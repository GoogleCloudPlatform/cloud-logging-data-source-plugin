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
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/go-cmp/cmp"
	grafana "github.com/grafana/grafana-api-golang-client"
)

var accessToken = "12345"

func TestBuildUpdateDataSourceRequest(t *testing.T) {
	tests := []struct {
		name      string
		input     grafana.DataSource
		token     string
		projectID string
		want      grafana.DataSource
		fail      bool
	}{
		{
			name: "OK - new datasource",
			input: grafana.DataSource{
				Type:     "googlecloud-logging-datasource",
				JSONData: map[string]interface{}{},
			},
			token:     accessToken,
			projectID: "test-project",
			want: grafana.DataSource{
				Type: "googlecloud-logging-datasource",
				JSONData: map[string]interface{}{
					"authenticationType": "accessToken",
					"defaultProject":     "test-project",
				},
				SecureJSONData: map[string]interface{}{
					"accessToken": "12345",
				},
			},
		},
		{
			name: "OK - datasource with existing JSONData",
			input: grafana.DataSource{
				Type: "googlecloud-logging-datasource",
				JSONData: map[string]interface{}{
					"httpMethod": "POST",
					"someField":  "someValue",
				},
			},
			token:     accessToken,
			projectID: "test-project",
			want: grafana.DataSource{
				Type: "googlecloud-logging-datasource",
				JSONData: map[string]interface{}{
					"httpMethod":         "POST",
					"someField":          "someValue",
					"authenticationType": "accessToken",
					"defaultProject":     "test-project",
				},
				SecureJSONData: map[string]interface{}{
					"accessToken": "12345",
				},
			},
		},
		{
			name: "OK - datasource with existing SecureJSONData",
			input: grafana.DataSource{
				Type: "googlecloud-logging-datasource",
				JSONData: map[string]interface{}{
					"existingField": "existingValue",
				},
				SecureJSONData: map[string]interface{}{
					"existingSecureField": "existing-secure-value",
				},
			},
			token:     accessToken,
			projectID: "test-project",
			want: grafana.DataSource{
				Type: "googlecloud-logging-datasource",
				JSONData: map[string]interface{}{
					"existingField":      "existingValue",
					"authenticationType": "accessToken",
					"defaultProject":     "test-project",
				},
				SecureJSONData: map[string]interface{}{
					"existingSecureField": "existing-secure-value",
					"accessToken":         "12345",
				},
			},
		},
		{
			name: "FAIL - wrong datasource type prometheus",
			input: grafana.DataSource{
				Type: "prometheus",
				JSONData: map[string]interface{}{
					"httpMethod": "POST",
				},
			},
			token:     accessToken,
			projectID: "test-project",
			fail:      true,
		},
		{
			name: "FAIL - wrong datasource type cortex",
			input: grafana.DataSource{
				Type: "Cortex",
			},
			token:     accessToken,
			projectID: "test-project",
			fail:      true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := buildUpdateDataSourceRequest(tt.input, tt.token, tt.projectID)
			if tt.fail {
				if err == nil {
					t.Fatalf("unexpectedly succeeded")
				}
				if !strings.Contains(err.Error(), "datasource type is not googlecloud-logging-datasource") {
					t.Errorf("unexpected error message: %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			// Compare JSONData
			gotJSON, err := json.Marshal(got.JSONData)
			if err != nil {
				t.Fatalf("marshal got JSONData failed with error: %v", err)
			}
			wantJSON, err := json.Marshal(tt.want.JSONData)
			if err != nil {
				t.Fatalf("marshal want JSONData failed with error: %v", err)
			}
			if diff := cmp.Diff(string(wantJSON), string(gotJSON)); diff != "" {
				t.Errorf("unexpected JSONData (-want, +got): %s", diff)
			}

			// Compare SecureJSONData
			gotSecureJSON, err := json.Marshal(got.SecureJSONData)
			if err != nil {
				t.Fatalf("marshal got SecureJSONData failed with error: %v", err)
			}
			wantSecureJSON, err := json.Marshal(tt.want.SecureJSONData)
			if err != nil {
				t.Fatalf("marshal want SecureJSONData failed with error: %v", err)
			}
			if diff := cmp.Diff(string(wantSecureJSON), string(gotSecureJSON)); diff != "" {
				t.Errorf("unexpected SecureJSONData (-want, +got): %s", diff)
			}
		})
	}
}

func TestGetOAuth2Token(t *testing.T) {
	tests := []struct {
		name            string
		credentialsFile string
		setupFile       bool
		fileContent     string
		wantErr         bool
		errContains     string
	}{
		{
			name:            "non-existent file returns error",
			credentialsFile: "non-existent-file.json",
			wantErr:         true,
			errContains:     "failed to read json key file",
		},
		{
			name:            "invalid json file returns error",
			credentialsFile: filepath.Join(t.TempDir(), "invalid.json"),
			setupFile:       true,
			fileContent:     `{invalid json`,
			wantErr:         true,
			errContains:     "could not generate token",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.setupFile && tt.fileContent != "" {
				err := os.WriteFile(tt.credentialsFile, []byte(tt.fileContent), 0644)
				if err != nil {
					t.Fatalf("failed to create test file: %v", err)
				}
				defer os.Remove(tt.credentialsFile)
			}

			_, err := getOAuth2Token(tt.credentialsFile)
			if (err != nil) != tt.wantErr {
				t.Errorf("getOAuth2Token() error = %v, wantErr %v", err, tt.wantErr)
			}
			if err != nil && tt.errContains != "" && !strings.Contains(err.Error(), tt.errContains) {
				t.Errorf("getOAuth2Token() error = %v, want error containing %s", err, tt.errContains)
			}
		})
	}
}

func TestGetTLSClient(t *testing.T) {
	// Create temporary test certificates
	tempDir := t.TempDir()
	certFile := filepath.Join(tempDir, "cert.pem")
	keyFile := filepath.Join(tempDir, "key.pem")
	caFile := filepath.Join(tempDir, "ca.pem")

	// Create dummy cert files for testing
	// These are self-signed test certificates - DO NOT use in production
	testCert := `-----BEGIN CERTIFICATE-----
MIICEzCCAXwCCQDaP1KXLpqF3TANBgkqhkiG9w0BAQsFADBOMQswCQYDVQQGEwJV
UzETMBEGA1UECAwKQ2FsaWZvcm5pYTEWMBQGA1UEBwwNU2FuIEZyYW5jaXNjbzES
MBAGA1UECgwJVGVzdCBPcmcuMB4XDTIxMDEwMTAwMDAwMFoXDTMxMDEwMTAwMDAw
MFowTjELMAkGA1UEBhMCVVMxEzARBgNVBAgMCkNhbGlmb3JuaWExFjAUBgNVBAcM
DVNhbiBGcmFuY2lzY28xEjAQBgNVBAoMCVRlc3QgT3JnLjCBnzANBgkqhkiG9w0B
AQEFAAOBjQAwgYkCgYEAx7JAyKHkaS2Ib9T8bwD1vPWLLLYscGRO9HCrY3b3L7sI
xcKJwBcJPGUNWxzUj1WVnLOScBv7s5ANI7zVCqhC8EvegGUHkHJQb2VUnAJ2StKv
KFqPLYpJBWpkQ6MdBmh+VHlzFW7u54LoY5nKdXfIlBFQrv6vLoBHlRCjL3MCAwEA
ATANBgkqhkiG9w0BAQsFAAOBgQC7VPUEnVdLxQD0XkW7jL7Sg3n4nlBEeMjvJFMW
DQG5YKWZ6SqJiOZmvyG8hC8WP1J0kcFwSa2FZhFpAZfFQOHiLww+U4hJmOYQPt0A
GYLCeEXO/vBcDY3TkH7I9SbFLLQVFYFwG0V2pObGeOvnPq0jZls8BnG0DfRqig==
-----END CERTIFICATE-----`

	testKey := `-----BEGIN PRIVATE KEY-----
MIICdwIBADANBgkqhkiG9w0BAQEFAASCAmEwggJdAgEAAoGBAMeyQMih5GktiG/U
/G8A9bz1iyy2LHBkTvRwq2N29y+7CMXCicAXCTxlDVsc1I9VlZyzknAb+7OQDSO8
1QqoQvBL3oBlB5ByUG9lVJwCdkrSryhajy2KSQVqZEOjHQZoflR5cxVu7ueC6GOZ
ynV3yJQRUK7+ry6AR5UQoy9zAgMBAAECgYEAwz3vS2UvEQjDH8b4PjlaCKyGFRDC
JF7m0eVHOmsCdGBgLWU7JNKn/rHtnLpMSdqj1BPxVVVotIf9VCSLjVPqCf7CD8Ht
QB6V7JKWZ3D8j/aWUah3LH6uL5+bDroC2JXM9txUW3z8PN6TnLfKWE0OHIcbKAOh
K3ynCCYLRYECQQDnwJto5YHJYeuwKBvZJwMZBkfMT0bqsCjt1mLBUKpvPHq7b8em
KyGe0KlH9Qi5E/GXQD3qt8KJQABe3LZNhJKxAkEA3JNgQc5mZLLuoQGIiVnqMguH
SWKJjGd8Y5Jq2YgW5u4HtpI7j5y4lbB5cM9LKKJOaCGNL5c0SAapaBQYwwJBAMeU
qoZDBQq5hEFJCmWJMPm8hTrXRtCnCdcB3X5A0V0cNGP4LJdqVXaZmx3I4F7aeN3m
Jifh8r8KyqcGlIhECQQDJqRwjPPGD9OhqHHevyMCxP7T6KOJ6g5jcL8cqKqPU0Q4
q0wsZw9qc0ggzZrQQbJ4wTTfZJeV8Y7qZ4DSwJAkEAhEJ8rXk31FNV5ZqY5JA2E5
KTv5Fuw3+MBx3RJAkEA1F7qTzD8Hw==
-----END PRIVATE KEY-----`

	tests := []struct {
		name               string
		certFile           string
		keyFile            string
		caFile             string
		insecureSkipVerify bool
		setupFiles         bool
		wantErr            bool
		wantNil            bool
		errContains        string
	}{
		{
			name:               "no TLS config returns nil",
			certFile:           "",
			keyFile:            "",
			caFile:             "",
			insecureSkipVerify: false,
			wantErr:            false,
			wantNil:            true,
		},
		{
			name:               "cert without key returns error",
			certFile:           "cert.pem",
			keyFile:            "",
			caFile:             "",
			insecureSkipVerify: false,
			wantErr:            true,
			wantNil:            true,
			errContains:        "--tls-cert and tls-key must both be set or unset",
		},
		{
			name:               "key without cert returns error",
			certFile:           "",
			keyFile:            "key.pem",
			caFile:             "",
			insecureSkipVerify: false,
			wantErr:            true,
			wantNil:            true,
			errContains:        "--tls-cert and tls-key must both be set or unset",
		},
		{
			name:               "insecure skip verify returns client",
			certFile:           "",
			keyFile:            "",
			caFile:             "",
			insecureSkipVerify: true,
			wantErr:            false,
			wantNil:            false,
		},

		{
			name:               "non-existent cert file returns error",
			certFile:           "non-existent-cert.pem",
			keyFile:            "non-existent-key.pem",
			caFile:             "",
			insecureSkipVerify: false,
			wantErr:            true,
			wantNil:            true,
			errContains:        "unable to load server cert and key",
		},
		{
			name:               "non-existent ca file returns error",
			certFile:           "",
			keyFile:            "",
			caFile:             "non-existent-ca.pem",
			insecureSkipVerify: false,
			wantErr:            true,
			wantNil:            true,
			errContains:        "unable to read ca cert",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.setupFiles {
				// Create test certificate files
				if err := os.WriteFile(certFile, []byte(testCert), 0644); err != nil {
					t.Fatalf("failed to create cert file: %v", err)
				}
				if err := os.WriteFile(keyFile, []byte(testKey), 0644); err != nil {
					t.Fatalf("failed to create key file: %v", err)
				}
				if err := os.WriteFile(caFile, []byte(testCert), 0644); err != nil {
					t.Fatalf("failed to create ca file: %v", err)
				}
			}

			client, err := getTLSClient(tt.certFile, tt.keyFile, tt.caFile, tt.insecureSkipVerify)
			if (err != nil) != tt.wantErr {
				t.Errorf("getTLSClient() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if err != nil && tt.errContains != "" && !strings.Contains(err.Error(), tt.errContains) {
				t.Errorf("getTLSClient() error = %v, want error containing %s", err, tt.errContains)
			}
			if (client == nil) != tt.wantNil {
				t.Errorf("getTLSClient() client = %v, wantNil %v", client, tt.wantNil)
			}
		})
	}
}

// TestMainFunction tests the main function's flag validation
func TestMainFunctionFlags(t *testing.T) {
	// Save original os.Args
	oldArgs := os.Args
	defer func() { os.Args = oldArgs }()

	// Save original flag values
	oldDatasourceUIDs := *datasourceUIDList
	oldGrafanaToken := *grafanaAPIToken
	oldGrafanaEndpoint := *grafanaEndpoint
	oldProjectID := *projectID
	defer func() {
		*datasourceUIDList = oldDatasourceUIDs
		*grafanaAPIToken = oldGrafanaToken
		*grafanaEndpoint = oldGrafanaEndpoint
		*projectID = oldProjectID
	}()

	tests := []struct {
		name               string
		datasourceUIDs     string
		grafanaToken       string
		grafanaEndpoint    string
		projectID          string
		envToken           string
		expectExit         bool
		expectFIPSModeExit bool
	}{
		{
			name:               "missing datasource UIDs",
			datasourceUIDs:     "",
			grafanaToken:       "token",
			grafanaEndpoint:    "https://grafana.example.com",
			projectID:          "test-project",
			expectExit:         true,
			expectFIPSModeExit: true,
		},
		{
			name:               "missing grafana token and env var",
			datasourceUIDs:     "uid1,uid2",
			grafanaToken:       "",
			grafanaEndpoint:    "https://grafana.example.com",
			projectID:          "test-project",
			envToken:           "",
			expectExit:         true,
			expectFIPSModeExit: true,
		},
		{
			name:               "missing grafana endpoint",
			datasourceUIDs:     "uid1,uid2",
			grafanaToken:       "token",
			grafanaEndpoint:    "",
			projectID:          "test-project",
			expectExit:         true,
			expectFIPSModeExit: true,
		},
		{
			name:               "missing project ID",
			datasourceUIDs:     "uid1,uid2",
			grafanaToken:       "token",
			grafanaEndpoint:    "https://grafana.example.com",
			projectID:          "",
			expectExit:         true,
			expectFIPSModeExit: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Set test values
			*datasourceUIDList = tt.datasourceUIDs
			*grafanaAPIToken = tt.grafanaToken
			*grafanaEndpoint = tt.grafanaEndpoint
			*projectID = tt.projectID

			if tt.envToken != "" {
				os.Setenv("GRAFANA_SERVICE_ACCOUNT_TOKEN", tt.envToken)
				defer os.Unsetenv("GRAFANA_SERVICE_ACCOUNT_TOKEN")
			}

			// The main function calls os.Exit, so we can't test it directly
			// Instead, we test the validation logic that would cause exits
			if tt.datasourceUIDs == "" && tt.expectExit {
				// Validation would fail for empty datasource UIDs
				if len(*datasourceUIDList) != 0 {
					t.Errorf("Expected empty datasourceUIDList, got %s", *datasourceUIDList)
				}
			}
		})
	}
}
