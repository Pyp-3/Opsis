import { useEffect, useRef } from 'react';
import type { NodeInfo } from './model';

const NOTE_TITLES: Record<string, string> = {
  misconception: 'Did you know?',
  nuance: 'Did you know?',
  safety: 'Stay safe',
  ambiguity: 'This could mean more than one thing',
};

/** Minimal side panel with a node's fixture summary, modality and pedagogy notes. */
export function SummaryPanel({ info, onClose }: { info: NodeInfo; onClose: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [info.id]);
  return (
    <aside className="opsis-panel" aria-labelledby="opsis-panel-title">
      <header>
        <h2 id="opsis-panel-title" ref={heading} tabIndex={-1}>
          {info.label}
        </h2>
        <button type="button" onClick={onClose} aria-label="Close summary">
          ×
        </button>
      </header>
      {info.optional ? (
        <p
          className="opsis-badge"
          title="The sentence says “can”: this part is possible, not required."
        >
          optional
        </p>
      ) : null}
      <p>{info.summary}</p>
      {info.notes.map((note) => (
        <p key={note.text} className="opsis-chip" role="note">
          <strong>{NOTE_TITLES[note.kind] ?? 'Note'}</strong> {note.text}
        </p>
      ))}
    </aside>
  );
}
