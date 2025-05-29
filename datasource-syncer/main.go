// Copyright 2024 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package main

import (
	"context"
	"crypto/fips140"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"flag"
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/go-kit/log"
	"github.com/go-kit/log/level"
	grafana "github.com/grafana/grafana-api-golang-client"
	"github.com/hashicorp/go-cleanhttp"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

var (
	credentialsFile = flag.String("query.credentials-file", "",
		"JSON-encoded credentials (service account or refresh token). Can be left empty if default credentials have sufficient permission.")

	datasourceUIDList = flag.String("datasource-uids", "", "datasource-uids is a comma separated list of data source UIDs to update.")

	grafanaAPIToken = flag.String("grafana-api-token", "",
		"grafana-api-token used to access Grafana. Can be created using: https://grafana.com/docs/grafana/latest/administration/service-accounts/#create-a-service-account-in-grafana")

	grafanaEndpoint = flag.String("grafana-api-endpoint", "", "grafana-api-endpoint is the endpoint of the Grafana instance that contains the data sources to update.")

	projectID = flag.String("project-id", "",
		"Project ID of the Google Cloud Logging scoping project to query. Queries sent to this project will union results from all projects within the scope.")

	certFile           = flag.String("tls-cert", "", "Path to the server TLS certificate.")
	keyFile            = flag.String("tls-key", "", "Path to the server TLS key.")
	caFile             = flag.String("tls-ca-cert", "", "Path to the server certificate authority")
	insecureSkipVerify = flag.Bool("insecure-skip-verify", false, "Skip TLS certificate verification")
)

func main() {
	flag.Parse()

	logger := log.NewJSONLogger(log.NewSyncWriter(os.Stderr))
	logger = log.With(logger, "ts", log.DefaultTimestampUTC)
	logger = log.With(logger, "caller", log.DefaultCaller)

	if !fips140.Enabled() {
		_ = logger.Log("msg", "FIPS mode not enabled")
		os.Exit(1)
	}

	if len(*datasourceUIDList) == 0 {
		//nolint:errcheck
		level.Error(logger).Log("msg", "--datasource-uid must be set")
		os.Exit(1)
	}

	if *grafanaAPIToken == "" {
		envToken := os.Getenv("GRAFANA_SERVICE_ACCOUNT_TOKEN")
		if envToken == "" {
			//nolint:errcheck
			level.Error(logger).Log("msg", "--grafana-api-token or the environment variable GRAFANA_SERVICE_ACCOUNT_TOKEN must be set")
			os.Exit(1)
		}
		grafanaAPIToken = &envToken
	}
	if *grafanaEndpoint == "" {
		//nolint:errcheck
		level.Error(logger).Log("msg", "--grafana-api-endpoint must be set")
		os.Exit(1)
	}

	if *projectID == "" {
		//nolint:errcheck
		level.Error(logger).Log("msg", "--project-id must be set")
		os.Exit(1)
	}

	client, err := getTLSClient(*certFile, *keyFile, *caFile, *insecureSkipVerify)
	if err != nil {
		//nolint:errcheck
		level.Error(logger).Log("msg", "couldn't create client", "err", err)
		os.Exit(1)
	}

	grafanaClient, err := grafana.New(*grafanaEndpoint, grafana.Config{
		APIKey: *grafanaAPIToken,
		Client: client,
	})
	if err != nil {
		//nolint:errcheck
		level.Error(logger).Log("msg", "couldn't create grafana client", "err", err)
		os.Exit(1)
	}

	token, err := getOAuth2Token(*credentialsFile)
	if err != nil {
		//nolint:errcheck
		level.Error(logger).Log("msg", "couldn't get Google OAuth2 token", "err", err)
		os.Exit(1)
	}

	dsSuccessfullyUpdated := []string{}
	dsErrors := []string{}
	datasourceUIDs := strings.Split(*datasourceUIDList, ",")
	for _, datasourceUID := range datasourceUIDs {
		datasourceUID = strings.TrimSpace(datasourceUID)
		if datasourceUID == "" {
			continue
		}

		dataSource, err := grafanaClient.DataSourceByUID(datasourceUID)
		if err != nil {
			dsErrors = append(dsErrors, datasourceUID)
			//nolint:errcheck
			level.Error(logger).Log("msg", fmt.Sprintf("error fetching data source config of data source uid: %s", datasourceUID), "err", err)
			continue
		}

		dataSource, err = buildUpdateDataSourceRequest(*dataSource, token, *projectID)
		if err != nil {
			dsErrors = append(dsErrors, datasourceUID)
			//nolint:errcheck
			level.Error(logger).Log("msg", fmt.Sprintf("couldn't build data source update request for data source uid: %s", datasourceUID), "err", err)
			continue
		}

		err = grafanaClient.UpdateDataSourceByUID(dataSource)
		if err != nil {
			dsErrors = append(dsErrors, datasourceUID)
			//nolint:errcheck
			level.Error(logger).Log("msg", fmt.Sprintf("couldn't send update data source request to data source id: %s", datasourceUID), "err", err)
			continue
		}
		dsSuccessfullyUpdated = append(dsSuccessfullyUpdated, datasourceUID)
	}
	if len(dsSuccessfullyUpdated) != 0 {
		//nolint:errcheck
		level.Info(logger).Log("msg", fmt.Sprintf("Updated Grafana data source uids: %s", dsSuccessfullyUpdated))
	}
	if len(dsErrors) != 0 {
		//nolint:errcheck
		level.Error(logger).Log("msg", fmt.Sprintf("Failed to update Grafana data source uids: %s", dsErrors))
		os.Exit(1)
	}
}

// getOAuth2Token generates an OAuth token based if a JSON file is provided or it will use the default credentials.
func getOAuth2Token(credentialsFile string) (string, error) {
	var err error
	var token oauth2.TokenSource
	if credentialsFile == "" {
		ctx := context.Background()
		token, err = google.DefaultTokenSource(ctx, "https://www.googleapis.com/auth/logging.read")
		if err != nil {
			return "", err
		}
	} else {
		jsonKey, err := os.ReadFile(credentialsFile)
		if err != nil {
			return "", fmt.Errorf("failed to read json key file: %v", err)
		}
		token, err = google.JWTAccessTokenSourceWithScope(jsonKey, "https://www.googleapis.com/auth/logging.read")
		if err != nil {
			return "", fmt.Errorf("could not generate token: %v", err)
		}
	}
	accessToken, err := token.Token()
	if err != nil {
		return "", err
	}
	return accessToken.AccessToken, nil
}

func buildUpdateDataSourceRequest(dataSource grafana.DataSource, token string, projectId string) (*grafana.DataSource, error) {
	if dataSource.Type != "googlecloud-logging-datasource" {
		return nil, errors.New("datasource type is not googlecloud-logging-datasource")
	}

	if dataSource.SecureJSONData == nil {
		dataSource.SecureJSONData = map[string]interface{}{}
	}
	dataSource.SecureJSONData["accessToken"] = token

	dataSource.JSONData["authenticationType"] = "accessToken"
	dataSource.JSONData["defaultProject"] = projectId

	return &dataSource, nil
}

func getTLSClient(certFile, keyFile, caFile string, insecureSkipVerify bool) (*http.Client, error) {
	if (certFile != "" || keyFile != "") && (certFile == "" || keyFile == "") {
		return nil, errors.New("--tls-cert and tls-key must both be set or unset")
	}

	if certFile == "" && keyFile == "" && caFile == "" && !insecureSkipVerify {
		return nil, nil
	}

	tlsConfig := &tls.Config{
		InsecureSkipVerify: insecureSkipVerify,
	}

	if certFile != "" && keyFile != "" {
		cert, err := tls.LoadX509KeyPair(certFile, keyFile)
		if err != nil {
			return nil, fmt.Errorf("unable to load server cert and key: %w", err)
		}
		tlsConfig.Certificates = []tls.Certificate{cert}
	}

	if caFile != "" {
		caCert, err := os.ReadFile(caFile)
		if err != nil {
			return nil, fmt.Errorf("unable to read ca cert: %w", err)
		}
		caCertPool := x509.NewCertPool()
		caCertPool.AppendCertsFromPEM(caCert)
		tlsConfig.RootCAs = caCertPool
	}

	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.TLSClientConfig = tlsConfig

	client := cleanhttp.DefaultClient()
	client.Transport = transport
	return client, nil
}
