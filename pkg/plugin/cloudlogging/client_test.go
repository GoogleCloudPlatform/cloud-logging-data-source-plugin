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
	"net"
	"testing"

	logging "cloud.google.com/go/logging/apiv2"
	"cloud.google.com/go/logging/apiv2/loggingpb"
	resourcemanager "cloud.google.com/go/resourcemanager/apiv3"
	"cloud.google.com/go/resourcemanager/apiv3/resourcemanagerpb"
	"github.com/stretchr/testify/require"
	"google.golang.org/api/option"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
)

type fakeLoggingServer struct {
	loggingpb.UnimplementedLoggingServiceV2Server
	listEntries func(context.Context, *loggingpb.ListLogEntriesRequest) (*loggingpb.ListLogEntriesResponse, error)
}

func (s *fakeLoggingServer) ListLogEntries(ctx context.Context, req *loggingpb.ListLogEntriesRequest) (*loggingpb.ListLogEntriesResponse, error) {
	return s.listEntries(ctx, req)
}

type fakeProjectsServer struct {
	resourcemanagerpb.UnimplementedProjectsServer
	getProject func(context.Context, *resourcemanagerpb.GetProjectRequest) (*resourcemanagerpb.Project, error)
}

func (s *fakeProjectsServer) GetProject(ctx context.Context, req *resourcemanagerpb.GetProjectRequest) (*resourcemanagerpb.Project, error) {
	return s.getProject(ctx, req)
}

func newTestClient(t *testing.T, logSrv loggingpb.LoggingServiceV2Server, projSrv resourcemanagerpb.ProjectsServer) *Client {
	t.Helper()

	lis, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)

	srv := grpc.NewServer()
	if logSrv != nil {
		loggingpb.RegisterLoggingServiceV2Server(srv, logSrv)
	}
	if projSrv != nil {
		resourcemanagerpb.RegisterProjectsServer(srv, projSrv)
	}
	go func() {
		_ = srv.Serve(lis)
	}()
	t.Cleanup(srv.Stop)

	conn, err := grpc.NewClient(lis.Addr().String(), grpc.WithTransportCredentials(insecure.NewCredentials()))
	require.NoError(t, err)
	t.Cleanup(func() { _ = conn.Close() })

	ctx := context.Background()
	opts := []option.ClientOption{option.WithGRPCConn(conn)}

	var lClient *logging.Client
	if logSrv != nil {
		lClient, err = logging.NewClient(ctx, opts...)
		require.NoError(t, err)
		lClient.CallOptions.ListLogEntries = nil
		t.Cleanup(func() { _ = lClient.Close() })
	}

	var rClient *resourcemanager.ProjectsClient
	if projSrv != nil {
		rClient, err = resourcemanager.NewProjectsClient(ctx, opts...)
		require.NoError(t, err)
		// Disable default GAPIC retries so Unavailable errors return immediately in tests.
		rClient.CallOptions.GetProject = nil
		t.Cleanup(func() { _ = rClient.Close() })
	}

	return &Client{
		lClient: lClient,
		rClient: rClient,
	}
}

func TestClient_ListLogs_SurfacesErrors(t *testing.T) {
	t.Run("first page error is returned", func(t *testing.T) {
		client := newTestClient(t, &fakeLoggingServer{
			listEntries: func(_ context.Context, _ *loggingpb.ListLogEntriesRequest) (*loggingpb.ListLogEntriesResponse, error) {
				return nil, status.Error(codes.InvalidArgument, "Unparseable filter")
			},
		}, nil)

		entries, err := client.ListLogs(context.Background(), &Query{
			ProjectID: "my-project",
			Filter:    "bad((syntax",
			Limit:     10,
		})
		require.Error(t, err)
		require.Nil(t, entries)
		require.Equal(t, codes.InvalidArgument, status.Code(err))
	})

	t.Run("subsequent page error is returned instead of partial results", func(t *testing.T) {
		calls := 0
		client := newTestClient(t, &fakeLoggingServer{
			listEntries: func(_ context.Context, req *loggingpb.ListLogEntriesRequest) (*loggingpb.ListLogEntriesResponse, error) {
				calls++
				if calls == 1 {
					return &loggingpb.ListLogEntriesResponse{
						Entries: []*loggingpb.LogEntry{
							{InsertId: "entry-1"},
						},
						NextPageToken: "page-2",
					}, nil
				}
				return nil, status.Error(codes.ResourceExhausted, "quota exceeded")
			},
		}, nil)

		entries, err := client.ListLogs(context.Background(), &Query{
			ProjectID: "my-project",
			Limit:     10,
		})
		require.Error(t, err)
		require.Nil(t, entries)
		require.Equal(t, codes.ResourceExhausted, status.Code(err))
		require.Equal(t, 2, calls)
	})

	t.Run("respects limit on success", func(t *testing.T) {
		client := newTestClient(t, &fakeLoggingServer{
			listEntries: func(_ context.Context, _ *loggingpb.ListLogEntriesRequest) (*loggingpb.ListLogEntriesResponse, error) {
				return &loggingpb.ListLogEntriesResponse{
					Entries: []*loggingpb.LogEntry{
						{InsertId: "entry-1"},
						{InsertId: "entry-2"},
						{InsertId: "entry-3"},
					},
				}, nil
			},
		}, nil)

		entries, err := client.ListLogs(context.Background(), &Query{
			ProjectID: "my-project",
			Limit:     2,
		})
		require.NoError(t, err)
		require.Len(t, entries, 2)
		require.Equal(t, "entry-1", entries[0].InsertId)
		require.Equal(t, "entry-2", entries[1].InsertId)
	})
}

func TestClient_ProjectExists(t *testing.T) {
	tests := []struct {
		name      string
		project   *resourcemanagerpb.Project
		rpcErr    error
		want      bool
		wantError bool
	}{
		{
			name:    "active project returns true",
			project: &resourcemanagerpb.Project{ProjectId: "p1", State: resourcemanagerpb.Project_ACTIVE},
			want:    true,
		},
		{
			name:    "inactive project returns false",
			project: &resourcemanagerpb.Project{ProjectId: "p1", State: resourcemanagerpb.Project_DELETE_REQUESTED},
			want:    false,
		},
		{
			name:   "not found returns false without error",
			rpcErr: status.Error(codes.NotFound, "not found"),
			want:   false,
		},
		{
			name:   "permission denied returns false without error",
			rpcErr: status.Error(codes.PermissionDenied, "denied"),
			want:   false,
		},
		{
			name:   "invalid argument returns false without error",
			rpcErr: status.Error(codes.InvalidArgument, "invalid"),
			want:   false,
		},
		{
			name:      "transient error is surfaced",
			rpcErr:    status.Error(codes.Unavailable, "service unavailable"),
			want:      false,
			wantError: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			client := newTestClient(t, nil, &fakeProjectsServer{
				getProject: func(_ context.Context, _ *resourcemanagerpb.GetProjectRequest) (*resourcemanagerpb.Project, error) {
					return tc.project, tc.rpcErr
				},
			})

			exists, err := client.ProjectExists(context.Background(), "p1")
			if tc.wantError {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
			}
			require.Equal(t, tc.want, exists)
		})
	}
}
