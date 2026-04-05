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

import { DataSourcePluginMeta } from '@grafana/data';
import { GoogleAuthType } from '@grafana/google-sdk';
import { random } from 'lodash';
import { DataSource } from './datasource';


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
});

const makeDataSource = (overrides?: { projectListFilter?: string; logBucketFilter?: string }) => {
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
    });
}
