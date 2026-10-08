import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fileSessionStore } from '../cli-sessions.js';
import { harnessArguments } from './arguments.js';
import { HarnessLLMClient, sessionDirectory } from './client.js';
import { HarnessError } from './errors.js';
import {
  MAX_SESSION_TURNS,
  parseSessionState,
  sessionIdFrom,
  sessionKey,
  withNativeSession,
  type SessionStore,
} from './sessions.js';
import type { HarnessConfig, LLMRequest, ProcessRunRequest, ProcessRunResult } from './types.js';

const THREAD = '6f9d4c3a-1b2e-4f5a-8c7d-9e0f1a2b3c4d';
const CODEX_THREAD = '0f0e0d0c-0b0a-4908-8706-050403020100';

function memoryStore(): SessionStore & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    read: async (key) => values.get(key) ?? null,
    write: async (key, state) => void values.set(key, state),
    clear: async (key) => void values.delete(key),
  };
}

describe('native CLI sessions for chat threads', () => {
  it('scopes a session to the signed-in account and a real thread id', () => {
    expect(sessionKey('account-1', THREAD)).toBe(`account-1/${THREAD}`);
    expect(sessionKey(undefined, THREAD)).toBeUndefined();
    expect(sessionKey('account-1', '../../etc')).toBeUndefined();
    expect(sessionKey('../escape', THREAD)).toBeUndefined();
    expect(() => sessionDirectory('/root', '../x/y')).toThrowError(/harness_config/u);
  });

  it('starts a Claude session with a fixed id, then resumes it until it is replaced', async () => {
    const store = memoryStore();
    const plans: unknown[] = [];
    const run = (turns: number) =>
      withNativeSession(
        {
          provider: 'claude',
          model: 'claude-sonnet-5-5',
          key: `a/${THREAD}`,
          store,
          freshId: () => `00000000-0000-4000-8000-${String(turns).padStart(12, '0')}`,
        },
        async (plan) => {
          plans.push(plan);
          return '{"type":"result"}';
        },
      );
    for (let turn = 0; turn <= MAX_SESSION_TURNS; turn++) await run(turn);
    expect(plans[0]).toEqual({
      id: '00000000-0000-4000-8000-000000000000',
      resume: false,
      turns: 0,
    });
    expect(plans[1]).toEqual({
      id: '00000000-0000-4000-8000-000000000000',
      resume: true,
      turns: 1,
    });
    // After the turn limit a new session starts; the thread's notes carry the context.
    expect(plans[MAX_SESSION_TURNS]).toEqual({
      id: `00000000-0000-4000-8000-${String(MAX_SESSION_TURNS).padStart(12, '0')}`,
      resume: false,
      turns: 0,
    });
  });

  it('records the session Codex names and resumes it on another model only after a restart', async () => {
    const store = memoryStore();
    const options = {
      provider: 'codex' as const,
      model: 'gpt-6-luna',
      key: `a/${THREAD}`,
      store,
      freshId: () => THREAD,
    };
    await withNativeSession(options, async (plan) => {
      expect(plan).toEqual({ resume: false, turns: 0 });
      return `{"type":"thread.started","thread_id":"${CODEX_THREAD}"}\n{"type":"turn.completed"}`;
    });
    expect(parseSessionState(store.values.get(`a/${THREAD}`)!)?.id).toBe(CODEX_THREAD);
    await withNativeSession(options, async (plan) => {
      expect(plan).toEqual({ id: CODEX_THREAD, resume: true, turns: 1 });
      return '';
    });
    await withNativeSession({ ...options, model: 'gpt-6' }, async (plan) => {
      expect(plan.resume).toBe(false);
      return '';
    });
  });

  it('forgets a session that cannot be resumed and says so, without retrying', async () => {
    const store = memoryStore();
    const key = `a/${THREAD}`;
    await store.write(
      key,
      JSON.stringify({ provider: 'claude', model: 'm', id: THREAD, turns: 2 }),
    );
    let runs = 0;
    await expect(
      withNativeSession(
        { provider: 'claude', model: 'm', key, store, freshId: () => THREAD },
        async () => {
          runs += 1;
          throw new HarnessError('harness_exit');
        },
      ),
    ).rejects.toMatchObject({ code: 'harness_session' });
    expect(runs).toBe(1);
    expect(store.values.has(key)).toBe(false);
  });

  it('leaves other providers and requests without a thread unchanged', async () => {
    const store = memoryStore();
    for (const [provider, key] of [
      ['kimi', `a/${THREAD}`],
      ['claude', undefined],
    ] as const)
      await withNativeSession(
        { provider, model: 'm', key, store, freshId: () => THREAD },
        async (plan) => {
          expect(plan).toBeNull();
          return '';
        },
      );
    expect(store.values.size).toBe(0);
  });

  it('reads the session a run created from its events', () => {
    expect(
      sessionIdFrom('claude', `{"type":"system","subtype":"init","session_id":"${THREAD}"}`),
    ).toBe(THREAD);
    expect(
      sessionIdFrom('codex', 'not json\n{"type":"thread.started","thread_id":"x"}'),
    ).toBeNull();
  });

  it('passes the session to each CLI while keeping its isolation flags', () => {
    const config = (provider: 'claude' | 'codex', resume: boolean): HarnessConfig => ({
      provider,
      model: 'm',
      executable: '/approved/cli',
      timeoutMs: 1000,
      session: { id: THREAD, resume },
    });
    const claudeStart = harnessArguments(config('claude', false), '/s.json');
    expect(claudeStart).toEqual(expect.arrayContaining(['--session-id', THREAD, '--tools', '']));
    expect(claudeStart).not.toContain('--no-session-persistence');
    expect(harnessArguments(config('claude', true), '/s.json')).toEqual(
      expect.arrayContaining(['--resume', THREAD, '--safe-mode', '--restricted']),
    );
    const codexResume = harnessArguments(config('codex', true), '/s.json');
    expect(codexResume.slice(0, 6)).toEqual([
      '--ask-for-approval',
      'never',
      'exec',
      'resume',
      THREAD,
      '-',
    ]);
    expect(codexResume).toEqual(
      expect.arrayContaining(['--config', 'sandbox_mode="read-only"', '--output-schema']),
    );
    expect(codexResume).not.toContain('--ephemeral');
    // Without a thread, runs stay ephemeral.
    const plain = harnessArguments({ ...config('codex', false), session: undefined }, '/s.json');
    expect(plain).toEqual(expect.arrayContaining(['--ephemeral', '--sandbox', 'read-only']));
    expect(
      harnessArguments({ ...config('claude', false), session: undefined }, '/s.json'),
    ).toContain('--no-session-persistence');
  });
});

