// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/target/**',
      '**/coverage/**',
      'pnpm-lock.yaml',
      'apps/desktop/assets/**',
      'apps/desktop/bundle/**',
      'apps/desktop/build/**',
      'apps/web/wailsjs/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}', 'apps/desktop/smoke.js'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    name: 'opsis/harness-process-boundary',
    files: ['**/*.{ts,tsx}'],
    ignores: ['apps/api/src/harness/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'node:child_process',
              message: 'Child processes are restricted to apps/api/src/harness/.',
            },
            {
              name: 'child_process',
              message: 'Child processes are restricted to apps/api/src/harness/.',
            },
          ],
        },
      ],
    },
  },
  {
    name: 'opsis/schema-is-a-leaf',
    files: ['packages/schema/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: ['node:child_process', 'child_process', 'api', 'web'],
          patterns: [
            {
              regex:
                '^@opsis/(?!schema(?:/|$))|^(\\.\\./)+(?:packages/)?(engine|pipeline|primitives|ui|apps)(/|$)',
              message:
                'Schema owns pure contracts and board rules; it must not depend on applications or other Opsis packages.',
            },
          ],
        },
      ],
    },
  },
);
