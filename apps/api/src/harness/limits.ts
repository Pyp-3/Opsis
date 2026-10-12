import {
  claudeLimitsFromUsageText,
  codexLimitsFromRateLimits,
  type LimitProvider,
  type ProviderLimits,
} from '@opsis/schema';

/**
 * The no-call limit check each CLI offers, shared by both hosts so they run the same command.
 *
 * Claude: the local `/usage` command, which reads the subscription's windows without a model
 * turn. The model ID is deliberately one the CLI does not recognise: if a future CLI stopped
 * handling `/usage` locally and sent it as a prompt, the CLI would refuse the unknown model
 * before any request, so the check can never spend usage. `TZ=UTC` fixes how resets read.
 *
 * Codex: `account/rateLimits/read` over the app-server's JSON-RPC stdio. The app-server exits
 * when its input ends, so the runner leaves stdin unclosed until the answer (`untilResponseId`).
 */
export type LimitCheck = {
  args: string[];
  stdin: string;
  environment: Record<string, string>;
  /** Stop the process once a stdout line is the JSON-RPC response with this ID. */
  untilResponseId: number | null;
  timeoutMs: number;
};

const CODEX_LIMITS_REQUEST = 2;
export const LIMIT_CHECK_MODEL = 'opsis-limit-check-no-model-call';

export function limitCheck(provider: LimitProvider): LimitCheck {
  if (provider === 'claude')
    return {
      args: [
        '--print',
        '--output-format',
        'json',
        '--model',
        LIMIT_CHECK_MODEL,
        '--safe-mode',
        '--restricted',
        '--tools',
        '',
        '--strict-mcp-config',
        '--permission-prompts',
        'none',
        '--no-session-persistence',
        '/usage',
      ],
      stdin: '',
      environment: { TZ: 'UTC' },
      untilResponseId: null,
      timeoutMs: 30_000,
    };
  return {
    args: ['app-server'],
    stdin: [
      { id: 1, method: 'initialize', params: { clientInfo: { name: 'opsis', version: '1' } } },
      { method: 'initialized' },
      { id: CODEX_LIMITS_REQUEST, method: 'account/rateLimits/read' },
    ]
      .map((message) => JSON.stringify(message) + '\n')
      .join(''),
    environment: {},
    untilResponseId: CODEX_LIMITS_REQUEST,
    timeoutMs: 30_000,
  };
}

/** Whether a stdout line is the JSON-RPC response a check waits for. */
export function isResponseLine(line: string, id: number): boolean {
  try {
    const value = JSON.parse(line) as { id?: unknown };
    return value !== null && typeof value === 'object' && value.id === id;
  } catch {
    return false;
  }
}

/** Reads a check's output; null when it reports no subscription windows or cannot be read. */
export function limitsFromCheckOutput(
  provider: LimitProvider,
  stdout: string,
  now: Date,
): ProviderLimits | null {
  if (provider === 'claude') {
    let envelope: { result?: unknown; is_error?: unknown; num_turns?: unknown };
    try {
      envelope = JSON.parse(stdout) as typeof envelope;
    } catch {
      return null;
    }
    // A model turn would mean the CLI did not run `/usage` itself; its text is not a report.
    if (envelope.is_error === true || envelope.num_turns !== 0) return null;
    return typeof envelope.result === 'string'
      ? claudeLimitsFromUsageText(envelope.result, now)
      : null;
  }
  for (const line of stdout.split(/\r?\n/u)) {
    if (!isResponseLine(line, CODEX_LIMITS_REQUEST)) continue;
    const response = JSON.parse(line) as { result?: unknown };
    return codexLimitsFromRateLimits(response.result, now);
  }
  return null;
}
