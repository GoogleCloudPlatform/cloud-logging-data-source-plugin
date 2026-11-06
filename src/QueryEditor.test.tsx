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
import { render, waitFor } from '@testing-library/react';
import { LoggingQueryEditor } from './QueryEditor';
import { DataSource } from './datasource';
import { Query } from './types';

type MockDataSource = {
    uid: string;
    getDefaultProject: jest.Mock<Promise<string>, []>;
    filterProjects: jest.Mock<string[], [string[]]>;
    filterBuckets: jest.Mock<string[], [string[]]>;
    getFilteredProjects: jest.Mock<Promise<string[]>, []>;
    projectExists: jest.Mock<Promise<boolean>, [string]>;
    getFilteredBuckets: jest.Mock<Promise<string[]>, [string]>;
    getLogBucketViews: jest.Mock<Promise<string[]>, [string, string]>;
};

const listedProjects = Array.from({ length: 100 }, (_, i) => `listed-${i}`);

const makeDataSource = (overrides: Partial<MockDataSource> = {}): MockDataSource => ({
    uid: 'ds1',
    getDefaultProject: jest.fn().mockResolvedValue('default-project'),
    filterProjects: jest.fn((projects: string[]) => projects.filter((p) => p !== 'excluded-project')),
    filterBuckets: jest.fn((buckets: string[]) => buckets),
    getFilteredProjects: jest.fn().mockResolvedValue(['default-project', ...listedProjects]),
    projectExists: jest.fn(),
    getFilteredBuckets: jest.fn().mockResolvedValue([]),
    getLogBucketViews: jest.fn().mockResolvedValue([]),
    ...overrides,
});

const renderEditor = (ds: MockDataSource, projectId: string) => {
    const onChange = jest.fn();
    const query = { refId: 'A', queryText: 'severity>=DEFAULT', projectId, bucketId: '', viewId: '' } as Query;
    render(
        <LoggingQueryEditor
            datasource={ds as unknown as DataSource}
            query={query}
            onChange={onChange}
            onRunQuery={jest.fn()}
        />
    );
    return onChange;
};

const resetToDefault = expect.objectContaining({ projectId: 'default-project', bucketId: '', viewId: '' });

describe('LoggingQueryEditor project initialization', () => {
    it('keeps a saved project that is missing from the capped list but exists', async () => {
        const ds = makeDataSource({ projectExists: jest.fn().mockResolvedValue(true) });
        const onChange = renderEditor(ds, 'saved-project');

        await waitFor(() => expect(ds.projectExists).toHaveBeenCalledWith('saved-project'));
        await waitFor(() => expect(ds.getFilteredBuckets).toHaveBeenCalledWith('saved-project'));
        expect(onChange).not.toHaveBeenCalledWith(resetToDefault);
    });

    it('resets a saved project that is missing from the list and does not exist', async () => {
        const ds = makeDataSource({ projectExists: jest.fn().mockResolvedValue(false) });
        const onChange = renderEditor(ds, 'saved-project');

        await waitFor(() => expect(onChange).toHaveBeenCalledWith(resetToDefault));
    });

    it('resets a saved project when the existence check fails', async () => {
        const ds = makeDataSource({ projectExists: jest.fn().mockRejectedValue(new Error('boom')) });
        const onChange = renderEditor(ds, 'saved-project');

        await waitFor(() => expect(onChange).toHaveBeenCalledWith(resetToDefault));
    });

    it('keeps a listed project without an existence check', async () => {
        const ds = makeDataSource();
        const onChange = renderEditor(ds, 'listed-5');

        await waitFor(() => expect(ds.getFilteredBuckets).toHaveBeenCalledWith('listed-5'));
        expect(ds.projectExists).not.toHaveBeenCalled();
        expect(onChange).not.toHaveBeenCalledWith(resetToDefault);
    });

    it('fills an empty project with the default project', async () => {
        const ds = makeDataSource();
        const onChange = renderEditor(ds, '');

        await waitFor(() => expect(onChange).toHaveBeenCalledWith(resetToDefault));
    });

    it('replaces a project excluded by the project list filter', async () => {
        const ds = makeDataSource();
        const onChange = renderEditor(ds, 'excluded-project');

        await waitFor(() => expect(onChange).toHaveBeenCalledWith(resetToDefault));
        expect(ds.getFilteredBuckets).not.toHaveBeenCalledWith('excluded-project');
    });
});
