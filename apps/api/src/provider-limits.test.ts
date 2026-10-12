import { describe, expect, it, vi } from 'vitest';
import type { ProviderLimits } from '@opsis/schema';
import { buildApp } from './app';
import { HarnessError } from './harness/errors';
import { LIMIT_CHECK_MODEL, limitCheck, limitsFromCheckOutput } from './harness/limits';
import {
  LIMIT_CHECK_INTERVAL_MS,
  LimitChecksOff,
  ProviderLimitsTracker,
  localLimitChecker,
  observingLimits,
} from './provider-limits';
import { signIn } from './test-session';
import type { BoardClientFactory } from './boards/client';
import type { HarnessProgress } from './harness/progress';

const now = new Date('2026-10-12T17:00:00Z');
const report = (provider: 'claude' | 'codex', used: number, source = 'check'): ProviderLimits => ({
  provider,
  status: 'allowed',
  windows: [
    {
      id: 'session',
      label: 'Session (5 hours)',
      models: null,
      usedPercent: used,
      resetsAt: '2026-10-12T21:30:00.000Z',
      windowMinutes: 300,
    },
  ],
  plan: null,
  observedAt: now.toISOString(),
  source: source as 'check',
});

describe('limit checks', () => {
  it('never lets the Claude check reach a model', () => {
    const claude = limitCheck('claude');
    expect(claude.args.at(-1)).toBe('/usage');
    expect(claude.args).toContain(LIMIT_CHECK_MODEL);
    expect(claude.args).toEqual(
      expect.arrayContaining(['--tools', '', '--no-session-persistence']),
    );
    expect(claude.environment).toEqual({ TZ: 'UTC' });
    const codex = limitCheck('codex');
    expect(codex.args).toEqual(['app-server']);
    expect(codex.untilResponseId).toBe(2);
    expect(
      codex.stdin
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line).method),
    ).toEqual(['initialize', 'initialized', 'account/rateLimits/read']);
  });

  it('reads only a local /usage answer as a report', () => {
    const answer = (fields: object) => JSON.stringify({ type: 'result', ...fields });
    const text = 'Current session: 7% used · resets Oct 12, 9:29pm (UTC)';
    expect(
      limitsFromCheckOutput('claude', answer({ num_turns: 0, result: text }), now)?.windows,
    ).toHaveLength(1);
    // A model turn means the CLI did not run the command itself.
    expect(limitsFromCheckOutput('claude', answer({ num_turns: 1, result: text }), now)).toBeNull();
    expect(
      limitsFromCheckOutput('claude', answer({ num_turns: 0, is_error: true, result: text }), now),
    ).toBeNull();
    expect(limitsFromCheckOutput('claude', 'not json', now)).toBeNull();
  });

  it('reads the Codex answer by its request ID', () => {
    const stdout = [
      '{"id":1,"result":{}}',
      '{"method":"configWarning","params":{}}',
      '{"id":2,"result":{"rateLimits":{"limitId":"codex","primary":{"usedPercent":28,"windowDurationMins":10080}},"ordinaryUsageAllowed":true}}',
    ].join('\n');
    expect(limitsFromCheckOutput('codex', stdout, now)).toMatchObject({
      provider: 'codex',
      windows: [{ id: 'codex:primary', usedPercent: 28 }],
    });
    expect(limitsFromCheckOutput('codex', '{"id":1,"result":{}}', now)).toBeNull();
  });

  it('is off when the host turns checks off', async () => {
    await expect(
      localLimitChecker(undefined, { OPSIS_LIMIT_CHECKS: 'off' })('claude'),
    ).rejects.toBeInstanceOf(LimitChecksOff);
  });
});

