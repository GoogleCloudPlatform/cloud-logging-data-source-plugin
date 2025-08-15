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

import React, { KeyboardEvent, useEffect, useMemo, useState } from 'react';
import { QueryEditorProps, SelectableValue } from '@grafana/data';
import { InlineField, InlineFieldRow, LinkButton, Select, TextArea, Tooltip } from '@grafana/ui';
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

  // Apply defaults if needed
  if (!query.projectId) {
    datasource.getDefaultProject().then(r => query.projectId = r);
  }

  // Check query field from query params to support default way of propagating query from other parts of grafana.
  if (query.query) {
    query.queryText = query.query;
    query.query = undefined;
  }

  if (query.queryText == null) {
    query.queryText = defaultQuery.queryText;
  }


  const [projects, setProjects] = useState<Array<SelectableValue<string>>>();
  useEffect(() => {
    datasource.getProjects().then(res => {
      setProjects(res.map(project => ({
        label: project,
        value: project,
      })));
    });
  }, [datasource]);

  const [buckets, setBuckets] = useState<Array<SelectableValue<string>>>();
  useEffect(() => {
    if (!query.projectId) {
      datasource.getDefaultProject().then(r => {
        query.projectId = r;
        datasource.getLogBuckets(query.projectId).then(res => {
          setBuckets(res.map(bucket => ({
            label: bucket,
            value: bucket,
          })));
        });
      });
    } else if (!query.projectId.startsWith('$')) {
      datasource.getLogBuckets(query.projectId).then(res => {
        setBuckets(res.map(bucket => ({
          label: bucket,
          value: bucket,
        })));
      });
    }
  }, [datasource, query]);

  const [views, setViews] = useState<Array<SelectableValue<string>>>();
  useEffect(() => {
    const bid = query.bucketId ? query.bucketId : "global/buckets/_Default";
    if (!bid.startsWith('$')) {
        datasource.getLogBucketViews(query.projectId, `${bid}`).then(res => {
            setViews(res.map(view => ({
              label: view,
              value: view,
            })));
        });
    }
  }, [datasource, query]);

  /**
   * Keep an up-to-date URI that links to the equivalent query in the GCP console
   */
    const gcpConsoleURI = useMemo<string | undefined>(() => {
    if (!query.queryText) {
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

    const encodedText = encodeURIComponent(`${query.queryText}`).replace(/[!'()*]/g, function(c) {
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
            width={30}
            allowCustomValue
            formatCreateLabel={(v) => `Use project: ${v}`}
            onChange={e => onChange({
              ...query,
              projectId: e.value!,
              bucketId: query.bucketId && query.bucketId.startsWith('$') ? query.bucketId : "",
              viewId: query.viewId && query.viewId.startsWith('$') ? query.viewId : "",
            })}
            options={projects}
            value={query.projectId}
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
      <TextArea
        name="Query"
        className="slate-query-field"
        value={query.queryText}
        rows={10}
        placeholder="Enter a Cloud Logging query (Run with Shift+Enter)"
        onBlur={onRunQuery}
        onChange={e => onChange({
          ...query,
          queryText: e.currentTarget.value,
        })}
        onKeyDown={onKeyDown}
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
