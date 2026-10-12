import { describe, expect, it } from 'vitest';
import { harnessArguments } from './arguments.js';
import { readHarnessConfig } from './config.js';
import { withNativeSession, type SessionStore } from './sessions.js';
import type { HarnessConfig } from './types.js';

const THREAD = '6f9d4c3a-1b2e-4f5a-8c7d-9e0f1a2b3c4d';
const config = (provider: 'claude' | 'codex', extra: Partial<HarnessConfig> = {}) =>
  ({ provider, model: 'm', executable: '/approved/cli', timeoutMs: 1000, ...extra }) as const;
const ISOLATION = [
  '--safe-mode',
  '--restricted',
  '--disable-slash-commands',
  '--strict-mcp-config',
  '--permission-prompts',
];

describe('agent access and fast mode', () => {
  it('runs Claude restricted by default, or with its own setup and no prompts with full access', () => {
    const restricted = harnessArguments(config('claude'), '/s.json');
    expect(restricted).toEqual(expect.arrayContaining([...ISOLATION, '--tools', '']));
    expect(restricted).not.toContain('--dangerously-skip-permissions');

    const full = harnessArguments(
      config('claude', { access: 'full', session: { id: THREAD, resume: true } }),
      '/s.json',
    );
    expect(full).toContain('--dangerously-skip-permissions');
    for (const flag of [...ISOLATION, '--tools']) expect(full).not.toContain(flag);
    // The answer is still the structured JSON, in the thread's session.
    expect(full).toEqual(expect.arrayContaining(['--json-schema', '--resume', THREAD]));
  });

  it('runs Codex sandboxed by default, or unsandboxed with its own configuration', () => {
    const restricted = harnessArguments(config('codex'), '/s.json');
    expect(restricted).toEqual(
      expect.arrayContaining(['--ask-for-approval', 'never', '--sandbox', 'read-only']),
    );
    expect(restricted).toEqual(expect.arrayContaining(['--ignore-user-config', '--ignore-rules']));

    for (const resume of [false, true]) {
      const full = harnessArguments(
        config('codex', { access: 'full', session: { id: THREAD, resume } }),
        '/s.json',
      );
      expect(full).toContain('--dangerously-bypass-approvals-and-sandbox');
      for (const flag of [
        '--ask-for-approval',
        '--sandbox',
        'sandbox_mode="read-only"',
        '--ignore-user-config',
        '--ignore-rules',
      ])
        expect(full).not.toContain(flag);
      expect(full).toEqual(expect.arrayContaining(['--output-schema', '--json']));
    }
  });

  it('turns on each CLI’s fast mode without changing its isolation', () => {
    const claude = harnessArguments(config('claude', { fast: true }), '/s.json');
    expect(claude).toEqual(
      expect.arrayContaining(['--settings', '{"fastMode":true}', '--safe-mode']),
    );
    const codex = harnessArguments(config('codex', { fast: true }), '/s.json');
    expect(codex).toEqual(
      expect.arrayContaining(['--config', 'service_tier="fast"', '--sandbox', 'read-only']),
    );
    expect(harnessArguments(config('claude'), '/s.json')).not.toContain('--settings');
  });

  it('accepts full access, fast mode and a ten-minute deadline only for Claude and Codex', () => {
    const env = (provider: string, extra: Record<string, string>) => ({
      OPSIS_LLM_PROVIDER: `harness:${provider}`,
      OPSIS_LLM_MODEL: 'm',
      OPSIS_HARNESS_BIN: process.platform === 'win32' ? 'C:\\cli\\agent.exe' : '/cli/agent',
      ...extra,
    });
    expect(
      readHarnessConfig(
        env('claude', {
          OPSIS_LLM_ACCESS: 'full',
          OPSIS_LLM_FAST: '1',
          OPSIS_HARNESS_TIMEOUT_MS: '600000',
        }),
      ),
    ).toMatchObject({ access: 'full', fast: true, timeoutMs: 600_000 });
    expect(readHarnessConfig(env('codex', { OPSIS_LLM_ACCESS: 'restricted' }))).not.toHaveProperty(
      'access',
    );
    for (const bad of [
      env('kimi', { OPSIS_LLM_ACCESS: 'full' }),
      env('grok', { OPSIS_LLM_FAST: '1' }),
      env('claude', { OPSIS_LLM_ACCESS: 'root' }),
      env('claude', { OPSIS_HARNESS_TIMEOUT_MS: '600001' }),
    ])
      expect(() => readHarnessConfig(bad)).toThrowError(/harness_config/u);
  });

  it('starts a new session for a compacted thread and keeps the old one listed', async () => {
    const values = new Map<string, string>();
    const store: SessionStore = {
      read: async (key) => values.get(key) ?? null,
      write: async (key, state) => void values.set(key, state),
      clear: async (key) => void values.delete(key),
    };
    const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];
    const plans: unknown[] = [];
    const run = (fresh: boolean) =>
      withNativeSession(
        {
          provider: 'claude',
          model: 'm',
          key: `a/${THREAD}`,
          store,
          freshId: () => ids.shift()!,
          ...(fresh ? { fresh: true } : {}),
        },
        async (plan) => {
          plans.push(plan);
          return '';
        },
      );
    await run(false);
    await run(true);
    await run(false);
    expect(plans).toEqual([
      { id: '00000000-0000-4000-8000-000000000001', resume: false, turns: 0 },
      { id: '00000000-0000-4000-8000-000000000002', resume: false, turns: 0 },
      { id: '00000000-0000-4000-8000-000000000002', resume: true, turns: 1 },
    ]);
    const state = JSON.parse(values.get(`a/${THREAD}`)!) as { transcripts: { id: string }[] };
    expect(state.transcripts.map((item) => item.id)).toEqual([
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
    ]);
  });
});
