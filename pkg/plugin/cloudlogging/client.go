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
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"

	"cloud.google.com/go/auth"
	"cloud.google.com/go/auth/credentials"
	logging "cloud.google.com/go/logging/apiv2"
	resourcemanager "cloud.google.com/go/resourcemanager/apiv3"
	resourcemanagerpb "cloud.google.com/go/resourcemanager/apiv3/resourcemanagerpb"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"golang.org/x/oauth2"
	"google.golang.org/api/impersonate"
	"google.golang.org/api/iterator"
	"google.golang.org/api/option"
	htransport "google.golang.org/api/transport/http"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	// Currently, LogEntry.ProtoPayload only supports two types
	// https://pkg.go.dev/cloud.google.com/go/logging/apiv2/loggingpb#LogEntry_ProtoPayload
	// Adding the _ import to get that proto message structure registered with the unmarshaller
	_ "google.golang.org/genproto/googleapis/appengine/logging/v1"
	_ "google.golang.org/genproto/googleapis/cloud/audit"

	"cloud.google.com/go/logging/apiv2/loggingpb"
)

const testConnectionTimeout = time.Minute * 1

var defaultAuthScopes = []string{"https://www.googleapis.com/auth/cloud-platform.read-only"}

// ProxyConfig holds optional Private Data Source Connect (PDC) proxy settings.
// When nil, all GCP API and OAuth2 token requests connect directly.
type ProxyConfig struct {
	GRPCDialOption grpc.DialOption
	HTTPClient     *http.Client
}

// API implements the methods we need to query logs and list projects from GCP
type API interface {
	// ListLogs retrieves all logs matching some query filter up to the given limit
	ListLogs(context.Context, *Query) ([]*loggingpb.LogEntry, error)
	// TestConnection queries for any log from the given project
	TestConnection(ctx context.Context, projectID string) error
	// ListProjects returns the project IDs of all visible projects.
	// If query is non-empty it is forwarded to the Resource Manager search filter.
	ListProjects(ctx context.Context, query string) ([]string, error)
	// ProjectExists reports whether the project exists and is active
	ProjectExists(ctx context.Context, projectID string) (bool, error)
	// ListProjectBuckets returns all log buckets of a project
	ListProjectBuckets(ctx context.Context, projectId string) ([]string, error)
	// ListProjectBucketViews returns all views of a log bucket
	ListProjectBucketViews(ctx context.Context, projectId string, bucketId string) ([]string, error)
	// Close closes the underlying connection to the GCP API
	Close() error
}

// Client wraps a GCP logging client to fetch logs, a resourcemanager client
// to list projects, and a config client to get log bucket configurations
type Client struct {
	lClient      *logging.Client
	rClient      *resourcemanager.ProjectsClient
	configClient *logging.ConfigClient
}

func universeDomainOpts(universeDomain string) []option.ClientOption {
	if universeDomain == "" {
		return nil
	}
	return []option.ClientOption{option.WithUniverseDomain(universeDomain)}
}

func proxyGRPCOpts(proxyCfg *ProxyConfig) []option.ClientOption {
	if proxyCfg == nil || proxyCfg.GRPCDialOption == nil {
		return nil
	}
	return []option.ClientOption{option.WithGRPCDialOption(proxyCfg.GRPCDialOption)}
}

func proxyAuthCreds(jsonCreds []byte, universeDomain string, httpClient *http.Client, scopes []string, useSelfSignedJWT bool) (*auth.Credentials, error) {
	detectOpts := &credentials.DetectOptions{
		Scopes:           scopes,
		Client:           httpClient,
		UniverseDomain:   universeDomain,
		UseSelfSignedJWT: useSelfSignedJWT,
	}
	if jsonCreds != nil {
		return credentials.NewCredentialsFromJSON(credentials.ServiceAccount, jsonCreds, detectOpts)
	}
	return credentials.DetectDefault(detectOpts)
}

// newClientFromOpts builds the three GCP clients that back Client. If any
// constructor fails, the previously-created clients are closed so we don't
// leak gRPC connections.
func newClientFromOpts(ctx context.Context, opts []option.ClientOption) (*Client, error) {
	lClient, err := logging.NewClient(ctx, opts...)
	if err != nil {
		return nil, err
	}
	rClient, err := resourcemanager.NewProjectsClient(ctx, opts...)
	if err != nil {
		lClient.Close()
		return nil, err
	}
	configClient, err := logging.NewConfigClient(ctx, opts...)
	if err != nil {
		rClient.Close()
		lClient.Close()
		return nil, err
	}
	return &Client{
		lClient:      lClient,
		rClient:      rClient,
		configClient: configClient,
	}, nil
}

