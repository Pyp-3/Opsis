import { apiFetch as fetch } from '../app-url';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { BoardDocumentSchema } from '@opsis/schema';
import type { useBoardLibrary } from './useBoardLibrary';

const Revisions = z.array(
  z.object({ revision: z.number().int(), title: z.string(), savedAt: z.number() }),
);
const Revision = z.object({ revision: z.number().int(), board: BoardDocumentSchema.nullable() });
type Library = ReturnType<typeof useBoardLibrary>;

export function BoardRevisionPanel({
  entry,
  library,
  onClose,
  onCreated,
}: {
  entry: Library['entries'][number];
  library: Library;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [revisions, setRevisions] = useState<z.infer<typeof Revisions>>([]);
  const [before, setBefore] = useState<number>();
  const [more, setMore] = useState(false);
  const [selected, setSelected] = useState<number>();
  const [preview, setPreview] = useState<z.infer<typeof Revision>>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(
          `/v1/boards/${entry.id}/revisions${before === undefined ? '' : `?before=${before}`}`,
          { signal: controller.signal },
        );
        if (!response.ok)
          throw new Error('Could not load saved revisions. Reopen history to retry.');
        const page = Revisions.parse(await response.json());
        if (controller.signal.aborted) return;
        setRevisions((previous) => (before === undefined ? page : [...previous, ...page]));
        setMore(page.length === 50);
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : 'Could not load revisions.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [entry.id, before]);
  useEffect(() => {
    if (selected === undefined) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/v1/boards/${entry.id}/revisions/${selected}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Could not load this revision.');
        const result = Revision.parse(await response.json());
        if (!controller.signal.aborted) setPreview(result);
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : 'Could not load this revision.');
      }
    })();
    return () => controller.abort();
  }, [entry.id, selected]);
  const displayed = preview?.revision === selected ? preview : undefined;
  return (
    <section className="revision-panel" aria-label={`Revision history for ${entry.title}`}>
      <header>
        <h2>Saved revisions</h2>
        <button onClick={onClose}>Close history</button>
      </header>
      <p>
        Each successful save is retained until you permanently delete the board. History starts when
        revision archiving was installed. Restore a private copy to inspect its original layout
        without changing this board.
      </p>
      {(error || library.error) && <p role="alert">{error || library.error}</p>}
      {loading && <p role="status">Loading revisions…</p>}
      <ul className="revision-list">
        {revisions.map((item) => (
          <li key={item.revision}>
            <button
              aria-pressed={selected === item.revision}
              onClick={() => {
                setSelected(item.revision);
                setError('');
              }}
            >
              Revision {item.revision} · {item.title} · {new Date(item.savedAt).toLocaleString()}
            </button>
          </li>
        ))}
      </ul>
      {more && (
        <button
          disabled={loading}
          onClick={() => {
            setLoading(true);
            setBefore(revisions.at(-1)?.revision);
          }}
        >
          Load older revisions
        </button>
      )}
      {displayed && (
        <>
          <div className="revision-preview" aria-label="Revision preview">
            <h3>
              {displayed.board?.title ?? 'Empty canvas'} · revision {displayed.revision}
            </h3>
            <p>{displayed.board?.description}</p>
            <p>
              {displayed.board?.nodes.length ?? 0} concepts · {displayed.board?.edges.length ?? 0}{' '}
              relationships
            </p>
            <ul>
              {displayed.board?.nodes.map((node) => (
                <li key={node.id}>
                  <strong>{node.label}</strong>
                  {node.summary && <p>{node.summary}</p>}
                </li>
              ))}
            </ul>
            <ul>
              {displayed.board?.edges.map((edge) => (
                <li key={edge.id}>
                  {edge.source} → {edge.target}: {edge.label}
                </li>
              ))}
            </ul>
          </div>
          <button
            disabled={library.switching}
            onClick={async () => {
              if (
                await library.manage(
                  'duplicate',
                  entry,
                  undefined,
                  undefined,
                  undefined,
                  displayed.revision,
                )
              ) {
                onClose();
                onCreated();
              }
            }}
          >
            Restore revision {displayed.revision} as private copy
          </button>
        </>
      )}
    </section>
  );
}
