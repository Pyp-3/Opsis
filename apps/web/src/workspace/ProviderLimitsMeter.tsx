import { useEffect, useId, useRef, useState } from 'react';
import { Gauge, LoaderCircle, RefreshCw } from 'lucide-react';
import {
  LIMIT_WARNING_PERCENT,
  PROVIDER_LABELS,
  limitStanding,
  windowAppliesTo,
  type LimitProvider,
  type ProviderLimitWindow,
} from '@opsis/schema';
import { untilLabel } from './provider-usage';
import type { ProviderLimitsEntry } from './useProviderLimits';

const shortLabel = (window: ProviderLimitWindow) =>
  window.windowMinutes === 300 && window.models === null
    ? '5h'
    : window.windowMinutes === 10080
      ? window.models === null
        ? 'Week'
        : `${window.label.replace(/^Week · /u, '')} week`
      : window.label;

const resetText = (resetsAt: string | null, now: number) => {
  if (!resetsAt) return 'reset time not reported';
  const at = Date.parse(resetsAt);
  if (at <= now) return 'has reset; check again for the new window';
  const when = new Intl.DateTimeFormat(undefined, {
    weekday: at - now > 86_400_000 ? 'short' : undefined,
    hour: 'numeric',
    minute: '2-digit',
  }).format(at);
  return `resets ${when} (in ${untilLabel(at, now)})`;
};

const agoText = (iso: string, now: number) => {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  return minutes < 1
    ? 'just now'
    : minutes < 60
      ? `${minutes} min ago`
      : `${untilLabel(now + (now - Date.parse(iso)), now)} ago`;
};

/**
 * The provider's own report of its subscription windows for the host's CLI login, beside the
 * composer: how much of each window is used and when it resets, for the chosen model. Advice
 * only; the provider decides whether a request is accepted.
 */
export function ProviderLimitsMeter({
  provider,
  model,
  entry,
  now,
  onCheck,
}: {
  provider: LimitProvider;
  model: string;
  entry: ProviderLimitsEntry | null;
  now: number;
  onCheck: () => void;
}) {
  const [open, setOpen] = useState(false);
  // The panel opens towards whichever side of the pill has room for it.
  const [alignEnd, setAlignEnd] = useState(false);
  const panel = useId();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === 'Escape'
          : !root.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const limits = entry?.limits ?? null;
  const standing = limitStanding(limits, model, new Date(now));
  const current = (limits?.windows ?? []).filter(
    (window) =>
      windowAppliesTo(window, model) &&
      (window.resetsAt === null || Date.parse(window.resetsAt) > now),
  );
  const summary =
    standing.state === 'limited'
      ? `Limit reached${standing.resetsAt ? ` · resets in ${untilLabel(Date.parse(standing.resetsAt), now)}` : ''}`
      : current.length
        ? current
            .slice(0, 2)
            .map((window) => `${shortLabel(window)} ${Math.round(window.usedPercent ?? 0)}%`)
            .join(' · ')
        : entry?.checking
          ? 'Checking limits…'
          : entry?.problem
            ? 'Limits unavailable'
            : 'Limits';
  const name = PROVIDER_LABELS[provider];
  return (
    <div className="limits-meter" ref={root}>
      <button
        type="button"
        className={`limits-pill is-${standing.state}`}
        aria-expanded={open}
        aria-controls={panel}
        aria-label={`${name} limits: ${summary}`}
        title={`${name} usage limits on this host`}
        onClick={() => {
          const box = root.current?.getBoundingClientRect();
          setAlignEnd(!!box && box.left + 356 > window.innerWidth);
          setOpen(!open);
        }}
      >
        {entry?.checking && !current.length ? (
          <LoaderCircle className="spin" size={12} aria-hidden />
        ) : (
          <Gauge size={12} aria-hidden />
        )}
        <span>{summary}</span>
      </button>
      {open && (
        <section
          id={panel}
          className={`limits-panel ${alignEnd ? 'is-end' : ''}`}
          aria-label={`${name} limits`}
        >
          <header>
            <strong>{name} limits</strong>
            {limits?.plan && <span className="limits-plan">{limits.plan} plan</span>}
          </header>
          <p className="limits-note">
            Reported by {name} for this host’s CLI login, which everyone here shares. For{' '}
            <code>{model || 'the chosen model'}</code>.
          </p>
          {standing.state === 'limited' && (
            <p className="limits-alert" role="status">
              {name} reports this window is used up. Requests will likely be refused until it
              resets; choose another model or provider meanwhile.
            </p>
          )}
          {limits?.windows.length ? (
            <ul className="limits-windows">
              {limits.windows.map((window) => {
                const used = window.usedPercent;
                const applies = windowAppliesTo(window, model);
                const reset = window.resetsAt !== null && Date.parse(window.resetsAt) <= now;
                const level =
                  used === null || reset
                    ? 'unknown'
                    : used >= 100
                      ? 'limited'
                      : used >= LIMIT_WARNING_PERCENT
                        ? 'warning'
                        : 'ok';
                return (
                  <li key={window.id} className={applies ? undefined : 'is-other-model'}>
                    <div className="limits-window-head">
                      <span>{window.label}</span>
                      <span>{used === null || reset ? '—' : `${Math.round(used)}% used`}</span>
                    </div>
                    <div className={`limits-bar is-${level}`} aria-hidden>
                      <span style={{ width: `${Math.min(100, reset ? 0 : (used ?? 0))}%` }} />
                    </div>
                    <small>
                      {resetText(window.resetsAt, now)}
                      {!applies && ' · not counted for this model'}
                    </small>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="limits-note">
              {entry?.problem ?? (entry?.checking ? 'Checking…' : 'No report yet.')}
            </p>
          )}
          <footer>
            <span>
              {limits
                ? `${limits.source === 'check' ? 'Checked' : 'Reported during a request'} ${agoText(limits.observedAt, now)}`
                : ''}
              {limits && entry?.problem ? ` · last check failed: ${entry.problem}` : ''}
            </span>
            <button type="button" disabled={entry?.checking} onClick={onCheck}>
              <RefreshCw size={12} aria-hidden className={entry?.checking ? 'spin' : undefined} />
              Check now
            </button>
          </footer>
        </section>
      )}
    </div>
  );
}
