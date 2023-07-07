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

import { DataSourcePluginMeta } from '@grafana/data';
import { GoogleAuthType } from '@grafana/google-sdk';
import { random } from 'lodash';
import { DataSource } from './datasource';


describe('Google Cloud Logging Data Source', () => {
    describe('getDefaultProject', () => {
        it('returns empty string if not set', () => {
            const ds = makeDataSource();
            ds.getDefaultProject().then(r => expect(r).toBe(''));
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
                readOnly: true,
            });
            ds.getDefaultProject().then(r => expect(r).toBe(projectId));
        });
    });

    describe('filterQuery', () => {
        it('returns true if hide is not set', () => {
            const ds = makeDataSource();
            const query = {
                refId: '1',
                projectId: '1',
            };
            expect(ds.filterQuery(query)).toBe(true);
        });
        it('returns true if hide is set to false', () => {
            const ds = makeDataSource();
            const query = {
                refId: '1',
                projectId: '1',
                hide: false
            };
            expect(ds.filterQuery(query)).toBe(true);
        });
        it('returns false if hide is set to true', () => {
            const ds = makeDataSource();
            const query = {
                refId: '1',
                projectId: '1',
                hide: true
            };
            expect(ds.filterQuery(query)).toBe(false);
        });
    });

    describe('modifyQuery', () => {
        it('removes [x] from QueryFixAction ADD_FILTER key', () => {
            const ds = makeDataSource();
            const query = {
                refId: '1',
                projectId: '1',
                queryText: `key1="value1"`
            };
            const action = {
                type: "ADD_FILTER",
                options: {key: "key2.key3[2].key4", value: "value4"},
                query: `key1="value1"`
            }
            expect(ds.modifyQuery(query, action).queryText).toEqual(`key1="value1"
key2.key3.key4="value4"`);
        });
    });

    describe('modifyQuery', () => {
        it('removes [x] from QueryFixAction ADD_FILTER_OUT key', () => {
            const ds = makeDataSource();
            const query = {
                refId: '1',
                projectId: '1',
                queryText: `key1="value1"`
            };
            const action = {
                type: "ADD_FILTER_OUT",
                options: {key: "key2.key3[2].key4", value: "value4"},
                query: `key1="value1"`
            }
            expect(ds.modifyQuery(query, action).queryText).toEqual(`key1="value1"
key2.key3.key4!="value4"`);
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
        readOnly: true,
    });
}
