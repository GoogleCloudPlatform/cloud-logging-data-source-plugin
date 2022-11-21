import { DataSourceInstanceSettings } from '@grafana/data';
import { BackendSrv, DataSourceWithBackend, getBackendSrv } from '@grafana/runtime';
import { CloudLoggingOptions, Query } from './types';

export class DataSource extends DataSourceWithBackend<Query, CloudLoggingOptions> {
  constructor(private instanceSettings: DataSourceInstanceSettings<CloudLoggingOptions>) {
    super(instanceSettings);
  }
  /**
   * Get the Project ID we parsed from the data source's JWT token
   *
   * @returns Project ID from the provided JWT token
   */
  getDefaultProject(): string {
    return this.instanceSettings.jsonData.defaultProject ?? '';
  }
  /**
   * Have the backend call `resourcemanager.projects.list` with our credentials,
   * and return the IDs of all projects found
   *
   * @param backendSrv  {@link BackendSrv} to make the request, only exposed for tests
   * @returns List of discovered project IDs
   */
  async getProjects(backendSrv: BackendSrv = getBackendSrv()): Promise<string[]> {
    try {
      const res = await backendSrv.get(`/api/datasources/${this.id}/resources/projects`);
      return res.projects;
    } catch (ex: unknown) {
      return [];
    }
  }
}
