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
  AdHocVariableFilter,
  DataFrame,
  DataQueryRequest,
  DataQueryResponse,
  DataSourceInstanceSettings,
  Field,
  FieldType,
  MetricFindValue,
  QueryFixAction,
  ScopedVars,
} from '@grafana/data';
import { DataSourceWithBackend, getBackendSrv, getDataSourceSrv, getTemplateSrv, TemplateSrv } from '@grafana/runtime';
import { from, lastValueFrom, Observable } from 'rxjs';
import { map, mergeMap, tap } from 'rxjs/operators';
import { CloudLoggingOptions, Query } from './types';
import { CloudLoggingVariableSupport } from './variables';

const DEFAULT_TAG_KEYS: readonly string[] = [
  'severity',
  'resource.type',
  'logName',
  'insertId',
  'trace',
  'spanId',
  'httpRequest.requestMethod',
  'httpRequest.status',
  'httpRequest.requestUrl',
  'httpRequest.userAgent',
  'httpRequest.remoteIp',
  'resource.labels.project_id',
  'resource.labels.location',
  'resource.labels.zone',
  'resource.labels.cluster_name',
  'resource.labels.namespace_name',
  'resource.labels.pod_name',
  'resource.labels.container_name',
  'resource.labels.service_name',
  'resource.labels.revision_name',
  'resource.labels.configuration_name',
  'resource.labels.instance_id',
  'resource.labels.function_name',
];

const CLOUD_LOGGING_SEVERITIES: readonly string[] = [
  'DEFAULT',
  'DEBUG',
  'INFO',
  'NOTICE',
  'WARNING',
  'ERROR',
  'CRITICAL',
  'ALERT',
  'EMERGENCY',
];

const SUPPORTED_ADHOC_OPERATORS = new Set(['=', '!=', '=~', '!~', '<', '>', '<=', '>=']);
// Cloud Logging Query Language field path: dot-separated identifiers or
// double-quoted segments (e.g. `labels."k8s-pod/app"`). Prevents whitespace,
// parentheses, or `OR` filter-bypass injection via filter keys.
const LQL_FIELD_PATH_RE =
  /^[a-zA-Z_][a-zA-Z0-9_-]*(?:\.(?:[a-zA-Z_][a-zA-Z0-9_-]*|"(?:[^"\\\r\n]|\\.)+"))*$/;
const LQL_RESERVED_KEYWORDS = new Set(['AND', 'OR', 'NOT']);
const MAX_OBSERVED_KEYS = 200;
const MAX_OBSERVED_VALUES_PER_KEY = 50;
const MAX_OBSERVED_VALUE_LENGTH = 200;
const MAX_OBSERVED_ROWS_PER_FRAME = 200;
const EXCLUDED_OBSERVED_VALUE_KEYS = new Set(['textPayload', 'trace', 'spanId']);

export class DataSource extends DataSourceWithBackend<Query, CloudLoggingOptions> {
  authenticationType: string;
  annotations = {};
  private observedLabels = new Map<string, Set<string>>();

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
   * Synchronous view of the default project. For GCE / Application Default
   * Credentials auth, an explicitly configured `defaultProject` takes
   * precedence over the auto-detected `gceDefaultProject` (which is only
   * populated once {@link ensureGCEDefaultProject} has resolved).
   */
  private defaultProjectSync(): string {
    const { authenticationType, defaultProject, gceDefaultProject } = this.instanceSettings.jsonData;
    return (authenticationType === 'gce' ? defaultProject || gceDefaultProject : defaultProject) || '';
  }

  async getGCEDefaultProject() {
    return this.getResource(`gceDefaultProject`);
  }

  /**
   * Resolve and cache the GCE / ADC default project. Single-flight: concurrent
   * queries share one resource call, and a failed lookup is not retried
   * until the next page load — retrying per query would gate every query
   * on a full failing round-trip. Skipped when `defaultProject` is already
   * configured explicitly (for example, when using local `gcloud` ADC).
   */
  private gceDefaultProjectPromise: Promise<void> | null = null;

