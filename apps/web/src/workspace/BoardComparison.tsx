import { apiFetch as fetch } from '../app-url';
import { useState } from 'react';
import { BoardDocumentSchema, compareBoards, type BoardDifference } from '@opsis/schema';
export function BoardComparison({ entries }: { entries: { id: string; title: string }[] }) {
  const [left, setLeft] = useState('');
  const [right, setRight] = useState('');
  const [leftRevision, setLeftRevision] = useState('');
  const [rightRevision, setRightRevision] = useState('');
  const [differences, setDifferences] = useState<BoardDifference[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function read(id: string, revision: string) {
    if (revision && (!/^\d+$/.test(revision) || Number(revision) < 1))
      throw new Error('Use a positive revision number, or leave it blank for current.');
    const response = await fetch(`/v1/boards/${id}${revision ? `/revisions/${revision}` : ''}`);
    if (!response.ok)
      throw new Error(
        'Could not read that board/revision. Saved history is available to the owner.',
      );
    const body = await response.json();
    return BoardDocumentSchema.nullable().parse(revision ? body.board : body.snapshot.board);
  }
  return (
    <details className="board-comparison">
      <summary>Compare boards or saved revisions</summary>
      <p>
        Choose two boards, or the same board with different revision numbers from Saved revisions.
        Blank revision means current.
      </p>
      {[
        {
          name: 'Before',
          id: left,
          set: setLeft,
          revision: leftRevision,
          setRevision: setLeftRevision,
        },
        {
          name: 'After',
          id: right,
          set: setRight,
          revision: rightRevision,
          setRevision: setRightRevision,
        },
      ].map((side) => (
        <fieldset key={side.name} disabled={busy}>
          <legend>{side.name}</legend>
          <label>
            {side.name} board
            <select
              aria-label={`${side.name} board`}
              value={side.id}
              onChange={(event) => {
                side.set(event.target.value);
                setDifferences(null);
              }}
            >
              <option value="">Choose a board…</option>
              {entries.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            {side.name} revision
            <input
              aria-label={`${side.name} revision`}
              type="number"
              min={1}
              value={side.revision}
              onChange={(event) => {
                side.setRevision(event.target.value);
                setDifferences(null);
              }}
            />
          </label>
        </fieldset>
      ))}
      <button
        disabled={busy || !left || !right}
        onClick={async () => {
          setBusy(true);
          setError('');
          setDifferences(null);
          try {
            const [a, b] = await Promise.all([
              read(left, leftRevision),
              read(right, rightRevision),
            ]);
            setDifferences(compareBoards(a, b));
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Comparison failed.');
          } finally {
            setBusy(false);
          }
        }}
      >
        Compare saved content
      </button>
      {error && <p role="alert">{error}</p>}
      {differences && (
        <section aria-label="Comparison results">
          <p>{differences.length} differences</p>
          {differences.map((difference) => (
            <details key={difference.label}>
              <summary>{difference.label}</summary>
              <div className="comparison-values">
                <div>
                  <h4>Before</h4>
                  <pre>{difference.before}</pre>
                </div>
                <div>
                  <h4>After</h4>
                  <pre>{difference.after}</pre>
                </div>
              </div>
            </details>
          ))}
        </section>
      )}
    </details>
  );
}
