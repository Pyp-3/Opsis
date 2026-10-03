import { defineConfig } from 'vitest/config';

/**
 * One Vitest project per workspace package; `pnpm test` runs them all from the root.
 */
export default defineConfig({
  test: {
    // Keep cold ESLint initialization and lazy React imports responsive on dev machines.
    maxWorkers: 4,
    projects: [
      'apps/*',
      'packages/{schema,engine}',
      { test: { name: 'schema-fuzz', include: ['tests/schema/**/*.test.ts'] } },
      'tests/lint',
    ],
  },
});
