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
	requireLogLinesFrame(t, frame, refID)
	require.Equal(t, 1, frame.Rows())
	require.Equal(t, time.UnixMilli(1660920349373).UTC(), frame.Fields[0].At(0).(time.Time).UTC())
	require.Equal(t, "Full log message from this GCE instance", frame.Fields[1].At(0))
	require.Equal(t, "info", frame.Fields[2].At(0))
	require.Equal(t, insertID, frame.Fields[3].At(0))
	require.JSONEq(t, `{
		"labels.\"custom_label\"": "custom_value",
		"labels.\"instance_id\"": "unique",
		"resource.type": "gce_instance",
		"textPayload": "Full log message from this GCE instance",
		"trace": "projects/xxx/traces/c0e331eab1515bbcd1b8306029902ff7"
	}`, string(frame.Fields[4].At(0).(json.RawMessage)))
	require.Equal(t, "c0e331eab1515bbcd1b8306029902ff7", *frame.Fields[5].At(0).(*string))

	// The wire format must advertise the dataplane log-lines type so Grafana
	// picks the dataplane parser rather than the legacy one.
	serialized, err := frame.MarshalJSON()
	require.NoError(t, err)
	var wire struct {
		Schema struct {
			Name  string `json:"name"`
			RefID string `json:"refId"`
			Meta  struct {
				Type                   string `json:"type"`
				TypeVersion            []int  `json:"typeVersion"`
				PreferredVisualization string `json:"preferredVisualisationType"`
			} `json:"meta"`
			Fields []struct {
				Name string `json:"name"`
				Type string `json:"type"`
			} `json:"fields"`
		} `json:"schema"`
	}
	require.NoError(t, json.Unmarshal(serialized, &wire))
	require.Equal(t, refID, wire.Schema.Name)
	require.Equal(t, refID, wire.Schema.RefID)
	require.Equal(t, "log-lines", wire.Schema.Meta.Type)
	require.Equal(t, []int{0, 0}, wire.Schema.Meta.TypeVersion)
	require.Equal(t, "logs", wire.Schema.Meta.PreferredVisualization)
	var names, types []string
	for _, f := range wire.Schema.Fields {
		names = append(names, f.Name)
		types = append(types, f.Type)
	}
	require.Equal(t, []string{"timestamp", "body", "severity", "id", "labels", "traceId"}, names)
	require.Equal(t, []string{"time", "string", "string", "string", "other", "string"}, types)
	client.AssertExpectations(t)
}

// requireLogLinesFrame asserts the frame-level invariants of the dataplane
// logs contract: one frame per query, named and tagged with the refId.
func requireLogLinesFrame(t *testing.T, frame *data.Frame, refID string) {
	t.Helper()
	require.Equal(t, refID, frame.Name)
	require.Equal(t, refID, frame.RefID)
	require.Equal(t, data.FrameTypeLogLines, frame.Meta.Type)
	require.Equal(t, data.FrameTypeVersion{0, 0}, frame.Meta.TypeVersion)
	require.Equal(t, data.VisTypeLogs, string(frame.Meta.PreferredVisualization))
	require.Len(t, frame.Fields, 6)
	for i, name := range []string{"timestamp", "body", "severity", "id", "labels", "traceId"} {
		require.Equal(t, name, frame.Fields[i].Name)
	}
}

// queryLogs runs a single query against a mocked client returning the given
// entries and returns the frames of the response.
func queryLogs(t *testing.T, entries []*loggingpb.LogEntry) (string, data.Frames) {
	t.Helper()
	to := time.Now()
	from := to.Add(-1 * time.Hour)
	client := mocks.NewAPI(t)
	client.On("ListLogs", mock.Anything, mock.Anything).Return(entries, nil)
	client.On("Close").Return(nil)

	ds := CloudLoggingDatasource{client: client}
	refID := "logs"
	resp, err := ds.QueryData(context.Background(), &backend.QueryDataRequest{
		Queries: []backend.DataQuery{
			{
				JSON:          []byte(`{"projectId": "testing", "queryText": "resource.type = \"testing\""}`),
				RefID:         refID,
				TimeRange:     backend.TimeRange{From: from, To: to},
				MaxDataPoints: 20,
			},
		},
	})
	ds.Dispose()
	require.NoError(t, err)
	require.NoError(t, resp.Responses[refID].Error)
	return refID, resp.Responses[refID].Frames
}

