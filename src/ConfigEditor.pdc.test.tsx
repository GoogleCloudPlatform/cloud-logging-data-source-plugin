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

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DataSourceSettings } from '@grafana/data';
import { GoogleAuthType } from '@grafana/google-sdk';
import { config } from '@grafana/runtime';
import { ConfigEditor } from './ConfigEditor';
import { CloudLoggingOptions, DataSourceSecureJsonData } from './types';

jest.mock('@grafana/runtime', () => ({
    ...jest.requireActual('@grafana/runtime'),
    config: {
        secureSocksDSProxyEnabled: false,
        featureToggles: {} as Record<string, boolean>,
    },
    DataSourcePicker: () => <div data-testid="mock-ds-picker" />,
}));

const makeOptions = (
    jsonData: Partial<CloudLoggingOptions> = {}
): DataSourceSettings<CloudLoggingOptions, DataSourceSecureJsonData> => ({
    id: 1,
    uid: 'test-uid',
    orgId: 1,
    name: 'Cloud Logging',
    type: 'googlecloud-logging-datasource',
    typeName: 'Google Cloud Logging',
    typeLogoUrl: '',
    access: 'proxy',
    url: '',
    user: '',
    database: '',
    basicAuth: false,
    basicAuthUser: '',
    isDefault: false,
    readOnly: false,
    withCredentials: false,
    jsonData: {
        authenticationType: GoogleAuthType.JWT,
        ...jsonData,
    } as CloudLoggingOptions,
    secureJsonData: {},
    secureJsonFields: {},
});

describe('ConfigEditor PDC / Secure SOCKS Proxy settings', () => {
    const bootConfig = config as unknown as {
        secureSocksDSProxyEnabled?: boolean;
        featureToggles: Record<string, boolean>;
    };

    afterEach(() => {
        bootConfig.secureSocksDSProxyEnabled = false;
        delete bootConfig.featureToggles.secureSocksDSProxyEnabled;
    });

    it('hides Secure Socks Proxy settings when top-level config.secureSocksDSProxyEnabled is false', () => {
        bootConfig.secureSocksDSProxyEnabled = false;
        // Ensure legacy featureToggles alone does not trigger rendering.
        bootConfig.featureToggles.secureSocksDSProxyEnabled = true;
        render(<ConfigEditor options={makeOptions()} onOptionsChange={jest.fn()} />);
        expect(screen.queryByTestId('secure-socks-proxy-settings')).toBeNull();
    });

    it('shows Secure Socks Proxy settings and updates enableSecureSocksProxy when enabled', () => {
        bootConfig.secureSocksDSProxyEnabled = true;
        const onOptionsChange = jest.fn();
        render(
            <ConfigEditor
                options={makeOptions({ enableSecureSocksProxy: false })}
                onOptionsChange={onOptionsChange}
            />
        );

        const pdcSection = screen.getByTestId('secure-socks-proxy-settings');
        expect(within(pdcSection).getByText('Secure Socks Proxy')).toBeInTheDocument();
        const toggle = within(pdcSection).getByLabelText('Toggle switch');
        fireEvent.click(toggle);

        expect(onOptionsChange).toHaveBeenCalledWith(
            expect.objectContaining({
                jsonData: expect.objectContaining({
                    enableSecureSocksProxy: true,
                }),
            })
        );
    });
});
