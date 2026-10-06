import { describe, expect, it } from 'vitest';
import { DEFAULT_COST_PROJECTION, projectTokenCost } from './cost-projection';

describe('API-rate cost projections', () => {
  it('prices disjoint token buckets and scales explicit request volume', () => {
    const result = projectTokenCost({
      ...DEFAULT_COST_PROJECTION,
      price: 'custom',
      customRates: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
      inputTokens: 1000,
      outputTokens: 1000,
      cacheReadTokens: 1000,
      cacheWriteTokens: 1000,
      requestsPerDay: 20,
    });
    expect(result).toMatchObject({ perRequest: 0.00735, perDay: 0.147, perMonth: 4.41 });
  });
  it('applies long-context pricing to the whole request only above the threshold', () => {
    const base = { ...DEFAULT_COST_PROJECTION, inputTokens: 272000, outputTokens: 1000 };
    expect(projectTokenCost(base)).toMatchObject({ longContext: false, perRequest: 0.0277 });
    const long = projectTokenCost({ ...base, cacheReadTokens: 1 });
    expect(long).toMatchObject({ longContext: true });
    if ('perRequest' in long) expect(long.perRequest).toBeCloseTo(0.05515002);
  });
  it('rejects invalid assumptions and impossible known-model requests instead of inventing totals', () => {
    expect(projectTokenCost({ ...DEFAULT_COST_PROJECTION, requestsPerDay: NaN })).toHaveProperty(
      'error',
    );
    expect(
      projectTokenCost({
        ...DEFAULT_COST_PROJECTION,
        price: 'claude-haiku-4-5',
        inputTokens: 200000,
      }),
    ).toHaveProperty('error');
    expect(projectTokenCost({ ...DEFAULT_COST_PROJECTION, requestsPerDay: 0 })).toMatchObject({
      perDay: 0,
      perMonth: 0,
    });
  });
});
