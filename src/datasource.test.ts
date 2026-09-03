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

import { ArrayVector, DataFrame, DataSourcePluginMeta, FieldType, Labels, ScopedVars } from '@grafana/data';
import { DataSourceWithBackend, TemplateSrv } from '@grafana/runtime';
import { GoogleAuthType } from '@grafana/google-sdk';
import { random } from 'lodash';
import { lastValueFrom, of } from 'rxjs';
import { DataSource } from './datasource';
import { CloudLoggingOptions, Query } from './types';

jest.mock('@grafana/runtime', () => ({
    ...jest.requireActual('@grafana/runtime'),
    getDataSourceSrv: () => ({
        getInstanceSettings: (uid?: string) =>
            uid === 'trace-uid' ? { uid: 'trace-uid', name: 'Google Cloud Trace' } : undefined,
    }),
}));


describe('Google Cloud Logging Data Source', () => {
    describe('getDefaultProject', () => {
        it('returns empty string if not set', () => {
            const ds = makeDataSource();
            ds.getDefaultProject().then(r => expect(r).toBe(''));
        });
        it('returns defaultProject from jsonData', () => {
            const projectId = `my-gcp-project-${random(100)}`;
            const ds = new DataSource({
                id: random(100),
                type: 'googlecloud-logging-datasource',
                access: 'direct',
                meta: {} as DataSourcePluginMeta,
                uid: `${random(100)}`,
                jsonData: {
                    authenticationType: GoogleAuthType.JWT,
                    defaultProject: projectId,
                },
                name: 'something',
                readOnly: true,
            });
            ds.getDefaultProject().then(r => expect(r).toBe(projectId));
        });
    });

    describe('filterProjects', () => {
        const allProjects = [
            'my-project-123',
            'team-alpha-prod',
            'team-alpha-staging',
            'team-beta-prod',
            'prod-logging-service',
            'other-project',
        ];

        it('returns all projects when no filter is configured', () => {
            const ds = makeDataSource();
            expect(ds.filterProjects(allProjects)).toEqual(allProjects);
        });

        it('returns all projects when filter is empty string', () => {
            const ds = makeDataSource({ projectListFilter: '' });
            expect(ds.filterProjects(allProjects)).toEqual(allProjects);
        });

        it('returns all projects when filter is only whitespace', () => {
            const ds = makeDataSource({ projectListFilter: '   \n  \n  ' });
            expect(ds.filterProjects(allProjects)).toEqual(allProjects);
        });

        it('filters by exact literal project ID', () => {
            const ds = makeDataSource({ projectListFilter: 'my-project-123' });
            expect(ds.filterProjects(allProjects)).toEqual(['my-project-123']);
        });

        it('filters using regex pattern', () => {
            const ds = makeDataSource({ projectListFilter: 'team-alpha-.*' });
            expect(ds.filterProjects(allProjects)).toEqual([
                'team-alpha-prod',
                'team-alpha-staging',
            ]);
        });

        it('supports multiple patterns (union of matches)', () => {
            const ds = makeDataSource({
                projectListFilter: 'my-project-123\nteam-beta-.*',
            });
            expect(ds.filterProjects(allProjects)).toEqual([
                'my-project-123',
                'team-beta-prod',
            ]);
        });

        it('ignores empty lines between patterns', () => {
            const ds = makeDataSource({
                projectListFilter: 'my-project-123\n\n\nother-project',
            });
            expect(ds.filterProjects(allProjects)).toEqual([
                'my-project-123',
                'other-project',
            ]);
        });

        it('anchors patterns so partial matches do not pass', () => {
            const ds = makeDataSource({ projectListFilter: 'team' });
            expect(ds.filterProjects(allProjects)).toEqual([]);
        });

        it('handles invalid regex gracefully by treating as literal', () => {
            const ds = makeDataSource({ projectListFilter: 'invalid[regex' });
            // Should not throw, and should not match anything (literal "invalid[regex" not in list)
            expect(ds.filterProjects(allProjects)).toEqual([]);
        });

        it('trims whitespace from pattern lines', () => {
            const ds = makeDataSource({ projectListFilter: '  my-project-123  ' });
            expect(ds.filterProjects(allProjects)).toEqual(['my-project-123']);
        });

        it('returns empty array when no projects match', () => {
            const ds = makeDataSource({ projectListFilter: 'nonexistent-.*' });
            expect(ds.filterProjects(allProjects)).toEqual([]);
        });
    });

    describe('filterBuckets', () => {
        const allBuckets = [
            'global/buckets/_Default',
            'global/buckets/_Required',
            'locations/us-central1/buckets/my-app-logs',
            'locations/us-central1/buckets/audit-logs',
            'locations/europe-west1/buckets/_Default',
        ];

        it('returns all buckets when no filter is configured', () => {
            const ds = makeDataSource();
            expect(ds.filterBuckets(allBuckets)).toEqual(allBuckets);
        });

        it('returns all buckets when filter is empty string', () => {
            const ds = makeDataSource({ logBucketFilter: '' });
            expect(ds.filterBuckets(allBuckets)).toEqual(allBuckets);
        });

        it('returns all buckets when filter is only whitespace', () => {
            const ds = makeDataSource({ logBucketFilter: '   \n  \n  ' });
            expect(ds.filterBuckets(allBuckets)).toEqual(allBuckets);
        });

        it('includes only matching buckets (include mode)', () => {
            const ds = makeDataSource({ logBucketFilter: '.*my-app-logs' });
            expect(ds.filterBuckets(allBuckets)).toEqual([
                'locations/us-central1/buckets/my-app-logs',
            ]);
        });

        it('includes multiple patterns (union of matches)', () => {
            const ds = makeDataSource({
                logBucketFilter: '.*my-app-logs\n.*audit-logs',
            });
            expect(ds.filterBuckets(allBuckets)).toEqual([
                'locations/us-central1/buckets/my-app-logs',
                'locations/us-central1/buckets/audit-logs',
            ]);
        });

        it('excludes matching buckets (exclude mode with ! prefix)', () => {
            const ds = makeDataSource({ logBucketFilter: '!.*/_Default' });
            expect(ds.filterBuckets(allBuckets)).toEqual([
                'global/buckets/_Required',
                'locations/us-central1/buckets/my-app-logs',
                'locations/us-central1/buckets/audit-logs',
            ]);
        });

        it('excludes multiple patterns', () => {
            const ds = makeDataSource({
                logBucketFilter: '!.*/_Default\n!.*/_Required',
            });
            expect(ds.filterBuckets(allBuckets)).toEqual([
                'locations/us-central1/buckets/my-app-logs',
                'locations/us-central1/buckets/audit-logs',
            ]);
        });

        it('supports mixed include and exclude (include first, then exclude)', () => {
            const ds = makeDataSource({
                logBucketFilter: 'global/buckets/.*\n!.*/_Default',
            });
            // Include: global/buckets/_Default, global/buckets/_Required
            // Exclude _Default → only _Required remains
            expect(ds.filterBuckets(allBuckets)).toEqual([
                'global/buckets/_Required',
            ]);
        });

        it('anchors patterns so partial matches do not pass', () => {
            const ds = makeDataSource({ logBucketFilter: '_Default' });
            expect(ds.filterBuckets(allBuckets)).toEqual([]);
        });

        it('handles invalid regex gracefully by treating as literal', () => {
            const ds = makeDataSource({ logBucketFilter: 'invalid[regex' });
            expect(ds.filterBuckets(allBuckets)).toEqual([]);
        });

        it('trims whitespace from pattern lines', () => {
            const ds = makeDataSource({ logBucketFilter: '  !.*/_Default  ' });
            expect(ds.filterBuckets(allBuckets)).toEqual([
                'global/buckets/_Required',
                'locations/us-central1/buckets/my-app-logs',
                'locations/us-central1/buckets/audit-logs',
            ]);
        });

        it('ignores empty lines between patterns', () => {
            const ds = makeDataSource({
                logBucketFilter: '!.*/_Default\n\n\n!.*/_Required',
            });
            expect(ds.filterBuckets(allBuckets)).toEqual([
                'locations/us-central1/buckets/my-app-logs',
                'locations/us-central1/buckets/audit-logs',
            ]);
        });

        it('returns empty array when include pattern matches nothing', () => {
            const ds = makeDataSource({ logBucketFilter: 'nonexistent-.*' });
            expect(ds.filterBuckets(allBuckets)).toEqual([]);
        });
    });

    describe('logs to traces data links', () => {
        type Row = { traceId?: string | null; labels?: Labels };
        const BASE_FIELDS = 6;

        // Mirrors the backend's dataplane log-lines frame: one frame per
        // query, one row per entry, nullable traceId, per-row labels.
        const logFrame = (rows: Row[]): DataFrame => ({
            name: 'A',
            refId: 'A',
            length: rows.length,
            fields: [
                { name: 'timestamp', type: FieldType.time, config: {}, values: new ArrayVector(rows.map((_, i) => 1700000000000 + i)) },
                { name: 'body', type: FieldType.string, config: {}, values: new ArrayVector(rows.map((_, i) => `line ${i}`)) },
                { name: 'severity', type: FieldType.string, config: {}, values: new ArrayVector(rows.map(() => 'info')) },
                { name: 'id', type: FieldType.string, config: {}, values: new ArrayVector(rows.map((_, i) => `insert-id-${i}`)) },
                { name: 'labels', type: FieldType.other, config: {}, values: new ArrayVector(rows.map((r) => r.labels ?? {})) },
                { name: 'traceId', type: FieldType.string, config: {}, values: new ArrayVector(rows.map((r) => r.traceId ?? null)) },
            ],
        });
        const tracedRow = (project = 'my-proj', traceId = 'abc123'): Row => ({
            traceId,
            labels: { trace: `projects/${project}/traces/${traceId}`, spanId: 'def' },
        });

        const field = (response: { data: any[] }, name: string) =>
            response.data[0].fields.find((f: { name: string }) => f.name === name);
        const values = (f: any): unknown[] => (typeof f.values.toArray === 'function' ? f.values.toArray() : Array.from(f.values));
        const linkProjects = (response: { data: any[] }) => values(field(response, 'traceProject'));
        const expectUntouched = (response: { data: any[] }) => {
            expect(response.data[0].fields).toHaveLength(BASE_FIELDS);
            expect(field(response, 'traceId').config.links).toBeUndefined();
        };

        const runQuery = async (ds: DataSource, frame: DataFrame, targets: Query[] = []) => {
            jest.spyOn(DataSourceWithBackend.prototype, 'query').mockReturnValue(of({ data: [frame] }));
            return lastValueFrom(ds.query({ targets, scopedVars: {} } as unknown as Parameters<DataSource['query']>[0]));
        };

        afterEach(() => {
            jest.restoreAllMocks();
        });

        it('attaches an internal link to traceId and a hidden per-row traceProject field', async () => {
            const ds = makeDataSource({ logsToTraces: { datasourceUid: 'trace-uid' } });
            const response = await runQuery(ds, logFrame([tracedRow()]));

            const traceField = field(response, 'traceId');
            expect(values(traceField)).toEqual(['abc123']);
            expect(traceField.config.links).toEqual([
                {
                    title: 'View trace',
                    url: '',
                    internal: {
                        datasourceUid: 'trace-uid',
                        datasourceName: 'Google Cloud Trace',
                        query: {
                            refId: 'trace',
                            queryType: 'traceID',
                            traceId: '${__value.raw}',
                            projectId: '${__data.fields.traceProject}',
                        },
                    },
                },
            ]);
            const projectField = field(response, 'traceProject');
            expect(projectField.type).toBe(FieldType.string);
            expect(projectField.config.custom.hidden).toBe(true);
            expect(values(projectField)).toEqual(['my-proj']);
        });

        it('resolves the project from each row\'s own trace path', async () => {
            const ds = makeDataSource({ logsToTraces: { datasourceUid: 'trace-uid' } });
            const response = await runQuery(ds, logFrame([tracedRow('proj-a', 't1'), tracedRow('proj-b', 't2')]));
            expect(values(field(response, 'traceId'))).toEqual(['t1', 't2']);
            expect(linkProjects(response)).toEqual(['proj-a', 'proj-b']);
        });

        it('leaves rows without a trace unlinked while linking the others', async () => {
            const ds = makeDataSource({ logsToTraces: { datasourceUid: 'trace-uid' } });
            const response = await runQuery(ds, logFrame([tracedRow(), { labels: { level: 'info' } }]));
            expect(values(field(response, 'traceId'))).toEqual(['abc123', null]);
            expect(linkProjects(response)).toEqual(['my-proj', null]);
        });

        it('leaves frames untouched when logsToTraces is not configured', async () => {
            const ds = makeDataSource();
            expectUntouched(await runQuery(ds, logFrame([tracedRow()])));
        });

        it('leaves frames untouched when the configured datasource does not resolve', async () => {
            const ds = makeDataSource({ logsToTraces: { datasourceUid: 'gone' } });
            expectUntouched(await runQuery(ds, logFrame([tracedRow()])));
        });

        it('leaves frames untouched when no row carries a trace', async () => {
            const ds = makeDataSource({ logsToTraces: { datasourceUid: 'trace-uid' } });
            expectUntouched(await runQuery(ds, logFrame([{ labels: { level: 'info' } }, {}])));
        });

        it('leaves frames without a traceId field untouched', async () => {
            const ds = makeDataSource({ logsToTraces: { datasourceUid: 'trace-uid' } });
            const frame = logFrame([tracedRow()]);
            frame.fields = frame.fields.filter((f) => f.name !== 'traceId');
            const response = await runQuery(ds, frame);
            expect(response.data[0].fields).toHaveLength(BASE_FIELDS - 1);
        });

        it('falls back to the default project when the trace label is not a resource path', async () => {
            const ds = makeDataSource({
                logsToTraces: { datasourceUid: 'trace-uid' },
                defaultProject: 'my-default-proj',
            });
            const response = await runQuery(ds, logFrame([{ traceId: 'abc123', labels: { trace: 'abc123' } }]));
            expect(linkProjects(response)).toEqual(['my-default-proj']);
        });

        it('skips the link when no project can be determined for any row', async () => {
            const ds = makeDataSource({ logsToTraces: { datasourceUid: 'trace-uid' } });
            expectUntouched(await runQuery(ds, logFrame([{ traceId: 'abc123', labels: { trace: 'abc123' } }])));
        });

        it('nulls out the trace id of rows whose project cannot be resolved so they get no broken link', async () => {
            const ds = makeDataSource({ logsToTraces: { datasourceUid: 'trace-uid' } });
            const response = await runQuery(ds, logFrame([tracedRow(), { traceId: 'zzz', labels: { trace: 'zzz' } }]));
            expect(values(field(response, 'traceId'))).toEqual(['abc123', null]);
            expect(linkProjects(response)).toEqual(['my-proj', null]);
        });

        it('keeps the trace-path project when targets carry a projectId and the flag is off', async () => {
            const ds = makeDataSource({ logsToTraces: { datasourceUid: 'trace-uid' } });
            const targets = [{ refId: 'A', projectId: 'other-proj' } as Query];
            const response = await runQuery(ds, logFrame([tracedRow()]), targets);
            expect(linkProjects(response)).toEqual(['my-proj']);
        });

        it('warms the GCE default project for the trace-link fallback when the flag is off', async () => {
            const ds = makeDataSource({
                logsToTraces: { datasourceUid: 'trace-uid' },
                authenticationType: GoogleAuthType.GCE,
            });
            const gceSpy = jest.spyOn(ds, 'getGCEDefaultProject').mockResolvedValue('gce-proj');
            // The target carries a projectId, so the warm-up is not needed to
            // build the request — only the non-canonical trace-path fallback
            // consumes it when the response is mapped.
            const targets = [{ refId: 'A', projectId: 'some-proj' } as Query];
            const response = await runQuery(ds, logFrame([{ traceId: 'abc123', labels: { trace: 'abc123' } }]), targets);

            expect(gceSpy).toHaveBeenCalled();
            expect(linkProjects(response)).toEqual(['gce-proj']);
        });

        describe('with projectIdFromQuery enabled', () => {
            const stubTemplateSrv = {
                replace: (s?: string) => (s === '$project' ? 'tenant-proj' : s ?? ''),
            } as unknown as TemplateSrv;

            const makeFlagOnDataSource = (overrides?: Partial<CloudLoggingOptions>) =>
                makeDataSource(
                    { logsToTraces: { datasourceUid: 'trace-uid', projectIdFromQuery: true }, ...overrides },
                    stubTemplateSrv
                );

            const routedFrame = () => logFrame([tracedRow('routing-proj')]);

            it('uses the projectId of the target that produced the frame, not the trace path', async () => {
                const ds = makeFlagOnDataSource();
                const targets = [{ refId: 'A', projectId: 'tenant-proj' } as Query];
                const response = await runQuery(ds, routedFrame(), targets);
                expect(linkProjects(response)).toEqual(['tenant-proj']);
            });

            it('applies the target project to every row of the frame', async () => {
                const ds = makeFlagOnDataSource();
                const targets = [{ refId: 'A', projectId: 'tenant-proj' } as Query];
                const response = await runQuery(ds, logFrame([tracedRow('routing-a', 't1'), tracedRow('routing-b', 't2')]), targets);
                expect(linkProjects(response)).toEqual(['tenant-proj', 'tenant-proj']);
            });

            it('interpolates template variables in the target projectId', async () => {
                const ds = makeFlagOnDataSource();
                const targets = [{ refId: 'A', projectId: '$project' } as Query];
                const response = await runQuery(ds, routedFrame(), targets);
                expect(linkProjects(response)).toEqual(['tenant-proj']);
            });

            it('falls back to the default project when no target matches the frame', async () => {
                const ds = makeFlagOnDataSource({ defaultProject: 'my-default-proj' });
                const response = await runQuery(ds, routedFrame(), []);
                expect(linkProjects(response)).toEqual(['my-default-proj']);
            });

            it('falls back to the default project when the matching target has no projectId', async () => {
                const ds = makeFlagOnDataSource({ defaultProject: 'my-default-proj' });
                const targets = [{ refId: 'A', projectId: '' } as Query];
                const response = await runQuery(ds, routedFrame(), targets);
                expect(linkProjects(response)).toEqual(['my-default-proj']);
            });

            it('ignores hidden targets when resolving the project', async () => {
                const ds = makeFlagOnDataSource({ defaultProject: 'my-default-proj' });
                const targets = [{ refId: 'A', projectId: 'tenant-proj', hide: true } as Query];
                const response = await runQuery(ds, routedFrame(), targets);
                expect(linkProjects(response)).toEqual(['my-default-proj']);
            });

            it('omits the link when neither a target project nor a default project resolves', async () => {
                const ds = makeFlagOnDataSource();
                expectUntouched(await runQuery(ds, routedFrame(), []));
            });

            it('pre-resolves the GCE default project so the link fallback works under GCE auth', async () => {
                const ds = makeFlagOnDataSource({ authenticationType: GoogleAuthType.GCE });
                const gceSpy = jest.spyOn(ds, 'getGCEDefaultProject').mockResolvedValue('gce-proj');
                // All targets carry a projectId, but none matches the frame's
                // refId, so the link must fall back to the GCE project.
                const targets = [{ refId: 'B', projectId: 'other-proj' } as Query];
                const response = await runQuery(ds, routedFrame(), targets);
                expect(gceSpy).toHaveBeenCalled();
                expect(linkProjects(response)).toEqual(['gce-proj']);
            });
        });
    });

    describe('applyTemplateVariables', () => {
        const passthroughTemplateSrv = {
            replace: (s?: string) => s ?? '',
        } as unknown as TemplateSrv;

        it('defaults projectId to the configured default project when the query has none', () => {
            const ds = makeDataSource({ defaultProject: 'my-default-proj' }, passthroughTemplateSrv);
            const query = { refId: 'A', query: '"abc123"' } as Query;
            expect(ds.applyTemplateVariables(query, {} as ScopedVars).projectId).toBe('my-default-proj');
        });

        it('keeps the query projectId when present', () => {
            const ds = makeDataSource({ defaultProject: 'my-default-proj' }, passthroughTemplateSrv);
            const query = { refId: 'A', projectId: 'explicit-proj' } as Query;
            expect(ds.applyTemplateVariables(query, {} as ScopedVars).projectId).toBe('explicit-proj');
        });

        it('uses the GCE default project for span-link queries under GCE auth', () => {
            const ds = makeDataSource(
                { authenticationType: GoogleAuthType.GCE, gceDefaultProject: 'gce-proj' },
                passthroughTemplateSrv
            );
            const query = { refId: 'A', query: '"abc123"' } as Query;
            expect(ds.applyTemplateVariables(query, {} as ScopedVars).projectId).toBe('gce-proj');
        });

        it('leaves projectId empty for non-span-link queries so misconfiguration fails loudly', () => {
            const ds = makeDataSource({ defaultProject: 'my-default-proj' }, passthroughTemplateSrv);
            const query = { refId: 'A' } as Query;
            expect(ds.applyTemplateVariables(query, {} as ScopedVars).projectId).toBe('');
        });
    });
});

const makeDataSource = (overrides?: Partial<CloudLoggingOptions>, templateSrv?: TemplateSrv) => {
    return new DataSource({
        id: random(100),
        type: 'googlecloud-logging-datasource',
        access: 'direct',
        meta: {} as DataSourcePluginMeta,
        uid: `${random(100)}`,
        jsonData: {
            authenticationType: GoogleAuthType.JWT,
            ...overrides,
        },
        name: 'something',
        readOnly: true,
    }, templateSrv);
}
