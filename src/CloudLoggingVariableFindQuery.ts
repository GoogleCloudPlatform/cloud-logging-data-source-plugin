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
import { getTemplateSrv } from '@grafana/runtime';
import { DataSource } from './datasource';
import { CloudLoggingVariableQuery, LogFindQueryScopes } from './types';

const toOption = (value: string): SelectableValue<string> => ({ text: value, value, expandable: true });

/**
 * Resolves the values of a Cloud Logging query variable.
 *
 * Errors are deliberately not swallowed: Grafana shows them in the variable
 * editor and dashboard settings, which beats silently offering no values
 * (a disabled Cloud Resource Manager API, for example, used to look like an
 * empty project list).
 */
export default class CloudLoggingVariableFindQuery {
    constructor(private datasource: DataSource) { }

    async execute(query: CloudLoggingVariableQuery): Promise<Array<SelectableValue<string>>> {
        const projectId = query.projectId || (await this.datasource.getDefaultProject());
        switch (query.selectedQueryType) {
            case LogFindQueryScopes.Projects:
                return this.handleProjectsQuery();
            case LogFindQueryScopes.Buckets:
                return this.handleBucketQuery(projectId);
            case LogFindQueryScopes.Views:
                return this.handleViewQuery(projectId, query.bucketId);
            default:
                return [];
        }
    }

    async handleProjectsQuery() {
        const projects = await this.datasource.getFilteredProjects();
        return projects.map(toOption);
    }

    async handleBucketQuery(projectId: string) {
        const buckets = await this.datasource.getFilteredBuckets(this.resolveProject(projectId, 'log buckets'));
        return buckets.map(toOption);
    }

    async handleViewQuery(projectId: string, bucketId?: string) {
        if (!bucketId) {
            return [];
        }
        const bucket = this.interpolate(bucketId);
        // Return if we don't know the bucket
        if (!bucket) {
            return [];
        }
        const views = await this.datasource.getLogBucketViews(this.resolveProject(projectId, 'log views'), bucket);
        return views.map(toOption);
    }

    /** Interpolates a `$variable` reference; other values pass through. */
    private interpolate(value: string): string {
        return value.startsWith('$') ? getTemplateSrv().replace(value) : value;
    }

    /**
     * The backend rejects an empty project, so fail with a message that says
     * what to do rather than "Missing required parameter: ProjectId".
     */
    private resolveProject(projectId: string, what: string): string {
        const project = this.interpolate(projectId);
        if (!project) {
            throw new Error(
                `Cannot list ${what}: select a project in the variable query or configure a default project on the data source.`
            );
        }
        return project;
    }
}
