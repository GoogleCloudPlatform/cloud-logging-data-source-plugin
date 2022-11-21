import { DataSourcePluginMeta } from '@grafana/data';
import { GoogleAuthType } from '@grafana/google-sdk';
import { BackendSrv } from '@grafana/runtime';
import { random, times } from 'lodash';
import { DataSource } from './datasource';


describe('Google Cloud Logging Data Source', () => {
    describe('getDefaultProject', () => {
        it('returns empty string if not set', () => {
            const ds = makeDataSource();
            expect(ds.getDefaultProject()).toBe('');
        });
        it('returns defaultProject from jsonData', () => {
            const projectId = `my-gcp-project-${random(100)}`;
            const ds = new DataSource({
                id: random(100),
                type: 'googlecloud-logging-datasource',
                access: 'direct',
                meta: {} as DataSourcePluginMeta,
                uid: `${random(100)}`,
                jsonData: {
                    authenticationType: GoogleAuthType.JWT,
                    defaultProject: projectId,
                },
                name: 'something',
            });
            expect(ds.getDefaultProject()).toBe(projectId);
        });
    });

    describe('getProjects', () => {
        it('returns an empty list when an error occurs', async () => {
            let backend: BackendSrv = {} as unknown as BackendSrv;
            backend.get = jest.fn().mockRejectedValue(new Error('Some network exception'));

            const ds = makeDataSource();
            const projects = await ds.getProjects(backend);
            expect(projects).toHaveLength(0);
            expect(backend.get).toHaveBeenCalledWith(`/api/datasources/${ds.id}/resources/projects`);
        });

        it('returns projects from the backend response', async () => {
            const projectIds = times(5).map(n => `gcp-project-${n}`);

            let backend: BackendSrv = {} as unknown as BackendSrv;
            backend.get = jest.fn().mockReturnValue({ projects: projectIds });

            const ds = makeDataSource();
            const projects = await ds.getProjects(backend);
            expect(projects).toStrictEqual(projectIds);
            expect(backend.get).toHaveBeenCalledWith(`/api/datasources/${ds.id}/resources/projects`);
        });
    });
});

const makeDataSource = () => {
    return new DataSource({
        id: random(100),
        type: 'googlecloud-logging-datasource',
        access: 'direct',
        meta: {} as DataSourcePluginMeta,
        uid: `${random(100)}`,
        jsonData: {
            authenticationType: GoogleAuthType.JWT,
        },
        name: 'something',
    });
}
