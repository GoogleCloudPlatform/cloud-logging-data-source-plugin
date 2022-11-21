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