// NewClient creates a new Client using jsonCreds for authentication
func NewClient(ctx context.Context, jsonCreds []byte, universeDomain string, proxyCfg *ProxyConfig) (*Client, error) {
	opts := []option.ClientOption{
		option.WithUserAgent("googlecloud-logging-datasource"),
	}
	if proxyCfg != nil && proxyCfg.HTTPClient != nil {
		// Use self-signed JWTs (matching direct EnableJwtWithScope behavior) so
		// direct JWT+PDC avoids an extra 2LO round-trip to oauth2.googleapis.com.
		creds, err := proxyAuthCreds(jsonCreds, universeDomain, proxyCfg.HTTPClient, defaultAuthScopes, true)
		if err != nil {
			return nil, err
		}
		opts = append(opts, option.WithAuthCredentials(creds))
	} else {
		opts = append(opts, option.WithCredentialsJSON(jsonCreds))
	}
	opts = append(opts, universeDomainOpts(universeDomain)...)
	opts = append(opts, proxyGRPCOpts(proxyCfg)...)

	return newClientFromOpts(ctx, opts)
}

// NewClientWithGCE creates a new Client using GCE metadata / ADC for authentication
func NewClientWithGCE(ctx context.Context, universeDomain string, proxyCfg *ProxyConfig) (*Client, error) {
	opts := []option.ClientOption{
		option.WithUserAgent("googlecloud-logging-datasource"),
	}
	if proxyCfg != nil && proxyCfg.HTTPClient != nil {
		creds, err := proxyAuthCreds(nil, universeDomain, proxyCfg.HTTPClient, defaultAuthScopes, false)
		if err != nil {
			return nil, err
		}
		opts = append(opts, option.WithAuthCredentials(creds))
	}
	opts = append(opts, universeDomainOpts(universeDomain)...)
	opts = append(opts, proxyGRPCOpts(proxyCfg)...)

	return newClientFromOpts(ctx, opts)
}

// NewImpersonationTokenSource builds the OAuth2 token source used for service
// account impersonation, routing token and IAMCredentials HTTP calls through
// proxyCfg.HTTPClient (preserving its Timeout) when configured.
func NewImpersonationTokenSource(ctx context.Context, jsonCreds []byte, impersonateSA string, universeDomain string, proxyCfg *ProxyConfig) (oauth2.TokenSource, error) {
	impersonateOpts := append([]option.ClientOption{}, universeDomainOpts(universeDomain)...)

	if proxyCfg != nil && proxyCfg.HTTPClient != nil {
		baseCreds, credErr := proxyAuthCreds(jsonCreds, universeDomain, proxyCfg.HTTPClient, []string{"https://www.googleapis.com/auth/cloud-platform"}, false)
		if credErr != nil {
			return nil, credErr
		}
		baseAuthOpts := append([]option.ClientOption{
			option.WithAuthCredentials(baseCreds),
			option.WithScopes("https://www.googleapis.com/auth/cloud-platform"),
		}, universeDomainOpts(universeDomain)...)
		authTransport, transportErr := htransport.NewTransport(ctx, proxyCfg.HTTPClient.Transport, baseAuthOpts...)
		if transportErr != nil {
			return nil, transportErr
		}
		impersonateOpts = append(impersonateOpts, option.WithHTTPClient(&http.Client{
			Transport: authTransport,
			Timeout:   proxyCfg.HTTPClient.Timeout,
		}))
	} else if jsonCreds != nil {
		impersonateOpts = append(impersonateOpts, option.WithCredentialsJSON(jsonCreds))
	}

	return impersonate.CredentialsTokenSource(ctx, impersonate.CredentialsConfig{
		TargetPrincipal: impersonateSA,
		Scopes:          defaultAuthScopes,
	}, impersonateOpts...)
}

// NewClientWithImpersonation creates a new Client using service account impersonation
func NewClientWithImpersonation(ctx context.Context, jsonCreds []byte, impersonateSA string, universeDomain string, proxyCfg *ProxyConfig) (*Client, error) {
	ts, err := NewImpersonationTokenSource(ctx, jsonCreds, impersonateSA, universeDomain, proxyCfg)
	if err != nil {
		return nil, err
	}

	opts := append([]option.ClientOption{
		option.WithTokenSource(ts),
		option.WithUserAgent("googlecloud-logging-datasource"),
	}, universeDomainOpts(universeDomain)...)
	opts = append(opts, proxyGRPCOpts(proxyCfg)...)

	return newClientFromOpts(ctx, opts)
}

