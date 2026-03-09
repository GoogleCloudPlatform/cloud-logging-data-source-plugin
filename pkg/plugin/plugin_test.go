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
	"encoding/json"
	"errors"
	"testing"
	"time"

	"cloud.google.com/go/logging/apiv2/loggingpb"
	"github.com/GoogleCloudPlatform/cloud-logging-data-source-plugin/pkg/plugin/cloudlogging"
	"github.com/GoogleCloudPlatform/cloud-logging-data-source-plugin/pkg/plugin/mocks"
	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/data"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"google.golang.org/genproto/googleapis/api/monitoredres"
	ltype "google.golang.org/genproto/googleapis/logging/type"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// This is where the tests for the datasource backend live.
func TestQueryData(t *testing.T) {
	ds := CloudLoggingDatasource{}

	resp, err := ds.QueryData(
		context.Background(),
		&backend.QueryDataRequest{
			Queries: []backend.DataQuery{
				{RefID: "A"},
			},
		},
	)
	if err != nil {
		t.Error(err)
	}

	if len(resp.Responses) != 1 {
		t.Fatal("QueryData must return a response")
	}
}

func TestQueryData_InvalidJSON(t *testing.T) {
	client := mocks.NewAPI(t)
	ds := CloudLoggingDatasource{
		client: client,
	}
	refID := "test"
	resp, err := ds.QueryData(context.Background(), &backend.QueryDataRequest{
		Queries: []backend.DataQuery{
			{
				JSON:  []byte(`Not JSON`),
				RefID: refID,
			},
		},
	})

	require.NoError(t, err)
	require.Error(t, resp.Responses[refID].Error)
	require.Nil(t, resp.Responses[refID].Frames)
	client.AssertExpectations(t)
}

func TestQueryData_GCPError(t *testing.T) {
	to := time.Now()
	from := to.Add(-1 * time.Hour)
	expectedErr := errors.New("something was wrong with the request")

	client := mocks.NewAPI(t)
	client.On("ListLogs", mock.Anything, &cloudlogging.Query{
		ProjectID: "testing",
		Filter:    `resource.type = "testing"`,
		Limit:     20,
		TimeRange: struct {
			From string
			To   string
		}{
			From: from.Format(time.RFC3339),
			To:   to.Format(time.RFC3339),
		},
	}).Return(nil, expectedErr)

	ds := CloudLoggingDatasource{
		client: client,
	}
	refID := "test"
	resp, err := ds.QueryData(context.Background(), &backend.QueryDataRequest{
		Queries: []backend.DataQuery{
			{
				JSON:  []byte(`{"projectId": "testing", "queryText": "resource.type = \"testing\""}`),
				RefID: refID,
				TimeRange: backend.TimeRange{
					From: from,
					To:   to,
				},
				MaxDataPoints: 20,
			},
		},
	})

	require.NoError(t, err)
	require.ErrorContains(t, resp.Responses[refID].Error, expectedErr.Error())
	require.Nil(t, resp.Responses[refID].Frames)
	client.AssertExpectations(t)
}

