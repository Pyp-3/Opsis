import { describe, expect, it } from 'vitest';
import {
  claudeLimitsFromEvent,
  claudeLimitsFromUsageText,
  claudeResetTime,
  codexLimitsFromRateLimits,
  limitStanding,
  mergeProviderLimits,
  ProviderLimitsSchema,
} from './provider-limits';

const now = new Date('2026-10-12T17:00:00Z');

const USAGE = `You are currently using your subscription to power your Claude Code usage

Current session: 11% used · resets Oct 12, 9:30pm (UTC)
Current week (all models): 41% used · resets Oct 17, 11am (UTC)
Current week (Sonnet only): 92% used · resets Oct 17, 10:59am (UTC)

What's contributing to your limits usage?
Last 24h · 116 requests · 2 sessions
  34% of your usage was at >150k context`;

describe('Claude /usage text', () => {
  it('reads each window with its UTC reset', () => {
    const limits = claudeLimitsFromUsageText(USAGE, now)!;
    expect(ProviderLimitsSchema.parse(limits)).toEqual(limits);
    // The Sonnet window is near its end, but only Sonnet requests count against it.
    expect(limits.status).toBe('allowed');
    expect(limits.source).toBe('check');
    expect(limits.windows).toEqual([
      {
        id: 'session',
        label: 'Session (5 hours)',
        models: null,
        usedPercent: 11,
        resetsAt: '2026-10-12T21:30:00.000Z',
        windowMinutes: 300,
      },
      {
        id: 'week',
        label: 'Week · all models',
        models: null,
        usedPercent: 41,
        resetsAt: '2026-10-17T11:00:00.000Z',
        windowMinutes: 10080,
      },
      {
        id: 'week:sonnet',
        label: 'Week · Sonnet',
        models: 'sonnet',
        usedPercent: 92,
        resetsAt: '2026-10-17T10:59:00.000Z',
        windowMinutes: 10080,
      },
    ]);
  });

  it('ignores contributor percentages and text without windows', () => {
    expect(claudeLimitsFromUsageText('34% of your usage was at >150k context', now)).toBeNull();
    expect(claudeLimitsFromUsageText('Using an API key; no subscription limits.', now)).toBeNull();
  });

  it('marks a full window as limited', () => {
    const limits = claudeLimitsFromUsageText(
      'Current session: 100% used · resets 9:30pm (UTC)',
      now,
    )!;
    expect(limits.status).toBe('limited');
    expect(limits.windows[0]!.resetsAt).toBe('2026-10-12T21:30:00.000Z');
  });

  it('reads reset times across midnight and the new year, and refuses other zones', () => {
    expect(claudeResetTime('3am (UTC)', now)).toBe('2026-10-13T03:00:00.000Z');
    expect(claudeResetTime('12:15am (UTC)', now)).toBe('2026-10-13T00:15:00.000Z');
    expect(claudeResetTime('Jan 2, 1pm (UTC)', now)).toBe('2027-01-02T13:00:00.000Z');
    expect(claudeResetTime('Oct 12, 4:59pm (UTC)', now)).toBe('2026-10-12T16:59:00.000Z');
    expect(claudeResetTime('Oct 17, 2pm (Africa/Nairobi)', now)).toBeNull();
    expect(claudeResetTime('13pm (UTC)', now)).toBeNull();
  });
});

describe('Claude rate-limit events', () => {
  it('reads every unified window and the provider status', () => {
    const limits = claudeLimitsFromEvent(
      {
        type: 'rate_limit_event',
        rate_limit_info: {
          status: 'allowed_warning',
          rateLimitType: 'seven_day',
          utilization: 0.83,
          resetsAt: 1792231200,
          unifiedWindows: {
            five_hour: { utilization: 0.2, resetsAt: 1791838800 },
            seven_day: { utilization: 0.834, resetsAt: 1792231200 },
            seven_day_overage_included: { utilization: 0.1, resetsAt: 1792231200 },
          },
        },
      },
      now,
    )!;
    expect(limits.status).toBe('warning');
    expect(limits.source).toBe('request');
    expect(limits.windows.map(({ id, usedPercent }) => [id, usedPercent])).toEqual([
      ['session', 20],
      ['week', 83.4],
    ]);
  });

  it('treats a refused model window as full without limiting every model', () => {
    const limits = claudeLimitsFromEvent(
      {
        type: 'rate_limit_event',
        rate_limit_info: {
          status: 'rejected',
          rateLimitType: 'seven_day_opus',
          resetsAt: 1792231200,
        },
      },
      now,
    )!;
    expect(limits.status).toBe('warning');
    expect(limits.windows).toMatchObject([{ id: 'week:opus', usedPercent: 100 }]);
    expect(limitStanding(limits, 'claude-opus-5-5', now).state).toBe('limited');
    expect(limitStanding(limits, 'claude-sonnet-5-5', now).state).toBe('ok');
  });

  it('ignores other events and malformed reports', () => {
    expect(claudeLimitsFromEvent({ type: 'result' }, now)).toBeNull();
    expect(claudeLimitsFromEvent({ type: 'rate_limit_event' }, now)).toBeNull();
    const odd = claudeLimitsFromEvent(
      { type: 'rate_limit_event', rate_limit_info: { status: 'surprise', resetsAt: -4 } },
      now,
    )!;
    expect(odd).toMatchObject({ status: 'unknown', windows: [] });
  });
});

