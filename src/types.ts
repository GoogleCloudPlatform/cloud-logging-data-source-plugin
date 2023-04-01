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

import { DataQuery, SelectableValue } from '@grafana/data';
import { DataSourceOptions, GoogleAuthType } from '@grafana/google-sdk';

export const authTypes: Array<SelectableValue<string>> = [
  { label: 'Google JWT File', value: GoogleAuthType.JWT },
  { label: 'GCE Default Service Account', value: GoogleAuthType.GCE },
];

/**
 * DataSourceOptionsExt adds default GCE project to DataSourceOptions
 */
export interface DataSourceOptionsExt extends DataSourceOptions {
  gceDefaultProject?: string;
}

/**
 * Query from Grafana
 */
export interface Query extends DataQuery {
  queryText?: string;
  query?: string;
  projectId: string;
}

/**
 * Query that basically gets all logs
 */
export const defaultQuery: Partial<Query> = {
  queryText: `severity >= DEFAULT`,
};

/**
 * These are options configured for each DataSource instance.
 */
export type CloudLoggingOptions = DataSourceOptionsExt;