  async ensureGCEDefaultProject() {
    const { authenticationType, defaultProject, gceDefaultProject } = this.instanceSettings.jsonData;
    if (authenticationType !== 'gce' || defaultProject || gceDefaultProject) {
      return;
    }
    if (!this.gceDefaultProjectPromise) {
      this.gceDefaultProjectPromise = this.getGCEDefaultProject().then((project) => {
        this.instanceSettings.jsonData.gceDefaultProject = project;
      });
    }
    return this.gceDefaultProjectPromise;
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
   * Check that a project exists, independent of the capped project list.
   */
  projectExists(projectId: string): Promise<boolean> {
    return this.getResource('projectExists', { ProjectId: projectId });
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
    const uid = this.instanceSettings.jsonData.logsToTraces?.datasourceUid;
    const traceDs = uid ? getDataSourceSrv().getInstanceSettings(uid) : undefined;
    // For GCE auth, defaultProjectSync() reads a lazily-populated cache.
    // applyTemplateVariables falls back to it while the backend request is
    // built, so when a target has no projectId the cache must resolve before
    // super.query. The trace-link fallbacks read the same cache but only
    // once the response is mapped, so for them the warm-up runs concurrently
    // with the query and is awaited in the response pipe below.
    const needsDefaultProjectForRequest = request.targets.some((t) => !t.hide && !t.projectId);
    const gceWarmup =
      this.instanceSettings.jsonData.authenticationType === 'gce' && (needsDefaultProjectForRequest || !!traceDs)
        ? this.ensureGCEDefaultProject().catch(() => {})
        : undefined;
    const base = (
      gceWarmup && needsDefaultProjectForRequest
        ? from(gceWarmup).pipe(mergeMap(() => super.query(request)))
        : super.query(request)
    ).pipe(
      tap((response) => {
        for (const frame of response?.data ?? []) {
          this.recordObservedLabels(frame);
        }
      })
    );
    if (!traceDs) {
      return base;
    }
    // With projectIdFromQuery enabled, trace links use the project of the
    // query target that produced each frame (matched by refId) instead of
    // the project embedded in the log entry's trace path.
    const projectByRefId = this.instanceSettings.jsonData.logsToTraces?.projectIdFromQuery
      ? new Map(
          request.targets
            .filter((t) => !t.hide && t.projectId)
            .map((t) => [t.refId, this.templateSrv.replace(t.projectId, request.scopedVars)])
        )
      : undefined;
    const awaited = gceWarmup ? base.pipe(mergeMap((response) => from(gceWarmup.then(() => response)))) : base;
    return awaited.pipe(
      map((response) => ({
        ...response,
        data: response.data.map((frame: DataFrame) =>
          this.addTraceLinkField(
            frame,
            traceDs.uid,
            traceDs.name,
            projectByRefId ? projectByRefId.get(frame.refId ?? '') || this.defaultProjectSync() : undefined
          )
        ),
      }))
    );
  }

  /**
   * The backend emits one dataplane log-lines frame per query. Each row has a
   * nullable `traceId` field (the bare trace ID, null when the entry has no
   * trace) and a `labels` object whose `trace` entry is the raw LogEntry value
   * in the canonical `projects/<project>/traces/<id>` form. Attach an internal
   * data link to `traceId` so the log details panel renders a "View trace"
   * link that opens the configured tracing data source — the same mechanism
   * as Loki's derived fields.
   *
   * The link's project can differ per row, and a data link is configured per
   * field, so the per-row project is carried in a hidden `traceProject` field
   * and interpolated into the link via `${__data.fields.traceProject}`; the
   * trace ID itself is `${__value.raw}`.
   *
   * `projectIdOverride` is defined when the projectIdFromQuery setting is
   * on: it is used verbatim as the link's project and the trace path is
   * never parsed — the entry may be stamped with a routing project the user
   * explicitly opted out of. An empty override means nothing resolved, so
   * the link is omitted.
   */
  addTraceLinkField(
    frame: DataFrame,
    datasourceUid: string,
    datasourceName: string,
    projectIdOverride?: string
  ): DataFrame {
    const traceField = frame.fields.find((f) => f.name === 'traceId');
    if (!traceField || frame.fields.some((f) => f.name === 'traceProject')) {
      return frame;
    }
    const traceIds = fieldValues<string | null>(traceField);
    if (!traceIds.some((id) => !!id)) {
      return frame;
    }
    const labelsField = frame.fields.find((f) => f.name === 'labels');
    const labelRows = labelsField ? fieldValues<Record<string, string> | null | undefined>(labelsField) : [];

    // LogEntry.trace is a free-form string; when it isn't the canonical
    // resource path, fall back to the default project, and if that is also
    // unset skip the link for that row — Cloud Trace errors on an empty
    // project, so no link beats a broken one.
    const projects = traceIds.map((traceId, i) => {
      if (!traceId) {
        return null;
      }
      const projectId =
        projectIdOverride !== undefined
          ? projectIdOverride
          : labelRows[i]?.['trace']?.match(/^projects\/([^/]+)\/traces\//)?.[1] ?? this.defaultProjectSync();
      return projectId || null;
    });
    if (!projects.some((p) => !!p)) {
      return frame;
    }

    // A data link applies to every non-null value of its field, so rows whose
    // project could not be resolved get their trace ID nulled out rather
    // than a broken link. The full trace path stays visible in `labels`.
    traceField.values = projects.map((p, i) => (p ? traceIds[i] : null)) as unknown as typeof traceField.values;
    traceField.config = {
      ...(traceField.config ?? {}),
      links: [
        {
          title: 'View trace',
          url: '',
          internal: {
            datasourceUid,
            datasourceName,
            query: {
              refId: 'trace',
              queryType: 'traceID',
              traceId: '${__value.raw}',
              projectId: '${__data.fields.traceProject}',
            },
          },
        },
      ],
    };
    frame.fields.push({
      name: 'traceProject',
      type: FieldType.string,
      // `custom.hidden` is what Grafana's log details parser checks to keep a
      // field out of the details view while leaving it available to links.
      config: { custom: { hidden: true } },
      // Grafana >= 10 accepts plain arrays as field values at runtime; the
      // cast only satisfies the bundled @grafana/data 9.x typings (Vector<T>).
      values: projects,
    } as unknown as Field);
    return frame;
  }

  /**
   * Cache label keys and values observed in query responses (bounded LRU) so
   * Ad Hoc filter dropdowns can suggest fields and values seen in recent logs.
   */
  private recordObservedLabels(frame: DataFrame): void {
    if (!frame?.fields) {
      return;
    }
    const labelsField = frame.fields.find((f) => f.name === 'labels');
    if (!labelsField) {
      return;
    }
    const rows = fieldValues<Record<string, unknown> | null | undefined>(labelsField);
    const rowLimit = Math.min(rows.length, MAX_OBSERVED_ROWS_PER_FRAME);
    for (let i = 0; i < rowLimit; i++) {
      const row = rows[i];
      if (!row || typeof row !== 'object') {
        continue;
      }
      for (const [key, rawValue] of Object.entries(row)) {
        if (!key || LQL_RESERVED_KEYWORDS.has(key.toUpperCase()) || !LQL_FIELD_PATH_RE.test(key)) {
          continue;
        }
        let values = this.observedLabels.get(key);
        if (values) {
          // Refresh LRU recency for this key.
          this.observedLabels.delete(key);
          this.observedLabels.set(key, values);
        } else {
          if (this.observedLabels.size >= MAX_OBSERVED_KEYS) {
            const oldestKey = this.observedLabels.keys().next().value;
            if (oldestKey !== undefined) {
              this.observedLabels.delete(oldestKey);
            }
          }
          values = new Set<string>();
          this.observedLabels.set(key, values);
        }
        if (EXCLUDED_OBSERVED_VALUE_KEYS.has(key)) {
          continue;
        }
        if (
          typeof rawValue === 'string' &&
          rawValue.length > 0 &&
          rawValue.length <= MAX_OBSERVED_VALUE_LENGTH &&
          !/[\r\n]/.test(rawValue)
        ) {
          if (values.has(rawValue)) {
            values.delete(rawValue);
            values.add(rawValue);
          } else {
            if (values.size >= MAX_OBSERVED_VALUES_PER_KEY) {
              const oldestVal = values.values().next().value;
              if (oldestVal !== undefined) {
                values.delete(oldestVal);
              }
            }
            values.add(rawValue);
          }
        }
      }
    }
  }

  /**
   * Return available filter keys for Grafana Ad Hoc filter variables:
   * standard Cloud Logging fields plus any label keys observed in query results.
   */
  async getTagKeys(): Promise<MetricFindValue[]> {
    const keys = new Set<string>(DEFAULT_TAG_KEYS);
    for (const key of Array.from(this.observedLabels.keys()).sort()) {
      keys.add(key);
    }
    return Array.from(keys).map((text) => ({ text }));
  }

  /**
   * Return suggested values for a given Ad Hoc filter key.
   */
  async getTagValues(options?: { key?: string }): Promise<MetricFindValue[]> {
    const key = options?.key;
    if (!key) {
      return [];
    }
    if (key === 'severity' || key === 'level') {
      return CLOUD_LOGGING_SEVERITIES.map((text) => ({ text }));
    }
    const values = this.observedLabels.get(key);
    if (!values) {
      return [];
    }
    return Array.from(values)
      .sort()
      .map((text) => ({ text }));
  }

  interpolateVariablesInQueries(
    queries: Query[],
    scopedVars: ScopedVars,
    filters?: AdHocVariableFilter[]
  ): Query[] {
    return queries.map((q) => this.applyTemplateVariables(q, scopedVars, filters));
  }

  applyTemplateVariables(query: Query, scopedVars: ScopedVars, filters?: AdHocVariableFilter[]): Query {
    const queryText = this.templateSrv.replace(query.queryText, scopedVars);
    const legacyQuery = this.templateSrv.replace(query.query, scopedVars);
    const adHocClauses = formatAdHocFilters(filters);

    let finalQueryText = queryText;
    let finalLegacyQuery = legacyQuery;
    if (adHocClauses) {
      if ((queryText ?? '').trim()) {
        finalQueryText = `${queryText.trimEnd()}\n${adHocClauses}`;
      } else if ((legacyQuery ?? '').trim()) {
        finalLegacyQuery = `${legacyQuery.trimEnd()}\n${adHocClauses}`;
      } else {
        finalQueryText = adHocClauses;
      }
    }

    return {
      ...query,
      queryText: finalQueryText,
      query: finalLegacyQuery,
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
          } else if (action.options?.key === "level" || action.options?.key === "severity") {
            queryText += `\nseverity="${escapeLabelValue(toCloudLoggingSeverity(action.options.value))}"`;
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
          } else if (action.options?.key === "level" || action.options?.key === "severity") {
            queryText += `\nseverity!="${escapeLabelValue(toCloudLoggingSeverity(action.options.value))}"`;
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

function formatAdHocFilters(filters?: AdHocVariableFilter[]): string {
  if (!filters || filters.length === 0) {
    return '';
  }
  const clauses: string[] = [];
  for (const filter of filters) {
    const clause = formatAdHocFilter(filter);
    if (clause) {
      clauses.push(clause);
    }
  }
  return clauses.join('\n');
}

function formatAdHocFilter(filter: AdHocVariableFilter): string | null {
  // Ignore Grafana's internal groupBy tokens.
  if (filter.operator === 'groupBy') {
    return null;
  }
  const rawKey = filter.key?.trim();
  if (!rawKey) {
    return null;
  }
  const ext = filter as AdHocVariableFilter & { values?: string[]; valueLabels?: string[] };
  const values = Array.isArray(ext.values) ? ext.values : undefined;
  const valueLabels = Array.isArray(ext.valueLabels) ? ext.valueLabels : undefined;
  const hasMultipleValues = Boolean(
    (values && values.length > 1) || (valueLabels && valueLabels.length > 1)
  );
  const hasNonEmptyValueLabel = Boolean(valueLabels && valueLabels.some((v) => Boolean(v)));
  const effectiveValue = filter.value || (values && values.length === 1 ? values[0] : '');

  // Ignore incomplete in-progress single-value UI picks before a value is selected.
  if (!effectiveValue && !hasMultipleValues && !hasNonEmptyValueLabel) {
    return null;
  }
  if (!SUPPORTED_ADHOC_OPERATORS.has(filter.operator)) {
    throw new Error(`Unsupported Ad Hoc filter operator "${filter.operator}" for key "${rawKey}"`);
  }
  if (hasMultipleValues) {
    throw new Error(`Multi-value Ad Hoc filters are not supported for key "${rawKey}"`);
  }
  if (!effectiveValue) {
    throw new Error(`Invalid Ad Hoc filter value for key "${rawKey}"`);
  }
  if (LQL_RESERVED_KEYWORDS.has(rawKey.toUpperCase()) || !LQL_FIELD_PATH_RE.test(rawKey)) {
    throw new Error(
      `Invalid Ad Hoc filter key "${rawKey}": expected a Cloud Logging field path (quote segments containing special characters, e.g. labels."k8s-pod/app")`
    );
  }
  const key = rawKey === 'id' ? 'insertId' : rawKey === 'level' ? 'severity' : rawKey;
  return `${key}${filter.operator}"${escapeLabelValue(effectiveValue)}"`;
}

// the 4 symbols we handle are:
// - \  ... the backslash character
// - \r ... the carriage return character
// - \n ... the newline character
// - "  ... the double-quote character
function escapeLabelValue(labelValue: string): string {
  return labelValue.replace(/\\/g, '\\\\').replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

/**
 * Field values as a plain array. Grafana >= 10 hands us plain arrays; the
 * bundled @grafana/data 9.x typings (and tests) still model them as Vector<T>.
 */
function fieldValues<T>(field: Field): T[] {
  const v = field.values as unknown;
  if (Array.isArray(v)) {
    return v as T[];
  }
  const vec = v as { toArray?: () => T[] };
  return typeof vec?.toArray === 'function' ? vec.toArray() : Array.from(v as Iterable<T>);
}

/**
 * Maps a Grafana log level (as shown in the logs panel) back to the Cloud
 * Logging severity it was derived from. Grafana has no DEFAULT or EMERGENCY.
 */
function toCloudLoggingSeverity(level: string): string {
  if (level === 'debug') {
    return 'DEFAULT';
  }
  if (level === 'critical') {
    return 'EMERGENCY';
  }
  return level;
}
