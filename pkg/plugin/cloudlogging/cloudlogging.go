package cloudlogging

import (
	"fmt"
	"strings"

	"github.com/grafana/grafana-plugin-sdk-go/data"
	ltype "google.golang.org/genproto/googleapis/logging/type"
	loggingpb "google.golang.org/genproto/googleapis/logging/v2"
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
		labels[k] = v
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
				labels[k] = fieldToLabel(v)
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

// fieldToLabel converts a LogEntry Field value to a stringified version
func fieldToLabel(field *structpb.Value) string {
	switch t := field.GetKind().(type) {
	case *structpb.Value_NumberValue:
		return fmt.Sprintf("%v", t.NumberValue)
	case *structpb.Value_BoolValue:
		return fmt.Sprintf("%t", t.BoolValue)
	case *structpb.Value_StringValue:
		return t.StringValue
	default:
		return field.String()
	}
}
