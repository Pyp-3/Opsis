import { mkdtemp, readFile, mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { HarnessLLMClient } from './client';
import { boardOutputSchema, boardOutputSchemaFor } from '@opsis/schema';
import { GROK_PROMPT_LIMIT, harnessArguments } from './arguments';
import { CONVERSATION, PAGES, SYSTEM } from '../boards/prompts';
import { parseVersion } from './version';
import { extractHarnessResult } from './envelope';
import type { HarnessProvider, ProcessRunRequest } from './types';

const request = {
  promptId: 'fixture',
  system: 'JSON only',
  user: 'fixture prompt',
  responseFormat: 'json' as const,
  temperature: 0,
  maxOutputTokens: 1000,
};
it.each(['kimi', 'grok', 'agy'] as const)(
  'isolates %s and extracts its official headless result',
  async (provider) => {
    const home = await mkdtemp(join(tmpdir(), 'opsis-cli-home-'));
    let directory = '';
    try {
      const client = new HarnessLLMClient(
        { provider, model: 'explicit-model', executable: '/fake', timeoutMs: 180000 },
        'fixture',
        {
          async run(call: ProcessRunRequest) {
            directory = call.cwd;
            expect(call.args[call.args.indexOf('--model') + 1]).toBe('explicit-model');
            expect(call.env).not.toHaveProperty('UNRELATED_SECRET');
            if (provider === 'kimi') {
              expect(await readFile(join(call.cwd, 'opsis-agent.yaml'), 'utf8')).toContain(
                'tools: []',
              );
              expect(JSON.parse(await readFile(join(call.cwd, 'opsis-mcp.json'), 'utf8'))).toEqual({
                mcpServers: {},
              });
              expect(call.args).toContain('--max-retries-per-step');
              expect(call.stdin).toContain('fixture prompt');
            } else if (provider === 'grok') {
              expect(call.args[call.args.indexOf('--tools') + 1]).toBe('');
              expect(call.args[call.args.indexOf('-p') + 1]).toContain('fixture prompt');
              expect(call.env.GROK_CLAUDE_MCPS_ENABLED).toBe('0');
              expect(call.args).toContain('--no-auto-update');
            } else {
              expect(call.env.HOME).toBe(call.cwd);
              expect(call.env.USERPROFILE).toBe(call.cwd);
              const settings = JSON.parse(
                await readFile(join(call.cwd, '.gemini/antigravity-cli/settings.json'), 'utf8'),
              );
              expect(settings.permissions.deny).toContain('command(*)');
              expect(settings.permissions.deny).toContain('mcp(*)');
              expect(JSON.parse(call.stdin)).toEqual({
                event: 'user',
                message: { content: 'JSON only\n\nfixture prompt' },
              });
              expect(call.args).toContain('180s');
            }
            return {
              exitCode: 0,
              stdout:
                provider === 'agy'
                  ? '{"event":"result","result":{"status":"SUCCESS","response":"{}"}}'
                  : '{}',
            };
          },
        },
        { HOME: home, USERPROFILE: home, UNRELATED_SECRET: 'fixture-secret' },
      );
      expect(await client.complete(request)).toBe('{}');
      await expect(stat(directory)).rejects.toThrow();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  },
);
it('rejects inherited Kimi plugins and Grok configuration before launching a process', async () => {
  const home = await mkdtemp(join(tmpdir(), 'opsis-cli-home-'));
  try {
    await mkdir(join(home, '.kimi/plugins'), { recursive: true });
    await writeFile(join(home, '.kimi/plugins/untrusted'), 'fixture');
    await mkdir(join(home, '.grok'));
    await writeFile(join(home, '.grok/config.toml'), 'fixture');
    for (const provider of ['kimi', 'grok'] as const) {
      const client = new HarnessLLMClient(
        { provider, model: 'explicit', executable: '/fake', timeoutMs: 1000 },
        'fixture',
        {
          async run() {
            throw new Error('MUST_NOT_LAUNCH');
          },
        },
        { HOME: home, USERPROFILE: home },
      );
      await expect(client.complete(request)).rejects.toThrow('harness_config');
    }
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
it('bounds Grok argv and rejects failed Antigravity results without trying output repair', () => {
  const grok = {
    provider: 'grok',
    model: 'grok-4.7',
    executable: '/fake',
    timeoutMs: 1000,
  } as const;
  // Opsis's own instructions and schema for a short request fit, with room for the request.
  expect(
    harnessArguments(
      grok,
      'schema',
      boardOutputSchema,
      [],
      [],
      `${SYSTEM}\nSchema: ${boardOutputSchema}\nExplain email`,
    ),
  ).toContain('--no-auto-update');
  // So does a chat request for new pages, whose schema adds further pages.
  const deck = boardOutputSchemaFor({ pages: true });
  expect(
    harnessArguments(
      grok,
      'schema',
      deck,
      [],
      [],
      `${SYSTEM}${CONVERSATION}${PAGES}\nSchema: ${deck}\nExplain email as a short deck`,
    ),
  ).toContain('--no-auto-update');
  expect(() =>
    harnessArguments(
      { provider: 'grok', model: 'grok-4.7', executable: '/fake', timeoutMs: 1000 },
      'schema',
      '{}',
      [],
      [],
      'x'.repeat(GROK_PROMPT_LIMIT),
    ),
  ).toThrow('harness_request_limit');
  expect(() =>
    extractHarnessResult(
      'agy',
      '{"event":"result","result":{"status":"ERROR","error":"secret","response":"{}"}}',
    ),
  ).toThrow('harness_exit');
  for (const [provider, version] of [
    ['kimi', '1.52.0'],
    ['grok', '1.0.46'],
    ['agy', '1.3.0'],
  ] as [HarnessProvider, string][])
    expect(parseVersion(provider, version)).toBe(version);
});
