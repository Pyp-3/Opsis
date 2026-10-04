import { generateBoard } from '../api/src/boards/generate';
import { illustrateBoard } from '../api/src/boards/illustrate';
import { prepareAttachments } from '../api/src/attachments';
import { HarnessError, type HarnessErrorCode } from '../api/src/harness/errors';
import { harnessArguments } from '../api/src/harness/arguments';
import { extractHarnessResult } from '../api/src/harness/envelope';
import { progressReader } from '../api/src/harness/progress';
import { parseVersion } from '../api/src/harness/version';
import type { BoardClientFactory } from '../api/src/boards/client';
import type { HarnessFile, LLMRequest } from '../api/src/harness/types';
import type { HarnessProgress } from '../api/src/harness/progress';
import { DEFAULT_BOARD_MODELS, boardOutputSchema } from '../../packages/schema/src/index';

declare function nativePrepareClient(agent: string): string;
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
    return { length: decoded.length, toString: () => decoded.text, toJSON: () => decoded.data };
  },
};

const factory: BoardClientFactory = async (
  agent,
  settings = DEFAULT_BOARD_MODELS[agent],
  schema = boardOutputSchema,
) => {
  const prepared = result<{ executable: string; version: string }>(nativePrepareClient(agent));
  parseVersion(agent, prepared.version);
  return {
    model: settings.model,
    async complete(
      request: LLMRequest,
      _signal?: AbortSignal,
      files: readonly HarnessFile[] = [],
      onProgress?: (progress: HarnessProgress) => void,
    ) {
      const read = progressReader(agent);
      const config = {
        provider: agent,
        model: settings.model,
        ...(settings.effort ? { effort: settings.effort } : {}),
        executable: prepared.executable,
        timeoutMs: 180000,
      };
      const response = result<{ stdout: string }>(
        nativeComplete(
          JSON.stringify({
            executable: prepared.executable,
            provider: agent,
            schema,
            request,
            files,
          }),
          (schemaPath, paths) =>
            JSON.stringify(
              harnessArguments(config, schemaPath, schema, files, JSON.parse(paths) as string[]),
            ),
          (line) => read(line).forEach((progress) => onProgress?.(progress)),
        ),
      );
      return extractHarnessResult(agent, response.stdout);
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
    operation === 'generate'
      ? await generateBoard(JSON.parse(body), factory, context, prepareAttachments)
      : await illustrateBoard(JSON.parse(body), factory, context);
  return JSON.stringify(outcome);
}

export async function agents(): Promise<string> {
  const agents: { id: string; available: boolean; detail: string }[] = [];
  for (const id of ['claude', 'codex'] as const) {
    try {
      await factory(id);
      agents.push({ id, available: true, detail: 'CLI ready · uses your local login' });
    } catch {
      agents.push({
        id,
        available: false,
        detail: `Unavailable · check ${id} installation and version`,
      });
    }
  }
  agents.push({ id: 'demo', available: true, detail: 'Built-in examples · no agent calls' });
  return JSON.stringify(agents);
}