func TestQueryData_SingleLog(t *testing.T) {
	to := time.Now()
	from := to.Add(-1 * time.Hour)
	// insertID and receivedAt are hardcoded to match the expected response
	insertID := "b6f39be2-b298-44da-9001-1f04e5756fa0"
	receivedAt := timestamppb.New(time.UnixMilli(1660920349373))
	trace := "projects/xxx/traces/c0e331eab1515bbcd1b8306029902ff7"

	logEntry := loggingpb.LogEntry{
		LogName: "organizations/1234567890/logs/cloudresourcemanager.googleapis.com%2Factivity",
		Resource: &monitoredres.MonitoredResource{
			Type:   "gce_instance",
			Labels: map[string]string{},
		},
		Timestamp:        receivedAt,
		ReceiveTimestamp: receivedAt,
		Severity:         ltype.LogSeverity_INFO,
		InsertId:         insertID,
		Trace:            trace,
		Labels: map[string]string{
			"instance_id":  "unique",
			"custom_label": "custom_value",
		},
		Payload: &loggingpb.LogEntry_TextPayload{
			TextPayload: "Full log message from this GCE instance",
		},
	}

	client := mocks.NewAPI(t)
	client.On("ListLogs", mock.Anything, &cloudlogging.Query{
		ProjectID: "testing",
		Filter:    `resource.type = "testing"`,
		Limit:     20,
		TimeRange: struct {
			From string
			To   string
		}{
			From: from.Format(time.RFC3339),
			To:   to.Format(time.RFC3339),
		},
	}).Return([]*loggingpb.LogEntry{&logEntry}, nil)
	client.On("Close").Return(nil)

	ds := CloudLoggingDatasource{
		client: client,
	}
	refID := "test"
	resp, err := ds.QueryData(context.Background(), &backend.QueryDataRequest{
		Queries: []backend.DataQuery{
			{
				JSON:  []byte(`{"projectId": "testing", "queryText": "resource.type = \"testing\""}`),
				RefID: refID,
				TimeRange: backend.TimeRange{
					From: from,
					To:   to,
				},
				MaxDataPoints: 20,
			},
		},
	})
	ds.Dispose()
	require.NoError(t, err)
	require.Len(t, resp.Responses[refID].Frames, 1)

	frame := resp.Responses[refID].Frames[0]
	require.Equal(t, insertID, frame.Name)
	require.Len(t, frame.Fields, 2)
	require.Equal(t, data.VisTypeLogs, string(frame.Meta.PreferredVisualization))

	expectedFrame := []byte(`{"schema":{"name":"b6f39be2-b298-44da-9001-1f04e5756fa0","meta":{"typeVersion":[0,0],"preferredVisualisationType":"logs"},"fields":[{"name":"time","type":"time","typeInfo":{"frame":"time.Time"}},{"name":"content","type":"string","typeInfo":{"frame":"string"},"labels":{"id":"b6f39be2-b298-44da-9001-1f04e5756fa0","labels.\"custom_label\"":"custom_value","labels.\"instance_id\"":"unique","level":"info","resource.type":"gce_instance","textPayload":"Full log message from this GCE instance","trace":"projects/xxx/traces/c0e331eab1515bbcd1b8306029902ff7","traceId":"c0e331eab1515bbcd1b8306029902ff7"}}]},"data":{"values":[[1660920349373],["Full log message from this GCE instance"]]}}`)

	serializedFrame, err := frame.MarshalJSON()
	require.NoError(t, err)
	require.Equal(t, string(expectedFrame), string(serializedFrame))
	client.AssertExpectations(t)
}

func TestNewCloudLoggingDatasource_OAuthPassthrough(t *testing.T) {
	jsonData := `{"oauthPassThru": true, "authenticationType": "oauthPassthrough", "defaultProject": "test-project"}`
	settings := backend.DataSourceInstanceSettings{
		JSONData: []byte(jsonData),
	}

	instance, err := NewCloudLoggingDatasource(context.Background(), settings)
	require.NoError(t, err)
	require.NotNil(t, instance)

	ds, ok := instance.(*CloudLoggingDatasource)
	require.True(t, ok)
	// The assertion has been fixed.
	require.Equal(t, true, ds.oauthPassThrough)
	require.Equal(t, "", ds.universeDomain)
	require.Nil(t, ds.client)
}

func TestNewCloudLoggingDatasource_UniverseDomain(t *testing.T) {
	jsonData := `{"oauthPassThru": true, "authenticationType": "oauthPassthrough", "defaultProject": "test-project", "universeDomain": "my-custom-domain.com"}`
	settings := backend.DataSourceInstanceSettings{
		JSONData: []byte(jsonData),
	}

	instance, err := NewCloudLoggingDatasource(context.Background(), settings)
	require.NoError(t, err)
	require.NotNil(t, instance)

	ds, ok := instance.(*CloudLoggingDatasource)
	require.True(t, ok)
	require.Equal(t, "my-custom-domain.com", ds.universeDomain)
}

