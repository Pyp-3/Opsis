import { defineConfig } from 'vitest/config';

/**
 * One Vitest project per workspace package; `pnpm test` runs them all from the root.
 * Top-level packages are listed explicitly so `packages/pipeline` itself is not a project.
 */
export default defineConfig({
  test: {
    projects: [
      'apps/*',
      'packages/{schema,primitives,ui}',
      'packages/pipeline/*',
      { test: { name: 'golden', include: ['tests/golden/**/*.test.ts'] } },
      'tests/lint',
    ],
  },
});
