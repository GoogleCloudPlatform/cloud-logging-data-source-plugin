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

import CloudLoggingVariableFindQuery from './CloudLoggingVariableFindQuery';
import { DataSource } from './datasource';
import { CloudLoggingVariableQuery, LogFindQueryScopes } from './types';

jest.mock('@grafana/runtime', () => ({
    ...jest.requireActual('@grafana/runtime'),
    getTemplateSrv: () => ({
        replace: (s?: string) => (s === '$project' ? 'tenant-proj' : s === '$bucket' ? 'global/buckets/_Default' : s === '$empty' ? '' : s ?? ''),
    }),
}));

const makeDataSource = (overrides: Record<string, jest.Mock> = {}) => ({
    getDefaultProject: jest.fn().mockResolvedValue('default-proj'),
    getFilteredProjects: jest.fn().mockResolvedValue(['proj-a', 'proj-b']),
    getFilteredBuckets: jest.fn().mockResolvedValue(['global/buckets/_Default', 'global/buckets/app']),
    getLogBucketViews: jest.fn().mockResolvedValue(['_AllLogs', 'errors']),
    ...overrides,
});

const query = (q: Partial<CloudLoggingVariableQuery>) => ({ refId: 'v', projectId: '', ...q } as CloudLoggingVariableQuery);

describe('CloudLoggingVariableFindQuery', () => {
    it('lists projects', async () => {
        const ds = makeDataSource();
        const result = await new CloudLoggingVariableFindQuery(ds as unknown as DataSource).execute(
            query({ selectedQueryType: LogFindQueryScopes.Projects })
        );
        expect(result).toEqual([
            { text: 'proj-a', value: 'proj-a', expandable: true },
            { text: 'proj-b', value: 'proj-b', expandable: true },
        ]);
    });

    it('lists buckets of the default project when the query has none', async () => {
        const ds = makeDataSource();
        const result = await new CloudLoggingVariableFindQuery(ds as unknown as DataSource).execute(
            query({ selectedQueryType: LogFindQueryScopes.Buckets })
        );
        expect(ds.getFilteredBuckets).toHaveBeenCalledWith('default-proj');
        expect(result.map((r) => r.value)).toEqual(['global/buckets/_Default', 'global/buckets/app']);
    });

    it('interpolates a template variable project', async () => {
        const ds = makeDataSource();
        await new CloudLoggingVariableFindQuery(ds as unknown as DataSource).execute(
            query({ selectedQueryType: LogFindQueryScopes.Buckets, projectId: '$project' })
        );
        expect(ds.getFilteredBuckets).toHaveBeenCalledWith('tenant-proj');
    });

    it('fails with an actionable message instead of sending an empty project', async () => {
        const ds = makeDataSource({ getDefaultProject: jest.fn().mockResolvedValue('') });
        await expect(
            new CloudLoggingVariableFindQuery(ds as unknown as DataSource).execute(query({ selectedQueryType: LogFindQueryScopes.Buckets }))
        ).rejects.toThrow(/Cannot list log buckets: select a project in the variable query or configure a default project/);
        expect(ds.getFilteredBuckets).not.toHaveBeenCalled();
    });

    it('treats a template variable that resolves to nothing as no project', async () => {
        const ds = makeDataSource();
        await expect(
            new CloudLoggingVariableFindQuery(ds as unknown as DataSource).execute(
                query({ selectedQueryType: LogFindQueryScopes.Views, projectId: '$empty', bucketId: 'global/buckets/app' })
            )
        ).rejects.toThrow(/Cannot list log views/);
    });

    it('lists views for a project and bucket, interpolating both', async () => {
        const ds = makeDataSource();
        const result = await new CloudLoggingVariableFindQuery(ds as unknown as DataSource).execute(
            query({ selectedQueryType: LogFindQueryScopes.Views, projectId: '$project', bucketId: '$bucket' })
        );
        expect(ds.getLogBucketViews).toHaveBeenCalledWith('tenant-proj', 'global/buckets/_Default');
        expect(result.map((r) => r.value)).toEqual(['_AllLogs', 'errors']);
    });

    it('returns no views when no bucket is selected', async () => {
        const ds = makeDataSource();
        const result = await new CloudLoggingVariableFindQuery(ds as unknown as DataSource).execute(
            query({ selectedQueryType: LogFindQueryScopes.Views, projectId: 'proj-a' })
        );
        expect(result).toEqual([]);
        expect(ds.getLogBucketViews).not.toHaveBeenCalled();
    });

    it('returns nothing for an unknown scope', async () => {
        const ds = makeDataSource();
        const result = await new CloudLoggingVariableFindQuery(ds as unknown as DataSource).execute(query({ selectedQueryType: 'nope' }));
        expect(result).toEqual([]);
    });

    it('propagates backend errors instead of returning an empty list', async () => {
        const ds = makeDataSource({
            getFilteredProjects: jest.fn().mockRejectedValue({ status: 502, data: { message: 'Cloud Resource Manager API has not been used' } }),
        });
        await expect(
            new CloudLoggingVariableFindQuery(ds as unknown as DataSource).execute(query({ selectedQueryType: LogFindQueryScopes.Projects }))
        ).rejects.toMatchObject({ status: 502 });
    });

    it('does not mutate the saved query model', async () => {
        const ds = makeDataSource();
        const q = query({ selectedQueryType: LogFindQueryScopes.Buckets });
        await new CloudLoggingVariableFindQuery(ds as unknown as DataSource).execute(q);
        expect(q.projectId).toBe('');
    });
});
