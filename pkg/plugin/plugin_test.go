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
	require.True(t, ds.oauthPassThrough)
	require.Nil(t, ds.client)
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
