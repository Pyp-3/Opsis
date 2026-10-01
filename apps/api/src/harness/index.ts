import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LLMClient } from '@opsis/parse';
import { HarnessError } from './errors.js';
import { readHarnessConfig } from './config.js';
import {
  HarnessLLMClient,
  validateExecutable,
  versionRunRequest,
  type ExecutableValidationOptions,
} from './client.js';
import { SpawnProcessRunner } from './runner.js';
import type { HarnessProvider, ProcessRunner } from './types.js';

const APPROVED_PATHS: Record<HarnessProvider, readonly string[]> = {
  claude: ['/home/pyp/.local/bin/claude'],
  codex: ['/usr/bin/codex'],
  agy: ['/home/pyp/.local/bin/agy'],
};

const VERSION_PATTERNS: Record<HarnessProvider, RegExp> = {
  claude: /(?:^|\s)2\.1\.\d+(?:\s|$)/u,
  codex: /(?:^|\s)0\.(?:156|157|159)\.\d+(?:\s|$)/u,
  agy: /(?:^|\s)1\.2\.\d+(?:\s|$)/u,
};

function parseVersion(provider: HarnessProvider, output: string): string {
  const match = VERSION_PATTERNS[provider].exec(output);
  if (!match) throw new HarnessError('harness_config');
  return match[0].trim();
}

export type CreateHarnessOptions = {
  resultSchema?: string;
  runner?: ProcessRunner;
  executableValidation?: ExecutableValidationOptions;
  processEnv?: NodeJS.ProcessEnv;
  executableValidator?: typeof validateExecutable;
  versionWorkspaceFactory?: () => Promise<{
    directory: string;
    dispose(): Promise<void>;
  }>;
};

/** Validates and creates a configured harness client, or returns null for non-harness mode. */
export async function createHarnessLLMClient(
  env: Readonly<Record<string, string | undefined>> = process.env,
  options: CreateHarnessOptions = {},
): Promise<LLMClient | null> {
  const config = readHarnessConfig(env);
  if (!config) return null;
  const runner = options.runner ?? new SpawnProcessRunner();
  const executable = await (options.executableValidator ?? validateExecutable)(config.executable, {
    allowedPaths: options.executableValidation?.allowedPaths ?? APPROVED_PATHS[config.provider],
  });
  const workspace = options.versionWorkspaceFactory
    ? await options.versionWorkspaceFactory()
    : await (async () => {
        const directory = await mkdtemp(join(tmpdir(), 'opsis-harness-version-'));
        await chmod(directory, 0o700);
        return {
          directory,
          dispose: async () => rm(directory, { recursive: true, force: true }),
        };
      })();
  try {
    const result = await runner.run(
      versionRunRequest(executable, workspace.directory, options.processEnv),
    );
    if (result.exitCode !== 0) throw new HarnessError('harness_exit');
    const version = parseVersion(config.provider, result.stdout);
    return new HarnessLLMClient(
      { ...config, executable },
      version,
      runner,
      options.processEnv,
      undefined,
      options.resultSchema,
    );
  } finally {
    await workspace.dispose();
  }
}

export { HarnessError } from './errors.js';
export { readHarnessConfig } from './config.js';
export { HarnessLLMClient } from './client.js';
export { SpawnProcessRunner } from './runner.js';
export { extractHarnessResult } from './envelope.js';
export { pdfText } from './pdf.js';
export type { HarnessProgress } from './progress.js';
export type {
  HarnessConfig,
  HarnessFile,
  HarnessProvider,
  ProcessRunner,
  ProcessRunRequest,
} from './types.js';
