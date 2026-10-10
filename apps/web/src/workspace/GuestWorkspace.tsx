import { useEffect, useState } from 'react';
import { boardPage, resolvePageId, type BoardDocument } from '@opsis/schema';
import { ReadOnlyBoard } from './ReadOnlyBoard';
import { apiFetch } from '../app-url';
import { navigate } from '../router';
import { AUTH_EXPIRED, BoardEntrySchema, BoardListSchema } from './board-library-api';
import './guest.css';

/** A guest never mounts editing, chat, account settings, or recovery/autosave hooks. */
export function GuestWorkspace({ onSignOut }: { onSignOut: () => Promise<void> }) {
  const [id, setId] = useState(() => new URLSearchParams(location.search).get('board'));
  const [entries, setEntries] = useState<ReturnType<typeof BoardListSchema.parse>>([]);
  const [fullBoard, setBoard] = useState<BoardDocument | null>(null);
  // A page link (`&page=`) opens that page, even one hidden from viewers.
  const [linkedPage] = useState(() => new URLSearchParams(location.search).get('page'));
  const [requestedPage, setRequestedPage] = useState(linkedPage);
  const pageId = resolvePageId(fullBoard, requestedPage);
  const board = fullBoard ? boardPage(fullBoard, pageId) : null;
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const back = () => setId(new URLSearchParams(location.search).get('board'));
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    // One request at a time; stale responses cannot restore a board after navigation/revocation.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const response = await apiFetch(
          id
            ? `/v1/boards/${encodeURIComponent(id)}${linkedPage ? `?page=${encodeURIComponent(linkedPage)}` : ''}`
            : '/v1/boards/public',
          { signal: controller.signal },
        );
        if (response.status === 401) window.dispatchEvent(new Event(AUTH_EXPIRED));
        if (!response.ok)
          throw new Error(
            id ? 'This public board is no longer available.' : 'Could not load public boards.',
          );
        const data: unknown = await response.json();
        if (controller.signal.aborted) return;
        if (id) setBoard(BoardEntrySchema.parse(data).snapshot.board);
        else setEntries(BoardListSchema.parse(data));
        setError('');
      } catch (failure) {
        if (controller.signal.aborted) return;
        setBoard(null);
        setEntries([]);
        setError(failure instanceof Error ? failure.message : 'Could not load public boards.');
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          timer = setTimeout(() => void refresh(), 5_000);
        }
      }
    };
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [id, linkedPage]);
  const open = (next: string | null) => {
    setLoading(true);
    setBoard(null);
    setError('');
    setId(next);
    navigate(next ? `/canvas?board=${encodeURIComponent(next)}` : '/boards');
  };
  return (
    <main className="guest-workspace">
      <header className="guest-header">
        <div>
          <strong>Opsis · Guest</strong>
          <p>Public boards only · read-only</p>
        </div>
        {id && <button onClick={() => open(null)}>Public boards</button>}
        <button onClick={() => void onSignOut()}>Log out</button>
      </header>
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">Loading public boards…</p>}
      {!id ? (
        <section>
          <h1>Public boards</h1>
          {!loading && !error && !entries.length && <p>No public boards yet.</p>}
          <ul className="guest-board-list">
            {entries.map((entry) => (
              <li key={entry.id}>
                <button onClick={() => open(entry.id)}>{entry.title}</button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        board && (
          <>
            <h1>{board.title}</h1>
            <p>{board.description}</p>
            {fullBoard && id && (
              <ReadOnlyBoard
                board={fullBoard}
                boardId={id}
                pageId={pageId}
                onPage={setRequestedPage}
                label="Read-only public diagram"
                className="guest-canvas"
              />
            )}
            <section aria-label="Board explanations" className="guest-explanations">
              {board.nodes.map((node) => (
                <article key={node.id}>
                  <h2>{node.label}</h2>
                  <p>{node.summary}</p>
                </article>
              ))}
            </section>
          </>
        )
      )}
    </main>
  );
}
