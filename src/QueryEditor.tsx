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

  // Compute normalized queryText as a derived value (never mutate the prop directly)
  const effectiveQueryText = query.query ?? query.queryText ?? defaultQuery.queryText;

  // Initialization effect: validates the carried-over project against the
  // datasource's actual filtered project list. The list is the source of truth;
  // the regex filter alone is insufficient because "no filter" passes everything,
  // so a stale projectId from a different datasource would slip through.
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

    (async () => {
      const latestQuery = queryRef.current;
      const textUpdates = computeTextUpdates(latestQuery);
      const currentProjectId = latestQuery.projectId;

      if (currentProjectId && currentProjectId.startsWith('$')) {
        if (!cancelled && Object.keys(textUpdates).length > 0) {
          onChange({ ...latestQuery, ...textUpdates });
        }
        return;
      }

      const defaultProject = await datasource.getDefaultProject();
      if (cancelled) { return; }

      let cachedList: string[] | null = null;
      let isValid = false;

      if (!currentProjectId) {
        isValid = false;
      } else if (datasource.filterProjects([currentProjectId]).length === 0) {
        isValid = false;
      } else {
        try {
          cachedList = await datasource.getFilteredProjects();
          if (cancelled) { return; }
          isValid = cachedList.includes(currentProjectId);
        } catch {
          // Transient API error — assume valid so we don't reset a saved
          // project on a flaky network. The eventual query will surface
          // any real access error.
          isValid = true;
        }
      }

      if (isValid) {
        const updates: Partial<Query> = { ...textUpdates };
        if (latestQuery.bucketId && !latestQuery.bucketId.startsWith('$') &&
          datasource.filterBuckets([latestQuery.bucketId]).length === 0) {
          updates.bucketId = '';
        }
        if (Object.keys(updates).length > 0) {
          onChange({ ...latestQuery, ...updates });
        }
        return;
      }

      // Pick a replacement project.
      let newProjectId = '';
      if (defaultProject && datasource.filterProjects([defaultProject]).length > 0) {
        newProjectId = defaultProject;
      } else {
        let list = cachedList;
        if (list === null) {
          try {
            list = await datasource.getFilteredProjects();
            if (cancelled) { return; }
          } catch {
            list = null;
          }
        }
        if (list && list.length > 0) {
          newProjectId = list[0];
        }
      }

      if (cancelled) { return; }
      onChange({ ...latestQuery, ...textUpdates, projectId: newProjectId, bucketId: '', viewId: '' });
      if (newProjectId) {
        onRunQuery();
      }
    })();

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

  // Project list state, tagged with the DS uid it was loaded for. The uid tag
  // lets the picker's `options` derivation (`projectsForCurrentDs` below)
  // return [] whenever the loaded data doesn't belong to the current DS —
  // preventing react-select from auto-selecting/displaying a stale option
  // (e.g. the only entry in test1's list when we've switched to test2 but
  // test2's load hasn't resolved yet).
  const [projectsState, setProjectsState] = useState<{
    uid: string | null;
    list: Array<SelectableValue<string>>;
  }>({ uid: null, list: [] });
  const [projectsLoading, setProjectsLoading] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();
  const projectsForCurrentDs = projectsState.uid === datasource.uid
    ? projectsState.list
    : [];

  useEffect(() => {
    let cancelled = false;
    const loadingForUid = datasource.uid;
    setProjectsLoading(true);
    datasource.getFilteredProjects()
      .then(res => {
        if (cancelled) { return; }
        setProjectsState({
          uid: loadingForUid,
          list: res.map(project => ({ label: project, value: project })),
        });
        setFetchError(undefined);
      })
      .catch(err => {
        if (cancelled) { return; }
        setProjectsState({ uid: loadingForUid, list: [] });
        setFetchError(sanitizeFetchError(err));
      })
      .finally(() => {
        if (!cancelled) { setProjectsLoading(false); }
      });
    return () => {
      cancelled = true;
      if (searchTimer.current) { clearTimeout(searchTimer.current); }
    };
  }, [datasource]);

  const onProjectSearchChange = useCallback((value: string) => {
    if (searchTimer.current) { clearTimeout(searchTimer.current); }
    const searchDsUid = datasource.uid;
    setProjectsLoading(true);
    searchTimer.current = setTimeout(() => {
      datasource.getFilteredProjects(value || undefined)
        .then(res => {
          // Discard the response if the datasource changed during the debounce
          // or in-flight fetch. Without this, a late search response from the
          // OLD datasource could clobber a freshly-loaded list from the new one.
          if (searchDsUid !== datasource.uid) { return; }
          setProjectsState({
            uid: searchDsUid,
            list: res.map(project => ({ label: project, value: project })),
          });
          setFetchError(undefined);
        })
        .catch(err => {
          if (searchDsUid !== datasource.uid) { return; }
          setFetchError(sanitizeFetchError(err));
        })
        .finally(() => {
          if (searchDsUid === datasource.uid) { setProjectsLoading(false); }
        });
    }, 300);
  }, [datasource]);

  const [buckets, setBuckets] = useState<Array<SelectableValue<string>>>();
  useEffect(() => {
    if (!query.projectId || query.projectId.startsWith('$')) { return; }
    if (projectsLoading) { return; }
    if (projectsForCurrentDs.length > 0 && !projectsForCurrentDs.some(p => p.value === query.projectId)) { return; }
    datasource.getFilteredBuckets(query.projectId).then(res => {
      setBuckets(res.map(bucket => ({
        label: bucket,
        value: bucket,
      })));
      setFetchError(undefined);
    }).catch(err => setFetchError(sanitizeFetchError(err)));
  }, [datasource, query.projectId, projectsLoading, projectsForCurrentDs]);

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
            })}
            options={projectsForCurrentDs}
            isLoading={projectsLoading}
            onInputChange={onProjectSearchChange}
            filterOption={() => true}
            // Pass value as a self-contained literal — do NOT derive it by
            // looking up query.projectId in the options list. react-select's
            // internal `cleanValue(value, options)` reconciliation lags under
            // React 18 concurrent rendering, which would make the picker
            // visually stuck on stale data on DS switch (only "fixed" by
            // opening DevTools, which forces a paint flush).
            // The init effect keeps query.projectId valid; the picker just
            // displays whatever it says. See react-select#4936.
            value={query.projectId ? { label: query.projectId, value: query.projectId } : undefined}
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
