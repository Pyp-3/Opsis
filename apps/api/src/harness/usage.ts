import type { ReportedUsage } from '@opsis/schema';
import type { HarnessProvider } from './types';

const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

/** Only completed provider envelopes are measurements, never streamed text/token estimates. */
export function reportedUsage(
  provider: HarnessProvider,
  event: Record<string, unknown>,
): ReportedUsage | null {
  if (
    (provider === 'codex' && event.type !== 'turn.completed') ||
    (provider === 'claude' && event.type !== 'result') ||
    provider === 'agy'
  )
    return null;
  const usage =
    event.usage && typeof event.usage === 'object' && !Array.isArray(event.usage)
      ? (event.usage as Record<string, unknown>)
      : {};
  const cost = event.total_cost_usd;
  return {
    inputTokens: count(usage.input_tokens),
    outputTokens: count(usage.output_tokens),
    cachedInputTokens: count(
      provider === 'codex' ? usage.cached_input_tokens : usage.cache_read_input_tokens,
    ),
    cacheWriteTokens: count(usage.cache_creation_input_tokens),
    estimatedCostUSD: typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : null,
  };
}
