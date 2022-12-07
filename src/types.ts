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

import { DataQuery } from '@grafana/data';
import { DataSourceOptions } from '@grafana/google-sdk';

/**
 * Query from Grafana
 */
export interface Query extends DataQuery {
  queryText?: string;
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
export type CloudLoggingOptions = DataSourceOptions;