describe('Codex rate limits', () => {
  const result = {
    ordinaryUsageAllowed: true,
    rateLimits: {
      limitId: 'codex',
      primary: { usedPercent: 28, windowDurationMins: 10080, resetsAt: 1792295860 },
      secondary: null,
      planType: 'prolite',
      rateLimitReachedType: null,
    },
    rateLimitsByLimitId: {
      codex: { limitId: 'codex', primary: { usedPercent: 28, windowDurationMins: 10080 } },
      codex_sol: {
        limitId: 'codex_sol',
        limitName: 'GPT-6.1 Sol',
        normalModelSlug: 'gpt-6.1-sol',
        primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 1791838800 },
      },
    },
  };

  it('reads the main and per-model windows and the plan', () => {
    const limits = codexLimitsFromRateLimits(result, now)!;
    expect(ProviderLimitsSchema.parse(limits)).toEqual(limits);
    expect(limits).toMatchObject({ provider: 'codex', status: 'allowed', plan: 'prolite' });
    expect(limits.windows).toEqual([
      {
        id: 'codex:primary',
        label: 'Week',
        models: null,
        usedPercent: 28,
        resetsAt: '2026-10-18T03:57:40.000Z',
        windowMinutes: 10080,
      },
      {
        id: 'codex_sol:primary',
        label: '5 hours · GPT-6.1 Sol',
        models: 'gpt-6.1-sol',
        usedPercent: 100,
        resetsAt: '2026-10-12T21:00:00.000Z',
        windowMinutes: 300,
      },
    ]);
    expect(limitStanding(limits, 'gpt-6.1-sol', now)).toMatchObject({
      state: 'limited',
      resetsAt: '2026-10-12T21:00:00.000Z',
    });
    expect(limitStanding(limits, 'gpt-6-luna', now)).toMatchObject({ state: 'ok' });
  });

  it('is limited when ordinary usage is refused', () => {
    const limits = codexLimitsFromRateLimits({ ...result, ordinaryUsageAllowed: false }, now)!;
    expect(limits.status).toBe('limited');
    expect(limitStanding(limits, 'gpt-6-luna', now).state).toBe('limited');
  });

  it('returns null without rate limits', () => {
    expect(codexLimitsFromRateLimits({}, now)).toBeNull();
    expect(codexLimitsFromRateLimits(null, now)).toBeNull();
  });
});

describe('merging and standing', () => {
  const check = claudeLimitsFromUsageText(USAGE, now)!;

  it('lets a request update only the windows it reports', () => {
    const request = claudeLimitsFromEvent(
      {
        type: 'rate_limit_event',
        rate_limit_info: {
          status: 'allowed',
          unifiedWindows: { five_hour: { utilization: 0.5, resetsAt: 1791838800 } },
        },
      },
      now,
    )!;
    const merged = mergeProviderLimits(check, request);
    expect(merged.windows.map(({ id, usedPercent }) => [id, usedPercent])).toEqual([
      ['session', 50],
      ['week', 41],
      ['week:sonnet', 92],
    ]);
    expect(mergeProviderLimits(merged, check)).toBe(check);
  });

  it('applies model windows only to their models and forgets windows that have reset', () => {
    expect(limitStanding(check, 'claude-sonnet-5-5', now)).toMatchObject({
      state: 'warning',
      window: { id: 'week:sonnet' },
    });
    expect(limitStanding(check, 'opus', now)).toMatchObject({
      state: 'ok',
      window: { id: 'week' },
    });
    const later = new Date('2026-10-18T00:00:00Z');
    expect(limitStanding(check, 'opus', later)).toMatchObject({ state: 'ok', window: null });
    expect(limitStanding(null, 'opus', now).state).toBe('unknown');
  });

  it('trusts a limited report until every window it knows has reset', () => {
    const limited = { ...check, status: 'limited' as const };
    expect(limitStanding(limited, 'opus', now).state).toBe('limited');
    expect(limitStanding(limited, 'opus', new Date('2026-10-18T00:00:00Z')).state).toBe('ok');
  });
});
