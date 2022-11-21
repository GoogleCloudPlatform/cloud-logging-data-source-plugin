/**
 * Copied from @granafa/google-sdk without change
 * https://github.com/grafana/grafana-google-sdk-react/blob/8b6502c912c32300b86b92502abdbe64ca5a9571/src/components/JWTConfigEditor.tsx
 */
import React, { useState, useCallback } from 'react';
import { FileDropzone, TextArea, LinkButton, useTheme2, Field, Button } from '@grafana/ui';
import { isObject } from 'lodash';
import { TEST_IDS } from './JWTForm';

const configKeys = ['private_key', 'token_uri', 'client_email', 'project_id'];
type JWTConfigKeys = 'privateKey' | 'tokenUri' | 'clientEmail' | 'projectId';
type JWTConfigDTO = Record<JWTConfigKeys, string>;

interface Props {
  onChange: (config: JWTConfigDTO) => void;
}

const INVALID_JWT_TOKEN_ERROR = 'Invalid JWT token';

export const JWTConfigEditor: React.FC<Props> = ({ onChange }: Props) => {
  const [error, setError] = useState<string | null>();
  const [isPasting, setIsPasting] = useState<boolean | null>(null);
  const theme = useTheme2();

  const onPasteClick = useCallback<React.MouseEventHandler<HTMLButtonElement>>(
    () => {
      setError(null);
      setIsPasting(true);
    },
    [setIsPasting]
  );

  const onUploadClick = useCallback<React.MouseEventHandler<HTMLButtonElement>>(
    () => {
      setIsPasting(null);
      setError(null);
    },
    [setIsPasting]
  );

  const readAndValidateJWT = useCallback(
    (value: string) => {
      if (value.trim() !== '') {
        let jwt;
        try {
          jwt = JSON.parse(value);
        } catch (e) {
          setError(INVALID_JWT_TOKEN_ERROR);
        }

        const validation = validateJWT(jwt);

        if (validation.isValid) {
          onChange({
            privateKey: jwt.private_key,
            tokenUri: jwt.token_uri,
            clientEmail: jwt.client_email,
            projectId: jwt.project_id,
          });
        } else {
          setError(validation.error!);
        }
      }
    },
    [setError, onChange]
  );

  return (
    <>
      <Field
        label="JWT token"
        invalid={Boolean(error)}
        description={isPasting ? 'Paste JWT token below' : 'Upload or paste GCP JWT token'}
        error={error}
      >
        <>
          {isPasting !== true && (
            <div data-testid={TEST_IDS.dropZone}>
              <FileDropzone
                options={{ multiple: false, accept: 'application/json' }}
                readAs="readAsText"
                onLoad={(result) => {
                  readAndValidateJWT(result as string);
                  setIsPasting(false);
                }}
              >
                <p style={{ margin: 0, fontSize: `${theme.typography.h4.fontSize}`, textAlign: 'center' }}>
                  Drop the Google JWT file here
                  <br />
                  <br />
                  <LinkButton fill="outline">Click to browse files</LinkButton>
                </p>
              </FileDropzone>
            </div>
          )}

          {isPasting && (
            // @ts-ignore
            <TextArea
              data-testid={TEST_IDS.pasteArea}
              autoFocus
              invalid={Boolean(error)}
              placeholder="Paste GCP JWT token here"
              onBlur={(e) => readAndValidateJWT(e.currentTarget.value)}
              rows={12}
            />
          )}
        </>
      </Field>

      {!isPasting && (
        <Field>
          <Button
            data-testid={TEST_IDS.pasteJwtButton}
            type="button"
            fill="outline"
            style={{ color: `${theme.colors.primary.text}` }}
            onClick={onPasteClick}
          >
            Paste JWT Token
          </Button>
        </Field>
      )}

      {isPasting && error && (
        <Field>
          <Button
            type="button"
            fill="outline"
            style={{ color: `${theme.colors.primary.text}` }}
            onClick={onUploadClick}
          >
            Upload JWT Token
          </Button>
        </Field>
      )}
    </>
  );
};

const validateJWT = (json: Record<string, string>): { isValid: boolean; error?: string } => {
  if (!isObject(json)) {
    return { isValid: false, error: 'Invalid JWT token' };
  }
  const missingKeys = configKeys.filter((key) => !json[key]);
  if (missingKeys.length > 0) {
    return { isValid: false, error: `Missing keys: ${missingKeys.join(', ')}` };
  }

  return { isValid: true };
};
