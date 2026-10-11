import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_BOARD_MODELS } from '@opsis/schema';
import { providerApiClient, type ProviderTransport } from './api-client';
import { HarnessError } from '../harness/errors';
const request = {
  promptId: 'test',
  system: 'JSON only',
  user: 'diagram',
  responseFormat: 'json' as const,
  temperature: 0,
  maxOutputTokens: 8000,
};

describe('official provider APIs', () => {
  it('pins Kimi settings, disables tools, and preserves absent usage', async () => {
    const send = vi.fn<ProviderTransport>().mockResolvedValue({
      choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 40, prompt_tokens_details: { cached_tokens: 12 } },
    });
    const progress = vi.fn();
    const client = providerApiClient(
      'kimi',
      DEFAULT_BOARD_MODELS.kimi,
      '{}',
      'fixture-secret',
      send,
      async () => {},
    );
    expect(await client.complete(request, undefined, [], progress)).toBe('{"ok":true}');
    expect(JSON.parse(send.mock.calls[0]![0].body!)).toMatchObject({
      model: 'kimi-k3',
      reasoning_effort: 'low',
      max_completion_tokens: 8000,
      tool_choice: 'none',
    });
    expect(progress).toHaveBeenCalledWith({
      type: 'usage',
      usage: {
        inputTokens: 40,
        outputTokens: null,
        cachedInputTokens: 12,
        cacheWriteTokens: null,
        estimatedCostUSD: null,
      },
    });
  });
  it('uses Grok Responses without tools or stored conversations', async () => {
    const send = vi.fn<ProviderTransport>().mockResolvedValue({
      status: 'completed',
      output: [
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{}' }] },
      ],
    });
    const client = providerApiClient(
      'grok',
      { ...DEFAULT_BOARD_MODELS.grok, maxOutputTokens: 1024 },
      '{}',
      'fixture-secret',
      send,
      async () => {},
    );
    expect(await client.complete(request)).toBe('{}');
    expect(send.mock.calls[0]![0].path).toBe('/v1/responses');
    expect(JSON.parse(send.mock.calls[0]![0].body!)).toMatchObject({
      model: 'grok-4.7',
      max_output_tokens: 1024,
      store: false,
      tools: [],
    });
  });
  it('polls the managed Antigravity interaction with an explicit model and no environment', async () => {
    const send = vi
      .fn<ProviderTransport>()
      .mockResolvedValueOnce({ id: 'fixture', status: 'in_progress' })
      .mockResolvedValueOnce({
        id: 'fixture',
        status: 'completed',
        steps: [{ type: 'model_output', content: [{ type: 'text', text: '{}' }] }],
        usage: { total_input_tokens: 7, total_output_tokens: 20, total_thought_tokens: 22 },
      });
    const client = providerApiClient(
      'antigravity',
      DEFAULT_BOARD_MODELS.antigravity,
      '{}',
      'fixture-secret',
      send,
      async () => {},
    );
    const progress = vi.fn();
    expect(await client.complete(request, undefined, [], progress)).toBe('{}');
    expect(progress).toHaveBeenCalledWith({
      type: 'usage',
      usage: expect.objectContaining({ inputTokens: 7, outputTokens: 42, estimatedCostUSD: null }),
    });
    const body = JSON.parse(send.mock.calls[0]![0].body!);
    expect(body).toMatchObject({
      agent_config: { model: 'gemini-3.8-flash' },
      tools: [],
      background: true,
    });
    expect(body).not.toHaveProperty('environment');
    expect(body).not.toHaveProperty('max_output_tokens');
    expect(send.mock.calls[1]![0].path).toBe('/v1beta/interactions/fixture');
  });
  it('cancels known background work when polling is interrupted', async () => {
    const send = vi
      .fn<ProviderTransport>()
      .mockResolvedValue({ id: 'fixture', status: 'in_progress' });
    const client = providerApiClient(
      'antigravity',
      DEFAULT_BOARD_MODELS.antigravity,
      '{}',
      'fixture-secret',
      send,
      async () => {
        throw new HarnessError('harness_cancelled');
      },
    );
    await expect(client.complete(request)).rejects.toThrow('harness_cancelled');
    expect(send.mock.calls[1]![0].path).toBe('/v1beta/interactions/fixture:cancel');
  });
  it.each(['kimi', 'grok', 'antigravity'] as const)(
    'encodes image attachments and schema instructions for %s without changing the model',
    async (provider) => {
      const send = vi.fn<ProviderTransport>().mockResolvedValue({
        id: 'fixture',
        status: 'completed',
        choices: [{ finish_reason: 'stop', message: { content: '{}' } }],
        output: [
          { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{}' }] },
        ],
        steps: [{ type: 'model_output', content: [{ type: 'text', text: '{}' }] }],
      });
      const client = providerApiClient(
        provider,
        DEFAULT_BOARD_MODELS[provider],
        '{"type":"object"}',
        'fixture-secret',
        send,
        async () => {},
      );
      const data = Buffer.from('fixture image');
      await client.complete(request, undefined, [{ name: 'diagram.JPEG', kind: 'image', data }]);
      expect(send).toHaveBeenCalledTimes(1);
      const body = JSON.parse(send.mock.calls[0]![0].body!);
      const system = 'JSON only\nReturn only JSON matching this schema:\n{"type":"object"}';
      const imageUrl = `data:image/jpeg;base64,${data.toString('base64')}`;
      if (provider === 'kimi') {
        expect(body.model).toBe(DEFAULT_BOARD_MODELS.kimi.model);
        expect(body.messages).toEqual([
          { role: 'system', content: system },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'diagram' },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ]);
      } else if (provider === 'grok') {
        expect(body.model).toBe(DEFAULT_BOARD_MODELS.grok.model);
        expect(body.input).toEqual([
          { role: 'system', content: system },
          {
            role: 'user',
            content: [
              { type: 'input_text', text: 'diagram' },
              { type: 'input_image', image_url: imageUrl },
            ],
          },
        ]);
      } else {
        expect(body.agent_config.model).toBe(DEFAULT_BOARD_MODELS.antigravity.model);
        expect(body.input).toEqual([
          { type: 'text', text: `${system}\n\ndiagram` },
          { type: 'image', data: data.toString('base64'), mime_type: 'image/jpeg' },
        ]);
      }
    },
  );

  it('rejects oversized requests and unsupported attachments before transport', async () => {
    const send = vi.fn<ProviderTransport>();
    const client = providerApiClient(
      'kimi',
      { ...DEFAULT_BOARD_MODELS.kimi, maxRequestCharacters: 16 },
      '{}',
      'fixture-secret',
      send,
      async () => {},
    );
    await expect(client.complete({ ...request, user: 'too much input' })).rejects.toThrow(
      'harness_request_limit',
    );
    await expect(
      client.complete(request, undefined, [
        { name: 'document.pdf', kind: 'pdf', data: Buffer.from('fixture') },
      ]),
    ).rejects.toThrow('provider_attachment');
    expect(send).not.toHaveBeenCalled();
  });

  it('never retries authentication failures and fails missing keys before I/O', async () => {
    const send = vi.fn<ProviderTransport>().mockRejectedValue(new HarnessError('provider_auth'));
    const client = providerApiClient(
      'grok',
      DEFAULT_BOARD_MODELS.grok,
      '{}',
      'fixture-secret',
      send,
      async () => {},
    );
    await expect(client.complete(request)).rejects.toThrow('provider_auth');
    expect(send).toHaveBeenCalledTimes(1);
    expect(() =>
      providerApiClient('kimi', DEFAULT_BOARD_MODELS.kimi, '{}', undefined, send, async () => {}),
    ).toThrow('provider_key');
    expect(send).toHaveBeenCalledTimes(1);
  });
});
