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
	"time"

	logging "cloud.google.com/go/logging/apiv2"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	resourcemanager "google.golang.org/api/cloudresourcemanager/v1"
	"google.golang.org/api/iterator"
	"google.golang.org/api/option"

	loggingpb "google.golang.org/genproto/googleapis/logging/v2"
)

// API implements the methods we need to query logs and list projects from GCP
type API interface {
	// ListLogs retrieves all logs matching some query filter up to the given limit
	ListLogs(context.Context, *Query) ([]*loggingpb.LogEntry, error)
	// TestConnection queries for any log from the given project
	TestConnection(ctx context.Context, projectID string) error
	// ListProjects returns the project IDs of all visible projects
	ListProjects(context.Context) ([]string, error)
	// Close closes the underlying connection to the GCP API
	Close() error
}

// Client wraps a GCP logging client to fetch logs, and a resourcemanager client
// to list projects
type Client struct {
	lClient *logging.Client
	rClient *resourcemanager.ProjectsService
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

	return &Client{
		lClient: client,
		rClient: rClient.Projects,
	}, nil
}

// Close closes the underlying connection to the GCP API
func (c *Client) Close() error {
	return c.lClient.Close()
}

// Query is the information from a Grafana query needed to query GCP for logs
type Query struct {
	ProjectID string
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

// TestConnection queries for any log from the given project
func (c *Client) TestConnection(ctx context.Context, projectID string) error {
	start := time.Now()
	defer func() {
		log.DefaultLogger.Info("Finished testConnection", "duration", time.Since(start).String())
	}()

	it := c.lClient.ListLogEntries(ctx, &loggingpb.ListLogEntriesRequest{
		ResourceNames: []string{projectResourceName(projectID)},
		PageSize:      1,
	})

	entry, err := it.Next()
	if err == iterator.Done {
		return errors.New("no entries")
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

	req := loggingpb.ListLogEntriesRequest{
		ResourceNames: []string{projectResourceName(q.ProjectID)},
		Filter:        q.String(),
		OrderBy:       "timestamp desc",
		PageSize:      pageSize,
	}

	start := time.Now()
	defer func() {
		log.DefaultLogger.Info("Finished listing logs", "duration", time.Since(start).String())
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

func projectResourceName(projectID string) string {
	return fmt.Sprintf("projects/%s", projectID)
}
