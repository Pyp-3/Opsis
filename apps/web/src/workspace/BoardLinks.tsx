import { Link2 } from 'lucide-react';
import { useEffect, useState } from 'react';

type Backlink = { id: string; title: string; conceptId: string; label: string };
export function BoardLinks({
  id,
  onOpen,
  onBack,
}: {
  id: string;
  onOpen(id: string, concept?: string): void;
  onBack?: (() => void) | undefined;
}) {
  const [links, setLinks] = useState<Backlink[]>([]);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    void fetch(`/v1/boards/${id}/backlinks`, { signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const values = (await response.json()) as Backlink[];
        if (!abort.signal.aborted) {
          setLinks(values);
          setError('');
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) setError('Could not load board links.');
      });
    return () => abort.abort();
  }, [id, refresh]);
  return (
    <>
      {onBack && <button onClick={onBack}>Back to previous board</button>}
      <details className="header-menu board-links">
        <summary title="Boards that link here" aria-label="Linked from">
          <Link2 size={15} aria-hidden />
          <span className="button-label">Linked from</span>
        </summary>
        <div className="header-menu-panel">
          <p>Boards you can access that link here</p>
          {error ? (
            <p role="status">{error}</p>
          ) : links.length ? (
            links.map((link) => (
              <button
                key={`${link.id}:${link.conceptId}`}
                onClick={() => onOpen(link.id, link.conceptId)}
              >
                {link.title} · {link.label}
              </button>
            ))
          ) : (
            <p>No incoming links.</p>
          )}
          <button onClick={() => setRefresh((value) => value + 1)}>Refresh links</button>
        </div>
      </details>
    </>
  );
}
