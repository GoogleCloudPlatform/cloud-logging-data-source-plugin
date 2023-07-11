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

import { SelectableValue } from '@grafana/data';
import { DataSource } from './datasource';
import { CloudLoggingVariableQuery, LogFindQueryScopes } from './types';
import { getTemplateSrv } from '@grafana/runtime';

export default class CloudLoggingVariableFindQuery {
    constructor(private datasource: DataSource) { }

    async execute(query: CloudLoggingVariableQuery) {
        try {
            if (!query.projectId) {
                this.datasource.getDefaultProject().then(r => query.projectId = r);
            }
            switch (query.selectedQueryType) {
                case LogFindQueryScopes.Projects:
                    return this.handleProjectsQuery();
                case LogFindQueryScopes.Buckets:
                    return this.handleBucketQuery(query)
                case LogFindQueryScopes.Views:
                    return this.handleViewQuery(query)
                default:
                    return [];
            }
        } catch (error) {
            console.error(`Could not run CloudLoggingVariableFindQuery ${query}`, error);
            return [];
        }
    }

    async handleProjectsQuery() {
        const projects = await this.datasource.getProjects();
        return (projects).map((s) => ({
            text: s,
            value: s,
            expandable: true,
        } as SelectableValue<string>));
    }

    async handleBucketQuery({ projectId }: CloudLoggingVariableQuery) {
        let buckets: string[] = [];
        let p = projectId
        if (projectId.startsWith('$')) {
            p = getTemplateSrv().replace(projectId)
        }
        buckets = await this.datasource.getLogBuckets(p);
        return (buckets).map((s) => ({
            text: s,
            value: s,
            expandable: true,
        } as SelectableValue<string>));
    }

    async handleViewQuery({ projectId, bucketId }: CloudLoggingVariableQuery) {
        if (!bucketId) {
            return []
        }
        let views: string[] = [];
        let p = projectId
        if (projectId.startsWith('$')) {
            p = getTemplateSrv().replace(projectId)
        }
        let b = bucketId
        if (bucketId.startsWith('$')) {
            b = getTemplateSrv().replace(bucketId)
        }
        // Return if we don't know the bucket
        if (!b) {
            return []
        }
        views = await this.datasource.getLogBucketViews(p, b);
        return (views).map((s) => ({
            text: s,
            value: s,
            expandable: true,
        } as SelectableValue<string>));
    }
}
