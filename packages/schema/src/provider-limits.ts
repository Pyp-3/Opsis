import { z } from 'zod';

/**
 * Provider limits: how much of a subscription's usage windows the host's own CLI logins have
 * used, as the providers themselves report it. They belong to the running instance (every
 * member account shares its CLI logins), so they are never account settings or board data.
 *
 * Two kinds of report feed them: a no-call check (Claude's local `/usage` command, Codex's
 * `account/rateLimits/read`) and the limit events Claude's CLI streams during real requests.
 * Percentages are the provider's own; nothing here estimates usage from token counts.
 */
export const LIMIT_PROVIDERS = ['claude', 'codex'] as const;
export const LimitProviderSchema = z.enum(LIMIT_PROVIDERS);
export type LimitProvider = z.infer<typeof LimitProviderSchema>;

/** At or above this share of a window, the next requests may be refused soon. */
export const LIMIT_WARNING_PERCENT = 80;

export const ProviderLimitWindowSchema = z
  .object({
    /** Stable within a provider: `session`, `week`, `week:sonnet`, `codex:primary`… */
    id: z.string().min(1).max(80),
    label: z.string().min(1).max(80),
    /** Which models the window counts; null means every model of the provider. */
    models: z.string().min(1).max(60).nullable(),
    usedPercent: z.number().finite().min(0).max(1000).nullable(),
    resetsAt: z.string().datetime().nullable(),
    windowMinutes: z.number().int().positive().max(1_000_000).nullable(),
  })
  .strict();
export type ProviderLimitWindow = z.infer<typeof ProviderLimitWindowSchema>;

export const ProviderLimitsSchema = z
  .object({
    provider: LimitProviderSchema,
    /** What the provider said about its own state when this was observed. */
    status: z.enum(['allowed', 'warning', 'limited', 'unknown']),
    windows: z.array(ProviderLimitWindowSchema).max(16),
    plan: z.string().min(1).max(40).nullable(),
    observedAt: z.string().datetime(),
    /** A full no-call check, or a partial report seen during a request. */
    source: z.enum(['check', 'request']),
  })
  .strict();
export type ProviderLimits = z.infer<typeof ProviderLimitsSchema>;

