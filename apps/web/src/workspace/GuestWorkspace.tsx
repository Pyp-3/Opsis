import { useEffect, useState } from 'react';
import { boardPage, resolvePageId } from '@opsis/schema';
import { ReadOnlyBoard } from './ReadOnlyBoard';
import { ReaderViewTabs } from './ReaderViewTabs';
import { InfoBook } from './InfoBook';
import { apiFetch } from '../app-url';
import { navigate } from '../router';
import { AUTH_EXPIRED, BoardListSchema } from './board-library-api';
import { useSharedBoard } from './useSharedBoard';
import './guest.css';

const boardLink = () => {
  const params = new URLSearchParams(location.search);
  return { id: params.get('board'), page: params.get('page') };
};

/** A guest never mounts editing, chat, account settings, or recovery/autosave hooks. */
export function GuestWorkspace({ onSignOut }: { onSignOut: () => Promise<void> }) {
  const [link, setLink] = useState(boardLink);
  const { id } = link;
  const [entries, setEntries] = useState<ReturnType<typeof BoardListSchema.parse>>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const back = () => setLink(boardLink());
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, []);
  useEffect(() => {
    if (id) return;
    const controller = new AbortController();
    // One request at a time; stale responses cannot restore a board after navigation/revocation.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const response = await apiFetch('/v1/boards/public', { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (response.status === 401) window.dispatchEvent(new Event(AUTH_EXPIRED));
        if (!response.ok) throw new Error('Could not load public boards.');
        const data: unknown = await response.json();
        if (controller.signal.aborted) return;
        setEntries(BoardListSchema.parse(data));
        setError('');
      } catch (failure) {
        if (controller.signal.aborted) return;
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
  }, [id]);
  const open = (next: string | null) => {
    setLoading(true);
    setError('');
    setLink({ id: next, page: null });
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
      {!id && error && <p role="alert">{error}</p>}
      {!id && loading && <p role="status">Loading public boards…</p>}
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
        <GuestPublicBoard key={`${id}:${link.page ?? ''}`} id={id} linkedPage={link.page} />
      )}
    </main>
  );
}

function GuestPublicBoard({ id, linkedPage }: { id: string; linkedPage: string | null }) {
  // Keep the explicitly opened hidden-page link on every refresh, even after turning pages.
  const path = `/v1/boards/${encodeURIComponent(id)}${linkedPage ? `?page=${encodeURIComponent(linkedPage)}` : ''}`;
  const state = useSharedBoard(path);
  const [requestedPage, setRequestedPage] = useState(linkedPage);
  const [readerView, setReaderView] = useState<'canvas' | 'info'>('canvas');
  if (state.status === 'loading') return <p role="status">Opening the public board…</p>;
  if (state.status === 'missing')
    return <p role="alert">This public board is no longer available.</p>;
  if (state.status === 'error') return <p role="alert">{state.message}</p>;
  const fullBoard = state.entry.snapshot.board;
  if (!fullBoard) return <p>This board is empty.</p>;
  const pageId = resolvePageId(fullBoard, requestedPage);
  const board = boardPage(fullBoard, pageId);
  return (
    <>
      <h1>{board.title}</h1>
      <p>{board.description}</p>
      {state.updated && <p role="status">Board updated. Play again to hear the latest version.</p>}
      <ReaderViewTabs view={readerView} onView={setReaderView} />
      {readerView === 'info' ? (
        <div className="guest-info">
          <InfoBook
            document={fullBoard}
            pageId={pageId}
            boardId={id}
            editable={false}
            // Guest accounts read images through the board's open address, like link visitors.
            signedOut
            showReadingControls={false}
            onOpenPage={setRequestedPage}
          />
        </div>
      ) : (
        <>
          <ReadOnlyBoard
            board={fullBoard}
            boardId={id}
            pageId={pageId}
            onPage={setRequestedPage}
            label="Read-only public diagram"
            className="guest-canvas"
          />
          <section aria-label="Board explanations" className="guest-explanations">
            {board.nodes.map((node) => (
              <article key={node.id}>
                <h2>{node.label}</h2>
                <p>{node.summary}</p>
              </article>
            ))}
          </section>
        </>
      )}
    </>
  );
}
