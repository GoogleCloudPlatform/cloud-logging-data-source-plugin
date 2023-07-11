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

import React, { PureComponent } from 'react';
import { VariableQueryField } from './Fields';
import { QueryEditorProps } from '@grafana/data';
import { DataSource } from './datasource';
import { CloudLoggingVariableQuery, LogFindQueryScopes, VariableScopeData, CloudLoggingOptions, Query } from './types';
import { getTemplateSrv } from '@grafana/runtime';

export type Props = QueryEditorProps<DataSource, Query, CloudLoggingOptions, CloudLoggingVariableQuery>;


export class CloudLoggingVariableQueryEditor extends PureComponent<Props, VariableScopeData> {
    queryTypes: Array<{ value: string; label: string }> = [
        { value: LogFindQueryScopes.Projects, label: 'Projects' },
        { value: LogFindQueryScopes.Buckets, label: 'Buckets' },
        { value: LogFindQueryScopes.Views, label: 'Views' },
    ];

    defaults: VariableScopeData = {
        selectedQueryType: this.queryTypes[0].value,
        bucketId: '',
        viewId: '',
        projects: [],
        buckets: [],
        projectId: '',
        loading: true,
    };

    constructor(props: Props) {
        super(props);
        this.state = Object.assign(this.defaults, this.props.query);
    }

    async componentDidMount() {
        await this.props.datasource.ensureGCEDefaultProject();
        const projectId = this.props.query.projectId || (await this.props.datasource.getDefaultProject());
        const projects = (await this.props.datasource.getProjects());
        let buckets: string[] = [];
        if (!projectId.startsWith('$')) {
            buckets = await this.props.datasource.getLogBuckets(projectId);
        }

        const state: any = {
            projects,
            buckets,
            loading: false,
            projectId,
        };
        this.setState(state, () => this.onPropsChange());
    }

    onPropsChange = () => {
        const { buckets, ...queryModel } = this.state;
        this.props.onChange({ ...queryModel, refId: 'CloudLoggingVariableQueryEditor-VariableQuery' });
    };

    async onQueryTypeChange(queryType: string) {
        const state: any = {
            selectedQueryType: queryType,
        };

        this.setState(state);
    }

    async onProjectChange(projectId: string) {
        let buckets: string[] = [];
        if (!projectId.startsWith('$')) {
            buckets = await this.props.datasource.getLogBuckets(projectId);
        }
        const state: any = {
            buckets,
            projectId,
            bucketId: '',
            viewId: '',
        };
        this.setState(state, () => this.onPropsChange());
    }

    async onBucketChange(projectId: string, bucketId: string) {
        let views: string[] = [];
        if (!bucketId.startsWith('$')) {
            views = await this.props.datasource.getLogBucketViews(projectId, bucketId);
        }

        const state: any = {
            views,
            projectId,
            bucketId,
            viewId: '',
        };
        this.setState(state, () => this.onPropsChange());
    }

    renderLogScopeSwitch(queryType: string) {
        const variableOptionGroup = {
            label: 'Template Variables',
            expanded: false,
            options: getTemplateSrv()
                .getVariables()
                .map((v: any) => ({
                    value: `$${v.name}`,
                    label: `$${v.name}`,
                })),
        };

        switch (queryType) {
            case LogFindQueryScopes.Buckets:
                return (
                    <>
                        <VariableQueryField
                            allowCustomValue={true}
                            value={this.state.projectId}
                            options={[variableOptionGroup, ...this.state.projects.map((v: any) => ({
                                value: `${v}`,
                                label: `${v}`,
                            }))]}
                            onChange={(value) => this.onProjectChange(value)}
                            label="Project"
                        />
                    </>
                );
            case LogFindQueryScopes.Views:
                return (
                    <>
                        <VariableQueryField
                            allowCustomValue={true}
                            value={this.state.projectId}
                            options={[variableOptionGroup, ...this.state.projects.map((v: any) => ({
                                value: `${v}`,
                                label: `${v}`,
                            }))]}
                            onChange={(value) => this.onProjectChange(value)}
                            label="Project"
                        />
                        <VariableQueryField
                            allowCustomValue={true}
                            value={this.state.bucketId}
                            options={[variableOptionGroup, ...this.state.buckets.map((v: any) => ({
                                value: `${v}`,
                                label: `${v}`,
                            }))]}
                            onChange={(value) => this.onBucketChange(this.state.projectId, value)}
                            label="Bucket"
                        />
                    </>);
            default:
                return '';
        }
    }

    render() {
        if (this.state.loading) {
            return (
                <div className="gf-form max-width-21">
                    <span className="gf-form-label width-10 query-keyword">Logging Scope</span>
                    <div className="gf-form-select-wrapper max-width-12">
                        <select className="gf-form-input">
                            <option>Loading...</option>
                        </select>
                    </div>
                </div>
            );
        }

        return (
            <>
                <VariableQueryField
                    value={this.state.selectedQueryType}
                    options={this.queryTypes}
                    onChange={(value) => this.onQueryTypeChange(value)}
                    label="Logging Scope"
                />
                {this.renderLogScopeSwitch(this.state.selectedQueryType)}
            </>
        );
    }
}
