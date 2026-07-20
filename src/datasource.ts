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

import {
  DataFrame,
  DataQueryRequest,
  DataQueryResponse,
  DataSourceInstanceSettings,
  Field,
  FieldType,
  QueryFixAction,
  ScopedVars,
} from '@grafana/data';
import { DataSourceWithBackend, getBackendSrv, getDataSourceSrv, getTemplateSrv, TemplateSrv } from '@grafana/runtime';
import { from, lastValueFrom, Observable } from 'rxjs';
import { map, mergeMap } from 'rxjs/operators';
import { CloudLoggingOptions, Query } from './types';
import { CloudLoggingVariableSupport } from './variables';

export class DataSource extends DataSourceWithBackend<Query, CloudLoggingOptions> {
  authenticationType: string;
  annotations = {};

  constructor(
    private instanceSettings: DataSourceInstanceSettings<CloudLoggingOptions>,
    private readonly templateSrv: TemplateSrv = getTemplateSrv(),
  ) {
    super(instanceSettings);
    this.authenticationType = instanceSettings.jsonData.authenticationType || 'jwt';
    this.variables = new CloudLoggingVariableSupport(this);
  }

  /**
   * Override testDatasource to sanitize errors that may contain raw HTML.
   * When Grafana returns HTTP 502 for health checks, the GCP Load Balancer
   * intercepts it and replaces the body with its own HTML 502 page. This
   * override catches those errors and returns a readable message instead.
   */
  async testDatasource() {
    try {
      return await super.testDatasource();
    } catch (err: unknown) {
      const errObj = err as Record<string, unknown>;
      // Grafana's backendSrv puts the HTTP response body in err.data
      const raw = errObj?.['data'] ?? errObj?.['message'] ?? String(err);
      const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
      const isHtml = /<html[\s>]|<!doctype\s+html/i.test(text) || text.includes('text/html');
      return {
        status: 'error' as const,
        message: isHtml
          ? 'The server returned an HTML error page. If you set a Universe Domain, please verify it is correct.'
          : text,
      };
    }
  }

  /**
   * Override getResource to suppress Grafana's automatic error toast popups.
   * The plugin's QueryEditor already shows errors inline via its own Alert,
   * so the default toasts cause every error to appear twice.
   */
  async getResource(path: string, params?: Record<string, unknown>): Promise<any> {
    return lastValueFrom(
      getBackendSrv().fetch({
        url: `/api/datasources/uid/${this.uid}/resources/${path}`,
        params,
        method: 'GET',
        showErrorAlert: false,
      })
    ).then((response) => response.data);
  }

  /**
   * Get the Project ID from GCE or we parsed from the data source's JWT token
   *
   * @returns Project ID
   */
  async getDefaultProject() {
    if (this.instanceSettings.jsonData.authenticationType === 'gce') {
      await this.ensureGCEDefaultProject();
    }
    return this.defaultProjectSync();
  }

  /**
   * Synchronous view of the default project. For GCE auth this reads the
   * cached `gceDefaultProject`, which is only populated once
   * {@link ensureGCEDefaultProject} has resolved.
   */
  private defaultProjectSync(): string {
    const { authenticationType, defaultProject, gceDefaultProject } = this.instanceSettings.jsonData;
    return (authenticationType === 'gce' ? gceDefaultProject : defaultProject) || '';
  }

  async getGCEDefaultProject() {
    return this.getResource(`gceDefaultProject`);
  }

  async ensureGCEDefaultProject() {
    const { authenticationType, gceDefaultProject } = this.instanceSettings.jsonData;
    if (authenticationType === 'gce' && !gceDefaultProject) {
      this.instanceSettings.jsonData.gceDefaultProject = await this.getGCEDefaultProject();
    }
  }

  /**
   * Have the backend call `resourcemanager.projects.list` with our credentials,
   * and return the IDs of all projects found.
   * When query is provided, results are filtered server-side.
   * The default (empty) call is cached so multiple query editors don't
   * trigger redundant backend requests.
   *
   * @returns List of discovered project IDs
   */
  private defaultProjectsCache: Promise<string[]> | null = null;

  getProjects(query?: string): Promise<string[]> {
    if (!query) {
      if (!this.defaultProjectsCache) {
        this.defaultProjectsCache = this.getResource('projects').catch((err: unknown) => {
          this.defaultProjectsCache = null;
          throw err;
        });
      }
      return this.defaultProjectsCache;
    }
    return this.getResource('projects', { query });
  }

