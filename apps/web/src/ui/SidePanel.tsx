import type { Explanation, PositionedNode } from '@opsis/schema';
import { t, type MessageKey } from '@opsis/ui';
import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import type { NodeInfo } from '../scene/model';
import { useSession } from '../state/context';
import { currentOsg, explanationKey, type ExplanationEntry, type Level } from '../state/session';

const NOTE_TITLES: Record<string, MessageKey> = {
  misconception: 'note.misconception',
  nuance: 'note.nuance',
  safety: 'note.safety',
  ambiguity: 'note.ambiguity',
};

const SECTIONS = ['whatItIs', 'whyItMattersHere', 'howItWorks', 'funFact'] as const;

/** Visible "unsure" marker for low-confidence content (PROMPT.md §12.1). */
function Unsure() {
  return (
    <p className="opsis-unsure" role="note">
      <span aria-hidden="true">?</span> <strong>{t('panel.unsure')}</strong> {t('panel.unsureHint')}
    </p>
  );
}

/** Gentle "Did you know?" chip for pedagogy notes (PROMPT.md §12.1). */
function Chip({ title, text }: { title: MessageKey; text: string }) {
  return (
    <p className="opsis-chip" role="note">
      <strong>{t(title)}</strong> {text}
    </p>
  );
}

/** Loading and error states for one `/v1/explain` entry. */
function EntryStatus({ entry, retry }: { entry: ExplanationEntry | undefined; retry: () => void }) {
  if (!entry || entry.status === 'loading')
    return (
      <p className="opsis-muted" role="status">
        {t('panel.loading')}
      </p>
    );
  if (entry.status === 'error')
    return (
      <div className="opsis-error" role="alert">
        <p>
          {t('panel.error')} {entry.error.message}
        </p>
        {entry.error.retryable ? (
          <button type="button" onClick={retry}>
            {t('state.retry')}
          </button>
        ) : null}
      </div>
    );
  return null;
}

function SummaryTab({ info, data }: { info: NodeInfo; data: Explanation | undefined }) {
  return (
    <>
      {info.optional ? (
        <p className="opsis-badge" title={t('panel.optionalHint')}>
          {t('panel.optionalBadge')}
          <span className="opsis-visually-hidden">: {t('panel.optionalHint')}</span>
        </p>
      ) : null}
      <p aria-live="polite">{data?.summary ?? info.summary}</p>
      {data?.confidence === 'low' ? <Unsure /> : null}
      {info.notes.map((note) => (
        <Chip key={note.text} title={NOTE_TITLES[note.kind] ?? 'note.other'} text={note.text} />
      ))}
    </>
  );
}

function ExplanationTab({ info, data }: { info: NodeInfo; data: Explanation | undefined }) {
  if (!data) return null;
  const misconception = data.sections?.commonMisconception;
  return (
    <>
      {data.confidence === 'low' ? <Unsure /> : null}
      {data.sections ? (
        <dl className="opsis-sections">
          {SECTIONS.map((key) =>
            data.sections?.[key] ? (
              <div key={key}>
                <dt>{t(`panel.${key}`)}</dt>
                <dd>{data.sections[key]}</dd>
              </div>
            ) : null,
          )}
        </dl>
      ) : (
        <p>{data.summary}</p>
      )}
      {misconception ? <Chip title="panel.commonMisconception" text={misconception} /> : null}
      {info.notes
        .filter((note) => note.text !== misconception)
        .map((note) => (
          <Chip key={note.text} title={NOTE_TITLES[note.kind] ?? 'note.other'} text={note.text} />
        ))}
      {data.suggestedDrillDown?.length ? (
        <p className="opsis-muted">
          {t('panel.suggested')}: {data.suggestedDrillDown.join(', ')}
        </p>
      ) : null}
    </>
  );
}

/**
 * Side panel for the selected node (PROMPT.md §2.2, M3): Summary and Explanation tabs that
 * call `/v1/explain` lazily (cached in the session store), "Explain more", and "Open".
 */
export function SidePanel({ node, info }: { node: PositionedNode; info: NodeInfo }) {
  const osgId = useSession((s) => currentOsg(s)?.id ?? '');
  const tab = useSession((s) => s.panelTab);
  const audience = useSession((s) => s.audience);
  const setTab = useSession((s) => s.setPanelTab);
  const select = useSession((s) => s.select);
  const open = useSession((s) => s.open);
  const request = useSession((s) => s.requestExplanation);
  const entry = useSession((s) => s.explanations[explanationKey(osgId, node.id, tab, audience)]);
  const baseId = useId();
  const tabRefs = useRef<Record<Level, HTMLButtonElement | null>>({
    summary: null,
    explanation: null,
  });

  useEffect(() => request(node.id, tab), [request, node.id, tab, audience]);

  const data = entry?.status === 'ready' ? entry.data : undefined;
  const tabs: Level[] = ['summary', 'explanation'];
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const next: Level =
      e.key === 'Home'
        ? 'summary'
        : e.key === 'End'
          ? 'explanation'
          : tab === 'summary'
            ? 'explanation'
            : 'summary';
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <aside className="opsis-panel" aria-labelledby={`${baseId}-title`}>
      <header>
        <h3 id={`${baseId}-title`}>{info.label}</h3>
        <button type="button" onClick={() => select(null)} aria-label={t('panel.close')}>
          <span aria-hidden="true">×</span>
        </button>
      </header>
      <div role="tablist" aria-label={t('panel.tabs')} className="opsis-tabs">
        {tabs.map((level) => (
          <button
            key={level}
            ref={(el) => {
              tabRefs.current[level] = el;
            }}
            type="button"
            role="tab"
            id={`${baseId}-tab-${level}`}
            aria-selected={tab === level}
            aria-controls={`${baseId}-panel`}
            tabIndex={tab === level ? 0 : -1}
            onClick={() => setTab(level)}
            onKeyDown={onTabKey}
          >
            {t(`panel.${level}`)}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel`}
        aria-labelledby={`${baseId}-tab-${tab}`}
        tabIndex={0}
        className="opsis-tabpanel"
      >
        {tab === 'summary' ? (
          <SummaryTab info={info} data={data} />
        ) : (
          <ExplanationTab info={info} data={data} />
        )}
        {tab === 'explanation' || entry?.status !== 'ready' ? (
          <EntryStatus entry={entry} retry={() => request(node.id, tab)} />
        ) : null}
      </div>
      <div className="opsis-panel__actions">
        {tab === 'summary' ? (
          <button
            type="button"
            onClick={() => setTab('explanation')}
            aria-keyshortcuts="Shift+Enter"
          >
            {t('panel.explainMore')}
          </button>
        ) : null}
        {node.drillable ? (
          <button
            type="button"
            className="opsis-primary"
            onClick={() => open(node.id)}
            aria-keyshortcuts="O"
            title={t('panel.openHint', { label: info.label })}
          >
            {t('panel.open')}
          </button>
        ) : null}
      </div>
    </aside>
  );
}
