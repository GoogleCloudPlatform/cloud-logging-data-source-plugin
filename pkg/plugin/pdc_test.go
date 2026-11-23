// Copyright 2022 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package plugin

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"cloud.google.com/go/auth/credentials"
	logging "cloud.google.com/go/logging/apiv2"
	"cloud.google.com/go/logging/apiv2/loggingpb"
	"github.com/GoogleCloudPlatform/cloud-logging-data-source-plugin/pkg/plugin/cloudlogging"
	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/proxy"
	"github.com/stretchr/testify/require"
	"google.golang.org/api/option"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

type socks5DialRecord struct {
	ATYP byte
	Host string
	Port uint16
}

// socks5TestServer is a minimal RFC 1928 / RFC 1929 SOCKS5 CONNECT proxy used
// to prove that gRPC and HTTP calls traverse the configured proxy and preserve
// unresolved domain names (ATYP 0x03) instead of resolving DNS locally.
type socks5TestServer struct {
	addr   string
	mu     sync.Mutex
	dials  []socks5DialRecord
	routes map[string]string
	conns  map[net.Conn]struct{}
	closed bool
}

func startSOCKS5TestServer(t *testing.T, routes map[string]string) *socks5TestServer {
	t.Helper()

	lis, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)

	s := &socks5TestServer{
		addr:   lis.Addr().String(),
		routes: routes,
		conns:  make(map[net.Conn]struct{}),
	}

	var wg sync.WaitGroup
	t.Cleanup(func() {
		_ = lis.Close()
		s.mu.Lock()
		s.closed = true
		for c := range s.conns {
			_ = c.Close()
		}
		s.mu.Unlock()
		wg.Wait()
	})

	wg.Add(1)
	go func() {
		defer wg.Done()
		for {
			conn, err := lis.Accept()
			if err != nil {
				return
			}
			s.mu.Lock()
			if s.closed {
				s.mu.Unlock()
				_ = conn.Close()
				return
			}
			s.conns[conn] = struct{}{}
			s.mu.Unlock()

			wg.Add(1)
			go func(c net.Conn) {
				defer wg.Done()
				defer func() {
					s.mu.Lock()
					delete(s.conns, c)
					s.mu.Unlock()
					_ = c.Close()
				}()
				s.handleConn(c)
			}(conn)
		}
	}()

	return s
}

func (s *socks5TestServer) handleConn(c net.Conn) {
	// RFC 1928 greeting: VER(1) NMETHODS(1) METHODS(NMETHODS)
	hdr := make([]byte, 2)
	if _, err := io.ReadFull(c, hdr); err != nil || hdr[0] != 0x05 {
		return
	}
	methods := make([]byte, int(hdr[1]))
	if _, err := io.ReadFull(c, methods); err != nil {
		return
	}

	// Accept username/password auth (0x02) when offered by Grafana's proxy dialer, else no-auth (0x00).
	chosen := byte(0x00)
	for _, m := range methods {
		if m == 0x02 {
			chosen = 0x02
			break
		}
	}
	if _, err := c.Write([]byte{0x05, chosen}); err != nil {
		return
	}

	if chosen == 0x02 {
		// RFC 1929: VER(1) ULEN(1) UNAME(ULEN) PLEN(1) PASSWD(PLEN)
		ahdr := make([]byte, 2)
		if _, err := io.ReadFull(c, ahdr); err != nil || ahdr[0] != 0x01 {
			return
		}
		if _, err := io.CopyN(io.Discard, c, int64(ahdr[1])); err != nil {
			return
		}
		plen := make([]byte, 1)
		if _, err := io.ReadFull(c, plen); err != nil {
			return
		}
		if _, err := io.CopyN(io.Discard, c, int64(plen[0])); err != nil {
			return
		}
		if _, err := c.Write([]byte{0x01, 0x00}); err != nil {
			return
		}
	}

	// RFC 1928 CONNECT request: VER(1) CMD(1) RSV(1) ATYP(1) DST.ADDR DST.PORT(2)
	req := make([]byte, 4)
	if _, err := io.ReadFull(c, req); err != nil || req[0] != 0x05 || req[1] != 0x01 {
		return
	}
	atyp := req[3]
	var host string
	switch atyp {
	case 0x01: // IPv4
		ip := make([]byte, 4)
		if _, err := io.ReadFull(c, ip); err != nil {
			return
		}
		host = net.IP(ip).String()
	case 0x03: // DOMAINNAME
		dlen := make([]byte, 1)
		if _, err := io.ReadFull(c, dlen); err != nil {
			return
		}
		domain := make([]byte, int(dlen[0]))
		if _, err := io.ReadFull(c, domain); err != nil {
			return
		}
		host = string(domain)
	case 0x04: // IPv6
		ip := make([]byte, 16)
		if _, err := io.ReadFull(c, ip); err != nil {
			return
		}
		host = net.IP(ip).String()
	default:
		_, _ = c.Write([]byte{0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0})
		return
	}

	portBytes := make([]byte, 2)
	if _, err := io.ReadFull(c, portBytes); err != nil {
		return
	}
	port := binary.BigEndian.Uint16(portBytes)

	s.mu.Lock()
	s.dials = append(s.dials, socks5DialRecord{ATYP: atyp, Host: host, Port: port})
	target := s.routes[fmt.Sprintf("%s:%d", host, port)]
	s.mu.Unlock()

	if target == "" {
		_, _ = c.Write([]byte{0x05, 0x04, 0x00, 0x01, 0, 0, 0, 0, 0, 0})
		return
	}

	upstream, err := net.DialTimeout("tcp", target, 2*time.Second)
	if err != nil {
		_, _ = c.Write([]byte{0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0})
		return
	}
	defer upstream.Close()

	// Success reply
	if _, err := c.Write([]byte{0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0}); err != nil {
		return
	}

	done := make(chan struct{}, 2)
	go func() {
		_, _ = io.Copy(upstream, c)
		_ = upstream.Close()
		done <- struct{}{}
	}()
	go func() {
		_, _ = io.Copy(c, upstream)
		_ = c.Close()
		done <- struct{}{}
	}()
	<-done
	_ = upstream.Close()
	_ = c.Close()
	<-done
}