describe('the instance tracker', () => {
  it('checks each provider at most once per interval and shares a running check', async () => {
    let time = 0;
    let release!: () => void;
    const check = vi.fn(
      (provider: 'claude' | 'codex') =>
        new Promise<ProviderLimits>((resolve) => {
          release = () => resolve(report(provider, 10));
        }),
    );
    const tracker = new ProviderLimitsTracker(check, () => time);
    const first = tracker.refresh(['claude']);
    const second = tracker.refresh(['claude']);
    expect(tracker.snapshot().providers[0]).toMatchObject({ provider: 'claude', checking: true });
    release();
    await Promise.all([first, second]);
    await tracker.refresh(['claude']);
    expect(check).toHaveBeenCalledTimes(1);
    expect(tracker.snapshot().providers[0]).toMatchObject({ checking: false, problem: null });
    time += LIMIT_CHECK_INTERVAL_MS;
    const third = tracker.refresh(['claude']);
    release();
    await third;
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('explains failures without provider output, keeping the last report', async () => {
    let time = 0;
    const outcomes: (() => Promise<ProviderLimits | null>)[] = [
      async () => report('codex', 10),
      async () => {
        throw new HarnessError('harness_exit');
      },
      async () => {
        throw new HarnessError('harness_missing');
      },
      async () => null,
      async () => {
        throw new LimitChecksOff();
      },
    ];
    const tracker = new ProviderLimitsTracker(
      () => outcomes.shift()!(),
      () => time,
    );
    const next = async () => {
      time += LIMIT_CHECK_INTERVAL_MS;
      await tracker.refresh(['codex']);
      return tracker.snapshot().providers[1]!;
    };
    expect((await next()).problem).toBeNull();
    expect(await next()).toMatchObject({
      problem: /Check the CLI’s login/,
      limits: { provider: 'codex' },
    });
    expect((await next()).problem).toMatch(/not installed/);
    expect((await next()).problem).toMatch(/no subscription limits/);
    expect((await next()).problem).toMatch(/turned off/);
  });

  it('records what a request reports and counts it as fresh', async () => {
    const check = vi.fn(async () => report('claude', 10));
    const tracker = new ProviderLimitsTracker(check, () => 1000);
    const factory: BoardClientFactory = async () => ({
      model: 'haiku',
      complete: async (
        _request: unknown,
        _signal?: AbortSignal,
        _files?: unknown,
        progress?: (value: HarnessProgress) => void,
      ) => {
        progress?.({ type: 'limits', limits: report('claude', 64, 'request') });
        progress?.({ type: 'phase', phase: 'writing' });
        return '{}';
      },
    });
    const seen: string[] = [];
    const client = await observingLimits(factory, tracker)('claude');
    await client.complete(
      {
        promptId: 'board',
        system: '',
        user: '',
        responseFormat: 'json',
        temperature: 0,
        maxOutputTokens: 100,
      },
      undefined,
      [],
      (value) => seen.push(value.type),
    );
    expect(seen).toEqual(['limits', 'phase']);
    expect(tracker.snapshot().providers[0]!.limits?.windows[0]?.usedPercent).toBe(64);
    await tracker.refresh(['claude']);
    expect(check).not.toHaveBeenCalled();
  });
});

describe('limit routes', () => {
  it('serve members only and validate what to check', async () => {
    const check = vi.fn(async (provider: 'claude' | 'codex') => report(provider, 33));
    const app = buildApp({ databasePath: ':memory:', speech: null, limitChecker: check });
    try {
      expect((await app.inject('/v1/providers/limits')).statusCode).toBe(401);
      expect(
        (await app.inject({ method: 'POST', url: '/v1/providers/limits/refresh' })).statusCode,
      ).toBe(401);
      await signIn(app);
      expect((await app.inject('/v1/providers/limits')).json()).toEqual({
        providers: [
          { provider: 'claude', limits: null, problem: null, checking: false },
          { provider: 'codex', limits: null, problem: null, checking: false },
        ],
      });
      const bad = await app.inject({
        method: 'POST',
        url: '/v1/providers/limits/refresh',
        payload: { providers: ['grok'] },
      });
      expect(bad.statusCode).toBe(400);
      const checked = await app.inject({
        method: 'POST',
        url: '/v1/providers/limits/refresh',
        payload: { providers: ['codex'] },
      });
      expect(checked.json().providers[1].limits.windows[0].usedPercent).toBe(33);
      expect(check).toHaveBeenCalledWith('codex');
      expect(check).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });
});
