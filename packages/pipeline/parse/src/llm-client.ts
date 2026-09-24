/** One chat-style completion request sent to an LLM provider. */
export type LLMRequest = {
  /** Stable id of the prompt template that produced this request, e.g. `parse/v1`. */
  promptId: string;
  system: string;
  user: string;
  /** Always `json` for pipeline stages; providers should enable their JSON mode if they have one. */
  responseFormat: 'json' | 'text';
  temperature: number;
  maxOutputTokens: number;
};

/**
 * Provider-agnostic LLM interface (PROMPT.md §4.2). Implementations return the raw completion text;
 * parsing and validation are the caller's job so every provider is treated identically.
 */
export interface LLMClient {
  /** Provider-specific model name, read from configuration, never hard-coded. */
  readonly model: string;
  /** Sends one request and resolves with the raw text of the completion. */
  complete(request: LLMRequest): Promise<string>;
}

/** Provider settings resolved from environment variables. */
export type LLMConfig = {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
};

/** Environment variable names that configure the LLM provider. */
export const LLM_ENV = {
  provider: 'OPSIS_LLM_PROVIDER',
  model: 'OPSIS_LLM_MODEL',
  apiKey: 'OPSIS_LLM_API_KEY',
  baseUrl: 'OPSIS_LLM_BASE_URL',
} as const;

/** Reads LLM settings from the environment; returns null when no key or model is set (offline mode). */
export function readLLMConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): LLMConfig | null {
  const apiKey = env[LLM_ENV.apiKey]?.trim();
  const model = env[LLM_ENV.model]?.trim();
  if (!apiKey || !model) return null;
  const baseUrl = env[LLM_ENV.baseUrl]?.trim();
  return {
    provider: env[LLM_ENV.provider]?.trim() || 'anthropic',
    model,
    apiKey,
    ...(baseUrl ? { baseUrl } : {}),
  };
}
