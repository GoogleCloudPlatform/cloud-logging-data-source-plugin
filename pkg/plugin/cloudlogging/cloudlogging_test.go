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

package cloudlogging_test

import (
	"errors"
	"testing"

	"cloud.google.com/go/logging/apiv2/loggingpb"
	"github.com/GoogleCloudPlatform/cloud-logging-data-source-plugin/pkg/plugin/cloudlogging"
	"github.com/grafana/grafana-plugin-sdk-go/data"
	"github.com/stretchr/testify/require"
	"google.golang.org/genproto/googleapis/api/monitoredres"
	ltype "google.golang.org/genproto/googleapis/logging/type"
	anypb "google.golang.org/protobuf/types/known/anypb"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestGetLogEntryMessage(t *testing.T) {
	t.Parallel()
	type expectedResult struct {
		message string
		err     error
	}

	testCases := []struct {
		name     string
		entry    *loggingpb.LogEntry
		expected *expectedResult
	}{
		{
			name:  "Empty payload",
			entry: &loggingpb.LogEntry{},
			expected: &expectedResult{
				err: errors.New("empty payload <nil>"),
			},
		},
		{
			name: "Text payload",
			entry: &loggingpb.LogEntry{
				Payload: &loggingpb.LogEntry_TextPayload{
					TextPayload: "INFO [08-31|11:30:23] Starting Grafana logger=settings version=9.0.2 commit=0641b5d0c branch=HEAD compiled=2022-06-28T07:24:40-04:00",
				},
			},
			expected: &expectedResult{
				message: "INFO [08-31|11:30:23] Starting Grafana logger=settings version=9.0.2 commit=0641b5d0c branch=HEAD compiled=2022-06-28T07:24:40-04:00",
			},
		},
		{
			name: "Proto payload",
			entry: &loggingpb.LogEntry{
				Payload: &loggingpb.LogEntry_ProtoPayload{
					ProtoPayload: &anypb.Any{
						TypeUrl: `type.googleapis.com/google.cloud.audit.AuditLog`,
						Value:   []byte(`Protobuf Payload message`),
					},
				},
			},
			expected: &expectedResult{
				message: loggingpb.LogEntry_ProtoPayload{
					ProtoPayload: &anypb.Any{
						TypeUrl: `type.googleapis.com/google.cloud.audit.AuditLog`,
						Value:   []byte(`Protobuf Payload message`),
					},
				}.ProtoPayload.String(),
			},
		},
		{
			name: "JSON payload, no message",
			entry: &loggingpb.LogEntry{
				Payload: &loggingpb.LogEntry_JsonPayload{
					JsonPayload: &structpb.Struct{
						Fields: map[string]*structpb.Value{
							"severity": {
								Kind: &structpb.Value_StringValue{StringValue: "INFO"},
							},
							"database_role": {
								Kind: &structpb.Value_StringValue{StringValue: "user"},
							},
						},
					},
				},
			},
			expected: &expectedResult{
				message: "{\"database_role\":\"user\",\"severity\":\"INFO\"}",
			},
		},
		{
			name: "JSON payload, with message",
			entry: &loggingpb.LogEntry{
				Payload: &loggingpb.LogEntry_JsonPayload{
					JsonPayload: &structpb.Struct{
						Fields: map[string]*structpb.Value{
							"message": {
								Kind: &structpb.Value_StringValue{StringValue: "Message body"},
							},
							"severity": {
								Kind: &structpb.Value_StringValue{StringValue: "INFO"},
							},
							"database_role": {
								Kind: &structpb.Value_StringValue{StringValue: "user"},
							},
						},
					},
				},
			},
			expected: &expectedResult{
				message: "Message body",
			},
		},
		{
			name: "JSON payload, with empty string message",
			entry: &loggingpb.LogEntry{
				Payload: &loggingpb.LogEntry_JsonPayload{
					JsonPayload: &structpb.Struct{
						Fields: map[string]*structpb.Value{
							"message": {
								Kind: &structpb.Value_StringValue{StringValue: ""},
							},
							"data": {
								Kind: &structpb.Value_StringValue{StringValue: "some data"},
							},
						},
					},
				},
			},
			expected: &expectedResult{
				message: "\"\"",
			},
		},
		{
			name: "JSON payload, with complex message field",
			entry: &loggingpb.LogEntry{
				Payload: &loggingpb.LogEntry_JsonPayload{
					JsonPayload: &structpb.Struct{
						Fields: map[string]*structpb.Value{
							"message": {
								Kind: &structpb.Value_StructValue{
									StructValue: &structpb.Struct{
										Fields: map[string]*structpb.Value{
											"text": {Kind: &structpb.Value_StringValue{StringValue: "nested message"}},
											"code": {Kind: &structpb.Value_NumberValue{NumberValue: 123}},
										},
									},
								},
							},
						},
					},
				},
			},
			expected: &expectedResult{
				message: "{\"code\":123,\"text\":\"nested message\"}",
			},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			message, err := cloudlogging.GetLogEntryMessage(tc.entry)

			if tc.expected.err != nil {
				require.ErrorContains(t, err, tc.expected.err.Error())
			} else {
				require.NoError(t, err)
			}
			require.Equal(t, tc.expected.message, message)
		})
	}
}

