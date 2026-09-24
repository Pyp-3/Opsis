import { describe, expect, it } from 'vitest';
import { readLLMConfig } from './llm-client';
import { MockLLMClient } from './mock-llm-client';
import { stripFences, tryParseJson } from './json';
import { buildParseRequest } from './prompt';

describe('readLLMConfig', () => {
  it('returns null offline (no key or no model)', () => {
    expect(readLLMConfig({})).toBeNull();
    expect(readLLMConfig({ OPSIS_LLM_MODEL: 'some-model' })).toBeNull();
    expect(readLLMConfig({ OPSIS_LLM_API_KEY: 'k' })).toBeNull();
  });

  it('reads provider, model, key and base URL from env', () => {
    expect(
      readLLMConfig({
        OPSIS_LLM_PROVIDER: 'openai',
        OPSIS_LLM_MODEL: 'some-model',
        OPSIS_LLM_API_KEY: ' secret ',
        OPSIS_LLM_BASE_URL: 'http://localhost:9999',
      }),
    ).toEqual({
      provider: 'openai',
      model: 'some-model',
      apiKey: 'secret',
      baseUrl: 'http://localhost:9999',
    });
    expect(readLLMConfig({ OPSIS_LLM_MODEL: 'm', OPSIS_LLM_API_KEY: 'k' })?.provider).toBe(
      'anthropic',
    );
  });
});

describe('MockLLMClient', () => {
  it('replays scripted replies in order and records calls', async () => {
    const request = buildParseRequest('Birds fly.', 'teen');
    const client = new MockLLMClient(['one', (r) => r.promptId, new Error('boom')]);
    expect(client.model).toBe('mock-model');
    await expect(client.complete(request)).resolves.toBe('one');
    await expect(client.complete(request)).resolves.toBe('parse/v1');
    await expect(client.complete(request)).rejects.toThrow('boom');
    await expect(client.complete(request)).rejects.toThrow('no scripted reply left');
    expect(client.calls).toHaveLength(4);
  });
});

describe('stripFences / tryParseJson', () => {
  it.each([
    ['{"a":1}', '{"a":1}'],
    ['```json\n{"a":1}\n```', '{"a":1}'],
    ['```\n{"a":1}\n```', '{"a":1}'],
    ['Sure! Here it is: {"a":1} Hope that helps.', '{"a":1}'],
    ['  {"a":{"b":2}}  ', '{"a":{"b":2}}'],
  ])('%j → %j', (raw, expected) => {
    expect(stripFences(raw)).toBe(expected);
  });

  it('reports invalid JSON readably', () => {
    expect(tryParseJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    const result = tryParseJson('{a:1}');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/^Output is not valid JSON:/u);
  });
});