// NewClientWithAccessToken creates a new Client using an access token for authentication.
// Since the datasource is re-created whenever the token changes, we can treat this token as static.
func NewClientWithAccessToken(ctx context.Context, accessToken string, universeDomain string, proxyCfg *ProxyConfig) (*Client, error) {
	ts := oauth2.StaticTokenSource(&oauth2.Token{AccessToken: accessToken})

	opts := append([]option.ClientOption{
		option.WithTokenSource(ts),
		option.WithUserAgent("googlecloud-logging-datasource"),
	}, universeDomainOpts(universeDomain)...)
	opts = append(opts, proxyGRPCOpts(proxyCfg)...)

	return newClientFromOpts(ctx, opts)
}

// NewClientWithPassThrough creates a new Client using OAuth browser credentials
func NewClientWithPassThrough(ctx context.Context, headers map[string]string, universeDomain string, proxyCfg *ProxyConfig) (*Client, error) {
	token, found := strings.CutPrefix(headers["Authorization"], "Bearer ")
	if !found || token == "" {
		return nil, errors.New("missing or invalid Authorization header")
	}

	opts := append([]option.ClientOption{
		option.WithTokenSource(
			oauth2.StaticTokenSource(&oauth2.Token{
				AccessToken: token,
			}),
		),
		option.WithUserAgent("googlecloud-logging-datasource"),
	}, universeDomainOpts(universeDomain)...)
	opts = append(opts, proxyGRPCOpts(proxyCfg)...)

	return newClientFromOpts(ctx, opts)
}

// Close closes the underlying connection to the GCP API
func (c *Client) Close() error {
	c.rClient.Close()
	c.configClient.Close()
	return c.lClient.Close()
}

// Query is the information from a Grafana query needed to query GCP for logs
type Query struct {
	ProjectID string
	BucketId  string
	ViewId    string
	Filter    string
	Limit     int64
	TimeRange struct {
		From string
		To   string
	}
}

// String is the query formatted for querying GCP
// It is the query text, with the time range constraints appended.
//
// No parentheses are needed around the user's filter: in the Logging query
// language OR binds tighter than AND, so `a OR b AND timestamp >= x` already
// groups as `(a OR b) AND timestamp >= x`.
//
// An empty filter yields just the time range; a leading `AND` is rejected by
// the API as an unparseable filter.
func (q *Query) String() string {
	timeRange := fmt.Sprintf(`timestamp >= "%s" AND timestamp <= "%s"`, q.TimeRange.From, q.TimeRange.To)
	filter := strings.TrimSpace(q.Filter)
	if filter == "" {
		return timeRange
	}
	return filter + " AND " + timeRange
}

// ListProjects returns the project IDs of all visible projects.
// If query is non-empty it is forwarded to the Resource Manager search filter
// (e.g. "id:*term* OR name:*term*"). Results are capped at maxProjects.
const maxProjects = 100

func (c *Client) ListProjects(ctx context.Context, query string) ([]string, error) {
	filter := ""
	if query != "" {
		filter = fmt.Sprintf("id:*%s* OR name:*%s*", query, query)
	}

	projectIDs := []string{}
	req := &resourcemanagerpb.SearchProjectsRequest{
		Query:    filter,
		PageSize: maxProjects,
	}
	it := c.rClient.SearchProjects(ctx, req)
	for {
		project, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, err
		}
		if project.State != resourcemanagerpb.Project_ACTIVE {
			continue
		}
		projectIDs = append(projectIDs, project.ProjectId)
		if len(projectIDs) >= maxProjects {
			break
		}
	}
	return projectIDs, nil
}

// ProjectExists reports whether the project exists and is active.
// Resource Manager returns PermissionDenied for unknown projects, so it is treated as not found.
func (c *Client) ProjectExists(ctx context.Context, projectID string) (bool, error) {
	project, err := c.rClient.GetProject(ctx, &resourcemanagerpb.GetProjectRequest{Name: "projects/" + projectID})
	if err != nil {
		switch status.Code(err) {
		case codes.NotFound, codes.PermissionDenied, codes.InvalidArgument:
			return false, nil
		}
		return false, err
	}
	return project.State == resourcemanagerpb.Project_ACTIVE, nil
}

