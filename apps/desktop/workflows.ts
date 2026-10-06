import { checkAgent } from '../api/src/boards/check-agent';
import { providerApiClient } from '../api/src/providers/api-client';
import { providerWorkspaceFiles, providerEnvironment } from '../api/src/harness/provider-workspace';
import { generateBoard } from '../api/src/boards/generate';
import { illustrateBoard } from '../api/src/boards/illustrate';
import { prepareAttachments } from '../api/src/attachments';
import { HarnessError, type HarnessErrorCode } from '../api/src/harness/errors';
import { harnessArguments } from '../api/src/harness/arguments';
import { extractHarnessResult } from '../api/src/harness/envelope';
import { progressReader } from '../api/src/harness/progress';
import { parseVersion } from '../api/src/harness/version';
import type { BoardClientFactory } from '../api/src/boards/client';
import type { HarnessFile, LLMRequest, HarnessConfig } from '../api/src/harness/types';
import type { HarnessProgress } from '../api/src/harness/progress';
import {
  DEFAULT_BOARD_MODELS,
  boardOutputSchema,
  modelSettingsProblem,
} from '../../packages/schema/src/index';

declare function nativePrepareClient(agent: string, executablePath: string): string;
declare function nativeProviderKey(agent: string): string;
declare function nativeProviderHttp(request: string): string;
declare function nativeProviderPause(): void;
declare function nativeComplete(
  request: string,
  argumentsFor: (schemaPath: string, paths: string) => string,
  onLine: (line: string) => void,
): string;
declare function nativeCancelled(): boolean;
declare function nativeProgress(json: string): void;
declare function nativeDecodeFile(base64: string): string;

function result<T>(value: string): T {
  const parsed = JSON.parse(value) as { error?: HarnessErrorCode; value: T };
  if (parsed.error) throw new HarnessError(parsed.error);
  return parsed.value;
}

// Only the Buffer operations used by attachment preparation exist here. No Node
// runtime or ambient filesystem/network API is exposed to the workflow VM.
(globalThis as unknown as { Buffer: unknown }).Buffer = {
  from(base64: string) {
    const decoded = JSON.parse(nativeDecodeFile(base64)) as {
      data: string;
      text: string;
      length: number;
    };
    return {
      length: decoded.length,
      toString: (encoding?: string) => (encoding === 'base64' ? decoded.data : decoded.text),
      toJSON: () => decoded.data,
    };
  },
};

const factory: BoardClientFactory = async (
  agent,
  settings = DEFAULT_BOARD_MODELS[agent],
  schema = boardOutputSchema,
) => {
  const problem = modelSettingsProblem(agent, settings);
  if (problem) throw new Error(problem);
  if (settings.connection === 'api')
    return providerApiClient(
      agent,
      settings,
      schema,
      nativeProviderKey(agent),
      async (request) => result(nativeProviderHttp(JSON.stringify(request))),
      async () => nativeProviderPause(),
    );
  const provider = agent === 'antigravity' ? 'agy' : agent;
  const prepared = result<{ executable: string; version: string }>(
    nativePrepareClient(agent, settings.executablePath ?? ''),
  );
  parseVersion(provider, prepared.version);
  return {
    model: settings.model,
    async complete(
      request: LLMRequest,
      _signal?: AbortSignal,
      files: readonly HarnessFile[] = [],
      onProgress?: (progress: HarnessProgress) => void,
    ) {
      if (request.system.length + request.user.length > (settings.maxRequestCharacters ?? 768000))
        throw new HarnessError('harness_request_limit');
      const read = progressReader(provider);
      const config: HarnessConfig = {
        provider,
        model: settings.model,
        ...(settings.effort ? { effort: settings.effort } : {}),
        executable: prepared.executable,
        timeoutMs: 180000,
        ...(settings.maxBudgetUSD !== undefined ? { maxBudgetUSD: settings.maxBudgetUSD } : {}),
      };
      const response = result<{ stdout: string }>(
        nativeComplete(
          JSON.stringify({
            executable: prepared.executable,
            provider,
            schema,
            request,
            files,
            workspaceFiles: providerWorkspaceFiles(provider, schema),
            environment: providerEnvironment(provider),
          }),
          (schemaPath, paths) =>
            JSON.stringify(
              harnessArguments(
                config,
                schemaPath,
                schema,
                files,
                JSON.parse(paths) as string[],
                `${request.system}\n\n${request.user}`,
              ),
            ),
          (line) => read(line).forEach((progress) => onProgress?.(progress)),
        ),
      );
      return extractHarnessResult(provider, response.stdout);
    },
  };
};

export async function run(operation: string, body: string): Promise<string> {
  const context = {
    signal: {
      get aborted() {
        return nativeCancelled();
      },
    } as AbortSignal,
    progress: (value: unknown) => nativeProgress(JSON.stringify(value)),
  };
  const outcome =
    operation === 'check-agent'
      ? await checkAgent(JSON.parse(body), factory)
      : operation === 'generate'
        ? await generateBoard(JSON.parse(body), factory, context, prepareAttachments)
        : await illustrateBoard(JSON.parse(body), factory, context);
  return JSON.stringify(outcome);
}

export async function agents(): Promise<string> {
  const agents: { id: string; available: boolean; detail: string }[] = [];
  for (const id of ['claude', 'codex'] as const) {
    try {
      await factory(id);
      agents.push({ id, available: true, detail: 'CLI ready · account access unverified' });
    } catch {
      agents.push({
        id,
        available: false,
        detail: `Unavailable · check ${id} installation and version`,
      });
    }
  }
  agents.push({ id: 'demo', available: true, detail: 'Built-in examples · no agent calls' });
  for (const id of ['kimi', 'grok', 'antigravity'])
    agents.push({ id, available: true, detail: 'API · configure this instance’s key in Settings' });
  return JSON.stringify(agents);
}
