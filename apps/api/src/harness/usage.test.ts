import { describe, expect, it } from 'vitest';
import { progressReader } from './progress';
import { harnessArguments } from './arguments';
import { readHarnessConfig } from './config';
import { modelSettingsProblem } from '@opsis/schema';

describe('provider measurements and limits', () => {
  it('retains true zero, missing values and separate cache counters', () => {
    const read = progressReader('claude');
    expect(
      read(
        JSON.stringify({
          type: 'result',
          total_cost_usd: 0,
          usage: {
            input_tokens: 0,
            output_tokens: 12,
            cache_read_input_tokens: 80,
            cache_creation_input_tokens: 25,
          },
        }),
      ),
    ).toEqual([
      {
        type: 'usage',
        usage: {
          inputTokens: 0,
          outputTokens: 12,
          cachedInputTokens: 80,
          cacheWriteTokens: 25,
          estimatedCostUSD: 0,
        },
      },
    ]);
    expect(
      progressReader('codex')(
        JSON.stringify({
          type: 'turn.completed',
          usage: { input_tokens: 100, output_tokens: 20, cached_input_tokens: 75 },
        }),
      ),
    ).toEqual([
      {
        type: 'usage',
        usage: {
          inputTokens: 100,
          outputTokens: 20,
          cachedInputTokens: 75,
          cacheWriteTokens: null,
          estimatedCostUSD: null,
        },
      },
    ]);
    expect(read('{"type":"result","usage":{"input_tokens":-1,"output_tokens":"10"}}')).toEqual([
      {
        type: 'usage',
        usage: {
          inputTokens: null,
          outputTokens: null,
          cachedInputTokens: null,
          cacheWriteTokens: null,
          estimatedCostUSD: null,
        },
      },
    ]);
  });
  it('passes only supported budget flags and rejects incompatible effort before calling a provider', () => {
    const config = {
      provider: 'claude' as const,
      model: 'haiku',
      executable: '/tmp/cli',
      timeoutMs: 1000,
      maxBudgetUSD: 0.5,
    };
    expect(harnessArguments(config, '/tmp/schema')).toContain('--max-budget-usd');
    expect(harnessArguments({ ...config, provider: 'codex' }, '/tmp/schema')).not.toContain(
      '--max-budget-usd',
    );
    expect(modelSettingsProblem('codex', { model: 'gpt-5.5', effort: 'max' })).toContain('effort');
    expect(
      modelSettingsProblem('codex', { model: 'gpt-6-luna', effort: 'low', maxBudgetUSD: 1 }),
    ).toContain('budget');
    expect(() =>
      readHarnessConfig({
        OPSIS_LLM_PROVIDER: 'harness:claude',
        OPSIS_LLM_MODEL: 'haiku',
        OPSIS_HARNESS_BIN: '/tmp/cli',
        OPSIS_LLM_MAX_BUDGET_USD: '-1',
      }),
    ).toThrow();
  });
});