  /**
   * Filter a list of project IDs against the configured project list filter patterns.
   * Each non-empty line in `projectListFilter` is treated as a regex pattern
   * anchored to the full project ID (^pattern$).
   * If no patterns are configured, all projects pass through unchanged.
   */
  filterProjects(projects: string[]): string[] {
    const raw = this.instanceSettings.jsonData.projectListFilter;
    if (!raw || !raw.trim()) {
      return projects;
    }
    const patterns = raw
      .split('\n')
      .map((line: string) => line.trim())
      .filter((line: string) => line.length > 0);
    if (patterns.length === 0) {
      return projects;
    }
    const regexes = patterns.map((p: string) => {
      try {
        return new RegExp(`^${p}$`);
      } catch {
        // If invalid regex, escape special chars and treat as literal match
        return new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
      }
    });
    return projects.filter((proj: string) => regexes.some((r: RegExp) => r.test(proj)));
  }

  /**
   * Get projects from the API and apply the configured project list filter.
   */
  async getFilteredProjects(query?: string): Promise<string[]> {
    const projects = await this.getProjects(query);
    return this.filterProjects(projects);
  }

  /**
   * Have the backend call `projects.locations.buckets.list` with our credentials,
   * and return the names of all log buckets found
   *
   * @returns List of discovered bucket names
   */
  getLogBuckets(projectId: string): Promise<string[]> {
    return this.getResource(`logBuckets`, { "ProjectId": projectId });
  }

  /**
   * Filter a list of bucket IDs against the configured log bucket filter patterns.
   * Each non-empty line in `logBucketFilter` is treated as a regex pattern
   * anchored to the full bucket path (^pattern$).
   *
   * Lines prefixed with `!` are **exclude** patterns — matching buckets are removed.
   * Lines without `!` are **include** patterns — only matching buckets are kept.
   *
   * Evaluation order:
   * 1. If include patterns exist, keep only buckets matching at least one.
   * 2. Remove any buckets matching any exclude pattern.
   * If no patterns are configured, all buckets pass through unchanged.
   */
  filterBuckets(buckets: string[]): string[] {
    const raw = this.instanceSettings.jsonData.logBucketFilter;
    if (!raw || !raw.trim()) {
      return buckets;
    }
    const lines = raw
      .split('\n')
      .map((line: string) => line.trim())
      .filter((line: string) => line.length > 0);
    if (lines.length === 0) {
      return buckets;
    }

    const toRegex = (pattern: string): RegExp => {
      try {
        return new RegExp(`^${pattern}$`);
      } catch {
        return new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
      }
    };

    const includePatterns: RegExp[] = [];
    const excludePatterns: RegExp[] = [];

    for (const line of lines) {
      if (line.startsWith('!')) {
        const pattern = line.slice(1).trim();
        if (pattern.length > 0) {
          excludePatterns.push(toRegex(pattern));
        }
      } else {
        includePatterns.push(toRegex(line));
      }
    }

    let result = buckets;

    // Step 1: If include patterns exist, keep only matching buckets
    if (includePatterns.length > 0) {
      result = result.filter((bucket: string) =>
        includePatterns.some((r: RegExp) => r.test(bucket))
      );
    }

    // Step 2: Remove any buckets matching exclude patterns
    if (excludePatterns.length > 0) {
      result = result.filter((bucket: string) =>
        !excludePatterns.some((r: RegExp) => r.test(bucket))
      );
    }

    return result;
  }

  /**
   * Get log buckets from the API and apply the configured log bucket filter.
   */
  async getFilteredBuckets(projectId: string): Promise<string[]> {
    const buckets = await this.getLogBuckets(projectId);
    return this.filterBuckets(buckets);
  }

  /**
   * Have the backend call `projects.locations.buckets.views.list` with our credentials,
   * and return the names of all views of the log bucket
   *
   * @returns List of discovered bucket names
   */
  getLogBucketViews(projectId: string, bucketId: string): Promise<string[]> {
    return this.getResource(`logViews`, { "ProjectId": projectId, "BucketId": bucketId });
  }

  /**
   * After performing a query, attach logs-to-traces data links when a
   * tracing data source is configured in the "Logs to traces" settings.
   *
   * @param request  {@link DataQueryRequest<Query>} a data query request
   * @returns a modified {@link Observable<DataQueryResponse>}
   */
  query(request: DataQueryRequest<Query>): Observable<DataQueryResponse> {
    // When a target has no projectId, applyTemplateVariables falls back to
    // defaultProjectSync(), which for GCE auth reads a lazily-populated
    // cache; resolve it before the backend call so the fallback is available.
    const needsDefaultProject = request.targets.some((t) => !t.hide && !t.projectId);
    const base =
      needsDefaultProject && this.instanceSettings.jsonData.authenticationType === 'gce'
        ? from(this.ensureGCEDefaultProject().catch(() => {})).pipe(mergeMap(() => super.query(request)))
        : super.query(request);
    const uid = this.instanceSettings.jsonData.logsToTraces?.datasourceUid;
    const traceDs = uid ? getDataSourceSrv().getInstanceSettings(uid) : undefined;
    if (!traceDs) {
      return base;
    }
    return base.pipe(
      map((response) => ({
        ...response,
        data: response.data.map((frame: DataFrame) => this.addTraceLinkField(frame, traceDs.uid, traceDs.name)),
      }))
    );
  }

