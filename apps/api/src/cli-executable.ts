import { access, readFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';
import { HarnessError } from './harness/errors.js';

type Agent = 'claude' | 'codex';
const PACKAGES = { claude: '@anthropic-ai/claude-code', codex: '@openai/codex' };

export type DiscoveryOptions = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  home?: string;
};

/** Resolves native CLIs and npm entry points without executing shell shims. */
export async function resolveAgentExecutable(agent: Agent, options: DiscoveryOptions = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();
  const paths = platform === 'win32' ? win32 : posix;
  const value = (name: string) =>
    Object.entries(env).find(([key]) => key.toUpperCase() === name.toUpperCase())?.[1];
  const override = value(`OPSIS_${agent.toUpperCase()}_BIN`)?.trim();

  const usable = async (file: string) => {
    try {
      if (!(await stat(file)).isFile()) return false;
      await access(
        file,
        platform === 'win32' || /\.[cm]?js$/iu.test(file) ? constants.F_OK : constants.X_OK,
      );
      return true;
    } catch {
      return false;
    }
  };
  const npmEntry = async (directory: string) => {
    const root = paths.join(directory, 'node_modules', PACKAGES[agent]);
    try {
      const manifest = JSON.parse(await readFile(paths.join(root, 'package.json'), 'utf8')) as {
        bin?: string | Record<string, string>;
      };
      const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[agent];
      if (!bin) return;
      const entry = paths.resolve(root, bin);
      const relative = paths.relative(root, entry);
      if (relative.startsWith('..') || paths.isAbsolute(relative)) return;
      if (await usable(entry)) return entry;
    } catch {
      // This directory does not contain this agent's npm installation.
    }
  };
  if (override) {
    if (!paths.isAbsolute(override)) throw new HarnessError('harness_config');
    if (platform === 'win32' && /\.(cmd|bat|ps1)$/iu.test(override)) {
      // npm installs these launchers beside node_modules; run the package entry directly.
      if (!(await usable(override))) throw new HarnessError('harness_missing');
      const entry = await npmEntry(paths.dirname(override));
      if (
        entry &&
        paths.basename(override).toLowerCase() ===
          `${agent}${paths.extname(override).toLowerCase()}`
      )
        return entry;
      throw new HarnessError('harness_config');
    }
    if (await usable(override)) return override;
    throw new HarnessError('harness_missing');
  }

  const directories = [
    ...(value('PATH') ?? '').split(platform === 'win32' ? ';' : ':'),
    paths.join(home, '.local', 'bin'),
    ...(platform === 'win32'
      ? [value('APPDATA') && paths.join(value('APPDATA')!, 'npm')]
      : [
          '/opt/homebrew/bin',
          '/usr/local/bin',
          '/usr/bin',
          paths.join(home, '.npm-global', 'bin'),
        ]),
  ].filter((directory): directory is string => !!directory && paths.isAbsolute(directory));
  for (const directory of new Set(directories)) {
    const executable = paths.join(directory, platform === 'win32' ? `${agent}.exe` : agent);
    if (await usable(executable)) return executable;
    const entry = await npmEntry(directory);
    if (entry) return entry;
  }
  throw new HarnessError('harness_missing');
}

/** A script is launched by this API's Node runtime; shell launchers are never spawned. */
export function executableCommand(executable: string, args: readonly string[]) {
  if (/\.(cmd|bat|ps1)$/iu.test(executable)) throw new HarnessError('harness_config');
  return /\.[cm]?js$/iu.test(executable)
    ? { executable: process.execPath, args: [executable, ...args] }
    : { executable, args: [...args] };
}
