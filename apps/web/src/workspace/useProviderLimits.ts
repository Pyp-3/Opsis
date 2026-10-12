import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LIMIT_PROVIDERS,
  ProviderLimitsResponseSchema,
  type LimitProvider,
  type ProviderLimitsResponse,
} from '@opsis/schema';
import { apiFetch as fetch } from '../app-url';

/** A report older than this is checked again while someone is about to use the provider. */
export const LIMITS_STALE_MS = 5 * 60_000;

export type ProviderLimitsEntry = ProviderLimitsResponse['providers'][number];

export const isLimitProvider = (agent: string): agent is LimitProvider =>
  (LIMIT_PROVIDERS as readonly string[]).includes(agent);

/**
 * The host's provider limits: the subscription windows its Claude and Codex CLI logins have used,
 * shared by everyone on the host. `active` is the provider about to be used; its report is
 * checked when missing or stale, and again every few minutes while the page is visible. The
 * host runs at most one check per provider a minute, however many people ask.
 */
export function useProviderLimits(active: LimitProvider | null) {
  const [entries, setEntries] = useState<ProviderLimitsEntry[]>([]);
  const [now, setNow] = useState(() => Date.now());
  // When this view last asked for each check, so a failing one is not retried every minute.
  const asked = useRef(new Map<LimitProvider, number>());

  const load = useCallback(async (refresh?: readonly LimitProvider[]) => {
    try {
      const response = await fetch(
        refresh ? '/v1/providers/limits/refresh' : '/v1/providers/limits',
        refresh
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ providers: refresh }),
            }
          : undefined,
      );
      if (!response.ok) return null;
      const parsed = ProviderLimitsResponseSchema.safeParse(await response.json());
      if (!parsed.success) return null;
      setEntries(parsed.data.providers);
      setNow(Date.now());
      return parsed.data.providers;
    } catch {
      // Limits are advice; a host that cannot answer leaves the composer as it was.
      return null;
    }
  }, []);

  const refresh = useCallback(
    (provider: LimitProvider) => {
      setEntries((current) =>
        current.map((entry) =>
          entry.provider === provider ? { ...entry, checking: true } : entry,
        ),
      );
      return load([provider]);
    },
    [load],
  );

  /** Checks the active provider when it has no report, or only an old one. */
  const checkIfStale = useCallback(
    async (provider: LimitProvider) => {
      const known = (await load())?.find((entry) => entry.provider === provider);
      const observed = known?.limits ? Date.parse(known.limits.observedAt) : 0;
      const lastAsked = asked.current.get(provider) ?? 0;
      if (
        known &&
        !known.checking &&
        Date.now() - observed > LIMITS_STALE_MS &&
        Date.now() - lastAsked > LIMITS_STALE_MS
      ) {
        asked.current.set(provider, Date.now());
        await load([provider]);
      }
    },
    [load],
  );

  useEffect(() => {
    if (!active) return;
    // Checked as soon as the provider is chosen, then every minute.
    const first = setTimeout(() => void checkIfStale(active), 0);
    const timer = setInterval(() => {
      setNow(Date.now());
      if (document.visibilityState === 'visible') void checkIfStale(active);
    }, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [active, checkIfStale]);

  /**
   * After a request: Claude reports its limits as it works, so the host already has them; Codex
   * does not, so its limits are checked again (the host still keeps to one check a minute).
   */
  const afterRequest = useCallback(
    (provider: string) => {
      if (!isLimitProvider(provider)) return;
      void (provider === 'codex' ? load([provider]) : load());
    },
    [load],
  );

  const entryOf = useCallback(
    (provider: string) => entries.find((entry) => entry.provider === provider) ?? null,
    [entries],
  );

  return { entryOf, refresh, afterRequest, now };
}
