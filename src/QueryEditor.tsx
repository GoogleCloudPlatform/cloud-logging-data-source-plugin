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
import { Alert, InlineField, InlineFieldRow, AsyncSelect, LinkButton, Select, TextArea, Tooltip } from '@grafana/ui';
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

  // Initialization effect: runs on mount and whenever the datasource instance changes.
  // On datasource switch (UID changed): always reset to the new datasource's default project,
  // since the carried-over projectId belongs to the old datasource.
  // On initial mount: validate existing project/bucket against filters and resolve defaults.
  useEffect(() => {
    let cancelled = false;

    // Helper: compute queryText normalization against a given query state.
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

    // Always resolve the default project for this datasource on mount.
    // This handles both initial mount and datasource switches (Grafana
    // unmounts/remounts the QueryEditor on switch, so refs don't survive).
    datasource.getDefaultProject().then(async defaultProject => {
      if (cancelled) {
        return;
      }
      const latestQuery = queryRef.current;
      const textUpdates = computeTextUpdates(latestQuery);
      const currentProjectId = latestQuery.projectId;

      // If the current project is a template variable, leave it alone
      if (currentProjectId && currentProjectId.startsWith('$')) {
        if (Object.keys(textUpdates).length > 0) {
          onChange({ ...latestQuery, ...textUpdates });
        }
        return;
      }

      // If no project is set, or the current project is not valid for this
      // datasource (e.g., carried over from a different datasource),
      // reset to the best available project and clear bucket/view.
      const isCurrentProjectValid = currentProjectId &&
        datasource.filterProjects([currentProjectId]).length > 0;

      if (!isCurrentProjectValid) {
        // Try the default project first; if it doesn't pass the filter,
        // fetch the full filtered project list and pick the first one.
        let newProjectId = '';
        if (defaultProject && datasource.filterProjects([defaultProject]).length > 0) {
          newProjectId = defaultProject;
        } else {
          // Default project doesn't pass the filter — fall back to
          // the first project that does.
          try {
            const filteredProjects = await datasource.getFilteredProjects();
            if (!cancelled && filteredProjects.length > 0) {
              newProjectId = filteredProjects[0];
            }
          } catch {
            // If we can't fetch projects, leave it empty
          }
        }
        if (cancelled) {
          return;
        }
        if (newProjectId !== currentProjectId) {
          onChange({ ...latestQuery, ...textUpdates, projectId: newProjectId, bucketId: '', viewId: '' });
          if (newProjectId) {
            onRunQuery();
          }
        } else if (Object.keys(textUpdates).length > 0) {
          onChange({ ...latestQuery, ...textUpdates });
        }
        return;
      }

      // Project matches default — just apply text normalizations and filter checks
      const updates: Partial<Query> = { ...textUpdates };
      if (latestQuery.bucketId && !latestQuery.bucketId.startsWith('$') &&
        datasource.filterBuckets([latestQuery.bucketId]).length === 0) {
        updates.bucketId = '';
      }
      if (Object.keys(updates).length > 0) {
        onChange({ ...latestQuery, ...updates });
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

  const loadProjects = useCallback((inputValue: string): Promise<Array<SelectableValue<string>>> => {
    return datasource.getFilteredProjects(inputValue || undefined).then(res => {
      setFetchError(undefined);
      return res.map(project => ({
        label: project,
        value: project,
      }));
    }).catch(err => {
      setFetchError(sanitizeFetchError(err));
      return [];
    });
  }, [datasource]);

  const [buckets, setBuckets] = useState<Array<SelectableValue<string>>>();
  useEffect(() => {
    if (query.projectId && !query.projectId.startsWith('$')) {
      datasource.getFilteredBuckets(query.projectId).then(res => {
        setBuckets(res.map(bucket => ({
          label: bucket,
          value: bucket,
        })));
        setFetchError(undefined);
      }).catch(err => setFetchError(sanitizeFetchError(err)));
    }
  }, [datasource, query.projectId]);

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
          <AsyncSelect
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
            loadOptions={loadProjects}
            defaultOptions
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
