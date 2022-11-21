import { DataSourcePlugin } from '@grafana/data';
import { DataSource } from './datasource';
import { ConfigEditor } from './ConfigEditor';
import { LoggingQueryEditor } from './QueryEditor';
import { CloudLoggingOptions, Query } from './types';

export const plugin = new DataSourcePlugin<DataSource, Query, CloudLoggingOptions>(DataSource)
  .setConfigEditor(ConfigEditor)
  .setQueryEditor(LoggingQueryEditor);