func TestGetLogLevel(t *testing.T) {
	t.Parallel()
	testCases := []struct {
		name            string
		gcpSeverity     ltype.LogSeverity
		grafanaSeverity string
	}{
		{
			name:            ltype.LogSeverity_EMERGENCY.String(),
			gcpSeverity:     ltype.LogSeverity_EMERGENCY,
			grafanaSeverity: "critical",
		},
		{
			name:            ltype.LogSeverity_ALERT.String(),
			gcpSeverity:     ltype.LogSeverity_ALERT,
			grafanaSeverity: "alert",
		},
		{
			name:            ltype.LogSeverity_CRITICAL.String(),
			gcpSeverity:     ltype.LogSeverity_CRITICAL,
			grafanaSeverity: "critical",
		},
		{
			name:            ltype.LogSeverity_ERROR.String(),
			gcpSeverity:     ltype.LogSeverity_ERROR,
			grafanaSeverity: "error",
		},
		{
			name:            ltype.LogSeverity_WARNING.String(),
			gcpSeverity:     ltype.LogSeverity_WARNING,
			grafanaSeverity: "warning",
		},
		{
			name:            ltype.LogSeverity_NOTICE.String(),
			gcpSeverity:     ltype.LogSeverity_NOTICE,
			grafanaSeverity: "notice",
		},
		{
			name:            ltype.LogSeverity_INFO.String(),
			gcpSeverity:     ltype.LogSeverity_INFO,
			grafanaSeverity: "info",
		},
		{
			name:            ltype.LogSeverity_DEBUG.String(),
			gcpSeverity:     ltype.LogSeverity_DEBUG,
			grafanaSeverity: "debug",
		},
		{
			name:            ltype.LogSeverity_DEFAULT.String(),
			gcpSeverity:     ltype.LogSeverity_DEFAULT,
			grafanaSeverity: "info",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			require.Equal(t, tc.grafanaSeverity, cloudlogging.GetLogLevel(tc.gcpSeverity))
		})
	}
}

