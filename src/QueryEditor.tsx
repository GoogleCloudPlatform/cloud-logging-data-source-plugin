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

  const [projects, setProjects] = useState<Array<SelectableValue<string>>>();
  useEffect(() => {
    datasource.getProjects().then(res => {
      setProjects(res.map(project => ({
        label: project,
        value: project,
      })));
    });
  }, [datasource]);


  // Apply defaults if needed
  if (query.projectId == null) {
    query.projectId = datasource.getDefaultProject();
  }
  if (query.queryText == null) {
    query.queryText = defaultQuery.queryText;
  }

  /**
   * Keep an up-to-date URI that links to the equivalent query in the GCP console
   */
  const gcpConsoleURI = useMemo<string | undefined>(() => {
    if (!query.queryText) {
      return undefined;
    }

    const queryText = `query=${encodeURIComponent(query.queryText)}`;
    // If range is somehow undefined, don't add timeRange to the URI
    const timeRange = range !== undefined ?
      `timeRange=${range?.from?.toISOString()}%2F${range?.to?.toISOString()}`
      : '';

    return `https://console.cloud.google.com/logs/query;` +
      queryText +
      `;${timeRange}` +
      `?project=${query.projectId}`;
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
              queryText: query.queryText,
              projectId: e.value!,
              refId: query.refId,
            })}
            options={projects}
            value={query.projectId}
            placeholder="Select Project"
            inputId={`${query.refId}-project`}
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
          queryText: e.currentTarget.value,
          projectId: query.projectId,
          refId: query.refId,
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
