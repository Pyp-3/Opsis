import { chmod, mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { accessSync, constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LLMClient, LLMRequest } from '@opsis/parse';
import { HarnessError } from './errors.js';
import { extractHarnessResult } from './envelope.js';
import { progressReader, type HarnessProgress } from './progress.js';
import type { HarnessConfig, HarnessFile, ProcessRunner, ProcessRunRequest } from './types.js';

// Room for extracted document text as well as the current diagram.
const MAX_STDIN_BYTES = 768 * 1024;
const MAX_STDOUT_BYTES = 1024 * 1024;
// Claude streams every token as its own event, which is far larger than the answer.
const MAX_STREAM_BYTES = 32 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const RESULT_SCHEMA = JSON.stringify({ type: 'object' });

export type HarnessWorkspace = {
  directory: string;
  schemaPath: string;
  dispose(): Promise<void>;
};

/** Creates the private, context-free working directory used by a real harness invocation. */
export async function privateHarnessWorkspace(schema = RESULT_SCHEMA): Promise<HarnessWorkspace> {
  const directory = await mkdtemp(join(tmpdir(), 'opsis-harness-'));
  await chmod(directory, 0o700);
  const schemaPath = join(directory, 'response-schema.json');
  await writeFile(schemaPath, schema, { mode: 0o600, flag: 'wx' });
  return {
    directory,
    schemaPath,
    dispose: async () => rm(directory, { recursive: true, force: true }),
  };
}

class Semaphore {
  private active = 0;
  private readonly waiters: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  async use<T>(action: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active += 1;
    try {
      return await action();
    } finally {
      this.active -= 1;
      this.waiters.shift()?.();
    }
  }
}

const harnessSlots = new Semaphore(2);

function childEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  return {
    HOME: env.HOME ?? '',
    LANG: env.LANG ?? 'C.UTF-8',
    TMPDIR: env.TMPDIR ?? tmpdir(),
    PATH: '/usr/local/bin:/usr/bin:/bin',
  };
}

/** Writes uploads into `attachments/` inside the private workspace and returns their paths. */
async function stageFiles(directory: string, files: readonly HarnessFile[]): Promise<string[]> {
  if (!files.length) return [];
  const folder = join(directory, 'attachments');
  await mkdir(folder, { mode: 0o700 });
  return Promise.all(
    files.map(async (file) => {
      const path = join(folder, file.name);
      await writeFile(path, file.data, { mode: 0o600, flag: 'wx' });
      return path;
    }),
  );
}

function argv(
  config: HarnessConfig,
  schemaPath: string,
  schema = RESULT_SCHEMA,
  files: readonly HarnessFile[] = [],
  paths: readonly string[] = [],
): string[] {
  if (config.provider === 'claude') {
    // Tools stay off unless files were uploaded; then only the read-only Read tool is offered,
    // which reads PDFs and images natively from the private workspace.
    const tools = files.length ? ['--tools', 'Read', '--allowedTools', 'Read'] : ['--tools', ''];
    return [
      '--print',
      // Streamed events let the app show the agent's progress live.
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--json-schema',
      schema,
      ...(config.model === 'default' ? [] : ['--model', config.model]),
      ...(config.effort && !config.model.includes('haiku') ? ['--effort', config.effort] : []),
      '--safe-mode',
      '--restricted',
      ...tools,
      '--disable-slash-commands',
      '--strict-mcp-config',
      '--permission-prompts',
      'none',
      '--no-session-persistence',
    ];
  }
  if (config.provider === 'codex') {
    return [
      '--ask-for-approval',
      'never',
      'exec',
      '-',
      ...(config.model === 'default' ? [] : ['--model', config.model]),
      ...(config.effort ? ['--config', `model_reasoning_effort="${config.effort}"`] : []),
      // Concise reasoning summaries become live progress notes.
      '--config',
      'model_reasoning_summary="concise"',
      // Codex attaches images natively; other documents arrive as extracted text.
      ...paths
        .filter((_, index) => files[index]?.kind === 'image')
        .map((path) => `--image=${path}`),
      '--output-schema',
      schemaPath,
      '--json',
      '--ephemeral',
      '--ignore-user-config',
      '--ignore-rules',
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      '--color',
      'never',
    ];
  }
  return [
    '--print',
    '--input-format',
    'text',
    '--output-format',
    'json',
    '--json-schema',
    schemaPath,
    '--model',
    config.model,
    '--print-timeout',
    String(Math.max(1, Math.floor(config.timeoutMs / 1000))),
    '--mode',
    'plan',
    '--sandbox',
    '--disable-slash-commands',
    '--log-file',
    '/dev/null',
  ];
}

