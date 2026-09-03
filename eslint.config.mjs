import { defineConfig } from 'eslint/config';
import baseConfig from './.config/eslint.config.mjs';

export default defineConfig([
  {
    ignores: ['dist/**', 'node_modules/**', '.config/**', 'coverage/**', 'playwright-report/**', 'test-results/**'],
  },
  ...baseConfig,
]);
