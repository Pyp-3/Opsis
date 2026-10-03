import type { LLMClient, LLMRequest } from '../harness/types.js';
import {
  DEFAULT_BOARD_MODELS,
  boardOutputSchema,
  type BoardAgent,
  type BoardModelSettings,
} from '@opsis/schema';
import {
  createHarnessLLMClient,
  type HarnessFile,
  type HarnessProgress,
} from '../harness/index.js';
import { resolveAgentExecutable } from '../cli-executable.js';

export type BoardClient = LLMClient & {
  complete(
    request: LLMRequest,
    signal?: AbortSignal,
    files?: readonly HarnessFile[],
    onProgress?: (progress: HarnessProgress) => void,
  ): Promise<string>;
};
export type BoardClientFactory = (
  agent: Exclude<BoardAgent, 'demo'>,
  settings?: BoardModelSettings,
  /** The JSON schema the agent's answer must match; diagrams by default. */
  resultSchema?: string,
) => Promise<BoardClient>;
export const localBoardClient: BoardClientFactory = async (
  agent,
  settings = DEFAULT_BOARD_MODELS[agent],
  resultSchema = boardOutputSchema,
) => {
  const executable = await resolveAgentExecutable(agent);
  const client = await createHarnessLLMClient(
    {
      OPSIS_LLM_PROVIDER: `harness:${agent}`,
      OPSIS_LLM_MODEL: settings.model,
      OPSIS_LLM_EFFORT: settings.effort,
      OPSIS_HARNESS_BIN: executable,
      OPSIS_HARNESS_TIMEOUT_MS: '180000',
    },
    { resultSchema, executableValidation: { allowedPaths: [executable] } },
  );
  if (!client) throw new Error('Agent unavailable');
  return client;
};
