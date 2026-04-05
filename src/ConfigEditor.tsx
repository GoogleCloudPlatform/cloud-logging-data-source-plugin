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

import { DataSourcePluginOptionsEditorProps, SelectableValue } from '@grafana/data';
import { ConnectionConfig, GoogleAuthType } from '@grafana/google-sdk';
import { Checkbox, Field, Input, SecretInput, Select, TextArea } from '@grafana/ui';
import React, { PureComponent } from 'react';
import { authTypes, CloudLoggingOptions, DataSourceSecureJsonData } from './types';

export type Props = DataSourcePluginOptionsEditorProps<CloudLoggingOptions, DataSourceSecureJsonData>;

export class ConfigEditor extends PureComponent<Props> {
  state = {
    isChecked: this.props.options.jsonData.usingImpersonation || false,
    sa: this.props.options.jsonData.serviceAccountToImpersonate || '',
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
          secureJsonData: {
            ...options.secureJsonData,
            accessToken: '',
          },
          secureJsonFields: {
            ...options.secureJsonFields,
            accessToken: false,
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
            <Checkbox
              label="To impersonate an existing Google Cloud service account."
              value={this.state.isChecked}
              onChange={() => handleClick()}
              onPointerEnterCapture={undefined}
              onPointerLeaveCapture={undefined}
            />
            {this.state.isChecked && (
              <Field label="Service Account">
                <Input
                  id="serviceAccount"
                  width={60}
                  value={this.state.sa}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    this.setState({ sa: e.target.value }, () => {
                      this.props.options.jsonData.serviceAccountToImpersonate = this.state.sa;
                    });
                  }}
                  onPointerEnterCapture={undefined}
                  onPointerLeaveCapture={undefined}
                />
              </Field>
            )}
          </div>
        ) : null}
        {options.jsonData.authenticationType === ('accessToken' as GoogleAuthType) ? (
          <>
            <p>
              Alternatively, configure a temporary access token and a project ID. This will override other
              authentication methods.
            </p>
            <Field label="Access Token">
              <SecretInput
                autoComplete="new-password"
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
                onPointerEnterCapture={undefined}
                onPointerLeaveCapture={undefined}
              />
            </Field>
          </>
        ) : null}
        {defaultProject(this.props)}
      </>
    );
  }
}

const defaultProject = (props: Props) => {
  const { options, onOptionsChange } = props;
  return (
    <>
      <Field label="Default Project ID" description="Required for OAuth passthrough">
        <Input
          autoComplete="off"
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
          onPointerEnterCapture={undefined}
          onPointerLeaveCapture={undefined}
        />
      </Field>
      <Field label="Universe Domain" description="Optional">
        <Input
          autoComplete="off"
          placeholder="googleapis.com (default)"
          value={options.jsonData.universeDomain || ''}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            onOptionsChange({
              ...options,
              jsonData: {
                ...options.jsonData,
                universeDomain: e.target.value,
              },
            });
          }}
          onPointerEnterCapture={undefined}
          onPointerLeaveCapture={undefined}
        />
      </Field>
      <Field
        label="Project List Filter"
        description="Enter project IDs or regex patterns, one per line. Only matching projects will appear in the project dropdown. Leave empty to show all projects."
      >
        <TextArea
          value={options.jsonData.projectListFilter || ''}
          placeholder={'my-project-id\nteam-.*\nprod-.*-logging'}
          rows={4}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
            onOptionsChange({
              ...options,
              jsonData: {
                ...options.jsonData,
                projectListFilter: e.target.value,
              },
            });
          }}
          onPointerEnterCapture={undefined}
          onPointerLeaveCapture={undefined}
        />
      </Field>
    </>
  );
};