func TestQueryData_MultipleLogs(t *testing.T) {
	base := time.UnixMilli(1660920349373)
	entries := []*loggingpb.LogEntry{
		{
			InsertId:  "insert-1",
			Timestamp: timestamppb.New(base),
			Severity:  ltype.LogSeverity_ERROR,
			Trace:     "projects/proj-a/traces/aaaa",
			Payload:   &loggingpb.LogEntry_TextPayload{TextPayload: "first"},
		},
		{
			InsertId:  "insert-2",
			Timestamp: timestamppb.New(base.Add(-time.Second)),
			Severity:  ltype.LogSeverity_DEFAULT,
			Payload:   &loggingpb.LogEntry_TextPayload{TextPayload: "second"},
		},
		{
			// No insert ID and no payload: must still yield a row with a
			// unique id rather than being dropped or colliding.
			Timestamp: timestamppb.New(base.Add(-2 * time.Second)),
			Severity:  ltype.LogSeverity_EMERGENCY,
		},
	}

	refID, frames := queryLogs(t, entries)
	require.Len(t, frames, 1, "all entries must land in a single frame")
	frame := frames[0]
	requireLogLinesFrame(t, frame, refID)
	require.Equal(t, 3, frame.Rows())

	var bodies, severities, ids []string
	var traceIDs []*string
	for i := 0; i < frame.Rows(); i++ {
		bodies = append(bodies, frame.Fields[1].At(i).(string))
		severities = append(severities, frame.Fields[2].At(i).(string))
		ids = append(ids, frame.Fields[3].At(i).(string))
		traceIDs = append(traceIDs, frame.Fields[5].At(i).(*string))
	}
	require.Equal(t, []string{"first", "second", ""}, bodies)
	require.Equal(t, []string{"error", "info", "critical"}, severities)
	require.Equal(t, []string{"insert-1", "insert-2", "logs_2"}, ids)
	require.NotNil(t, traceIDs[0])
	require.Equal(t, "aaaa", *traceIDs[0])
	require.Nil(t, traceIDs[1])
	require.Nil(t, traceIDs[2])

	// Order is preserved and timestamps are per row.
	require.Equal(t, base.UTC(), frame.Fields[0].At(0).(time.Time).UTC())
	require.Equal(t, base.Add(-2*time.Second).UTC(), frame.Fields[0].At(2).(time.Time).UTC())

	// Labels are per row and no longer duplicate the id/severity/traceId fields.
	require.JSONEq(t, `{"trace": "projects/proj-a/traces/aaaa", "textPayload": "first"}`, string(frame.Fields[4].At(0).(json.RawMessage)))
	require.JSONEq(t, `{}`, string(frame.Fields[4].At(2).(json.RawMessage)))
}

func TestQueryData_EmptyLogs(t *testing.T) {
	refID, frames := queryLogs(t, []*loggingpb.LogEntry{})
	require.Len(t, frames, 1, "an empty result still returns one frame so Grafana sees the schema")
	requireLogLinesFrame(t, frames[0], refID)
	require.Equal(t, 0, frames[0].Rows())
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
	client.On("ListProjects", mock.Anything, "").Return(expectedProjects, nil)

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

func TestCallResource_ProjectsWithQuery(t *testing.T) {
	expectedProjects := []string{"proj-a"}

	client := mocks.NewAPI(t)
	client.On("ListProjects", mock.Anything, "proj-a").Return(expectedProjects, nil)

	ds := &CloudLoggingDatasource{
		client: client,
	}

	sender := &responseSender{}
	err := ds.CallResource(context.Background(), &backend.CallResourceRequest{
		Path: "projects",
		URL:  "projects?query=proj-a",
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

func TestCallResource_LogBuckets_MissingProjectId(t *testing.T) {
	client := mocks.NewAPI(t)
	ds := &CloudLoggingDatasource{client: client}

	sender := &responseSender{}
	err := ds.CallResource(context.Background(), &backend.CallResourceRequest{
		Path: "logBuckets",
		URL:  "logBuckets",
	}, sender)

	require.NoError(t, err)
	require.NotNil(t, sender.resp)
	require.Equal(t, 400, sender.resp.Status)
	require.Contains(t, string(sender.resp.Body), "ProjectId")
}

func TestCallResource_LogViews_MissingProjectId(t *testing.T) {
	client := mocks.NewAPI(t)
	ds := &CloudLoggingDatasource{client: client}

	sender := &responseSender{}
	err := ds.CallResource(context.Background(), &backend.CallResourceRequest{
		Path: "logViews",
		URL:  "logViews?BucketId=global%2Fbuckets%2F_Default",
	}, sender)

	require.NoError(t, err)
	require.NotNil(t, sender.resp)
	require.Equal(t, 400, sender.resp.Status)
	require.Contains(t, string(sender.resp.Body), "ProjectId")
}

func TestCallResource_LogViews_MissingBucketId(t *testing.T) {
	client := mocks.NewAPI(t)
	ds := &CloudLoggingDatasource{client: client}

	sender := &responseSender{}
	err := ds.CallResource(context.Background(), &backend.CallResourceRequest{
		Path: "logViews",
		URL:  "logViews?ProjectId=my-project",
	}, sender)

	require.NoError(t, err)
	require.NotNil(t, sender.resp)
	require.Equal(t, 400, sender.resp.Status)
	require.Contains(t, string(sender.resp.Body), "BucketId")
}
