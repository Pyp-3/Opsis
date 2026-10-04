import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ZoomIn, ZoomOut, Expand } from 'lucide-react';
import { boardReviewChanges, selectBoardChanges, type BoardDocument } from '@opsis/schema';
import { boardSvg } from './export';

export function GenerationReview({
  before,
  candidate,
  apply,
  discard,
}: {
  before: BoardDocument;
  candidate: BoardDocument;
  changes: string[];
  apply: (board: BoardDocument) => void;
  discard: () => void;
}) {
  const options = useMemo(() => boardReviewChanges(before, candidate), [before, candidate]);
  const [selected, setSelected] = useState(() => options.map((change) => change.key));
  const selection = useMemo(() => {
    try {
      return { board: selectBoardChanges(before, candidate, selected), error: '' };
    } catch (error) {
      return {
        board: before,
        error: error instanceof Error ? error.message : 'These changes cannot be combined.',
      };
    }
  }, [before, candidate, selected]);
  const changes = options;
  const proposed = selection.board;
  const [view, setView] = useState<'current' | 'proposed'>('proposed');
  const [zoom, setZoom] = useState(1);
  const previews = useMemo(
    () => ({
      current: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(boardSvg(before))}`,
      proposed: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(boardSvg(proposed))}`,
    }),
    [before, proposed],
  );
  const shown = view === 'proposed' ? proposed : before;
  return createPortal(
    <section className="generation-review" aria-label="Review proposed changes">
      <div className="review-header">
        <div>
          <h3>Preview changes</h3>
          <p>Your saved board has not changed.</p>
        </div>
        <div className="review-actions">
          <button onClick={discard}>Keep current board</button>
          <button
            className="review-apply"
            disabled={!!selection.error || !selected.length}
            onClick={() => apply(proposed)}
          >
            Apply reviewed changes
          </button>
        </div>
      </div>
      <div className="review-toolbar">
        <div className="review-tabs" role="group" aria-label="Layout comparison">
          <button
            aria-pressed={view === 'current'}
            onClick={() => {
              setView('current');
              setZoom(1);
            }}
          >
            Current
          </button>
          <button
            aria-pressed={view === 'proposed'}
            onClick={() => {
              setView('proposed');
              setZoom(1);
            }}
          >
            Proposed
          </button>
        </div>
        <span>
          {shown.nodes.length} concepts · {shown.edges.length} connections
        </span>
        <div className="review-zoom">
          <button
            aria-label="Zoom out preview"
            disabled={zoom <= 1}
            onClick={() => setZoom((value) => Math.max(1, value - 0.5))}
          >
            <ZoomOut size={16} />
          </button>
          <button aria-label="Fit preview" onClick={() => setZoom(1)}>
            <Expand size={16} />
          </button>
          <button
            aria-label="Zoom in preview"
            disabled={zoom >= 4}
            onClick={() => setZoom((value) => Math.min(4, value + 0.5))}
          >
            <ZoomIn size={16} />
          </button>
        </div>
      </div>
      <div
        className="review-layout"
        tabIndex={0}
        aria-label={`${view === 'proposed' ? 'Proposed' : 'Current'} layout preview`}
      >
        <img
          src={previews[view]}
          alt={`${view === 'proposed' ? 'Proposed' : 'Current'} diagram: ${shown.title}`}
          style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
        />
      </div>
      {selection.error && <p role="alert">{selection.error}</p>}
      <details className="review-changes" open>
        <summary>
          {changes.length ? `${changes.length} proposed changes` : 'Updated presentation'}
        </summary>
        <button onClick={() => setSelected(options.map((change) => change.key))}>
          Select all changes
        </button>
        <button onClick={() => setSelected([])}>Clear selection</button>

        <ul>
          {changes.map((change) => (
            <li key={change.key}>
              <label>
                <input
                  type="checkbox"
                  checked={selected.includes(change.key)}
                  onChange={(event) =>
                    setSelected(
                      event.target.checked
                        ? [...selected, change.key]
                        : selected.filter((key) => key !== change.key),
                    )
                  }
                />
                {change.label}
              </label>
            </li>
          ))}
        </ul>
      </details>
    </section>,
    document.body,
  );
}
