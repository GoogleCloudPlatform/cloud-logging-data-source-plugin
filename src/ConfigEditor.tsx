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
import { DataSourceSecureJsonData, ConnectionConfig } from '@grafana/google-sdk';
import { Label } from '@grafana/ui';
import { CloudLoggingOptions } from 'types';

export type Props = DataSourcePluginOptionsEditorProps<CloudLoggingOptions, DataSourceSecureJsonData>;

export class ConfigEditor extends PureComponent<Props> {
    state = {
        isChecked: this.props.options.jsonData.usingImpersonation || false,
    };
    handleClick = () => {
        this.props.options.jsonData.usingImpersonation = !this.state.isChecked;
        this.setState({
            isChecked: !this.state.isChecked,
        });
    }
    render() {
        return (
            <>
                <ConnectionConfig {...this.props}></ConnectionConfig>
                <div>
                    <input type="checkbox" onChange={this.handleClick} checked={this.state.isChecked} /> To impersonate an existing Google Cloud service account.
                    <div hidden={!this.state.isChecked}>
                        <Label>Service Account:</Label>
                        <input
                            size={60}
                            id="serviceAccount"
                            value={this.props.options.jsonData.serviceAccountToImpersonate}
                            onChange={(e) => {
                                this.props.options.jsonData.serviceAccountToImpersonate = e.target.value
                            }}
                        />
                    </div>
                </div>
            </>
        );
    }
}