func TestGetLogLabels(t *testing.T) {
	testCases := []struct {
		name     string
		entry    *loggingpb.LogEntry
		expected data.Labels
	}{
		{
			name: "no labels or resource",
			entry: &loggingpb.LogEntry{
				InsertId: "insert-id",
			},
			expected: data.Labels{
				"id":    "insert-id",
				"level": "info",
			},
		},
		{
			name: "no log labels, but resource with labels",
			entry: &loggingpb.LogEntry{
				InsertId: "insert-id",
				Resource: &monitoredres.MonitoredResource{
					Labels: map[string]string{
						"instance_id": "123456",
					},
					Type: "gce_instance",
				},
			},
			expected: data.Labels{
				"id":                          "insert-id",
				"resource.labels.instance_id": "123456",
				"resource.type":               "gce_instance",
				"level":                       "info",
			},
		},
		{
			name: "log labels and resource with labels",
			entry: &loggingpb.LogEntry{
				InsertId: "insert-id2",
				Labels: map[string]string{
					"pid":            "111",
					"LOG_BUCKET_NUM": "1",
				},
				Resource: &monitoredres.MonitoredResource{
					Labels: map[string]string{
						"instance_id": "98765",
					},
					Type: "cloudsql_database",
				},
			},
			expected: data.Labels{
				"id":                          "insert-id2",
				"labels.\"pid\"":              "111",
				"labels.\"LOG_BUCKET_NUM\"":   "1",
				"resource.labels.instance_id": "98765",
				"resource.type":               "cloudsql_database",
				"level":                       "info",
			},
		},
		{
			name: "JSON payload with nested fields",
			entry: &loggingpb.LogEntry{
				InsertId: "insert-id4",
				Labels: map[string]string{
					"logging.googleapis.com/instrumentation_source": "agent.googleapis.com/thirdparty",
					"LOG_BUCKET_NUM": "1",
				},
				Severity: ltype.LogSeverity_ALERT,
				Payload: &loggingpb.LogEntry_JsonPayload{
					JsonPayload: &structpb.Struct{
						Fields: map[string]*structpb.Value{
							"tid":        {Kind: &structpb.Value_NumberValue{NumberValue: 222}},
							"db":         {Kind: &structpb.Value_StringValue{StringValue: "database-experiencing-error"}},
							"is_serious": {Kind: &structpb.Value_BoolValue{BoolValue: true}},
							"message":    {Kind: &structpb.Value_StringValue{StringValue: "Something very bad happened!"}},
							"service_context": {Kind: &structpb.Value_StructValue{
								StructValue: &structpb.Struct{
									Fields: map[string]*structpb.Value{
										"service": {Kind: &structpb.Value_StringValue{StringValue: "some-service"}},
										"version": {Kind: &structpb.Value_StringValue{StringValue: "v42"}},
									},
								},
							}},
						},
					},
				},
				Resource: &monitoredres.MonitoredResource{
					Labels: map[string]string{
						"instance_id": "98765",
					},
					Type: "gce_instance",
				},
			},
			expected: data.Labels{
				"id": "insert-id4",
				"labels.\"logging.googleapis.com/instrumentation_source\"": "agent.googleapis.com/thirdparty",
				"jsonPayload.tid":                     "222",
				"jsonPayload.db":                      "database-experiencing-error",
				"jsonPayload.is_serious":              "true",
				"labels.\"LOG_BUCKET_NUM\"":           "1",
				"resource.labels.instance_id":         "98765",
				"resource.type":                       "gce_instance",
				"level":                               "alert",
				"jsonPayload.service_context.service": "some-service",
				"jsonPayload.service_context.version": "v42",
			},
		},
		{
			name: "Text payload",
			entry: &loggingpb.LogEntry{
				InsertId: "insert-id5",
				Payload: &loggingpb.LogEntry_TextPayload{
					TextPayload: "This is a text log message",
				},
			},
			expected: data.Labels{
				"id":          "insert-id5",
				"level":       "info",
				"textPayload": "This is a text log message",
			},
		},
		{
			name: "Trace and span data",
			entry: &loggingpb.LogEntry{
				InsertId: "insert-id6",
				Trace:    "projects/my-project/traces/06796866738c859f2f19b7cfb3214824",
				SpanId:   "000000000000004a",
			},
			expected: data.Labels{
				"id":      "insert-id6",
				"level":   "info",
				"trace":   "projects/my-project/traces/06796866738c859f2f19b7cfb3214824",
				"traceId": "06796866738c859f2f19b7cfb3214824",
				"spanId":  "000000000000004a",
			},
		},
		{
			name: "JSON payload with various field types",
			entry: &loggingpb.LogEntry{
				InsertId: "insert-id7",
				Payload: &loggingpb.LogEntry_JsonPayload{
					JsonPayload: &structpb.Struct{
						Fields: map[string]*structpb.Value{
							"string_field": {Kind: &structpb.Value_StringValue{StringValue: "test"}},
							"number_field": {Kind: &structpb.Value_NumberValue{NumberValue: 42.5}},
							"bool_field":   {Kind: &structpb.Value_BoolValue{BoolValue: false}},
							"null_field":   {Kind: &structpb.Value_NullValue{}},
							"list_field": {Kind: &structpb.Value_ListValue{
								ListValue: &structpb.ListValue{
									Values: []*structpb.Value{
										{Kind: &structpb.Value_StringValue{StringValue: "item1"}},
										{Kind: &structpb.Value_NumberValue{NumberValue: 2}},
									},
								},
							}},
						},
					},
				},
			},
			expected: data.Labels{
				"id":                       "insert-id7",
				"level":                    "info",
				"jsonPayload.string_field": "test",
				"jsonPayload.number_field": "42.5",
				"jsonPayload.bool_field":   "false",
				"jsonPayload.null_field":   "null_value:NULL_VALUE",
				"jsonPayload.list_field":   "list_value:{values:{string_value:\"item1\"} values:{number_value:2}}",
			},
		},
		{
			name: "Proto payload with AuditLog",
			entry: &loggingpb.LogEntry{
				InsertId: "insert-id8",
				Payload: &loggingpb.LogEntry_ProtoPayload{
					ProtoPayload: &anypb.Any{
						TypeUrl: "type.googleapis.com/google.cloud.audit.AuditLog",
						Value:   []byte{}, // Empty for simplicity in test
					},
				},
			},
			expected: data.Labels{
				"id":    "insert-id8",
				"level": "info",
			},
		},
		{
			name: "Proto payload with RequestLog",
			entry: &loggingpb.LogEntry{
				InsertId: "insert-id9",
				Payload: &loggingpb.LogEntry_ProtoPayload{
					ProtoPayload: &anypb.Any{
						TypeUrl: "type.googleapis.com/google.appengine.logging.v1.RequestLog",
						Value:   []byte{}, // Empty for simplicity in test
					},
				},
			},
			expected: data.Labels{
				"id":    "insert-id9",
				"level": "info",
			},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			require.Equal(t, tc.expected, cloudlogging.GetLogLabels(tc.entry))
		})
	}
}
