import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'golden', include: ['tests/golden/**/*.test.ts'] },
});
