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

import React, { KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QueryEditorProps, SelectableValue } from '@grafana/data';
import { Alert, InlineField, InlineFieldRow, LinkButton, Select, TextArea, Tooltip } from '@grafana/ui';
import { DataSource } from './datasource';
import { CloudLoggingOptions, defaultQuery, Query } from './types';

type Props = QueryEditorProps<DataSource, Query, CloudLoggingOptions>;

/**
 * This is basically copied from {MQLQueryEditor} from the cloud-monitoring data source
 *
 */
export function LoggingQueryEditor({ datasource, query, range, onChange, onRunQuery }: React.PropsWithChildren<Props>) {
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.shiftKey || event.ctrlKey)) {
      event.preventDefault();
      onRunQuery();
    }
  };

  // Keep a ref to the latest query so async callbacks avoid stale closures
  const queryRef = useRef(query);
  queryRef.current = query;

  // Ref-based guard: always holds the CURRENT datasource UID.
  // Async callbacks check this at resolution time to detect stale responses,
  // regardless of whether React's effect cleanup has run.
  const activeDsUidRef = useRef(datasource.uid);
  activeDsUidRef.current = datasource.uid;

  // Compute normalized queryText as a derived value (never mutate the prop directly)
  const effectiveQueryText = query.query ?? query.queryText ?? defaultQuery.queryText;

  // ── DEBUG: remove after troubleshooting ──
  console.warn('[QueryEditor RENDER]', {
    'datasource.uid (prop)': datasource.uid,
    'query.datasource?.uid': (query as any).datasource?.uid,
    'query._datasourceUid': query._datasourceUid,
    'query.projectId': query.projectId,
  });

  // Synchronous ownership check: if _datasourceUid is set and doesn't match
  // the current datasource, the query's projectId belongs to a different
  // datasource and must not be used until the init effect corrects it.
  const isProjectOwnedByDatasource = !query._datasourceUid ||
    query._datasourceUid === datasource.uid;

  // Initialization effect: runs on mount and whenever the datasource instance changes.
  useEffect(() => {
    let cancelled = false;

    const computeTextUpdates = (q: Query): Partial<Query> => {
      const norm: Partial<Query> = {};
      if (q.query) {
        norm.queryText = q.query;
        norm.query = undefined;
      }
      if ((norm.queryText ?? q.queryText) == null) {
        norm.queryText = defaultQuery.queryText;
      }
      return norm;
    };

    const latestQuery = queryRef.current;
    const textUpdates = computeTextUpdates(latestQuery);
    const currentProjectId = latestQuery.projectId;

    // Detect datasource switch SYNCHRONOUSLY — before any async work.
    const isDatasourceSwitch = latestQuery._datasourceUid != null
      && latestQuery._datasourceUid !== datasource.uid;

    if (isDatasourceSwitch) {
      console.warn('[QueryEditor INIT] SWITCH detected!', { from: latestQuery._datasourceUid, to: datasource.uid, staleProject: currentProjectId });
      if (currentProjectId && currentProjectId.startsWith('$')) {
        onChange({ ...latestQuery, ...textUpdates, _datasourceUid: datasource.uid });
        return;
      }
      // IMMEDIATELY clear stale project and stamp UID — updates URL right away.
      onChange({
        ...latestQuery, ...textUpdates,
        projectId: '', bucketId: '', viewId: '',
        _datasourceUid: datasource.uid,
      });
      // Then async resolve the correct default project.
      const switchTargetUid = datasource.uid;
      datasource.getDefaultProject().then(async defaultProject => {
        if (cancelled || activeDsUidRef.current !== switchTargetUid) {
          console.warn('[QueryEditor INIT] SWITCH async STALE — skipping', { switchTargetUid, activeDsUid: activeDsUidRef.current });
          return;
        }
        console.warn('[QueryEditor INIT] SWITCH async resolve', {
          switchTargetUid,
          defaultProject,
          currentQueryRef: queryRef.current?.projectId,
          currentQueryRefUid: queryRef.current?._datasourceUid,
        });
        let newProjectId = '';
        if (defaultProject && datasource.filterProjects([defaultProject]).length > 0) {
          newProjectId = defaultProject;
        } else {
          try {
            const filteredProjects = await datasource.getFilteredProjects();
            console.warn('[QueryEditor INIT] SWITCH filteredProjects', { switchTargetUid, filteredProjects });
            if ((cancelled || activeDsUidRef.current !== switchTargetUid) || filteredProjects.length === 0) {
              return;
            }
            newProjectId = filteredProjects[0];
          } catch { /* leave empty */ }
        }
        if (cancelled || activeDsUidRef.current !== switchTargetUid || !newProjectId) { return; }
        console.warn('[QueryEditor INIT] SWITCH setting project', { switchTargetUid, newProjectId });
        const q = queryRef.current;
        // Explicitly stamp _datasourceUid — queryRef.current may be stale.
        onChange({ ...q, projectId: newProjectId, bucketId: '', viewId: '', _datasourceUid: switchTargetUid });
        onRunQuery();
      });
      return () => { cancelled = true; };
    }

    // ── Same datasource (reload / initial mount) ──
    if (currentProjectId && currentProjectId.startsWith('$')) {
      const stampUpdate: Partial<Query> = { ...textUpdates };
      if (!latestQuery._datasourceUid) {
        stampUpdate._datasourceUid = datasource.uid;
      }
      if (Object.keys(stampUpdate).length > 0) {
        onChange({ ...latestQuery, ...stampUpdate });
      }
      return;
    }

    const sameDsUid = datasource.uid;
    datasource.getDefaultProject().then(async defaultProject => {
      if (cancelled || activeDsUidRef.current !== sameDsUid) { return; }
      const q = queryRef.current;
      const qUpdates = computeTextUpdates(q);
      const projId = q.projectId;

      const isValid = projId && datasource.filterProjects([projId]).length > 0;
      if (!isValid) {
        let newProjectId = '';
        if (defaultProject && datasource.filterProjects([defaultProject]).length > 0) {
          newProjectId = defaultProject;
        } else {
          try {
            const fp = await datasource.getFilteredProjects();
            if ((cancelled || activeDsUidRef.current !== sameDsUid) || fp.length === 0) { return; }
            newProjectId = fp[0];
          } catch { /* leave empty */ }
        }
        if (cancelled || activeDsUidRef.current !== sameDsUid) { return; }
        if (newProjectId !== projId) {
          onChange({ ...q, ...qUpdates, projectId: newProjectId, bucketId: '', viewId: '', _datasourceUid: datasource.uid });
          if (newProjectId) { onRunQuery(); }
        } else if (Object.keys(qUpdates).length > 0) {
          onChange({ ...q, ...qUpdates, _datasourceUid: datasource.uid });
        }
        return;
      }

      const updates: Partial<Query> = { ...qUpdates };
      if (!q._datasourceUid) { updates._datasourceUid = datasource.uid; }
      if (q.bucketId && !q.bucketId.startsWith('$') && datasource.filterBuckets([q.bucketId]).length === 0) {
        updates.bucketId = '';
      }
      if (Object.keys(updates).length > 0) {
        onChange({ ...q, ...updates, _datasourceUid: datasource.uid });
      }
    });

    return () => { cancelled = true; };
  }, [datasource]);

  const [fetchError, setFetchError] = useState<string | undefined>();

  /**
   * Sanitize fetch errors — Grafana's backendSrv may include raw HTML bodies
   * from proxy/universe-domain errors in err.data or err.message.
   */
  const sanitizeFetchError = (err: unknown): string => {
    const errData = (err as any)?.data;
    // When the backend returns JSON { "message": "..." }, err.data is the parsed object
    const raw = (typeof errData === 'object' && errData?.message)
      ? errData.message
      : errData ?? (err as any)?.message ?? String(err);
    const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
    // Detect HTML content (full page or gRPC content-type error)
    if (/<html[\s>]|<!doctype\s+html/i.test(text) || text.includes('text/html')) {
      return 'The server returned an HTML error page. If you have configured a Universe Domain, please verify it is correct.';
    }
    return text;
  };

  // Eagerly load the project list into state. This ensures the dropdown
  // always reflects the current datasource's filtered projects, regardless
  // of react-select's internal mount behavior.
  const [projects, setProjects] = useState<Array<SelectableValue<string>>>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);

  // Server-side search: debounce input changes and re-fetch filtered projects.
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    let cancelled = false;
    console.warn('[QueryEditor PROJECTS] Loading projects for datasource:', datasource.uid);
    setProjectsLoading(true);
    const effectDsUid = datasource.uid;
    datasource.getFilteredProjects().then(res => {
      // Double guard: cancelled flag + ref-based UID check
      if (cancelled || activeDsUidRef.current !== effectDsUid) {
        console.warn('[QueryEditor PROJECTS] DISCARDED stale response for', effectDsUid, '(active:', activeDsUidRef.current, ')', res);
        return;
      }
      console.warn('[QueryEditor PROJECTS] Resolved for', effectDsUid, res);
      setProjects(res.map(project => ({
        label: project,
        value: project,
      })));
      setFetchError(undefined);
    }).catch(err => {
      if (cancelled || activeDsUidRef.current !== effectDsUid) { return; }
      setProjects([]);
      setFetchError(sanitizeFetchError(err));
    }).finally(() => {
      if (cancelled || activeDsUidRef.current !== effectDsUid) { return; }
      setProjectsLoading(false);
    });
    // Also clear any pending debounced search from the old datasource.
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    return () => { cancelled = true; };
  }, [datasource]);

  const onProjectSearchChange = useCallback((value: string) => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    const searchDsUid = datasource.uid;
    searchTimeoutRef.current = setTimeout(() => {
      // Ref guard: don't search if datasource changed since debounce started
      if (activeDsUidRef.current !== searchDsUid) {
        console.warn('[QueryEditor SEARCH] DISCARDED stale debounce for', searchDsUid, '(active:', activeDsUidRef.current, ')');
        return;
      }
      console.warn('[QueryEditor SEARCH] Debounce fired for', searchDsUid, 'query:', value);
      setProjectsLoading(true);
      datasource.getFilteredProjects(value || undefined).then(res => {
        if (activeDsUidRef.current !== searchDsUid) {
          console.warn('[QueryEditor SEARCH] DISCARDED stale response for', searchDsUid, '(active:', activeDsUidRef.current, ')');
          return;
        }
        console.warn('[QueryEditor SEARCH] Resolved for', searchDsUid, res);
        setProjects(res.map(project => ({
          label: project,
          value: project,
        })));
        setFetchError(undefined);
      }).catch(err => {
        if (activeDsUidRef.current !== searchDsUid) { return; }
        setProjects([]);
        setFetchError(sanitizeFetchError(err));
      }).finally(() => {
        if (activeDsUidRef.current !== searchDsUid) { return; }
        setProjectsLoading(false);
      });
    }, 300);
  }, [datasource]);

  // Clean up the debounce timer on unmount
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  const [buckets, setBuckets] = useState<Array<SelectableValue<string>>>();
  useEffect(() => {
    if (query.projectId && !query.projectId.startsWith('$') && isProjectOwnedByDatasource) {
      datasource.getFilteredBuckets(query.projectId).then(res => {
        setBuckets(res.map(bucket => ({
          label: bucket,
          value: bucket,
        })));
        setFetchError(undefined);
      }).catch(err => setFetchError(sanitizeFetchError(err)));
    }
  }, [datasource, query.projectId, isProjectOwnedByDatasource]);

  const [views, setViews] = useState<Array<SelectableValue<string>>>();
  useEffect(() => {
    if (!buckets || buckets.length === 0) {
      return;
    }
    const bid = query.bucketId ? query.bucketId : "global/buckets/_Default";
    // Only fetch views if the selected bucket actually exists in the loaded buckets list
    const bucketExists = buckets.some(b => b.value === bid);
    if (query.projectId && !query.projectId.startsWith('$') && !bid.startsWith('$') && bucketExists) {
      datasource.getLogBucketViews(query.projectId, `${bid}`).then(res => {
        setViews(res.map(view => ({
          label: view,
          value: view,
        })));
        setFetchError(undefined);
      }).catch(err => setFetchError(sanitizeFetchError(err)));
    }
  }, [datasource, query.projectId, query.bucketId, buckets]);

  /**
   * Keep an up-to-date URI that links to the equivalent query in the GCP console
   */
  const gcpConsoleURI = useMemo<string | undefined>(() => {
    if (!effectiveQueryText) {
      return undefined;
    }

    let storageScope = "";
    if (query.projectId) {
      let scopePath = `storage,projects/${query.projectId}`;

      if (query.bucketId) {
        // Check if bucketId already includes 'locations/' prefix
        if (query.bucketId.startsWith('locations/')) {
          scopePath += `/${query.bucketId}`;
        } else {
          scopePath += `/locations/${query.bucketId}`;
        }
      } else {
        scopePath += `/locations/global/buckets/_Default`;
      }
      if (query.viewId) {
        scopePath += `/views/${query.viewId}`;
      } else {
        scopePath += `/views/_AllLogs`;
      }

      // URL encode the forward slashes in the storage scope
      storageScope = `;storageScope=${scopePath.replace(/\//g, '%2F')}`;
    }

    const encodedText = encodeURIComponent(`${effectiveQueryText}`).replace(/[!'()*]/g, function (c) {
      if (c === '(' || c === ')') {
        return '%25' + c.charCodeAt(0).toString(16);
      }
      return '%' + c.charCodeAt(0).toString(16);
    });

    // Build query string parameters
    let queryParams = [`project=${query.projectId}`, `query=${encodedText}`];

    // Add storageScope without the semicolon prefix
    if (storageScope) {
      queryParams.push(storageScope.substring(1)); // Remove the leading semicolon
    }

    // Add time parameters
    if (range !== undefined) {
      queryParams.push(`startTime=${range?.from?.toISOString()}`);
      queryParams.push(`endTime=${range?.to?.toISOString()}`);
    }

    return `https://console.cloud.google.com/logs/query?${queryParams.join('&')}`;
  }, [query, range]);

  return (
    <>
      <InlineFieldRow>
        <InlineField label='Project ID'>
          <Select
            key={datasource.uid}
            width={30}
            allowCustomValue
            formatCreateLabel={(v) => `Use project: ${v}`}
            onChange={e => onChange({
              ...query,
              projectId: e.value!,
              bucketId: query.bucketId && query.bucketId.startsWith('$') ? query.bucketId : "",
              viewId: query.viewId && query.viewId.startsWith('$') ? query.viewId : "",
              _datasourceUid: datasource.uid,
            })}
            options={projects}
            isLoading={projectsLoading}
            onInputChange={onProjectSearchChange}
            filterOption={() => true}
            value={(() => {
              if (!query.projectId) { return undefined; }
              if (query.projectId.startsWith('$')) {
                return { label: query.projectId, value: query.projectId };
              }
              // Guard 1: _datasourceUid mismatch means stale carry-over
              if (!isProjectOwnedByDatasource) { return undefined; }
              // Guard 2: if projects loaded and this project isn't in the list,
              // it doesn't belong to this datasource (catches cases where
              // Grafana routes the query through the wrong DS instance)
              if (projects.length > 0 && !projects.some(p => p.value === query.projectId)) {
                return undefined;
              }
              return { label: query.projectId, value: query.projectId };
            })()}
            placeholder="Select Project"
            inputId={`${query.refId}-project`}
          />
        </InlineField>
        <InlineField label='Log Bucket'>
          <Select
            width={40}
            allowCustomValue
            formatCreateLabel={(v) => `Use bucket: ${v}`}
            onChange={e => onChange({
              ...query,
              bucketId: e.value!,
              viewId: query.viewId && query.viewId.startsWith('$') ? query.viewId : "",
            })}
            options={buckets}
            value={query.bucketId}
            placeholder="Select Log Bucket"
            inputId={`${query.refId}-bucket`}
          />
        </InlineField>
        <InlineField label='View'>
          <Select
            width={30}
            allowCustomValue
            formatCreateLabel={(v) => `Use view: ${v}`}
            onChange={e => onChange({
              ...query,
              viewId: e.value!,
            })}
            options={views}
            value={query.viewId}
            placeholder="Select View"
            inputId={`${query.refId}-view`}
          />
        </InlineField>
      </InlineFieldRow>
      {fetchError && (
        <Alert severity="error" title={fetchError} />
      )}
      <TextArea
        name="Query"
        className="slate-query-field"
        value={effectiveQueryText}
        rows={10}
        placeholder="Enter a Cloud Logging query (Run with Shift+Enter)"
        onBlur={onRunQuery}
        onChange={e => onChange({
          ...query,
          queryText: e.currentTarget.value,
        })}
        onKeyDown={onKeyDown}
        onPointerEnterCapture={undefined}
        onPointerLeaveCapture={undefined}
      />
      <Tooltip content='Click to view these results in the Google Cloud console'>
        <LinkButton
          href={gcpConsoleURI}
          disabled={!gcpConsoleURI}
          target='_blank'
          icon='external-link-alt'
          variant='secondary'
        >
          View in Cloud Logging
        </LinkButton>
      </Tooltip>
    </>
  );
};