  /**
   * The backend emits one frame per log entry, with the entry's trace data
   * attached as labels on the `content` field (`trace` holds the full
   * `projects/<project>/traces/<id>` path, `traceId` the bare ID). Surface
   * the trace ID as its own field carrying an internal data link, so the
   * log details panel renders a "View trace" link that opens the configured
   * tracing data source — the same mechanism as Loki's derived fields.
   */
  addTraceLinkField(frame: DataFrame, datasourceUid: string, datasourceName: string): DataFrame {
    const contentField = frame.fields.find((f) => f.name === 'content');
    const labels = contentField?.labels;
    const traceId = labels?.['traceId'];
    if (!contentField || !labels || !traceId || frame.fields.some((f) => f.name === 'traceId')) {
      return frame;
    }
    // LogEntry.trace is a free-form string; when it isn't the canonical
    // resource path, fall back to the default project, and if that is also
    // unset skip the link entirely — Cloud Trace errors on an empty project,
    // so no link beats a broken one.
    const projectId =
      labels['trace']?.match(/^projects\/([^/]+)\/traces\//)?.[1] ?? this.defaultProjectSync();
    if (!projectId) {
      return frame;
    }
    // The linked field replaces the label in the log details view; leaving
    // both would show `traceId` twice (once without the link).
    delete labels['traceId'];
    const rowCount = contentField.values.length;
    frame.fields.push({
      name: 'traceId',
      type: FieldType.string,
      config: {
        links: [
          {
            title: 'View trace',
            url: '',
            internal: {
              datasourceUid,
              datasourceName,
              query: { refId: 'trace', queryType: 'traceID', traceId, projectId },
            },
          },
        ],
      },
      // Grafana >= 10 accepts plain arrays as field values at runtime; the
      // cast only satisfies the bundled @grafana/data 9.x typings (Vector<T>).
      values: new Array(rowCount).fill(traceId),
    } as unknown as Field);
    return frame;
  }

  applyTemplateVariables(query: Query, scopedVars: ScopedVars): Query {
    return {
      ...query,
      queryText: this.templateSrv.replace(query.queryText, scopedVars),
      query: this.templateSrv.replace(query.query, scopedVars),
      // Trace-to-logs span links built by Grafana core carry only a `query`
      // string and no project; fall back to the default project so the
      // backend doesn't request the invalid resource "projects/". The
      // fallback is scoped to that span-link shape (`query` set, no project)
      // so a dashboard query whose projectId resolves to empty still fails
      // loudly instead of silently reading from the default project.
      projectId:
        this.templateSrv.replace(query.projectId, scopedVars) || (query.query ? this.defaultProjectSync() : ''),
      bucketId: this.templateSrv.replace(query.bucketId, scopedVars),
      viewId: this.templateSrv.replace(query.viewId, scopedVars),
    };
  }

  modifyQuery(query: Query, action: QueryFixAction): Query {
    let queryText = query.queryText;

    switch (action.type) {
      case 'ADD_FILTER': {
        if (action.options?.key && action.options?.value) {
          if (action.options?.key === "id") {
            queryText += `\ninsertId="${escapeLabelValue(action.options.value)}"`;
          } else if (action.options?.key === "level") {
            let level = action.options.value;
            if (level === "debug") {
              level = "DEFAULT";
            } else if (level === "critical") {
              level = "EMERGENCY";
            }
            queryText += `\nseverity="${escapeLabelValue(level)}"`;
          } else {
            queryText += `\n${action.options.key}="${escapeLabelValue(action.options.value)}"`;
          }
        }
        break;
      }
      case 'ADD_FILTER_OUT': {
        if (action.options?.key && action.options?.value) {
          if (action.options?.key === "id") {
            queryText += `\ninsertId!="${escapeLabelValue(action.options.value)}"`;
          } else if (action.options?.key === "level") {
            let level = action.options.value;
            if (level === "debug") {
              level = "DEFAULT";
            } else if (level === "critical") {
              level = "EMERGENCY";
            }
            queryText += `\nseverity!="${escapeLabelValue(level)}"`;
          } else {
            queryText += `\n${action.options.key}!="${escapeLabelValue(action.options.value)}"`;
          }
        }
        break;
      }
    }
    return { ...query, queryText: queryText };
  }

  filterQuery(query: Query): boolean {
    return !query.hide;
  }
}

// the 3 symbols we handle are:
// - \n ... the newline character
// - \  ... the backslash character
// - "  ... the double-quote character
function escapeLabelValue(labelValue: string): string {
  return labelValue.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}
