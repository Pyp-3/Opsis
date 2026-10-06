import { ProviderApiKeySchema, type BoardModelSettings, type ProviderAgent } from '@opsis/schema';
import type { BoardClient } from '../boards/client';
import { HarnessError } from '../harness/errors';
import type { LLMRequest, HarnessFile } from '../harness/types';
import type { HarnessProgress } from '../harness/progress';

export type ApiProvider = 'kimi' | 'grok' | 'antigravity';
export type ProviderHttpRequest = {
  provider: ApiProvider;
  method: 'POST' | 'GET';
  path: string;
  key: string;
  body?: string;
};
export type ProviderTransport = (
  request: ProviderHttpRequest,
  signal?: AbortSignal,
) => Promise<unknown>;
export const API_ORIGINS = {
  kimi: 'https://api.moonshot.ai',
  grok: 'https://api.x.ai',
  antigravity: 'https://generativelanguage.googleapis.com',
} as const;
type Json = Record<string, unknown>;
const object = (value: unknown): Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

/** Shared protocol code runs in Node and the native workflow VM; transports own I/O. */
export function providerApiClient(
  agent: ProviderAgent,
  settings: BoardModelSettings,
  schema: string,
  key: string | undefined,
  send: ProviderTransport,
  pause: (signal?: AbortSignal) => Promise<void>,
): BoardClient {
  if (
    !['kimi', 'grok', 'antigravity'].includes(agent) ||
    !ProviderApiKeySchema.safeParse(key).success
  )
    throw new HarnessError('provider_key');
  const provider = agent as ApiProvider;
  return {
    model: settings.model,
    async complete(
      request: LLMRequest,
      signal?: AbortSignal,
      files: readonly HarnessFile[] = [],
      progress?: (value: HarnessProgress) => void,
    ) {
      if (request.system.length + request.user.length > (settings.maxRequestCharacters ?? 768000))
        throw new HarnessError('harness_request_limit');
      if (files.some((file) => file.kind !== 'image'))
        throw new HarnessError('provider_attachment');
      const images = files.map((file) => {
        const extension = file.name.split('.').pop()?.toLowerCase();
        const mime =
          extension === 'jpg' || extension === 'jpeg'
            ? 'image/jpeg'
            : extension === 'webp'
              ? 'image/webp'
              : extension === 'gif'
                ? 'image/gif'
                : 'image/png';
        return { data: file.data.toString('base64'), mime };
      });
      const system = `${request.system}\nReturn only JSON matching this schema:\n${schema}`;
      const limit = settings.maxOutputTokens ?? request.maxOutputTokens;
      let path: string;
      let body: Json;
      if (provider === 'kimi') {
        path = '/v1/chat/completions';
        body = {
          model: settings.model,
          reasoning_effort: settings.effort,
          max_completion_tokens: limit,
          response_format: { type: 'json_object' },
          tool_choice: 'none',
          stream: false,
          messages: [
            { role: 'system', content: system },
            {
              role: 'user',
              content: [
                { type: 'text', text: request.user },
                ...images.map(({ data, mime }) => ({
                  type: 'image_url',
                  image_url: { url: `data:${mime};base64,${data}` },
                })),
              ],
            },
          ],
        };
      } else if (provider === 'grok') {
        path = '/v1/responses';
        body = {
          model: settings.model,
          max_output_tokens: limit,
          store: false,
          tools: [],
          input: [
            { role: 'system', content: system },
            {
              role: 'user',
              content: [
                { type: 'input_text', text: request.user },
                ...images.map(({ data, mime }) => ({
                  type: 'input_image',
                  image_url: `data:${mime};base64,${data}`,
                })),
              ],
            },
          ],
        };
      } else {
        path = '/v1beta/interactions';
        body = {
          agent: 'antigravity-preview-09-2026',
          agent_config: { type: 'antigravity', model: settings.model },
          background: true,
          tools: [],
          input: [
            { type: 'text', text: `${system}\n\n${request.user}` },
            ...images.map(({ data, mime }) => ({ type: 'image', data, mime_type: mime })),
          ],
        };
      }
      let response = object(
        await send(
          { provider, method: 'POST', path, key: key!, body: JSON.stringify(body) },
          signal,
        ),
      );
      let text: unknown;
      if (provider === 'antigravity') {
        const id = response.id;
        if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,1024}$/.test(id))
          throw new HarnessError('harness_malformed');
        let completed = false;
        try {
          for (let poll = 0; response.status === 'in_progress' && poll < 180; poll++) {
            await pause(signal);
            response = object(
              await send({ provider, method: 'GET', path: `${path}/${id}`, key: key! }, signal),
            );
          }
          if (response.status !== 'completed') throw new HarnessError('provider_failed');
          completed = true;
          const last = array(response.steps)
            .map(object)
            .filter((step) => step.type === 'model_output')
            .at(-1);
          text = array(last?.content)
            .map(object)
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('');
        } finally {
          if (!completed)
            await send({ provider, method: 'POST', path: `${path}/${id}:cancel`, key: key! }).catch(
              () => undefined,
            );
        }
      } else if (provider === 'grok') {
        if (response.status !== 'completed') throw new HarnessError('provider_failed');
        text = array(response.output)
          .map(object)
          .filter((item) => item.type === 'message' && item.role === 'assistant')
          .flatMap((item) => array(item.content).map(object))
          .filter((part) => part.type === 'output_text')
          .map((part) => part.text)
          .join('');
      } else {
        const choice = object(array(response.choices)[0]);
        if (choice.finish_reason !== 'stop') throw new HarnessError('provider_failed');
        text = object(choice.message).content;
      }
      const usage = object(response.usage);
      const cached = object(usage.prompt_tokens_details ?? usage.input_tokens_details);
      // Interactions reports thinking separately; other providers include it in output.
      const generated = count(usage.total_output_tokens);
      const thoughts = count(usage.total_thought_tokens);
      progress?.({
        type: 'usage',
        usage: {
          inputTokens: count(
            provider === 'kimi'
              ? usage.prompt_tokens
              : provider === 'grok'
                ? usage.input_tokens
                : usage.total_input_tokens,
          ),
          outputTokens: count(
            provider === 'kimi'
              ? usage.completion_tokens
              : provider === 'grok'
                ? usage.output_tokens
                : generated !== null && thoughts !== null
                  ? generated + thoughts
                  : null,
          ),
          cachedInputTokens: count(
            provider === 'antigravity'
              ? usage.total_cached_tokens
              : (cached.cached_tokens ?? usage.cached_tokens),
          ),
          cacheWriteTokens: count(cached.cache_write_tokens),
          estimatedCostUSD: null,
        },
      });
      if (typeof text !== 'string' || !text.trim()) throw new HarnessError('harness_malformed');
      return text;
    },
  };
}
