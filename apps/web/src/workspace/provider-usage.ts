import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Provider mode: each board-generating agent tracks its own usage against a rolling
 * 5-hour window and a rolling 7-day (weekly) window. When an agent reaches a cap it is
 * disabled in the composer until the oldest counted generation rolls off its window.
 *
 * Everything here is local to this device: the API and board schema are untouched, which
 * matches "each agent handles their own" without a server round-trip. A cap of 0 means
 * "no limit", so enabling provider mode never blocks an agent until a real cap is set.
 */
export type ProviderAgent = 'claude' | 'codex';
export const PROVIDER_AGENTS: ProviderAgent[] = ['claude', 'codex'];

export const FIVE_HOURS = 5 * 60 * 60 * 1000;
export const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;

export type AgentCaps = { fiveHour: number; weekly: number };
export type ProviderSettings = {
  enabled: boolean;
  caps: Record<ProviderAgent, AgentCaps>;
};
type UsageEvents = Record<ProviderAgent, number[]>;

const SETTINGS_KEY = 'opsis:provider:v1';
const USAGE_KEY = 'opsis:provider-usage:v1';

const DEFAULT_SETTINGS: ProviderSettings = {
  enabled: false,
  caps: { claude: { fiveHour: 0, weekly: 0 }, codex: { fiveHour: 0, weekly: 0 } },
};

function cap(value: unknown): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 100_000) : 0;
}

function readSettings(): ProviderSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<ProviderSettings>;
    const caps = (agent: ProviderAgent): AgentCaps => ({
      fiveHour: cap(raw.caps?.[agent]?.fiveHour),
      weekly: cap(raw.caps?.[agent]?.weekly),
    });
    return {
      enabled: raw.enabled === true,
      caps: { claude: caps('claude'), codex: caps('codex') },
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

function readUsage(): UsageEvents {
  const empty: UsageEvents = { claude: [], codex: [] };
  try {
    const raw = JSON.parse(localStorage.getItem(USAGE_KEY) ?? '{}') as Partial<UsageEvents>;
    const list = (agent: ProviderAgent) =>
      (raw[agent] ?? []).filter((t): t is number => typeof t === 'number' && Number.isFinite(t));
    return { claude: list('claude'), codex: list('codex') };
  } catch {
    return empty;
  }
}

export type AgentStatus = {
  tracked: boolean;
  blocked: boolean;
  reason: string;
  used5h: number;
  used7d: number;
  cap5h: number;
  cap7d: number;
  /** When the current block lifts (oldest counted generation rolls off its window), or null. */
  resetsAt: number | null;
};

/** Humanises the wait until a window reset, e.g. "2h 14m" or "3d". */
export function untilLabel(resetsAt: number | null, now = Date.now()): string {
  if (!resetsAt) return '';
  const ms = Math.max(0, resetsAt - now);
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.round(hours / 24)}d`;
}

function statusFrom(
  settings: ProviderSettings,
  events: number[],
  agent: ProviderAgent,
  now: number,
): AgentStatus {
  const { fiveHour, weekly } = settings.caps[agent];
  const within = (windowMs: number) => events.filter((t) => now - t < windowMs);
  const in5h = within(FIVE_HOURS);
  const in7d = within(ONE_WEEK);
  const used5h = in5h.length;
  const used7d = in7d.length;
  const tracked = settings.enabled && (fiveHour > 0 || weekly > 0);
  let blocked = false;
  let reason = '';
  let resetsAt: number | null = null;
  if (settings.enabled && weekly > 0 && used7d >= weekly) {
    blocked = true;
    resetsAt = Math.min(...in7d) + ONE_WEEK;
    reason = 'Weekly cap reached';
  }
  if (settings.enabled && fiveHour > 0 && used5h >= fiveHour) {
    const fiveReset = Math.min(...in5h) + FIVE_HOURS;
    // Surface whichever limit frees up first.
    if (!blocked || fiveReset < (resetsAt ?? Infinity)) {
      resetsAt = fiveReset;
      reason = '5-hour cap reached';
    }
    blocked = true;
  }
  return { tracked, blocked, reason, used5h, used7d, cap5h: fiveHour, cap7d: weekly, resetsAt };
}

export function useProviderUsage() {
  const [settings, setSettingsState] = useState<ProviderSettings>(readSettings);
  const events = useRef<UsageEvents>(readUsage());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // Refresh counters and countdowns while a window rolls over.
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const persistSettings = (next: ProviderSettings) => {
    setSettingsState(next);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {
      // Remembering provider settings is a convenience only.
    }
  };
  const setEnabled = useCallback(
    (enabled: boolean) => persistSettings({ ...readSettings(), enabled }),
    [],
  );
  const setCaps = useCallback((agent: ProviderAgent, caps: AgentCaps) => {
    const base = readSettings();
    persistSettings({
      ...base,
      caps: { ...base.caps, [agent]: { fiveHour: cap(caps.fiveHour), weekly: cap(caps.weekly) } },
    });
  }, []);

  const record = useCallback((agent: ProviderAgent) => {
    const at = Date.now();
    const kept = [...events.current[agent].filter((t) => at - t < ONE_WEEK), at];
    events.current = { ...events.current, [agent]: kept };
    try {
      localStorage.setItem(USAGE_KEY, JSON.stringify(events.current));
    } catch {
      // Counting is best-effort if storage is unavailable.
    }
    setNow(at);
  }, []);

  const statusOf = useCallback(
    (agent: ProviderAgent): AgentStatus => statusFrom(settings, events.current[agent], agent, now),
    [settings, now],
  );

  return { settings, setEnabled, setCaps, record, statusOf };
}
