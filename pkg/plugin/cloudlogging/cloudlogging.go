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
	"strconv"
	"strings"

	"cloud.google.com/go/logging/apiv2/loggingpb"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/grafana/grafana-plugin-sdk-go/data"
	"google.golang.org/genproto/googleapis/cloud/audit"
	_ "google.golang.org/genproto/googleapis/cloud/bigquery/logging/v1"
	ltype "google.golang.org/genproto/googleapis/logging/type"
	"google.golang.org/protobuf/encoding/protojson"
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
		if t.ProtoPayload.TypeUrl == "type.googleapis.com/google.cloud.audit.AuditLog" {
			a := &audit.AuditLog{}

			if err := t.ProtoPayload.UnmarshalTo(a); err != nil {
				return t.ProtoPayload.String(), fmt.Errorf("error unmarshaling Any to AuditLog: %v\n", err)
			}

			messageJSON, err := protojson.Marshal(a)
			if err != nil {
				return t.ProtoPayload.String(), fmt.Errorf("error unmarshaling AuditLog to JSON byte[]: %v\n", err)
			}

			return string(messageJSON), nil
		}

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
		if t.ProtoPayload.TypeUrl == "type.googleapis.com/google.cloud.audit.AuditLog" {
			labels["protoPayload.@type"] = t.ProtoPayload.TypeUrl
			a := &audit.AuditLog{}
			if err := t.ProtoPayload.UnmarshalTo(a); err != nil {
				log.DefaultLogger.Warn("failed Any to AuditLog", "error", err)
				break
			}
			messageJSON, err := protojson.Marshal(a)
			if err != nil {
				break
			}
			var auditLogMap map[string]interface{}
			if err = json.Unmarshal(messageJSON, &auditLogMap); err != nil {
				break
			}

			for k, v := range auditLogMap {
				interfaceToLabels(labels, fmt.Sprintf("protoPayload.%s", k), v)
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

	return labels
}

// GetLogLevel maps the string value of a LogSeverity to one supported by Grafana
func GetLogLevel(severity ltype.LogSeverity) string {
	switch severity {
	case ltype.LogSeverity_EMERGENCY:
		return "critical"
	case ltype.LogSeverity_DEFAULT:
		return "debug"
	// Other levels already map to supported values
	default:
		return strings.ToLower(severity.String())
	}
}

// interfaceToLabels converts an interface{} value to a stringified version,
// recursively converting nested structs.
func interfaceToLabels(labels data.Labels, fieldName string, field interface{}) {
	switch t := field.(type) {
	case string:
		labels[fieldName] = t
	case bool:
		labels[fieldName] = strconv.FormatBool(t)
	case int:
		labels[fieldName] = strconv.FormatInt(int64(t), 10)
	case int8:
		labels[fieldName] = strconv.FormatInt(int64(t), 10)
	case int16:
		labels[fieldName] = strconv.FormatInt(int64(t), 10)
	case int32:
		labels[fieldName] = strconv.FormatInt(int64(t), 10)
	case int64:
		labels[fieldName] = strconv.FormatInt(t, 10)
	case uint:
		labels[fieldName] = strconv.FormatUint(uint64(t), 10)
	case uint8:
		labels[fieldName] = strconv.FormatUint(uint64(t), 10)
	case uint16:
		labels[fieldName] = strconv.FormatUint(uint64(t), 10)
	case uint32:
		labels[fieldName] = strconv.FormatUint(uint64(t), 10)
	case uint64:
		labels[fieldName] = strconv.FormatUint(t, 10)
	case float32:
		labels[fieldName] = strconv.FormatFloat(float64(t), 'E', 10, 32)
	case float64:
		labels[fieldName] = strconv.FormatFloat(t, 'E', 10, 64)
	case map[string]interface{}:
		for key, value := range t {
			interfaceToLabels(labels, fmt.Sprintf("%s.%s", fieldName, key), value)
		}
	case []interface{}:
		for index, value := range t {
			interfaceToLabels(labels, fmt.Sprintf("%s[%s]", fieldName, strconv.Itoa(index)), value)
		}
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
