/**
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { CloudLoggingVariableQueryEditor, describeError, Props } from './VariableQueryEditor';
import { DataSource } from './datasource';
import { CloudLoggingVariableQuery, LogFindQueryScopes } from './types';

jest.mock('@grafana/runtime', () => ({
    ...jest.requireActual('@grafana/runtime'),
    getTemplateSrv: () => ({
        getVariables: () => [{ name: 'project' }],
        replace: (s?: string) => s ?? '',
    }),
}));

type MockDataSource = {
    getDefaultProject: jest.Mock<Promise<string>, []>;
    getFilteredProjects: jest.Mock<Promise<string[]>, []>;
    getFilteredBuckets: jest.Mock<Promise<string[]>, [string]>;
};

const makeDataSource = (overrides: Partial<MockDataSource> = {}): MockDataSource => ({
    getDefaultProject: jest.fn().mockResolvedValue('default-proj'),
    getFilteredProjects: jest.fn().mockResolvedValue(['proj-a', 'proj-b']),
    getFilteredBuckets: jest.fn().mockResolvedValue(['global/buckets/_Default']),
    ...overrides,
});

const fetchError = (status: number, message: string) => ({ status, data: { message } });

const renderEditor = (ds: MockDataSource, query: Partial<CloudLoggingVariableQuery> = {}) => {
    const onChange = jest.fn();
    const ref = React.createRef<CloudLoggingVariableQueryEditor>();
    const props = {
        datasource: ds as unknown as DataSource,
        query: query as CloudLoggingVariableQuery,
        onChange,
        onRunQuery: jest.fn(),
    } as unknown as Props;
    const utils = render(<CloudLoggingVariableQueryEditor ref={ref} {...props} />);
    return { ...utils, onChange, ref };
};

const lastModel = (onChange: jest.Mock) => onChange.mock.calls[onChange.mock.calls.length - 1][0];
const scopeSelect = () => document.querySelector('#cloud-logging-variable-scope');
const projectSelect = () => document.querySelector('#cloud-logging-variable-project');
const bucketSelect = () => document.querySelector('#cloud-logging-variable-bucket');

describe('CloudLoggingVariableQueryEditor', () => {
    it('saves default scope and project on mount so a new variable can run', async () => {
        const ds = makeDataSource();
        const { onChange } = renderEditor(ds);

        await waitFor(() => expect(onChange).toHaveBeenCalled());
        expect(lastModel(onChange)).toMatchObject({
            selectedQueryType: LogFindQueryScopes.Projects,
            projectId: 'default-proj',
            bucketId: '',
        });
        expect(scopeSelect()).not.toBeNull();
        expect(screen.queryByText('Loading...')).toBeNull();
    });

    it('does not fetch projects or buckets for the Projects scope', async () => {
        const ds = makeDataSource();
        const { onChange } = renderEditor(ds);
        await waitFor(() => expect(onChange).toHaveBeenCalled());

        expect(ds.getFilteredProjects).not.toHaveBeenCalled();
        expect(ds.getFilteredBuckets).not.toHaveBeenCalled();
        expect(projectSelect()).toBeNull();
        expect(bucketSelect()).toBeNull();
    });

    it('stays usable and shows the error when the default project cannot be resolved', async () => {
        const ds = makeDataSource({ getDefaultProject: jest.fn().mockRejectedValue(new Error('metadata server unreachable')) });
        const { onChange } = renderEditor(ds);

        expect(await screen.findByText(/Could not resolve the default project: metadata server unreachable/)).toBeTruthy();
        expect(lastModel(onChange)).toMatchObject({ selectedQueryType: LogFindQueryScopes.Projects, projectId: '' });
        expect(scopeSelect()).not.toBeNull();
    });

    it('does not request buckets for an empty project in the Views scope (#212)', async () => {
        const ds = makeDataSource({ getDefaultProject: jest.fn().mockResolvedValue('') });
        const { onChange } = renderEditor(ds, { selectedQueryType: LogFindQueryScopes.Views });

        await waitFor(() => expect(ds.getFilteredProjects).toHaveBeenCalled());
        await waitFor(() => expect(onChange).toHaveBeenCalled());
        expect(ds.getFilteredBuckets).not.toHaveBeenCalled();
        expect(screen.queryByText('Loading...')).toBeNull();
        expect(projectSelect()).not.toBeNull();
        expect(bucketSelect()).not.toBeNull();
        expect(screen.queryByText(/Could not/)).toBeNull();
    });

    it('does not request buckets when the project is a template variable', async () => {
        const ds = makeDataSource();
        const { onChange } = renderEditor(ds, { selectedQueryType: LogFindQueryScopes.Views, projectId: '$project' });
        await waitFor(() => expect(onChange).toHaveBeenCalled());
        await waitFor(() => expect(ds.getFilteredProjects).toHaveBeenCalled());
        expect(ds.getFilteredBuckets).not.toHaveBeenCalled();
    });

    it('loads only the project list for the Buckets scope', async () => {
        const ds = makeDataSource();
        renderEditor(ds, { selectedQueryType: LogFindQueryScopes.Buckets, projectId: 'proj-a' });

        await waitFor(() => expect(ds.getFilteredProjects).toHaveBeenCalledTimes(1));
        expect(ds.getFilteredBuckets).not.toHaveBeenCalled();
        expect(projectSelect()).not.toBeNull();
        expect(bucketSelect()).toBeNull();
    });

    it('reports a failed project listing inline and keeps the configured project selectable', async () => {
        const ds = makeDataSource({
            getFilteredProjects: jest
                .fn()
                .mockRejectedValue(fetchError(502, 'Cloud Resource Manager API has not been used in project 123 before or it is disabled')),
        });
        const { ref } = renderEditor(ds, { selectedQueryType: LogFindQueryScopes.Buckets, projectId: 'proj-a' });

        expect(await screen.findByText(/Could not load projects: Cloud Resource Manager API has not been used/)).toBeTruthy();
        expect(ref.current?.state.projects).toEqual([{ label: 'proj-a', value: 'proj-a' }]);
        expect(ref.current?.state.loading).toBe(false);
    });

    it('loads buckets for a concrete project in the Views scope and reports failures inline', async () => {
        const ds = makeDataSource({
            getFilteredBuckets: jest.fn().mockRejectedValue(fetchError(403, 'Permission denied on resource project proj-a')),
        });
        const { ref } = renderEditor(ds, { selectedQueryType: LogFindQueryScopes.Views, projectId: 'proj-a' });

        expect(await screen.findByText(/Could not load log buckets for proj-a: Permission denied/)).toBeTruthy();
        expect(ds.getFilteredBuckets).toHaveBeenCalledWith('proj-a');
        expect(ref.current?.state.loading).toBe(false);
    });

    it('saves a scope change immediately and lazily loads what the new scope needs', async () => {
        const ds = makeDataSource();
        const { onChange, ref } = renderEditor(ds);
        await waitFor(() => expect(onChange).toHaveBeenCalled());
        expect(ds.getFilteredProjects).not.toHaveBeenCalled();

        await act(async () => {
            ref.current!.onQueryTypeChange(LogFindQueryScopes.Views);
        });

        await waitFor(() => expect(ds.getFilteredBuckets).toHaveBeenCalledWith('default-proj'));
        expect(ds.getFilteredProjects).toHaveBeenCalledTimes(1);
        expect(lastModel(onChange)).toMatchObject({ selectedQueryType: LogFindQueryScopes.Views, projectId: 'default-proj' });
    });

    it('reloads buckets and clears the bucket when the project changes in the Views scope', async () => {
        const ds = makeDataSource();
        const { onChange, ref } = renderEditor(ds, {
            selectedQueryType: LogFindQueryScopes.Views,
            projectId: 'proj-a',
            bucketId: 'global/buckets/_Default',
        });
        await waitFor(() => expect(ds.getFilteredBuckets).toHaveBeenCalledWith('proj-a'));

        await act(async () => {
            ref.current!.onProjectChange('proj-b');
        });

        await waitFor(() => expect(ds.getFilteredBuckets).toHaveBeenCalledWith('proj-b'));
        expect(lastModel(onChange)).toMatchObject({ projectId: 'proj-b', bucketId: '' });
    });

    it('clears a previous error on the next user action', async () => {
        const ds = makeDataSource({ getFilteredBuckets: jest.fn().mockRejectedValue(new Error('boom')) });
        const { ref } = renderEditor(ds, { selectedQueryType: LogFindQueryScopes.Views, projectId: 'proj-a' });
        expect(await screen.findByText(/Could not load log buckets/)).toBeTruthy();

        await act(async () => {
            ref.current!.onQueryTypeChange(LogFindQueryScopes.Projects);
        });
        expect(screen.queryByText(/Could not load log buckets/)).toBeNull();
    });
});

describe('describeError', () => {
    it('prefers the backend JSON message', () => {
        expect(describeError({ status: 400, data: { message: 'Missing required parameter: ProjectId' }, message: 'Bad Request' }))
            .toBe('Missing required parameter: ProjectId');
    });
    it('falls back to a string body, then the error message, then statusText', () => {
        expect(describeError({ data: 'plain body' })).toBe('plain body');
        expect(describeError(new Error('network down'))).toBe('network down');
        expect(describeError({ statusText: 'Gateway Timeout' })).toBe('Gateway Timeout');
    });
    it('stringifies anything else', () => {
        expect(describeError(42)).toBe('42');
    });
});
