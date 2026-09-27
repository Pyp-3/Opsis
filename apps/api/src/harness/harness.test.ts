import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { LLMRequest } from '@opsis/parse';
import {
  configuredLLMClientFromEnvironment,
  llmClientFromEnvironment,
  llmIdentity,
} from '../llm.js';
import { HarnessLLMClient, type HarnessWorkspace } from './client.js';
import { readHarnessConfig } from './config.js';
import { extractHarnessResult } from './envelope.js';
import { HarnessError } from './errors.js';
import { createHarnessLLMClient } from './index.js';
import { SpawnProcessRunner } from './runner.js';
import type {
  HarnessConfig,
  HarnessProvider,
  ProcessRunner,
  ProcessRunRequest,
  ProcessRunResult,
} from './types.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const HARNESS_SOURCE = fileURLToPath(new URL('./', import.meta.url));
const REQUEST: LLMRequest = {
  promptId: 'test/v1',
  system: 'Return JSON only. SECRET_SYSTEM',
  user: 'SECRET_USER',
  responseFormat: 'json',
  temperature: 0.2,
  maxOutputTokens: 123,
};

class FakeRunner implements ProcessRunner {
  requests: ProcessRunRequest[] = [];

  constructor(private readonly reply: ProcessRunResult | Error) {}

  async run(request: ProcessRunRequest): Promise<ProcessRunResult> {
    this.requests.push(request);
    if (this.reply instanceof Error) throw this.reply;
    return this.reply;
  }
}

function workspace(): HarnessWorkspace {
  return {
    directory: '/private/context-free',
    schemaPath: '/private/context-free/schema.json',
    dispose: async () => undefined,
  };
}

function config(provider: HarnessProvider): HarnessConfig {
  return { provider, model: 'audited-model', executable: `/approved/${provider}`, timeoutMs: 900 };
}

async function fixture(name: string): Promise<string> {
  return readFile(`${FIXTURES}${name}`, 'utf8');
}

describe('sanitized harness envelopes', () => {
  it.each([
    ['claude', 'claude-2.1.281.json', 'claude fixture'],
    ['codex', 'codex-0.156.0.jsonl', 'codex fixture'],
    ['agy', 'agy-1.2.9.json', 'agy fixture'],
  ] as const)('extracts %s JSON-only output', async (provider, name, answer) => {
    expect(JSON.parse(extractHarnessResult(provider, await fixture(name)))).toEqual({ answer });
  });

  it('rejects malformed envelopes, missing final results, and non-object results', () => {
    expect(() => extractHarnessResult('claude', 'not json')).toThrowError(/harness_malformed/u);
    expect(() => extractHarnessResult('codex', '{"type":"turn.completed"}')).toThrowError(
      /harness_malformed/u,
    );
    expect(() => extractHarnessResult('agy', '{"is_error":false,"result":"[1,2]"}')).toThrowError(
      /harness_schema/u,
    );
  });
});

