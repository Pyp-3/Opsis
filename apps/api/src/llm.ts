import type { LLMClient, LLMConfig, LLMRequest } from '@opsis/parse';
import { readLLMConfig } from '@opsis/parse';

type OpenAIReply = { choices?: { message?: { content?: string } }[] };
type AnthropicReply = { content?: { type?: string; text?: string }[] };

/** HTTP implementation of the pipeline LLMClient for Anthropic or OpenAI-compatible APIs. */
export class EnvironmentLLMClient implements LLMClient {
  readonly model: string;

  constructor(private readonly config: LLMConfig) {
    this.model = config.model;
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
  const config = readLLMConfig(env);
  return config ? new EnvironmentLLMClient(config) : null;
}
