/** Stable failure codes safe to expose to pipeline diagnostics. */
export type HarnessErrorCode =
  | 'provider_busy'
  | 'provider_key'
  | 'provider_auth'
  | 'provider_quota'
  | 'provider_failed'
  | 'provider_attachment'
  | 'harness_request_limit'
  | 'harness_config'
  | 'harness_missing'
  | 'harness_timeout'
  | 'harness_cancelled'
  | 'harness_overflow'
  | 'harness_exit'
  | 'harness_malformed'
  | 'harness_schema';

const SAFE_MESSAGES: Record<HarnessErrorCode, string> = {
  provider_busy: 'Two API requests are already running on this instance. Wait for one to finish.',
  provider_key: 'Configure an API key in this instance’s Settings.',
  provider_auth: 'Provider authentication failed. Check this instance’s API key and model access.',
  provider_quota: 'Provider rate or usage limit reached.',
  provider_failed:
    'Provider request failed or stopped before completing. No automatic retry was made.',
  provider_attachment: 'This connection does not support this attachment type.',
  harness_request_limit: 'Request exceeds the configured character limit.',
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
