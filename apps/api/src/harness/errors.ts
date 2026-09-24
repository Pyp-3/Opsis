/** Stable failure codes safe to expose to pipeline diagnostics. */
export type HarnessErrorCode =
  | 'harness_config'
  | 'harness_missing'
  | 'harness_timeout'
  | 'harness_cancelled'
  | 'harness_overflow'
  | 'harness_exit'
  | 'harness_malformed'
  | 'harness_schema';

const SAFE_MESSAGES: Record<HarnessErrorCode, string> = {
  harness_config: 'Harness configuration is invalid.',
  harness_missing: 'Harness executable is unavailable.',
  harness_timeout: 'Harness request timed out.',
  harness_cancelled: 'Harness request was cancelled.',
  harness_overflow: 'Harness output exceeded a safety limit.',
  harness_exit: 'Harness process failed.',
  harness_malformed: 'Harness returned malformed output.',
  harness_schema: 'Harness result did not match the JSON response contract.',
};

/** An intentionally redacted harness error: no argv, paths, prompts, stdout or stderr. */
export class HarnessError extends Error {
  constructor(readonly code: HarnessErrorCode) {
    super(`${code}: ${SAFE_MESSAGES[code]}`);
    this.name = 'HarnessError';
  }
}
