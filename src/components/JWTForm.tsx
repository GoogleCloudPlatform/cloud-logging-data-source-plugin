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

/**
 * Copied from @grafana/google-sdk with minimal change
 * https://github.com/grafana/grafana-google-sdk-react/blob/8b6502c912c32300b86b92502abdbe64ca5a9571/src/components/JWTForm.tsx
 */
import React from 'react';
import { Button, Field, Input, Tooltip } from '@grafana/ui';
import { CloudLoggingOptions } from '../types';

/**
 * Map of `data-testid` attributes for different fields
 */
export const TEST_IDS = {
  dropZone: 'Configuration drop zone',
  pasteArea: 'Configuration text area',
  pasteJwtButton: 'Paste JWT button',
  resetJwtButton: 'Reset JWT button',
  jwtForm: 'JWT form',
};

/**
 * Props for the JWT Form
 */
interface JWTFormProps {
  options: CloudLoggingOptions;
  /**
   * Clear JWT fields
   */
  onReset: (a?: Partial<CloudLoggingOptions>) => void;
  /**
   * Update values of a single JWT field
   */
  onChange: (key: keyof CloudLoggingOptions) => (e: React.SyntheticEvent<HTMLInputElement | HTMLSelectElement>) => void;
}

export const JWTForm: React.FC<JWTFormProps> = ({ options, onReset, onChange }: JWTFormProps) => {
  const onResetPress = () => onReset(undefined);
  return (
    <div data-testid={TEST_IDS.jwtForm}>
      <Field label="Project ID">
        {/* @ts-ignore */}
        <Input
          id="defaultProject"
          width={60}
          value={options.defaultProject || ''}
          onChange={onChange('defaultProject')}
        />
      </Field>

      <Field label="Client email">
        {/* @ts-ignore */}
        <Input width={60} id="clientEmail" value={options.clientEmail || ''} onChange={onChange('clientEmail')} />
      </Field>

      <Field label="Token URI">
        {/* @ts-ignore */}
        <Input width={60} id="tokenUri" value={options.tokenUri || ''} onChange={onChange('tokenUri')} />
      </Field>

      <Field label="Private key" disabled>
        {/* @ts-ignore */}
        <Input
          width={60}
          id="privateKey"
          readOnly
          placeholder="Private key configured"
          addonAfter={
            <Tooltip content="Click to clear the uploaded JWT token and upload a new one">
              <Button data-testid={TEST_IDS.resetJwtButton} icon="sync" size="xs" onClick={onResetPress} fill="outline">
                Reset token
              </Button>
            </Tooltip>
          }
        />
      </Field>
    </div>
  );
};
