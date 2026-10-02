import { defineConfig } from 'vitest/config';

/**
 * One Vitest project per workspace package; `pnpm test` runs them all from the root.
 * Top-level packages are listed explicitly so `packages/pipeline` itself is not a project.
 */
export default defineConfig({
  test: {
    // Keep cold ESLint initialization and lazy React imports responsive on dev machines.
    maxWorkers: 4,
    projects: [
      'apps/*',
      'packages/{schema,primitives,ui,engine}',
      'packages/pipeline/*',
      { test: { name: 'golden', include: ['tests/golden/**/*.test.ts'] } },
      { test: { name: 'schema-fuzz', include: ['tests/schema/**/*.test.ts'] } },
      'tests/lint',
    ],
  },
});
