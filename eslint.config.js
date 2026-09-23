// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * Pipeline stage order (PROMPT.md §4.1, §17). A stage MUST NOT import from any later stage,
 * whether via its package name (`@opsis/layout`) or a relative path (`../../layout/src`).
 */
const STAGES = ['parse', 'metaphor', 'layout', 'explain'];

/** Builds a `no-restricted-imports` config forbidding the given workspace packages. */
function forbid(packages, message) {
  const names = packages.join('|');
  return {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          { regex: `^@opsis/(${names})(/|$)`, message },
          { regex: `^(\\.\\./)+(pipeline/)?(${names})(/|$)`, message },
        ],
      },
    ],
  };
}

const stageBoundaries = STAGES.slice(0, -1).map((stage, i) => {
  const later = STAGES.slice(i + 1);
  return {
    name: `opsis/stage-boundary/${stage}`,
    files: [`packages/pipeline/${stage}/**/*.{ts,tsx}`],
    rules: forbid(
      later,
      `Stage "${stage}" must not import from a later pipeline stage (${later.join(', ')}). See PROMPT.md §17.`,
    ),
  };
});

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', 'pnpm-lock.yaml'],
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
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  ...stageBoundaries,
  {
    name: 'opsis/schema-is-a-leaf',
    files: ['packages/schema/**/*.{ts,tsx}'],
    rules: forbid(
      ['parse', 'metaphor', 'layout', 'explain', 'primitives', 'ui'],
      'packages/schema is the contract leaf and must not import other Opsis packages.',
    ),
  },
);
