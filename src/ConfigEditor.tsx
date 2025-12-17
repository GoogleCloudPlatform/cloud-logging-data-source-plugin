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
import { DataSourcePluginOptionsEditorProps, SelectableValue } from '@grafana/data';
import { ConnectionConfig, GoogleAuthType } from '@grafana/google-sdk';
import { Field, Label, SecretInput, Select } from '@grafana/ui';
import { authTypes, CloudLoggingOptions, DataSourceSecureJsonData } from './types';

export type Props = DataSourcePluginOptionsEditorProps<CloudLoggingOptions, DataSourceSecureJsonData>;

export class ConfigEditor extends PureComponent<Props> {
  state = {
    isChecked: this.props.options.jsonData.usingImpersonation || false,
    sa: this.props.options.jsonData.serviceAccountToImpersonate || '',
    authenticationMethod: this.props.options.jsonData.authenticationType || GoogleAuthType.JWT,
  };

  render() {
    const { options, onOptionsChange } = this.props;
    const secureJsonData = options.secureJsonData || {};

    const handleClick = () => {
      const newImpersonationState = !this.state.isChecked;
      onOptionsChange({
        ...options,
        jsonData: {
          ...options.jsonData,
          usingImpersonation: newImpersonationState,
        },
      });
      this.setState({
        isChecked: newImpersonationState,
      });
    };

    const handleAuthTypeChange = (e: SelectableValue<string>) => {
      if (e.value === 'oauthPassthrough') {
        onOptionsChange({
          ...options,
          jsonData: {
            ...options.jsonData,
            authenticationType: 'oauthPassthrough' as GoogleAuthType,
            oauthPassThru: true,
          },
        });
      } else {
        onOptionsChange({
          ...options,
          jsonData: {
            ...options.jsonData,
            authenticationType: (e.value as GoogleAuthType) || GoogleAuthType.JWT,
            oauthPassThru: false,
          },
        });
      }
    };

    return (
      <>
        <Field
          label={'Authentication'}
          description={'Choose the type of authentication for Google Cloud Logging services'}
          htmlFor="authentication-type"
        >
          <Select
            width={30}
            value={authTypes.find((opt) => opt.value === options.jsonData.authenticationType)}
            options={authTypes}
            onChange={handleAuthTypeChange}
            disabled={false}
          />
        </Field>
        {options.jsonData.authenticationType === GoogleAuthType.JWT ||
        options.jsonData.authenticationType === GoogleAuthType.GCE ? (
          <ConnectionConfig {...this.props}></ConnectionConfig>
        ) : null}
        {!options.jsonData.oauthPassThru ? (
          <div>
            <input type="checkbox" onChange={() => handleClick()} checked={this.state.isChecked} /> To impersonate an
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
          </div>
        ) : null}
        {options.jsonData.authenticationType === ('accessToken' as GoogleAuthType) ? (
          <div>
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
            </div>
          </div>
        ) : null}
        {defaultProject(this.props)}
      </>
    );
  }
}

const defaultProject = (props: Props) => {
  const { options, onOptionsChange } = props;
  return (
    <div style={{ marginTop: '10px' }}>
      <Label>Default Project ID (required for OAuth passthrough)</Label>
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
  );
};