func TestCreateOauthClient_Success(t *testing.T) {
	ds := &CloudLoggingDatasource{
		oauthPassThrough: true,
	}

	headers := map[string]string{
		"Authorization": "Bearer test-token-123",
	}

	client, err := ds.CreateOauthClient(context.Background(), headers)
	require.NoError(t, err)
	require.NotNil(t, client)
	defer client.Close()
}

func TestCreateOauthClient_MissingAuthHeader(t *testing.T) {
	ds := &CloudLoggingDatasource{
		oauthPassThrough: true,
	}

	headers := map[string]string{}

	client, err := ds.CreateOauthClient(context.Background(), headers)
	require.Error(t, err)
	require.ErrorContains(t, err, "missing or invalid Authorization header")
	require.Nil(t, client)
}

func TestCreateOauthClient_InvalidAuthHeader(t *testing.T) {
	ds := &CloudLoggingDatasource{
		oauthPassThrough: true,
	}

	headers := map[string]string{
		"Authorization": "Basic invalid-auth",
	}

	client, err := ds.CreateOauthClient(context.Background(), headers)
	require.Error(t, err)
	require.ErrorContains(t, err, "missing or invalid Authorization header")
	require.Nil(t, client)
}

// TestNewCloudLoggingDatasource_JWTPreferredOverLingeringAccessToken verifies
// that when a user selects JWT auth and provides a privateKey, a lingering
// accessToken in secureJsonData does NOT override the auth type (issue #151).
func TestNewCloudLoggingDatasource_JWTPreferredOverLingeringAccessToken(t *testing.T) {
	jsonData := `{"authenticationType": "jwt", "clientEmail": "test@test.iam.gserviceaccount.com", "defaultProject": "test-project", "tokenUri": "https://oauth2.googleapis.com/token"}`
	settings := backend.DataSourceInstanceSettings{
		JSONData: []byte(jsonData),
		DecryptedSecureJSONData: map[string]string{
			"privateKey":  "-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----\n",
			"accessToken": "lingering-access-token",
		},
	}

	// NewCloudLoggingDatasource will fail to create a real JWT client with
	// a fake key, but the important assertion is that it does NOT fail with
	// errMissingAccessToken — that would mean the access token override fired.
	_, err := NewCloudLoggingDatasource(context.Background(), settings)
	require.NotErrorIs(t, err, errMissingAccessToken, "JWT auth must be preferred over a lingering access token")
}

// TestNewCloudLoggingDatasource_AccessTokenFallbackWithoutPrivateKey verifies
// backward compat: if authenticationType defaults to jwt but no privateKey is
// present, a configured accessToken should still be used (pre-dropdown behavior).
func TestNewCloudLoggingDatasource_AccessTokenFallbackWithoutPrivateKey(t *testing.T) {
	jsonData := `{"authenticationType": "jwt", "defaultProject": "test-project"}`
	settings := backend.DataSourceInstanceSettings{
		JSONData: []byte(jsonData),
		DecryptedSecureJSONData: map[string]string{
			"accessToken": "my-access-token",
		},
	}

	instance, err := NewCloudLoggingDatasource(context.Background(), settings)
	require.NoError(t, err)
	require.NotNil(t, instance)
}