func (s *socks5TestServer) records() []socks5DialRecord {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]socks5DialRecord, len(s.dials))
	copy(out, s.dials)
	return out
}

type fakePDCLoggingServer struct {
	loggingpb.UnimplementedLoggingServiceV2Server
}

func (s *fakePDCLoggingServer) ListLogEntries(_ context.Context, _ *loggingpb.ListLogEntriesRequest) (*loggingpb.ListLogEntriesResponse, error) {
	return &loggingpb.ListLogEntriesResponse{
		Entries: []*loggingpb.LogEntry{{InsertId: "pdc-entry-1"}},
	}, nil
}

func TestPDC_GRPCAndHTTPThroughSOCKS5(t *testing.T) {
	// 1. Start in-process fake gRPC Cloud Logging server.
	grpcLis, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	grpcSrv := grpc.NewServer()
	loggingpb.RegisterLoggingServiceV2Server(grpcSrv, &fakePDCLoggingServer{})
	go func() { _ = grpcSrv.Serve(grpcLis) }()
	t.Cleanup(grpcSrv.Stop)

	// 2. Start in-process fake OAuth2 token server.
	var oauthHits atomic.Int32
	oauthSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		oauthHits.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"pdc-jwt-token","token_type":"Bearer","expires_in":3600}`))
	}))
	t.Cleanup(oauthSrv.Close)

	// 3. Start a stalled listener for IAMCredentials to prove impersonation
	// preserves proxyCfg.HTTPClient.Timeout over SOCKS5.
	stalledLis, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	stalledStop := make(chan struct{})
	var stalledWG sync.WaitGroup
	stalledWG.Add(1)
	go func() {
		defer stalledWG.Done()
		for {
			c, err := stalledLis.Accept()
			if err != nil {
				return
			}
			stalledWG.Add(1)
			go func(conn net.Conn) {
				defer stalledWG.Done()
				defer conn.Close()
				<-stalledStop
			}(c)
		}
	}()
	t.Cleanup(func() {
		close(stalledStop)
		_ = stalledLis.Close()
		stalledWG.Wait()
	})

	// 4. Start in-process SOCKS5 server routing test hostnames (no real network egress).
	socks := startSOCKS5TestServer(t, map[string]string{
		"fake-logging.internal:443":       grpcLis.Addr().String(),
		"fake-oauth.internal:80":          oauthSrv.Listener.Addr().String(),
		"iamcredentials.googleapis.com:443": stalledLis.Addr().String(),
	})

	grafanaCfg := backend.NewGrafanaCfg(map[string]string{
		proxy.PluginSecureSocksProxyEnabled:       "true",
		proxy.PluginSecureSocksProxyProxyAddress:  socks.addr,
		proxy.PluginSecureSocksProxyAllowInsecure: "true",
	})
	ctx := backend.WithGrafanaConfig(context.Background(), grafanaCfg)
	settings := backend.DataSourceInstanceSettings{
		UID:      "pdc-test-uid",
		Type:     "googlecloud-logging-datasource",
		Name:     "pdc-test-logging",
		JSONData: json.RawMessage(`{"authenticationType":"jwt","enableSecureSocksProxy":true}`),
	}

	proxyCfg, err := buildProxyConfig(ctx, settings)
	require.NoError(t, err)
	require.NotNil(t, proxyCfg)
	t.Cleanup(func() { proxyCfg.HTTPClient.CloseIdleConnections() })

	t.Run("gRPC ListLogEntries traverses SOCKS5 preserving hostname", func(t *testing.T) {
		lClient, err := logging.NewClient(
			ctx,
			option.WithEndpoint("fake-logging.internal:443"),
			option.WithoutAuthentication(),
			option.WithGRPCDialOption(grpc.WithTransportCredentials(insecure.NewCredentials())),
			option.WithGRPCDialOption(proxyCfg.GRPCDialOption),
		)
		require.NoError(t, err)
		defer lClient.Close()

		callCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		it := lClient.ListLogEntries(callCtx, &loggingpb.ListLogEntriesRequest{
			ResourceNames: []string{"projects/pdc-project"},
			PageSize:      1,
		})
		entry, err := it.Next()
		require.NoError(t, err)
		require.Equal(t, "pdc-entry-1", entry.GetInsertId())

		require.Contains(t, socks.records(), socks5DialRecord{
			ATYP: 0x03,
			Host: "fake-logging.internal",
			Port: 443,
		})
	})

	t.Run("JWT token exchange traverses SOCKS5 preserving hostname", func(t *testing.T) {
		saJSON, err := json.Marshal(serviceAccountJSON{
			Type:        "service_account",
			ProjectID:   "pdc-project",
			PrivateKey:  testPrivateKeyPEM(t),
			ClientEmail: "sa@pdc-project.iam.gserviceaccount.com",
			TokenURI:    "http://fake-oauth.internal/token",
		})
		require.NoError(t, err)

		creds, err := credentials.NewCredentialsFromJSON(credentials.ServiceAccount, saJSON, &credentials.DetectOptions{
			Scopes: []string{"https://www.googleapis.com/auth/logging.read"},
			Client: proxyCfg.HTTPClient,
		})
		require.NoError(t, err)

		tok, err := creds.Token(ctx)
		require.NoError(t, err)
		require.Equal(t, "pdc-jwt-token", tok.Value)
		require.GreaterOrEqual(t, oauthHits.Load(), int32(1))
		require.Contains(t, socks.records(), socks5DialRecord{
			ATYP: 0x03,
			Host: "fake-oauth.internal",
			Port: 80,
		})
	})

	t.Run("impersonation routes base and IAM HTTP calls over SOCKS5 and honors HTTPClient.Timeout", func(t *testing.T) {
		saJSON, err := json.Marshal(serviceAccountJSON{
			Type:        "service_account",
			ProjectID:   "pdc-project",
			PrivateKey:  testPrivateKeyPEM(t),
			ClientEmail: "sa@pdc-project.iam.gserviceaccount.com",
			TokenURI:    "http://fake-oauth.internal/token",
		})
		require.NoError(t, err)

		// Clone ProxyConfig with a short HTTPClient.Timeout to verify NewImpersonationTokenSource preserves it.
		shortProxyCfg := &cloudlogging.ProxyConfig{
			GRPCDialOption: proxyCfg.GRPCDialOption,
			HTTPClient: &http.Client{
				Transport: proxyCfg.HTTPClient.Transport,
				Timeout:   250 * time.Millisecond,
			},
		}

		ts, err := cloudlogging.NewImpersonationTokenSource(ctx, saJSON, "target@pdc-project.iam.gserviceaccount.com", "", shortProxyCfg)
		require.NoError(t, err)

		start := time.Now()
		_, err = ts.Token()
		elapsed := time.Since(start)
		require.Error(t, err)
		require.Less(t, elapsed, 3*time.Second, "impersonation HTTP client should enforce proxyCfg.HTTPClient.Timeout")

		require.Contains(t, socks.records(), socks5DialRecord{
			ATYP: 0x03,
			Host: "iamcredentials.googleapis.com",
			Port: 443,
		})
	})
}
