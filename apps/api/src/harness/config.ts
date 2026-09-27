import { isAbsolute } from 'node:path';
import type { HarnessConfig, HarnessProvider } from './types.js';
import { HarnessError } from './errors.js';

export const HARNESS_ENV = {
  provider: 'OPSIS_LLM_PROVIDER',
  model: 'OPSIS_LLM_MODEL',
  executable: 'OPSIS_HARNESS_BIN',
  timeoutMs: 'OPSIS_HARNESS_TIMEOUT_MS',
} as const;

const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/u;
const PROVIDERS = new Set<HarnessProvider>(['claude', 'codex', 'agy']);

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
    timeoutMs > 300_000
  ) {
    throw new HarnessError('harness_config');
  }
  return { provider, model, executable, timeoutMs, ...(effort ? { effort } : {}) };
}
