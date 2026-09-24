import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));
const eslint = new ESLint({ cwd: root });

/** Returns the rule ids reported when `code` is linted as if it lived at `filePath`. */
async function ruleIds(code: string, filePath: string): Promise<(string | null)[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return result?.messages.map((m) => m.ruleId) ?? [];
}

describe('§17 stage import boundary', () => {
  const later: [string, string][] = [
    ['parse', '@opsis/metaphor'],
    ['parse', '@opsis/layout'],
    ['parse', '@opsis/explain'],
    ['parse', '../../layout/src/index'],
    ['metaphor', '@opsis/layout'],
    ['metaphor', '@opsis/explain/sub'],
    ['layout', '@opsis/explain'],
    ['layout', '../../../pipeline/explain'],
  ];

  it.each(later)('%s must not import %s', async (stage, spec) => {
    const ids = await ruleIds(
      `export { PACKAGE_NAME } from '${spec}';\n`,
      `packages/pipeline/${stage}/src/probe.ts`,
    );
    expect(ids).toContain('no-restricted-imports');
  });

  const allowed: [string, string][] = [
    ['metaphor', '@opsis/parse'],
    ['layout', '@opsis/metaphor'],
    ['explain', '@opsis/layout'],
    ['parse', '@opsis/schema'],
  ];

  it.each(allowed)('%s may import %s', async (stage, spec) => {
    const ids = await ruleIds(
      `export { PACKAGE_NAME } from '${spec}';\n`,
      `packages/pipeline/${stage}/src/probe.ts`,
    );
    expect(ids).not.toContain('no-restricted-imports');
  });

  it('schema must not import pipeline stages', async () => {
    const ids = await ruleIds(
      `export { PACKAGE_NAME } from '@opsis/parse';\n`,
      'packages/schema/src/probe.ts',
    );
    expect(ids).toContain('no-restricted-imports');
  });
});

describe('harness child-process boundary', () => {
  it('rejects child_process imports outside apps/api/src/harness', async () => {
    const ids = await ruleIds(
      `import { spawn } from 'node:child_process';\nspawn('x');\n`,
      'apps/api/src/not-harness.ts',
    );
    expect(ids).toContain('no-restricted-imports');
  });

  it('allows the audited runner to import child_process', async () => {
    const ids = await ruleIds(
      `import { spawn } from 'node:child_process';\nspawn('x');\n`,
      'apps/api/src/harness/probe.ts',
    );
    expect(ids).not.toContain('no-restricted-imports');
  });
});
