import { z } from 'zod';

const rate = z.number().finite().min(0).max(10000);
export const TokenRatesSchema = z
  .object({
    input: rate,
    output: rate,
    cacheRead: rate,
    cacheWrite: rate,
  })
  .strict();
export type TokenRates = z.infer<typeof TokenRatesSchema>;

export const CostProjectionSettingsSchema = z
  .object({
    price: z.enum(['gpt-6-luna', 'claude-haiku-4-5', 'custom']),
    customRates: TokenRatesSchema,
    requestsPerDay: z.number().int().min(0).max(100000),
    inputTokens: z.number().int().min(0).max(2000000),
    outputTokens: z.number().int().min(0).max(2000000),
    cacheReadTokens: z.number().int().min(0).max(2000000),
    cacheWriteTokens: z.number().int().min(0).max(2000000),
  })
  .strict();
export type CostProjectionSettings = z.infer<typeof CostProjectionSettingsSchema>;

/** Published standard/global API rates, USD per million tokens; never subscription billing. */
export const TOKEN_PRICES = {
  'gpt-6-luna': {
    label: 'GPT-6 Luna',
    rates: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
    source: 'https://developers.openai.com/api/docs/models/gpt-6-luna',
    checked: '2026-10-06',
    contextLimit: 1050000,
    outputLimit: 128000,
    longContextThreshold: 272000,
    longInputMultiplier: 2,
    longOutputMultiplier: 1.5,
  },
  'claude-haiku-4-5': {
    label: 'Claude Haiku 4.5',
    rates: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
    source: 'https://platform.claude.com/docs/en/models/haiku-4-5/overview',
    checked: '2026-10-06',
    contextLimit: 200000,
    outputLimit: 64000,
    longContextThreshold: Infinity,
    longInputMultiplier: 1,
    longOutputMultiplier: 1,
  },
} as const;

export const DEFAULT_COST_PROJECTION: CostProjectionSettings = {
  price: 'gpt-6-luna',
  customRates: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  requestsPerDay: 10,
  inputTokens: 10000,
  outputTokens: 2000,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

/** Token buckets are disjoint user assumptions, not inferred from missing provider usage. */
export function projectTokenCost(value: CostProjectionSettings) {
  const parsed = CostProjectionSettingsSchema.safeParse(value);
  if (!parsed.success)
    return { error: 'Enter valid, non-negative rates and whole-number token counts.' } as const;
  const settings = parsed.data;
  const preset = settings.price === 'custom' ? null : TOKEN_PRICES[settings.price];
  const rates = preset?.rates ?? settings.customRates;
  const input = settings.inputTokens + settings.cacheReadTokens + settings.cacheWriteTokens;
  if (
    preset &&
    (input + settings.outputTokens > preset.contextLimit ||
      settings.outputTokens > preset.outputLimit)
  )
    return {
      error: 'These token assumptions exceed the selected model’s context or output limit.',
    } as const;
  const longContext = preset !== null && input > preset.longContextThreshold;
  const inputMultiplier = longContext ? preset.longInputMultiplier : 1;
  const outputMultiplier = longContext ? preset.longOutputMultiplier : 1;
  const perRequest =
    ((settings.inputTokens * rates.input +
      settings.cacheReadTokens * rates.cacheRead +
      settings.cacheWriteTokens * rates.cacheWrite) *
      inputMultiplier +
      settings.outputTokens * rates.output * outputMultiplier) /
    1000000;
  const perDay = perRequest * settings.requestsPerDay;
  return { perRequest, perDay, perMonth: perDay * 30, longContext, rates } as const;
}