describe('HarnessLLMClient with a chat thread', () => {
  let root = '';
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('resumes in the thread’s own directory with the shorter resume prompt', async () => {
    root = await mkdtemp(join(tmpdir(), 'opsis-session-test-'));
    const requests: ProcessRunRequest[] = [];
    const runner = {
      async run(request: ProcessRunRequest): Promise<ProcessRunResult> {
        requests.push(request);
        return {
          exitCode: 0,
          stdout: JSON.stringify({ type: 'result', structured_output: { ok: true } }),
        };
      },
    };
    const client = new HarnessLLMClient(
      { provider: 'claude', model: 'm', executable: '/approved/claude', timeoutMs: 1000 },
      '2.1.293',
      runner,
      {},
      undefined,
      undefined,
      { root, store: fileSessionStore(root) },
    );
    const request: LLMRequest = {
      promptId: 'test',
      system: 'FULL_SYSTEM',
      user: 'FULL_USER',
      responseFormat: 'json',
      temperature: 0,
      maxOutputTokens: 10,
      session: { key: `account/${THREAD}`, resumeSystem: 'RESUME', resumeUser: 'NEXT' },
    };
    await client.complete(request);
    await client.complete(request);
    const directory = sessionDirectory(root, `account/${THREAD}`);
    expect(requests.map((item) => item.cwd)).toEqual([directory, directory]);
    expect(requests[0]!.stdin).toContain('FULL_SYSTEM');
    expect(requests[1]!.stdin).toBe('RESUME\n\nNEXT');
    const sessionId = requests[0]!.args[requests[0]!.args.indexOf('--session-id') + 1];
    expect(requests[1]!.args).toEqual(expect.arrayContaining(['--resume', sessionId]));
    // Without a thread, the private disposable workspace is used as before.
    await client.complete({ ...request, session: undefined });
    expect(requests[2]!.cwd).not.toBe(directory);
    expect(requests[2]!.args).toContain('--no-session-persistence');
  });
});