function prompt(request: LLMRequest): string {
  return `${request.system}\n\n${request.user}`;
}

/** Secure, bounded LLMClient backed by one audited local CLI. */
export class HarnessLLMClient implements LLMClient {
  readonly model: string;
  readonly identity: string;
  readonly capabilities = { temperature: false, maxOutputTokens: false } as const;

  constructor(
    private readonly config: HarnessConfig,
    private readonly version: string,
    private readonly runner: ProcessRunner,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly workspaceFactory: (() => Promise<HarnessWorkspace>) | undefined = undefined,
    private readonly resultSchema = RESULT_SCHEMA,
  ) {
    this.model = config.model;
    this.identity = `harness:${config.provider}:${config.model}:cli-${version}`;
  }

  /** Runs a JSON-only completion; temperature and token limits are unsupported by these CLIs. */
  async complete(
    request: LLMRequest,
    signal?: AbortSignal,
    files: readonly HarnessFile[] = [],
    onProgress?: (progress: HarnessProgress) => void,
  ): Promise<string> {
    return harnessSlots.use(async () => {
      try {
        const workspace = await (this.workspaceFactory?.() ??
          privateHarnessWorkspace(this.resultSchema));
        try {
          const paths = await stageFiles(workspace.directory, files);
          const result = await this.runner.run({
            executable: this.config.executable,
            args: argv(this.config, workspace.schemaPath, this.resultSchema, files, paths),
            stdin: prompt(request),
            cwd: workspace.directory,
            env: childEnvironment(this.env),
            timeoutMs: this.config.timeoutMs,
            maxStdinBytes: MAX_STDIN_BYTES,
            maxStdoutBytes: this.config.provider === 'claude' ? MAX_STREAM_BYTES : MAX_STDOUT_BYTES,
            maxStderrBytes: MAX_STDERR_BYTES,
            ...(signal ? { signal } : {}),
            ...(onProgress
              ? {
                  onStdoutLine: (() => {
                    const read = progressReader(this.config.provider);
                    return (line: string) => read(line).forEach(onProgress);
                  })(),
                }
              : {}),
          });
          if (result.exitCode !== 0) throw new HarnessError('harness_exit');
          return extractHarnessResult(this.config.provider, result.stdout);
        } finally {
          await workspace.dispose();
        }
      } catch (error) {
        if (error instanceof HarnessError) throw error;
        throw new HarnessError('harness_exit');
      }
    });
  }
}

export type ExecutableValidationOptions = {
  allowedPaths: readonly string[];
};

/** Resolves and verifies an executable before the API enables a harness backend. */
export async function validateExecutable(
  executable: string,
  options: ExecutableValidationOptions,
): Promise<string> {
  let resolved: string;
  try {
    resolved = await realpath(executable);
    const allowed = await Promise.all(options.allowedPaths.map((path) => realpath(path)));
    if (!allowed.includes(resolved)) throw new HarnessError('harness_config');
    const metadata = await stat(resolved);
    if (!metadata.isFile() || (metadata.mode & 0o022) !== 0)
      throw new HarnessError('harness_config');
    accessSync(resolved, constants.X_OK);
  } catch (error) {
    if (error instanceof HarnessError) throw error;
    throw new HarnessError('harness_missing');
  }
  return resolved;
}

/** Shared limits for startup version probes. */
export function versionRunRequest(
  executable: string,
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): ProcessRunRequest {
  return {
    executable,
    args: ['--version'],
    stdin: '',
    cwd,
    env: childEnvironment(env),
    timeoutMs: 5_000,
    maxStdinBytes: MAX_STDIN_BYTES,
    maxStdoutBytes: 4 * 1024,
    maxStderrBytes: 4 * 1024,
  };
}
