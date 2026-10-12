import { isAbsolute } from 'node:path';
import type { HarnessConfig, HarnessProvider } from './types.js';
import { HarnessError } from './errors.js';

export const HARNESS_ENV = {
  provider: 'OPSIS_LLM_PROVIDER',
  model: 'OPSIS_LLM_MODEL',
  executable: 'OPSIS_HARNESS_BIN',
  timeoutMs: 'OPSIS_HARNESS_TIMEOUT_MS',
  access: 'OPSIS_LLM_ACCESS',
  fast: 'OPSIS_LLM_FAST',
} as const;

/** The longest one CLI run may take: ten minutes, for full-access agents that use tools. */
export const MAX_HARNESS_TIMEOUT_MS = 600_000;

const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/u;
const PROVIDERS = new Set<HarnessProvider>(['claude', 'codex', 'agy', 'kimi', 'grok']);

/** Reads and validates harness settings, returning null for non-harness providers. */
export function readHarnessConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): HarnessConfig | null {
  const rawProvider = env[HARNESS_ENV.provider]?.trim();
  if (!rawProvider?.startsWith('harness:')) return null;
  const provider = rawProvider.slice('harness:'.length) as HarnessProvider;
  const model = env[HARNESS_ENV.model]?.trim() ?? '';
  const effort = env.OPSIS_LLM_EFFORT?.trim() as HarnessConfig['effort'];
  if (effort && !['low', 'medium', 'high', 'xhigh', 'max'].includes(effort))
    throw new HarnessError('harness_config');
  const executable = env[HARNESS_ENV.executable]?.trim() ?? '';
  const timeoutText = env[HARNESS_ENV.timeoutMs]?.trim();
  const timeoutMs = timeoutText === undefined || timeoutText === '' ? 30_000 : Number(timeoutText);

  if (
    !PROVIDERS.has(provider) ||
    !MODEL_PATTERN.test(model) ||
    !isAbsolute(executable) ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > MAX_HARNESS_TIMEOUT_MS
  ) {
    throw new HarnessError('harness_config');
  }
  const budget = env.OPSIS_LLM_MAX_BUDGET_USD ? Number(env.OPSIS_LLM_MAX_BUDGET_USD) : undefined;
  if (
    budget !== undefined &&
    (provider !== 'claude' || !Number.isFinite(budget) || budget < 0.01 || budget > 100)
  )
    throw new HarnessError('harness_config');
  const access = env[HARNESS_ENV.access]?.trim();
  const fast = env[HARNESS_ENV.fast]?.trim() === '1';
  if (
    (access && access !== 'full' && access !== 'restricted') ||
    ((access === 'full' || fast) && provider !== 'claude' && provider !== 'codex')
  )
    throw new HarnessError('harness_config');
  return {
    provider,
    ...(access === 'full' ? { access: 'full' as const } : {}),
    ...(fast ? { fast: true } : {}),
    model,
    executable,
    timeoutMs,
    ...(effort ? { effort } : {}),
    ...(budget !== undefined ? { maxBudgetUSD: budget } : {}),
  };
}
