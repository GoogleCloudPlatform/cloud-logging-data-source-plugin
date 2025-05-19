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

import React, { PureComponent } from 'react';
import { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { ConnectionConfig } from '@grafana/google-sdk';
import { Label, SecretInput } from '@grafana/ui';
import { CloudLoggingOptions, DataSourceSecureJsonData } from './types';

export type Props = DataSourcePluginOptionsEditorProps<CloudLoggingOptions, DataSourceSecureJsonData>;

export class ConfigEditor extends PureComponent<Props> {
  state = {
    isChecked: this.props.options.jsonData.usingImpersonation || false,
    sa: this.props.options.jsonData.serviceAccountToImpersonate || '',
  };

  handleClick = () => {
    this.props.options.jsonData.usingImpersonation = !this.state.isChecked;
    this.setState({
      isChecked: !this.state.isChecked,
    });
  };
  render() {
    const { options, onOptionsChange } = this.props;
    const secureJsonData = options.secureJsonData || {};

    return (
      <>
        <ConnectionConfig {...this.props}></ConnectionConfig>
        <div>
          <input type="checkbox" onChange={this.handleClick} checked={this.state.isChecked} /> To impersonate an
          existing Google Cloud service account.
          <div hidden={!this.state.isChecked}>
            <Label>Service Account:</Label>
            <input
              size={60}
              id="serviceAccount"
              value={this.state.sa}
              onChange={(e) => {
                this.setState({ sa: e.target.value }, () => {
                  this.props.options.jsonData.serviceAccountToImpersonate = this.state.sa;
                });
              }}
            />
          </div>
          <div style={{ marginTop: '10px' }}>
            <div className="gf-form-label__desc">
              Alternatively, configure a temporary access token and a project ID. This will override other
              authentication methods.
            </div>
            <div style={{ marginTop: '10px' }}>
              <Label>Access Token</Label>
              <SecretInput
                value={secureJsonData.accessToken || ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  onOptionsChange({
                    ...options,
                    secureJsonData: {
                      ...secureJsonData,
                      accessToken: e.target.value,
                    },
                  });
                }}
                isConfigured={!!options.secureJsonFields?.accessToken}
                onReset={() => {
                  onOptionsChange({
                    ...options,
                    secureJsonData: {
                      ...secureJsonData,
                      accessToken: '',
                    },
                    secureJsonFields: {
                      ...options.secureJsonFields,
                      accessToken: false,
                    },
                  });
                }}
              />
            </div>
            <div style={{ marginTop: '10px' }}>
              <Label>Project ID</Label>
              <input
                value={options.jsonData.defaultProject || ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  onOptionsChange({
                    ...options,
                    jsonData: {
                      ...options.jsonData,
                      defaultProject: e.target.value,
                    },
                  });
                }}
              />
            </div>
          </div>
        </div>
      </>
    );
  }
}
