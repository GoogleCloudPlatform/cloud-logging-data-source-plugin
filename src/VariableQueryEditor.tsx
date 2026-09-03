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
import { QueryEditorProps, SelectableValue } from '@grafana/data';
import { getTemplateSrv } from '@grafana/runtime';
import { Alert } from '@grafana/ui';
import { VariableQueryField } from './Fields';
import { DataSource } from './datasource';
import { CloudLoggingVariableQuery, LogFindQueryScopes, VariableScopeData, CloudLoggingOptions, Query } from './types';

export type Props = QueryEditorProps<DataSource, Query, CloudLoggingOptions, CloudLoggingVariableQuery>;

const isTemplateVariable = (value: string) => value.startsWith('$');
const toOption = (value: string): SelectableValue<string> => ({ label: value, value });

/**
 * Human-readable message from a backendSrv fetch error or a plain Error.
 * The backend returns `{ "message": "..." }` bodies, which backendSrv
 * exposes as `err.data`.
 */
export function describeError(err: unknown): string {
  const e = err as { data?: { message?: unknown } | string; message?: unknown; statusText?: unknown } | undefined;
  const data = e?.data;
  const candidates = [
    typeof data === 'object' && data !== null ? data.message : undefined,
    typeof data === 'string' ? data : undefined,
    e?.message,
    e?.statusText,
  ];
  const found = candidates.find((c) => typeof c === 'string' && c.length > 0);
  return typeof found === 'string' ? found : String(err);
}

/**
 * Editor for the Cloud Logging query variable (scope: Projects, Buckets or
 * Views).
 *
 * Option lists are loaded lazily per scope and every fetch is guarded: the
 * Projects scope needs no lookups, Buckets needs the project list, Views
 * needs the project list plus the buckets of the chosen project. A failed
 * lookup is reported inline and never blocks the editor (#212).
 */
export class CloudLoggingVariableQueryEditor extends PureComponent<Props, VariableScopeData> {
  queryTypes: Array<{ value: string; label: string }> = [
    { value: LogFindQueryScopes.Projects, label: 'Projects' },
    { value: LogFindQueryScopes.Buckets, label: 'Buckets' },
    { value: LogFindQueryScopes.Views, label: 'Views' },
  ];

  private unmounted = false;

  constructor(props: Props) {
    super(props);
    const query = props.query ?? ({} as Partial<CloudLoggingVariableQuery>);
    this.state = {
      selectedQueryType: query.selectedQueryType || LogFindQueryScopes.Projects,
      projectId: query.projectId || '',
      bucketId: query.bucketId || '',
      projects: [],
      buckets: [],
      loading: true,
    };
  }

  async componentDidMount() {
    // Resolve the default project first: it seeds the project picker and the
    // saved query model. Everything else is loaded on demand per scope.
    let projectId = this.state.projectId;
    let error: string | undefined;
    if (!projectId) {
      try {
        projectId = await this.props.datasource.getDefaultProject();
      } catch (err) {
        error = `Could not resolve the default project: ${describeError(err)}`;
      }
    }
    if (this.unmounted) {
      return;
    }
    this.setState({ projectId, error, loading: false }, () => {
      // Persist the defaults so a brand-new variable has a scope to run with.
      this.onPropsChange();
      void this.loadOptionsForScope(this.state.selectedQueryType, projectId);
    });
  }

  componentWillUnmount() {
    this.unmounted = true;
  }

  onPropsChange = () => {
    const { selectedQueryType, projectId, bucketId } = this.state;
    this.props.onChange({
      ...this.props.query,
      refId: 'CloudLoggingVariableQueryEditor-VariableQuery',
      selectedQueryType,
      projectId,
      bucketId,
    });
  };

  onQueryTypeChange = (selectedQueryType: string) => {
    this.setState({ selectedQueryType, error: undefined }, () => {
      this.onPropsChange();
      void this.loadOptionsForScope(selectedQueryType, this.state.projectId);
    });
  };

  onProjectChange = (projectId: string) => {
    this.setState({ projectId, bucketId: '', buckets: [], error: undefined }, () => {
      this.onPropsChange();
      if (this.state.selectedQueryType === LogFindQueryScopes.Views) {
        void this.loadBuckets(projectId);
      }
    });
  };

  onBucketChange = (bucketId: string) => {
    this.setState({ bucketId, error: undefined }, () => this.onPropsChange());
  };

  /** Load only what the selected scope's pickers need. */
  private async loadOptionsForScope(scope: string, projectId: string) {
    if (scope === LogFindQueryScopes.Projects) {
      return;
    }
    await this.loadProjects();
    if (scope === LogFindQueryScopes.Views) {
      await this.loadBuckets(projectId);
    }
  }

  private async loadProjects() {
    if (this.state.projects.length > 0) {
      return;
    }
    this.setState({ loading: true });
    try {
      const projects = await this.props.datasource.getFilteredProjects();
      if (!this.unmounted) {
        this.setState({ projects: projects.map(toOption) });
      }
    } catch (err) {
      if (!this.unmounted) {
        // Keep the picker usable: the current project stays selectable and
        // custom values still work.
        const { projectId } = this.state;
        const fallback = projectId && !isTemplateVariable(projectId) ? [toOption(projectId)] : [];
        this.setState({ projects: fallback, error: `Could not load projects: ${describeError(err)}` });
      }
    } finally {
      if (!this.unmounted) {
        this.setState({ loading: false });
      }
    }
  }

  private async loadBuckets(projectId: string) {
    // An empty project used to be sent to the backend, which rejected it and
    // left the editor stuck on "Loading..." (#212).
    if (!projectId || isTemplateVariable(projectId)) {
      this.setState({ buckets: [] });
      return;
    }
    this.setState({ loading: true });
    try {
      const buckets = await this.props.datasource.getFilteredBuckets(projectId);
      if (!this.unmounted) {
        this.setState({ buckets: buckets.map(toOption) });
      }
    } catch (err) {
      if (!this.unmounted) {
        this.setState({ buckets: [], error: `Could not load log buckets for ${projectId}: ${describeError(err)}` });
      }
    } finally {
      if (!this.unmounted) {
        this.setState({ loading: false });
      }
    }
  }

  render() {
    const { selectedQueryType, projectId, bucketId, projects, buckets, loading, error } = this.state;
    const variableOptionGroup = {
      label: 'Template Variables',
      expanded: false,
      options: getTemplateSrv()
        .getVariables()
        .map((v) => toOption(`$${v.name}`)),
    };

    return (
      <>
        <VariableQueryField
          inputId="cloud-logging-variable-scope"
          value={selectedQueryType}
          options={this.queryTypes}
          onChange={this.onQueryTypeChange}
          label="Logging Scope"
        />
        {selectedQueryType !== LogFindQueryScopes.Projects && (
          <VariableQueryField
            inputId="cloud-logging-variable-project"
            allowCustomValue={true}
            isLoading={loading && projects.length === 0}
            value={projectId}
            options={[variableOptionGroup, ...projects]}
            onChange={this.onProjectChange}
            label="Project"
          />
        )}
        {selectedQueryType === LogFindQueryScopes.Views && (
          <VariableQueryField
            inputId="cloud-logging-variable-bucket"
            allowCustomValue={true}
            isLoading={loading}
            value={bucketId}
            options={[variableOptionGroup, ...buckets]}
            onChange={this.onBucketChange}
            label="Bucket"
          />
        )}
        {error && <Alert severity="error" title={error} />}
      </>
    );
  }
}
