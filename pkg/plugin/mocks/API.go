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

// Code generated by mockery v2.14.0. DO NOT EDIT.

package mocks

import (
	context "context"

	cloudlogging "github.com/GoogleCloudPlatform/cloud-logging-grafana-data-source-plugin/pkg/plugin/cloudlogging"

	logging "google.golang.org/genproto/googleapis/logging/v2"

	mock "github.com/stretchr/testify/mock"
)

// API is an autogenerated mock type for the API type
type API struct {
	mock.Mock
}

// Close provides a mock function with given fields:
func (_m *API) Close() error {
	ret := _m.Called()

	var r0 error
	if rf, ok := ret.Get(0).(func() error); ok {
		r0 = rf()
	} else {
		r0 = ret.Error(0)
	}

	return r0
}

// ListLogs provides a mock function with given fields: _a0, _a1
func (_m *API) ListLogs(_a0 context.Context, _a1 *cloudlogging.Query) ([]*logging.LogEntry, error) {
	ret := _m.Called(_a0, _a1)

	var r0 []*logging.LogEntry
	if rf, ok := ret.Get(0).(func(context.Context, *cloudlogging.Query) []*logging.LogEntry); ok {
		r0 = rf(_a0, _a1)
	} else {
		if ret.Get(0) != nil {
			r0 = ret.Get(0).([]*logging.LogEntry)
		}
	}

	var r1 error
	if rf, ok := ret.Get(1).(func(context.Context, *cloudlogging.Query) error); ok {
		r1 = rf(_a0, _a1)
	} else {
		r1 = ret.Error(1)
	}

	return r0, r1
}

// ListProjects provides a mock function with given fields: _a0
func (_m *API) ListProjects(_a0 context.Context) ([]string, error) {
	ret := _m.Called(_a0)

	var r0 []string
	if rf, ok := ret.Get(0).(func(context.Context) []string); ok {
		r0 = rf(_a0)
	} else {
		if ret.Get(0) != nil {
			r0 = ret.Get(0).([]string)
		}
	}

	var r1 error
	if rf, ok := ret.Get(1).(func(context.Context) error); ok {
		r1 = rf(_a0)
	} else {
		r1 = ret.Error(1)
	}

	return r0, r1
}

// TestConnection provides a mock function with given fields: ctx, projectID
func (_m *API) TestConnection(ctx context.Context, projectID string) error {
	ret := _m.Called(ctx, projectID)

	var r0 error
	if rf, ok := ret.Get(0).(func(context.Context, string) error); ok {
		r0 = rf(ctx, projectID)
	} else {
		r0 = ret.Error(0)
	}

	return r0
}

type mockConstructorTestingTNewAPI interface {
	mock.TestingT
	Cleanup(func())
}

// NewAPI creates a new instance of API. It also registers a testing interface on the mock and a cleanup function to assert the mocks expectations.
func NewAPI(t mockConstructorTestingTNewAPI) *API {
	mock := &API{}
	mock.Mock.Test(t)

	t.Cleanup(func() { mock.AssertExpectations(t) })

	return mock
}