describe('HarnessLLMClient', () => {
  it.each([
    ['claude', 'sonnet', 'medium', 'claude-2.1.281.json'],
    ['claude', 'haiku', 'low', 'claude-2.1.281.json'],
    ['codex', 'gpt-6-luna', 'low', 'codex-0.156.0.jsonl'],
  ] as const)(
    'forwards explicit model and supported effort for %s/%s',
    async (provider, model, effort, name) => {
      const runner = new FakeRunner({ exitCode: 0, stdout: await fixture(name) });
      const client = new HarnessLLMClient(
        { ...config(provider), model, effort },
        'test',
        runner,
        {},
        async () => workspace(),
      );
      await client.complete(REQUEST);
      const args = runner.requests[0]!.args;
      expect(args[args.indexOf('--model') + 1]).toBe(model);
      if (provider === 'codex') expect(args).toContain('model_reasoning_effort="low"');
      else if (model === 'haiku') expect(args).not.toContain('--effort');
      else expect(args[args.indexOf('--effort') + 1]).toBe('medium');
      expect(args).not.toContain('--fallback-model');
    },
  );
  it.each([
    ['claude', 'claude-2.1.281.json'],
    ['codex', 'codex-0.156.0.jsonl'],
    ['agy', 'agy-1.2.9.json'],
  ] as const)(
    'uses the audited %s argv and keeps prompts only on bounded stdin',
    async (provider, name) => {
      const runner = new FakeRunner({ exitCode: 0, stdout: await fixture(name) });
      const client = new HarnessLLMClient(
        config(provider),
        provider === 'claude' ? '2.1.281' : provider === 'codex' ? '0.156.0' : '1.2.9',
        runner,
        {
          HOME: '/credential-owner-home',
          LANG: 'en_US.UTF-8',
          TMPDIR: '/tmp',
          OPSIS_LLM_API_KEY: 'NEVER_INHERIT_THIS',
          UNRELATED_SECRET: 'NEITHER_THIS',
        },
        async () => workspace(),
      );

      await client.complete(REQUEST);
      const call = runner.requests[0];
      expect(call?.stdin).toContain('SECRET_SYSTEM');
      expect(call?.stdin).toContain('SECRET_USER');
      expect(call?.args.join(' ')).not.toContain('SECRET');
      expect(call?.env).toEqual({
        HOME: '/credential-owner-home',
        LANG: 'en_US.UTF-8',
        TMPDIR: '/tmp',
        PATH: '/usr/local/bin:/usr/bin:/bin',
      });
      expect(call).toMatchObject({
        cwd: '/private/context-free',
        maxStdinBytes: 65_536,
        maxStdoutBytes: 1_048_576,
        maxStderrBytes: 65_536,
      });
      if (provider === 'codex') {
        expect(call?.args.slice(0, 4)).toEqual(['--ask-for-approval', 'never', 'exec', '-']);
      }
      expect(llmIdentity(client)).toMatch(
        new RegExp(`^harness:${provider}:audited-model:cli-`, 'u'),
      );
      expect(client.capabilities).toEqual({ temperature: false, maxOutputTokens: false });
    },
  );

  it.each([
    ['harness_timeout', 'harness_timeout'],
    ['harness_cancelled', 'harness_cancelled'],
    ['harness_overflow', 'harness_overflow'],
    ['harness_exit', 'harness_exit'],
  ] as const)('preserves redacted %s failures', async (code, expected) => {
    const runner = new FakeRunner(new HarnessError(code));
    const client = new HarnessLLMClient(config('claude'), '2.1.281', runner, {}, async () =>
      workspace(),
    );
    await expect(client.complete(REQUEST)).rejects.toThrowError(expected);
    await expect(client.complete(REQUEST)).rejects.not.toThrowError(/SECRET|credential/u);
  });

  it('maps a nonzero injected process result without exposing output', async () => {
    const runner = new FakeRunner({ exitCode: 7, stdout: 'TOP_SECRET_PROCESS_OUTPUT' });
    const client = new HarnessLLMClient(config('claude'), '2.1.281', runner, {}, async () =>
      workspace(),
    );
    await expect(client.complete(REQUEST)).rejects.toThrowError('harness_exit');
    await expect(client.complete(REQUEST)).rejects.not.toThrowError('TOP_SECRET_PROCESS_OUTPUT');
  });

  it('does not contain production code that reads CLI credential or config files directly', async () => {
    const sourceFiles = (await readdir(HARNESS_SOURCE)).filter(
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    );
    const source = (
      await Promise.all(sourceFiles.map((name) => readFile(`${HARNESS_SOURCE}${name}`, 'utf8')))
    ).join('\n');

    expect(source).not.toMatch(/\b(?:readFile|readFileSync|createReadStream|open|openSync)\b/u);
    expect(source).not.toMatch(/\.claude|\.codex|keychain|credential(?:s)?\.json/iu);
  });
});

