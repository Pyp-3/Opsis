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

describe('schema dependency boundary', () => {
  it.each(['@opsis/engine', '@opsis/mcp', '../../engine/src/index', '../../../apps/api/src/app'])(
    'rejects %s from schema',
    async (specifier) => {
      const ids = await ruleIds(`export * from '${specifier}';\n`, 'packages/schema/src/probe.ts');
      expect(ids).toContain('no-restricted-imports');
    },
  );
  it('allows internal schema modules', async () => {
    expect(
      await ruleIds("export * from './board';\n", 'packages/schema/src/probe.ts'),
    ).not.toContain('no-restricted-imports');
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