func TestNewCloudLoggingDatasource_AuthOverride(t *testing.T) {
	// Test case 1: JWT auth type + Private Key + Access Token => Should use JWT
	t.Run("JWT Auth with both private key and access token", func(t *testing.T) {
		jsonData := `{"authenticationType": "jwt", "defaultProject": "test-project"}`
		settings := backend.DataSourceInstanceSettings{
			JSONData: []byte(jsonData),
			DecryptedSecureJSONData: map[string]string{
				privateKeyKey:  "dummy-private-key",
				accessTokenKey: "dummy-access-token",
			},
		}

		_, err := NewCloudLoggingDatasource(context.Background(), settings)
		require.Error(t, err)
		require.NotEqual(t, errMissingAccessToken, err)
		require.Contains(t, err.Error(), "create client")
	})

	// Test case 2: JWT auth type + NO Private Key + Access Token => Should use Access Token
	t.Run("JWT Auth with NO private key and access token", func(t *testing.T) {
		jsonData := `{"authenticationType": "jwt", "defaultProject": "test-project"}`
		settings := backend.DataSourceInstanceSettings{
			JSONData: []byte(jsonData),
			DecryptedSecureJSONData: map[string]string{
				accessTokenKey: "dummy-access-token",
			},
		}

		inst, err := NewCloudLoggingDatasource(context.Background(), settings)
		require.NoError(t, err)
		require.NotNil(t, inst)

		ds := inst.(*CloudLoggingDatasource)
		require.NotNil(t, ds.client)
	})

	// Test case 3: OAuth auth type + Access Token => Should use OAuth Passthrough
	t.Run("OAuth Auth with lingering access token", func(t *testing.T) {
		jsonData := `{"oauthPassThru": true, "authenticationType": "oauthPassthrough", "defaultProject": "test-project"}`
		settings := backend.DataSourceInstanceSettings{
			JSONData: []byte(jsonData),
			DecryptedSecureJSONData: map[string]string{
				accessTokenKey: "dummy-access-token",
			},
		}

		inst, err := NewCloudLoggingDatasource(context.Background(), settings)
		require.NoError(t, err)
		require.NotNil(t, inst)

		ds, ok := inst.(*CloudLoggingDatasource)
		require.True(t, ok)
		require.Equal(t, true, ds.oauthPassThrough)
	})
}

// responseSender implements backend.CallResourceResponseSender for testing
type responseSender struct {
	resp *backend.CallResourceResponse
}

func (s *responseSender) Send(resp *backend.CallResourceResponse) error {
	s.resp = resp
	return nil
}

func TestCallResource_Projects(t *testing.T) {
	expectedProjects := []string{"project-a", "project-b", "project-c", "project-d", "project-e"}

	client := mocks.NewAPI(t)
	client.On("ListProjects", mock.Anything).Return(expectedProjects, nil)

	ds := &CloudLoggingDatasource{
		client: client,
	}

	sender := &responseSender{}
	err := ds.CallResource(context.Background(), &backend.CallResourceRequest{
		Path: "projects",
		URL:  "projects",
	}, sender)

	require.NoError(t, err)
	require.NotNil(t, sender.resp)
	require.Equal(t, 200, sender.resp.Status)

	var projects []string
	err = json.Unmarshal(sender.resp.Body, &projects)
	require.NoError(t, err)
	require.Equal(t, expectedProjects, projects)
	client.AssertExpectations(t)
}

func TestSanitizeErrorMessage_HTML(t *testing.T) {
	htmlErr := errors.New(`<html><head> <meta http-equiv="content-type" content="text/html;charset=utf-8"> <title>502 Server Error</title> </head> <body text=#000000 bgcolor=#ffffff> <h1>Error: Server Error</h1> <h2>The server encountered a temporary error and could not complete your request.<p>Please try again in 30 seconds.</h2> <h2></h2> </body></html>`)
	result := sanitizeErrorMessage(htmlErr)
	require.NotContains(t, result, "<html")
	require.NotContains(t, result, "<h1>")
	require.Contains(t, result, "Universe Domain")
}

func TestSanitizeErrorMessage_GRPCContentType(t *testing.T) {
	// Simulate gRPC transport error that doesn't include the full HTML body
	// but does mention the content-type text/html
	grpcErr := errors.New(`rpc error: code = Unavailable desc = transport: received the unexpected content-type "text/html;charset=utf-8"`)
	result := sanitizeErrorMessage(grpcErr)
	require.NotContains(t, result, "text/html")
	require.Contains(t, result, "Universe Domain")
}

func TestSanitizeErrorMessage_PlainText(t *testing.T) {
	plainErr := errors.New("rpc error: code = NotFound desc = Requested entity was not found.")
	result := sanitizeErrorMessage(plainErr)
	require.Equal(t, "rpc error: code = NotFound desc = Requested entity was not found.", result)
	require.NotContains(t, result, "Universe Domain")
}
