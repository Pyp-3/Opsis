import { HarnessError } from '../harness/errors';
import type { LLMClient, LLMRequest } from '../harness/types.js';
import {
  DEFAULT_BOARD_MODELS,
  modelSettingsProblem,
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
import { fileSessionStore } from '../cli-sessions.js';
import { DEFAULT_SESSION_ROOT } from '../harness/client.js';
import { providerApiClient } from '../providers/api-client';
import { providerHttp, providerPause, withProviderSlot } from '../providers/http';

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
  apiKey?: string,
) => Promise<BoardClient>;
export const localBoardClient: BoardClientFactory = async (
  agent,
  settings = DEFAULT_BOARD_MODELS[agent],
  resultSchema = boardOutputSchema,
  apiKey,
) => {
  const problem = modelSettingsProblem(agent, settings);
  if (problem) throw new Error(problem);
  if (settings.connection === 'api') {
    const api = providerApiClient(
      agent,
      settings,
      resultSchema,
      apiKey,
      providerHttp,
      providerPause,
    );
    return {
      model: api.model,
      complete: (
        request: LLMRequest,
        signal?: AbortSignal,
        files?: readonly HarnessFile[],
        progress?: (value: HarnessProgress) => void,
      ) => withProviderSlot(() => api.complete(request, signal, files, progress)),
    };
  }
  const executable = await resolveAgentExecutable(
    agent,
    settings.executablePath
      ? { env: { ...process.env, [`OPSIS_${agent.toUpperCase()}_BIN`]: settings.executablePath } }
      : {},
  );
  const client = await createHarnessLLMClient(
    {
      OPSIS_LLM_PROVIDER: `harness:${agent === 'antigravity' ? 'agy' : agent}`,
      OPSIS_LLM_MODEL: settings.model,
      OPSIS_LLM_EFFORT: settings.effort,
      OPSIS_HARNESS_BIN: executable,
      OPSIS_HARNESS_TIMEOUT_MS: '180000',
      ...(settings.maxBudgetUSD !== undefined
        ? { OPSIS_LLM_MAX_BUDGET_USD: String(settings.maxBudgetUSD) }
        : {}),
    },
    {
      resultSchema,
      executableValidation: { allowedPaths: [executable] },
      sessions: { root: DEFAULT_SESSION_ROOT, store: fileSessionStore(DEFAULT_SESSION_ROOT) },
    },
  );
  if (!client) throw new Error('Agent unavailable');
  return {
    model: client.model,
    async complete(
      request: LLMRequest,
      signal?: AbortSignal,
      files?: readonly HarnessFile[],
      progress?: (progress: HarnessProgress) => void,
    ) {
      if (request.system.length + request.user.length > (settings.maxRequestCharacters ?? 768000))
        throw new HarnessError('harness_request_limit');
      return client.complete(request, signal, files, progress);
    },
  };
};
