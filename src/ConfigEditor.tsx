import React from 'react';
import { DataSourcePluginOptionsEditorProps, onUpdateDatasourceJsonDataOption } from '@grafana/data';
import { DataSourceOptions, DataSourceSecureJsonData, GoogleAuthType } from '@grafana/google-sdk';
import { FieldSet } from '@grafana/ui';
import { JWTConfigEditor } from './components/JWTConfigEditor';
import { JWTForm } from './components/JWTForm';

type Props = DataSourcePluginOptionsEditorProps<DataSourceOptions, DataSourceSecureJsonData>;

/**
 * Config page that accepts a JWT token either through upload or pasting
 *
 * @param props JWT token fields needed by the plugin
 */
export const ConfigEditor: React.FC<Props> = (props: Props) => {
  const { options, onOptionsChange } = props;
  const { jsonData, secureJsonFields, secureJsonData } = options;
  // We only accept a JWT token
  jsonData.authenticationType = GoogleAuthType.JWT;

  const hasJWTConfigured = Boolean(
    secureJsonFields &&
    secureJsonFields.privateKey &&
    jsonData.clientEmail &&
    jsonData.defaultProject &&
    jsonData.tokenUri
  );

  /**
   * Clear JWT fields
   *
   * @param jsonData Remaining data source options
   */
  const onResetJWTToken = (jsonData?: Partial<DataSourceOptions> | null) => {
    const nextSecureJsonData = { ...secureJsonData };
    const nextJsonData = !jsonData ? { ...options.jsonData } : { ...options.jsonData, ...jsonData };

    delete nextJsonData.clientEmail;
    delete nextJsonData.defaultProject;
    delete nextJsonData.tokenUri;
    delete nextSecureJsonData.privateKey;

    onOptionsChange({
      ...options,
      secureJsonData: nextSecureJsonData,
      jsonData: nextJsonData,
    });
  };

  const onJWTFormChange = (key: keyof DataSourceOptions) => onUpdateDatasourceJsonDataOption(props, key);

  return (
    <>
      <FieldSet label="JWT Key Details">
        {hasJWTConfigured ? (
          <JWTForm options={options.jsonData} onReset={onResetJWTToken} onChange={onJWTFormChange} />
        ) : (
          <JWTConfigEditor
            onChange={(jwt) => {
              onOptionsChange({
                ...options,
                secureJsonFields: { ...secureJsonFields, privateKey: true },
                secureJsonData: {
                  ...secureJsonData,
                  privateKey: jwt.privateKey,
                },
                jsonData: {
                  ...jsonData,
                  clientEmail: jwt.clientEmail,
                  defaultProject: jwt.projectId,
                  tokenUri: jwt.tokenUri,
                },
              });
            }}
          />
        )}{' '}
      </FieldSet>
    </>
  );
};
