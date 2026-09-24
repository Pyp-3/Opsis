import type { LLMClient, LLMConfig, LLMRequest } from '@opsis/parse';
import { readLLMConfig } from '@opsis/parse';
import { createHarnessLLMClient, HarnessError } from './harness/index.js';
import type { CreateHarnessOptions } from './harness/index.js';

type OpenAIReply = { choices?: { message?: { content?: string } }[] };
type AnthropicReply = { content?: { type?: string; text?: string }[] };

/** HTTP implementation of the pipeline LLMClient for Anthropic or OpenAI-compatible APIs. */
export class EnvironmentLLMClient implements LLMClient {
  readonly model: string;
  readonly identity: string;

  constructor(private readonly config: LLMConfig) {
    this.model = config.model;
    this.identity = `http:${config.provider.toLowerCase()}:${config.model}`;
  }

  /** Sends a provider-shaped completion request and returns its text payload. */
  async complete(request: LLMRequest): Promise<string> {
    return this.config.provider.toLowerCase() === 'anthropic'
      ? this.completeAnthropic(request)
      : this.completeOpenAI(request);
  }

  private async completeAnthropic(request: LLMRequest): Promise<string> {
    const baseUrl = this.config.baseUrl ?? 'https://api.anthropic.com';
    const response = await fetch(`${baseUrl.replace(/\/$/u, '')}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        system: request.system,
        messages: [{ role: 'user', content: request.user }],
        max_tokens: request.maxOutputTokens,
        temperature: request.temperature,
      }),
    });
    if (!response.ok) throw new Error(`Anthropic request failed with status ${response.status}`);
    const payload = (await response.json()) as AnthropicReply;
    const text = payload.content?.find((part) => part.type === 'text')?.text;
    if (!text) throw new Error('Anthropic response did not include text');
    return text;
  }

  private async completeOpenAI(request: LLMRequest): Promise<string> {
    const baseUrl = this.config.baseUrl ?? 'https://api.openai.com/v1';
    const response = await fetch(`${baseUrl.replace(/\/$/u, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
        response_format: request.responseFormat === 'json' ? { type: 'json_object' } : undefined,
        max_tokens: request.maxOutputTokens,
        temperature: request.temperature,
      }),
    });
    if (!response.ok)
      throw new Error(`OpenAI-compatible request failed with status ${response.status}`);
    const payload = (await response.json()) as OpenAIReply;
    const text = payload.choices?.[0]?.message?.content;
    if (!text) throw new Error('OpenAI-compatible response did not include text');
    return text;
  }
}

/** Builds the configured client, or returns null to select deterministic offline fallbacks. */
export function llmClientFromEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
): LLMClient | null {
  if (env.OPSIS_LLM_PROVIDER?.trim().startsWith('harness:')) return null;
  const config = readLLMConfig(env);
  return config ? new EnvironmentLLMClient(config) : null;
}

type IdentifiedClient = LLMClient & { readonly identity?: string };

/** Stable provider/model/version identity used by cache keys. */
export function llmIdentity(client: LLMClient | null): string {
  return (
    (client as IdentifiedClient | null)?.identity ?? (client ? `model:${client.model}` : 'offline')
  );
}

export type ConfiguredClientOptions = CreateHarnessOptions & {
  onWarning?: (message: string) => void;
};

/** Builds HTTP, harness or offline mode; invalid harness startup fails closed to offline. */
export async function configuredLLMClientFromEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
  options: ConfiguredClientOptions = {},
): Promise<LLMClient | null> {
  if (!env.OPSIS_LLM_PROVIDER?.trim().startsWith('harness:')) {
    return llmClientFromEnvironment(env);
  }
  try {
    return await createHarnessLLMClient(env, options);
  } catch (error) {
    const code = error instanceof HarnessError ? error.code : 'harness_config';
    options.onWarning?.(`Harness backend disabled (${code}); using offline rules.`);
    return null;
  }
}
