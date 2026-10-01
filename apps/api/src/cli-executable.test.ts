import { beforeEach, describe, expect, it, vi } from 'vitest';
import { childEnvironment } from './harness/client.js';
import { executableCommand, resolveAgentExecutable } from './cli-executable.js';

const files = vi.hoisted(() => new Map<string, string>());
vi.mock('node:fs/promises', async (original) => ({
  ...(await original<typeof import('node:fs/promises')>()),
  stat: vi.fn(async (path: string) => {
    if (!files.has(path)) throw new Error('ENOENT');
    return { isFile: () => true };
  }),
  access: vi.fn(async (path: string) => {
    if (!files.has(path)) throw new Error('ENOENT');
  }),
  readFile: vi.fn(async (path: string) => {
    if (!files.has(path)) throw new Error('ENOENT');
    return files.get(path);
  }),
}));

beforeEach(() => files.clear());

describe('local CLI discovery', () => {
  it.each(['linux', 'darwin'] as const)('resolves %s PATH installations', async (platform) => {
    files.set('/custom/bin/codex', '');
    expect(
      await resolveAgentExecutable('codex', {
        platform,
        home: '/home/test',
        env: { PATH: '/missing:/custom/bin' },
      }),
    ).toBe('/custom/bin/codex');
  });

  it('finds native user installations and Apple Silicon Homebrew', async () => {
    files.set('/home/test/.local/bin/claude', '');
    expect(
      await resolveAgentExecutable('claude', { platform: 'linux', home: '/home/test', env: {} }),
    ).toBe('/home/test/.local/bin/claude');
    files.set('/opt/homebrew/bin/codex', '');
    expect(
      await resolveAgentExecutable('codex', { platform: 'darwin', home: '/Users/test', env: {} }),
    ).toBe('/opt/homebrew/bin/codex');
  });

  it('finds Windows native executables with case-insensitive environment keys', async () => {
    files.set('C:\\Tools\\claude.exe', '');
    expect(
      await resolveAgentExecutable('claude', {
        platform: 'win32',
        home: 'C:\\Users\\test',
        env: { Path: 'C:\\Missing;C:\\Tools' },
      }),
    ).toBe('C:\\Tools\\claude.exe');
  });

  it.each(['codex', 'claude'] as const)(
    'resolves Windows npm %s without a shell',
    async (agent) => {
      const root = `C:\\Users\\Test Name\\npm`;
      const packageName = agent === 'codex' ? '@openai\\codex' : '@anthropic-ai\\claude-code';
      const bin = agent === 'codex' ? 'bin/codex.js' : 'bin/claude.exe';
      const entry = `${root}\\node_modules\\${packageName}\\${bin.replace('/', '\\')}`;
      files.set(
        `${root}\\node_modules\\${packageName}\\package.json`,
        JSON.stringify({ bin: { [agent]: bin } }),
      );
      files.set(entry, '');
      const options = {
        platform: 'win32' as const,
        home: 'C:\\Users\\test',
        env: { APPDATA: 'C:\\Users\\Test Name', Path: root },
      };
      expect(await resolveAgentExecutable(agent, options)).toBe(entry);
      files.set(`${root}\\${agent}.cmd`, '');
      expect(
        await resolveAgentExecutable(agent, {
          ...options,
          env: { [`OPSIS_${agent.toUpperCase()}_BIN`]: `${root}\\${agent}.cmd` },
        }),
      ).toBe(entry);
    },
  );

  it('honours overrides without falling back on a typo', async () => {
    files.set('/custom/claude', '');
    files.set('/usr/bin/claude', '');
    expect(
      await resolveAgentExecutable('claude', {
        platform: 'linux',
        env: { OPSIS_CLAUDE_BIN: '/custom/claude' },
      }),
    ).toBe('/custom/claude');
    await expect(
      resolveAgentExecutable('claude', {
        platform: 'linux',
        env: { OPSIS_CLAUDE_BIN: '/missing' },
      }),
    ).rejects.toThrow('harness_missing');
    await expect(
      resolveAgentExecutable('claude', { platform: 'linux', env: { OPSIS_CLAUDE_BIN: 'claude' } }),
    ).rejects.toThrow('harness_config');
  });

  it('rejects npm entries outside the package and unsupported shell scripts', async () => {
    files.set(
      'C:\\npm\\node_modules\\@openai\\codex\\package.json',
      JSON.stringify({ bin: '../../outside.js' }),
    );
    files.set('C:\\npm\\outside.js', '');
    await expect(
      resolveAgentExecutable('codex', {
        platform: 'win32',
        home: 'C:\\Users\\test',
        env: { Path: 'C:\\npm' },
      }),
    ).rejects.toThrow('harness_missing');
    expect(() => executableCommand('C:\\custom.cmd', [])).toThrow('harness_config');
  });
});

it('launches JavaScript with the current Node runtime and preserves argument boundaries', () => {
  expect(executableCommand('C:\\Program Files\\codex.js', ['--model', 'test'])).toEqual({
    executable: process.execPath,
    args: ['C:\\Program Files\\codex.js', '--model', 'test'],
  });
  expect(executableCommand('/usr/bin/claude', ['--version'])).toEqual({
    executable: '/usr/bin/claude',
    args: ['--version'],
  });
});

it('retains Windows login/runtime paths while excluding unrelated secrets', () => {
  expect(
    childEnvironment({
      Path: 'C:\\Tools',
      USERPROFILE: 'C:\\Users\\test',
      AppData: 'C:\\Users\\test\\AppData\\Roaming',
      SYSTEMROOT: 'C:\\Windows',
      API_KEY: 'secret',
    }),
  ).toMatchObject({
    PATH: 'C:\\Tools',
    USERPROFILE: 'C:\\Users\\test',
    APPDATA: 'C:\\Users\\test\\AppData\\Roaming',
    SystemRoot: 'C:\\Windows',
  });
  expect(childEnvironment({ API_KEY: 'secret' })).not.toHaveProperty('API_KEY');
});
