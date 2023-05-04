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
	"strings"
	"time"

	logging "cloud.google.com/go/logging/apiv2"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	resourcemanager "google.golang.org/api/cloudresourcemanager/v1"
	"google.golang.org/api/iterator"
	"google.golang.org/api/option"

	"cloud.google.com/go/logging/apiv2/loggingpb"
)

const testConnectionTimeout = time.Minute * 1

// API implements the methods we need to query logs and list projects from GCP
type API interface {
	// ListLogs retrieves all logs matching some query filter up to the given limit
	ListLogs(context.Context, *Query) ([]*loggingpb.LogEntry, error)
	// TestConnection queries for any log from the given project
	TestConnection(ctx context.Context, projectID string) error
	// ListProjects returns the project IDs of all visible projects
	ListProjects(context.Context) ([]string, error)
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
	rClient      *resourcemanager.ProjectsService
	configClient *logging.ConfigClient
}

// NewClient creates a new Client using jsonCreds for authentication
func NewClient(ctx context.Context, jsonCreds []byte) (*Client, error) {
	client, err := logging.NewClient(ctx, option.WithCredentialsJSON(jsonCreds),
		option.WithUserAgent("googlecloud-logging-datasource"))
	if err != nil {
		return nil, err
	}
	rClient, err := resourcemanager.NewService(ctx, option.WithCredentialsJSON(jsonCreds),
		option.WithUserAgent("googlecloud-logging-datasource"))
	if err != nil {
		return nil, err
	}

	configClient, err := logging.NewConfigClient(ctx, option.WithCredentialsJSON(jsonCreds),
		option.WithUserAgent("googlecloud-logging-datasource"))
	if err != nil {
		return nil, err
	}
	return &Client{
		lClient:      client,
		rClient:      rClient.Projects,
		configClient: configClient,
	}, nil
}

// NewClient creates a new Clients using GCE metadata for authentication
func NewClientWithGCE(ctx context.Context) (*Client, error) {
	client, err := logging.NewClient(ctx,
		option.WithUserAgent("googlecloud-logging-datasource"))
	if err != nil {
		return nil, err
	}
	rClient, err := resourcemanager.NewService(ctx,
		option.WithUserAgent("googlecloud-logging-datasource"))
	if err != nil {
		return nil, err
	}
	configClient, err := logging.NewConfigClient(ctx,
		option.WithUserAgent("googlecloud-logging-datasource"))
	if err != nil {
		return nil, err
	}
	return &Client{
		lClient:      client,
		rClient:      rClient.Projects,
		configClient: configClient,
	}, nil
}

// Close closes the underlying connection to the GCP API
func (c *Client) Close() error {
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
// It is the query text, with the time range constraints appended
func (q *Query) String() string {
	return fmt.Sprintf(`%s AND timestamp >= "%s" AND timestamp <= "%s"`,
		q.Filter, q.TimeRange.From, q.TimeRange.To,
	)
}

// ListProjects returns the project IDs of all visible projects
func (c *Client) ListProjects(ctx context.Context) ([]string, error) {
	response, err := c.rClient.List().Do()
	if err != nil {
		return nil, err
	}

	projectIDs := []string{}
	for _, p := range response.Projects {
		if p.LifecycleState == "DELETE_REQUESTED" || p.LifecycleState == "DELETE_IN_PROGRESS" {
			continue
		}
		projectIDs = append(projectIDs, p.ProjectId)
	}
	return projectIDs, nil
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
			break
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