describe('SpawnProcessRunner supervision', () => {
  const runner = new SpawnProcessRunner();
  const base = (args: string[], overrides: Partial<ProcessRunRequest> = {}): ProcessRunRequest => ({
    executable: process.execPath,
    args,
    stdin: '',
    cwd: '/tmp',
    env: { PATH: '/usr/bin:/bin' },
    timeoutMs: 1_000,
    maxStdinBytes: 64,
    maxStdoutBytes: 64,
    maxStderrBytes: 64,
    ...overrides,
  });

  it('rejects nonzero exits with a redacted code', async () => {
    await expect(runner.run(base(['-e', 'process.exit(9)']))).rejects.toThrowError('harness_exit');
  });

  it('terminates a timed-out child', async () => {
    await expect(
      runner.run(base(['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 100 })),
    ).rejects.toThrowError('harness_timeout');
  });

  it('terminates a cancelled child', async () => {
    const controller = new AbortController();
    const running = runner.run(
      base(['-e', 'setInterval(() => {}, 1000)'], { signal: controller.signal }),
    );
    controller.abort();
    await expect(running).rejects.toThrowError('harness_cancelled');
  });

  it('rejects oversized stdin before spawning', async () => {
    await expect(
      runner.run(base(['-e', 'process.exit(0)'], { stdin: 'x'.repeat(65) })),
    ).rejects.toThrowError('harness_overflow');
  });
});

describe('harness configuration and offline fallback', () => {
  it('preserves existing HTTP and offline environment modes', async () => {
    const http = llmClientFromEnvironment({
      OPSIS_LLM_PROVIDER: 'openai',
      OPSIS_LLM_MODEL: 'gpt-test',
      OPSIS_LLM_API_KEY: 'test-key',
    });
    expect(llmIdentity(http)).toBe('http:openai:gpt-test');
    expect(llmClientFromEnvironment({})).toBeNull();
    expect(await configuredLLMClientFromEnvironment({})).toBeNull();
  });

  it('requires an explicit safe model, absolute binary, known provider and bounded timeout', () => {
    expect(() => readHarnessConfig({ OPSIS_LLM_PROVIDER: 'harness:nope' })).toThrowError(
      'harness_config',
    );
    expect(() =>
      readHarnessConfig({
        OPSIS_LLM_PROVIDER: 'harness:codex',
        OPSIS_LLM_MODEL: '--danger',
        OPSIS_HARNESS_BIN: '/usr/bin/codex',
      }),
    ).toThrowError('harness_config');
    expect(() =>
      readHarnessConfig({
        OPSIS_LLM_PROVIDER: 'harness:codex',
        OPSIS_LLM_MODEL: 'safe',
        OPSIS_HARNESS_BIN: 'codex',
      }),
    ).toThrowError('harness_config');
  });

  it.each([
    ['claude', 'claude 2.1.281', '2.1.281'],
    ['codex', 'codex-cli 0.156.0', '0.156.0'],
    ['agy', 'agy 1.2.9', '1.2.9'],
  ] as const)(
    'accepts only the audited %s version family at startup',
    async (provider, output, version) => {
      const executable = `/approved/${provider}`;
      const client = await createHarnessLLMClient(
        {
          OPSIS_LLM_PROVIDER: `harness:${provider}`,
          OPSIS_LLM_MODEL: 'safe-model',
          OPSIS_HARNESS_BIN: executable,
        },
        {
          runner: new FakeRunner({ exitCode: 0, stdout: output }),
          executableValidator: async () => executable,
          versionWorkspaceFactory: async () => ({
            directory: '/private/version-check',
            dispose: async () => undefined,
          }),
        },
      );
      expect(llmIdentity(client)).toBe(`harness:${provider}:safe-model:cli-${version}`);
    },
  );

  it('rejects an unaudited CLI version', async () => {
    await expect(
      createHarnessLLMClient(
        {
          OPSIS_LLM_PROVIDER: 'harness:codex',
          OPSIS_LLM_MODEL: 'safe-model',
          OPSIS_HARNESS_BIN: '/approved/codex',
        },
        {
          runner: new FakeRunner({ exitCode: 0, stdout: 'codex-cli 0.158.0' }),
          processEnv: {},
          executableValidator: async () => '/approved/codex',
          versionWorkspaceFactory: async () => ({
            directory: '/private/version-check',
            dispose: async () => undefined,
          }),
        },
      ),
    ).rejects.toThrowError('harness_config');
  });

  it('disables a missing executable cleanly and emits only a redacted warning', async () => {
    const warnings: string[] = [];
    const client = await configuredLLMClientFromEnvironment(
      {
        OPSIS_LLM_PROVIDER: 'harness:codex',
        OPSIS_LLM_MODEL: 'safe-model',
        OPSIS_HARNESS_BIN: '/definitely/missing/TOP_SECRET_NAME',
      },
      { onWarning: (warning) => warnings.push(warning) },
    );
    expect(client).toBeNull();
    expect(warnings).toEqual(['Harness backend disabled (harness_missing); using offline rules.']);
    expect(warnings.join(' ')).not.toContain('TOP_SECRET_NAME');
  });
});
