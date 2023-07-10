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

package cloudlogging

import (
	"encoding/json"
	"fmt"
	"strings"

	"cloud.google.com/go/logging/apiv2/loggingpb"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/grafana/grafana-plugin-sdk-go/data"
	rlpb "google.golang.org/genproto/googleapis/appengine/logging/v1"
	alpb "google.golang.org/genproto/googleapis/cloud/audit"
	ltype "google.golang.org/genproto/googleapis/logging/type"
	"google.golang.org/protobuf/types/known/structpb"
)

// GetLogEntryMessage gets the message body of a LogEntry based on what kind of payload it is
// If it's JSON, we look for the `message` field since the other fields will be added as labels
func GetLogEntryMessage(entry *loggingpb.LogEntry) (string, error) {
	switch t := entry.GetPayload().(type) {
	case *loggingpb.LogEntry_JsonPayload:
		if msg, ok := t.JsonPayload.Fields["message"]; ok {
			return msg.GetStringValue(), nil
		}
		return t.JsonPayload.String(), nil
	case *loggingpb.LogEntry_TextPayload:
		return t.TextPayload, nil
	case *loggingpb.LogEntry_ProtoPayload:
		return t.ProtoPayload.String(), nil
	default:
		return "", fmt.Errorf("unknown payload type %T", t)
	}
}

// GetLogLabels flattens a log entry's labels + resource labels into a map
func GetLogLabels(entry *loggingpb.LogEntry) data.Labels {
	labels := make(data.Labels)
	for k, v := range entry.GetLabels() {
		labels[fmt.Sprintf("labels.\"%s\"", k)] = v
	}

	labels["id"] = entry.GetInsertId()
	// This is how severity is set
	labels["level"] = GetLogLevel(entry.GetSeverity())

	resource := entry.GetResource()
	if resourceType := resource.GetType(); resourceType != "" {
		labels["resource.type"] = resourceType
	}
	// Add resource labels nested under `resource.labels.`
	for k, v := range resource.GetLabels() {
		labels[fmt.Sprintf("resource.labels.%s", k)] = v
	}
	switch t := entry.GetPayload().(type) {
	case *loggingpb.LogEntry_JsonPayload:
		fields := t.JsonPayload.GetFields()
		for k, v := range fields {
			if strings.ToLower(k) != "message" {
				fieldToLabels(labels, fmt.Sprintf("jsonPayload.%s", k), v)
			}
		}
	case *loggingpb.LogEntry_ProtoPayload:
		typeUrl := t.ProtoPayload.TypeUrl
		if strings.HasSuffix(typeUrl, "AuditLog") {
			var a alpb.AuditLog
			if err := t.ProtoPayload.UnmarshalTo(&a); err != nil {
				log.DefaultLogger.Error("Could not get AuditLog payload out of LogEntry: %v", err)
			} else {
				byteArr, _ := json.Marshal(a)
				var inInterface map[string]*structpb.Value
				json.Unmarshal(byteArr, &inInterface)
				for k, v := range inInterface {
					fieldToLabels(labels, fmt.Sprintf("protoPayload.%s", k), v)
				}
			}
		} else if strings.HasSuffix(typeUrl, "RequestLog") {
			var r rlpb.RequestLog
			if err := t.ProtoPayload.UnmarshalTo(&r); err != nil {
				log.DefaultLogger.Error("Could not get RequestLog payload out of LogEntry: %v", err)
			} else {
				byteArr, _ := json.Marshal(r)
				var inInterface map[string]*structpb.Value
				json.Unmarshal(byteArr, &inInterface)
				for k, v := range inInterface {
					fieldToLabels(labels, fmt.Sprintf("protoPayload.%s", k), v)
				}
			}
		}
	}
	// If httpRequest exists in the log entry, include it too
	httpRequest := entry.GetHttpRequest()
	if httpRequest != nil {
		byteArr, _ := json.Marshal(httpRequest)
		var inInterface map[string]interface{}
		json.Unmarshal(byteArr, &inInterface)
		for k, v := range inInterface {
			if k == "latency" {
				labels["httpRequest.latency"] = httpRequest.Latency.AsDuration().String()
			} else {
				labels[fmt.Sprintf("httpRequest.%s", k)] = fmt.Sprintf("%v", v)
			}
		}
	}

	// Add trace data
	traceId := entry.GetTrace()
	spanId := entry.GetSpanId()
	if traceId != "" {
		labels["trace"] = entry.GetTrace()
	}
	if spanId != "" {
		labels["spanId"] = entry.GetSpanId()
	}

	return labels
}

// GetLogLevel maps the string value of a LogSeverity to one supported by Grafana
func GetLogLevel(severity ltype.LogSeverity) string {
	switch severity {
	case ltype.LogSeverity_EMERGENCY:
		return "critical"
	case ltype.LogSeverity_DEFAULT:
		return "info"
	// Other levels already map to supported values
	default:
		return strings.ToLower(severity.String())
	}
}

// fieldToLabels converts a LogEntry Field value to a stringified version,
// recursively converting nested structs.
func fieldToLabels(labels data.Labels, fieldName string, field *structpb.Value) {
	switch t := field.GetKind().(type) {
	case *structpb.Value_NumberValue:
		labels[fieldName] = fmt.Sprintf("%v", t.NumberValue)
	case *structpb.Value_BoolValue:
		labels[fieldName] = fmt.Sprintf("%t", t.BoolValue)
	case *structpb.Value_StringValue:
		labels[fieldName] = t.StringValue
	case *structpb.Value_StructValue:
		for key, value := range t.StructValue.GetFields() {
			fieldToLabels(labels, fmt.Sprintf("%s.%s", fieldName, key), value)
		}
	default:
		labels[fieldName] = field.String()
	}
}