/** What `GET /v1/providers/limits` returns on both hosts. */
export const ProviderLimitsResponseSchema = z
  .object({
    providers: z.array(
      z
        .object({
          provider: LimitProviderSchema,
          limits: ProviderLimitsSchema.nullable(),
          /** Why the last check failed, in words for people; never provider output. */
          problem: z.string().max(200).nullable(),
          checking: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();
export type ProviderLimitsResponse = z.infer<typeof ProviderLimitsResponseSchema>;

type Json = Record<string, unknown>;
const record = (value: unknown): Json | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null;
const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const percent = (value: number | null): number | null =>
  value === null ? null : Math.min(1000, Math.max(0, Math.round(value * 10) / 10));
/** Unix seconds to an ISO time, refusing values that cannot be a real reset. */
const fromSeconds = (value: unknown): string | null => {
  const seconds = finite(value);
  if (seconds === null || seconds <= 0 || seconds > 32_503_680_000) return null;
  return new Date(Math.round(seconds) * 1000).toISOString();
};
const words = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

const CLAUDE_WINDOWS: Record<
  string,
  Pick<ProviderLimitWindow, 'id' | 'label' | 'models' | 'windowMinutes'>
> = {
  five_hour: { id: 'session', label: 'Session (5 hours)', models: null, windowMinutes: 300 },
  seven_day: { id: 'week', label: 'Week · all models', models: null, windowMinutes: 10080 },
  seven_day_opus: { id: 'week:opus', label: 'Week · Opus', models: 'opus', windowMinutes: 10080 },
  seven_day_sonnet: {
    id: 'week:sonnet',
    label: 'Week · Sonnet',
    models: 'sonnet',
    windowMinutes: 10080,
  },
};

const claudeStatus = (value: unknown): ProviderLimits['status'] =>
  value === 'allowed'
    ? 'allowed'
    : value === 'allowed_warning'
      ? 'warning'
      : value === 'rejected'
        ? 'limited'
        : 'unknown';

/**
 * Reads a `rate_limit_event` from Claude's stream. Its top level describes the window that
 * currently limits the session; `unifiedWindows`, when present, reports each window. Overage
 * buckets are left out: they are spending, not the subscription's windows.
 */
export function claudeLimitsFromEvent(event: unknown, now: Date): ProviderLimits | null {
  const outer = record(event);
  const info = record(outer?.rate_limit_info);
  if (outer?.type !== 'rate_limit_event' || !info) return null;
  const windows = new Map<string, ProviderLimitWindow>();
  const unified = record(info.unifiedWindows);
  for (const [key, shape] of Object.entries(CLAUDE_WINDOWS)) {
    const reported = record(unified?.[key]);
    if (!reported) continue;
    const used = finite(reported.utilization);
    windows.set(shape.id, {
      ...shape,
      usedPercent: percent(used === null ? null : used * 100),
      resetsAt: fromSeconds(reported.resetsAt),
    });
  }
  const type = typeof info.rateLimitType === 'string' ? CLAUDE_WINDOWS[info.rateLimitType] : null;
  if (type && !windows.has(type.id)) {
    const used = finite(info.utilization);
    windows.set(type.id, {
      ...type,
      usedPercent: percent(used === null ? null : used * 100),
      resetsAt: fromSeconds(info.resetsAt),
    });
  }
  // A refusal names the window that caused it: that window is full, whatever its rounded share.
  // One that counts only some models must not mark the others limited.
  let status = claudeStatus(info.status);
  if (status === 'limited' && type) {
    const window = windows.get(type.id)!;
    windows.set(type.id, { ...window, usedPercent: Math.max(window.usedPercent ?? 0, 100) });
    if (type.models !== null) status = 'warning';
  }
  return {
    provider: 'claude',
    status,
    windows: [...windows.values()],
    plan: null,
    observedAt: now.toISOString(),
    source: 'request',
  };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Reads a reset such as "Oct 17, 10:59am (UTC)" or "9:29pm (UTC)". The check runs the CLI with
 * `TZ=UTC`, so any other zone is refused rather than guessed. The year is the one that puts the
 * reset nearest after now; a time alone is today's, or tomorrow's once it has passed.
 */
export function claudeResetTime(text: string, now: Date): string | null {
  const match =
    /^(?:([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? )?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(UTC\)$/iu.exec(
      text.trim(),
    );
  if (!match) return null;
  const [, monthName, day, hourText, minuteText, meridiem] = match;
  if (Number(hourText) < 1 || Number(hourText) > 12) return null;
  const hour = (Number(hourText) % 12) + (meridiem!.toLowerCase() === 'pm' ? 12 : 0);
  const minute = Number(minuteText ?? 0);
  if (hour > 23 || minute > 59) return null;
  if (!monthName) {
    const at = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute);
    return new Date(at < now.getTime() - 60_000 ? at + 86_400_000 : at).toISOString();
  }
  const month = MONTHS.indexOf(monthName.toLowerCase());
  if (month < 0 || Number(day) < 1 || Number(day) > 31) return null;
  const candidates = [now.getUTCFullYear(), now.getUTCFullYear() + 1].map((year) =>
    Date.UTC(year, month, Number(day), hour, minute),
  );
  // A reset just past (the check and the window turning over together) still reads as this year.
  const at = candidates.find((value) => value >= now.getTime() - 86_400_000) ?? candidates[1]!;
  return new Date(at).toISOString();
}

/**
 * Reads the text of Claude's local `/usage` command: "Current session: 7% used · resets …" and
 * one "Current week (…)" line per weekly window. Returns null when no window is recognised,
 * for example when an API key rather than a subscription powers the CLI.
 */
export function claudeLimitsFromUsageText(text: string, now: Date): ProviderLimits | null {
  const windows: ProviderLimitWindow[] = [];
  for (const line of text.split(/\r?\n/u)) {
    const match =
      /^\s*Current (session|week \(([^)]{1,40})\)):\s*(\d{1,4}(?:\.\d+)?)% used(?:\s*·\s*resets\s+(.+?))?\s*$/u.exec(
        line,
      );
    if (!match) continue;
    const [, kind, scope, used, reset] = match;
    const scopeName = scope?.replace(/\s+only$/iu, '').trim() ?? '';
    const all = !scope || /^all models$/iu.test(scopeName);
    const shape =
      kind === 'session'
        ? CLAUDE_WINDOWS.five_hour!
        : all
          ? CLAUDE_WINDOWS.seven_day!
          : {
              id: `week:${scopeName.toLowerCase().replace(/[^a-z0-9.]+/gu, '-')}`.slice(0, 80),
              label: `Week · ${scopeName}`.slice(0, 80),
              models: scopeName.toLowerCase().slice(0, 60),
              windowMinutes: 10080,
            };
    if (windows.some((window) => window.id === shape.id) || windows.length >= 16) continue;
    windows.push({
      ...shape,
      usedPercent: percent(Number(used)),
      resetsAt: reset ? claudeResetTime(reset, now) : null,
    });
  }
  if (!windows.length) return null;
  const { full, near } = overall(windows);
  return {
    provider: 'claude',
    status: full ? 'limited' : near ? 'warning' : 'allowed',
    windows,
    plan: null,
    observedAt: now.toISOString(),
    source: 'check',
  };
}

/** The provider-wide state counts only windows for every model; model windows apply per model. */
function overall(windows: readonly ProviderLimitWindow[]) {
  const shared = windows.filter((window) => window.models === null);
  return {
    full: shared.some((window) => (window.usedPercent ?? 0) >= 100),
    near: shared.some((window) => (window.usedPercent ?? 0) >= LIMIT_WARNING_PERCENT),
  };
}

const durationLabel = (minutes: number | null) =>
  minutes === null
    ? 'Window'
    : minutes === 10080
      ? 'Week'
      : minutes % 1440 === 0
        ? `${minutes / 1440} days`
        : minutes % 60 === 0
          ? `${minutes / 60} hours`
          : `${minutes} minutes`;

/**
 * Reads the result of Codex's app-server `account/rateLimits/read`. Each limit has a primary
 * and an optional secondary window; limits other than the main `codex` one count only a
 * particular model, named by `normalModelSlug` (or, failing that, its `limitName`).
 */
export function codexLimitsFromRateLimits(result: unknown, now: Date): ProviderLimits | null {
  const root = record(result);
  const main = record(root?.rateLimits);
  if (!root || !main) return null;
  const byId = record(root.rateLimitsByLimitId) ?? {};
  const limits: Json[] = [
    main,
    ...Object.values(byId).flatMap((value): Json[] => {
      const entry = record(value);
      return entry ? [entry] : [];
    }),
  ];
  const seen = new Set<string>();
  const windows: ProviderLimitWindow[] = [];
  let reached = root.ordinaryUsageAllowed === false;
  for (const limit of limits) {
    const limitId = words(limit.limitId, 40) ?? 'codex';
    if (seen.has(limitId)) continue;
    seen.add(limitId);
    const model = limitId === 'codex' ? null : words(limit.normalModelSlug ?? limit.limitName, 60);
    if (limitId !== 'codex' && !model) continue;
    if (limit.rateLimitReachedType != null || limit.spendControlReached === true)
      reached ||= limitId === 'codex';
    for (const key of ['primary', 'secondary'] as const) {
      const window = record(limit[key]);
      if (!window || windows.length >= 16) continue;
      const minutes = finite(window.windowDurationMins);
      const span = minutes !== null && minutes > 0 ? Math.round(minutes) : null;
      windows.push({
        id: `${limitId}:${key}`.slice(0, 80),
        label: `${durationLabel(span)}${model ? ` · ${words(limit.limitName, 30) ?? model}` : ''}`,
        models: model ? model.toLowerCase() : null,
        usedPercent: percent(finite(window.usedPercent)),
        resetsAt: fromSeconds(window.resetsAt),
        windowMinutes: span,
      });
    }
  }
  const { full, near } = overall(windows);
  return {
    provider: 'codex',
    status: reached || full ? 'limited' : near ? 'warning' : 'allowed',
    windows,
    plan: words(main.planType, 40),
    observedAt: now.toISOString(),
    source: 'check',
  };
}

/**
 * Combines a new report with what was known. A full check replaces everything; a request's
 * report only updates the windows it names, keeping the others (and the plan) as they were.
 */
export function mergeProviderLimits(
  previous: ProviderLimits | null,
  next: ProviderLimits,
): ProviderLimits {
  if (!previous || previous.provider !== next.provider || next.source === 'check') return next;
  const named = new Set(next.windows.map((window) => window.id));
  return {
    ...next,
    windows: [...next.windows, ...previous.windows.filter((window) => !named.has(window.id))].slice(
      0,
      16,
    ),
    plan: next.plan ?? previous.plan,
  };
}

/** Whether a window counts the given model: every model, or one whose ID names its family. */
export function windowAppliesTo(window: ProviderLimitWindow, model: string): boolean {
  if (window.models === null) return true;
  const family = window.models.toLowerCase();
  const id = model.toLowerCase();
  return id === family || id.includes(family) || family.includes(id);
}

export type LimitStanding = {
  /** `unknown` until a report arrives; `limited` means the next request is expected to fail. */
  state: 'ok' | 'warning' | 'limited' | 'unknown';
  /** The window that decides the state, or the fullest one that applies. */
  window: ProviderLimitWindow | null;
  /** When the deciding window resets, if known. */
  resetsAt: string | null;
};

/**
 * How a model stands against its provider's windows now. A window whose reset has passed no
 * longer counts until the next report. A "limited" report with no window still in effect is
 * trusted only until the window it named resets; with none named it stays limited until the
 * next report.
 */
export function limitStanding(
  limits: ProviderLimits | null,
  model: string,
  now: Date,
): LimitStanding {
  if (!limits) return { state: 'unknown', window: null, resetsAt: null };
  const current = limits.windows.filter(
    (window) =>
      windowAppliesTo(window, model) &&
      (window.resetsAt === null || Date.parse(window.resetsAt) > now.getTime()),
  );
  const fullest = [...current].sort((a, b) => (b.usedPercent ?? -1) - (a.usedPercent ?? -1))[0];
  const full = current
    .filter((window) => (window.usedPercent ?? 0) >= 100)
    .sort((a, b) => Date.parse(b.resetsAt ?? '') - Date.parse(a.resetsAt ?? ''))[0];
  if (full) return { state: 'limited', window: full, resetsAt: full.resetsAt };
  const everyWindowPassed =
    limits.windows.length > 0 &&
    limits.windows.every(
      (window) => window.resetsAt !== null && Date.parse(window.resetsAt) <= now.getTime(),
    );
  if (limits.status === 'limited' && !everyWindowPassed)
    return { state: 'limited', window: fullest ?? null, resetsAt: fullest?.resetsAt ?? null };
  if (!fullest)
    return { state: limits.windows.length ? 'ok' : 'unknown', window: null, resetsAt: null };
  return {
    state: (fullest.usedPercent ?? 0) >= LIMIT_WARNING_PERCENT ? 'warning' : 'ok',
    window: fullest,
    resetsAt: fullest.resetsAt,
  };
}