// ListProjectBucketsViews returns all views of a log bucket
func (c *Client) ListProjectBucketViews(ctx context.Context, projectId string, bucketId string) ([]string, error) {
	views := []string{""}

	req := &loggingpb.ListViewsRequest{
		// See https://pkg.go.dev/cloud.google.com/go/logging/apiv2/loggingpb#ListViewsRequest
		Parent: fmt.Sprintf("projects/%s/locations/%s", projectId, bucketId),
	}
	it := c.configClient.ListViews(ctx, req)
	for {
		resp, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, err
		}
		// See response format: https://cloud.google.com/logging/docs/reference/v2/rest/v2/billingAccounts.locations.buckets.views#LogView
		view := strings.Split(resp.Name, "/")
		// Append `my-view` for `projects/my-project/locations/global/buckets/my-bucket/views/my-view`
		views = append(views, view[len(view)-1])
	}

	return views, nil
}

// ListProjectBuckets returns all log buckets of a project
func (c *Client) ListProjectBuckets(ctx context.Context, projectId string) ([]string, error) {
	buckets := []string{""}

	req := &loggingpb.ListBucketsRequest{
		// Request struct fields. Using '-' to get the full list
		// See https://pkg.go.dev/cloud.google.com/go/logging/apiv2/loggingpb#ListBucketsRequest
		Parent: fmt.Sprintf("projects/%s/locations/-", projectId),
	}
	it := c.configClient.ListBuckets(ctx, req)
	for {
		resp, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, err
		}
		// See response format: https://cloud.google.com/logging/docs/reference/v2/rest/v2/billingAccounts.locations.buckets#LogBucket
		bucket := strings.Split(resp.Name, "/")
		// Get `global/buckets/my-bucket` for `projects/my-project/locations/global/buckets/my-bucket`
		buckets = append(buckets, strings.Join(bucket[3:], "/"))
	}

	return buckets, nil
}

// TestConnection queries for any log from the given project
func (c *Client) TestConnection(ctx context.Context, projectID string) error {
	start := time.Now()

	listCtx, cancel := context.WithTimeout(ctx, time.Duration(testConnectionTimeout))

	defer func() {
		cancel()
		log.DefaultLogger.Debug("Finished testConnection", "duration", time.Since(start).String())
	}()

	it := c.lClient.ListLogEntries(listCtx, &loggingpb.ListLogEntriesRequest{
		ResourceNames: []string{legacyProjectResourceName(projectID)},
		PageSize:      1,
	})

	if listCtx.Err() != nil {
		return errors.New("list entries: timeout")
	}

	entry, err := it.Next()
	if err == iterator.Done {
		return errors.New("no entries")
	}
	if err == context.DeadlineExceeded {
		return errors.New("list entries: timeout")
	}
	if err != nil {
		return fmt.Errorf("list entries: %w", err)
	}
	if entry == nil {
		return errors.New("no entries")
	}

	return nil
}

// ListLogs retrieves all logs matching some query filter up to the given limit
func (c *Client) ListLogs(ctx context.Context, q *Query) ([]*loggingpb.LogEntry, error) {
	// Never exceed the maximum page size
	pageSize := int32(math.Min(float64(q.Limit), 1000))

	resourceName := []string{}
	if q.BucketId == "" {
		resourceName = append(resourceName, legacyProjectResourceName(q.ProjectID))
	} else {
		resourceName = append(resourceName, projectResourceName(q.ProjectID, q.BucketId, q.ViewId))
	}

	req := loggingpb.ListLogEntriesRequest{
		ResourceNames: resourceName,
		Filter:        q.String(),
		OrderBy:       "timestamp desc",
		PageSize:      pageSize,
	}

	start := time.Now()
	defer func() {
		log.DefaultLogger.Debug("Finished listing logs", "duration", time.Since(start).String())
	}()

	it := c.lClient.ListLogEntries(ctx, &req)
	if it == nil {
		return nil, errors.New("nil response")
	}

	var i int64
	entries := []*loggingpb.LogEntry{}
	for {
		resp, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			log.DefaultLogger.Error("error getting page", "error", err)
			return nil, err
		}

		entries = append(entries, resp)
		i++
		if i >= q.Limit {
			break
		}
	}
	return entries, nil
}

func legacyProjectResourceName(projectID string) string {
	return fmt.Sprintf("projects/%s", projectID)
}

func projectResourceName(projectId string, bucketId string, viewId string) string {
	if viewId != "" {
		return fmt.Sprintf("projects/%s/locations/%s/views/%s", projectId, bucketId, viewId)
	} else {
		// Use default `_AllLogs` view
		return fmt.Sprintf("projects/%s/locations/%s/views/_AllLogs", projectId, bucketId)
	}
}
