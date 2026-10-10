import { apiFetch as fetch } from '../app-url';
import { useState } from 'react';
import { z } from 'zod';
import { LegacyBundleSchema } from '@opsis/schema';
export function LegacyBatchReview({
  bundle,
  onClose,
  onSaved,
}: {
  bundle: z.infer<typeof LegacyBundleSchema>;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const [remaining, setRemaining] = useState(bundle.boards);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <section className="import-preview" aria-label="Bulk legacy import review">
      <h2>Review legacy database import</h2>
      <p>
        {remaining.length} boards ready · {bundle.rejected.length} source records rejected · {count}{' '}
        imported.
      </p>
      <p>
        Creates private copies for your account on this server. Original database and existing
        boards remain unchanged. A partial failure retains the remaining list for retry.
      </p>
      <ul>
        {remaining.map((item) => (
          <li key={item.id}>
            {item.board.title} · {item.board.nodes.length} concepts · source {item.sourceId}
          </li>
        ))}
        {bundle.rejected.map((item) => (
          <li key={item.sourceId}>
            {item.sourceId}: {item.reason}
          </li>
        ))}
      </ul>
      {error && <p role="alert">{error}</p>}
      <button
        disabled={busy || !remaining.length}
        onClick={async () => {
          setBusy(true);
          setError('');
          let queue = [...remaining];
          try {
            for (const item of remaining) {
              const response = await fetch(`/v1/boards/${crypto.randomUUID()}`, {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  revision: 0,
                  snapshot: { board: item.board, past: [], future: [] },
                }),
              });
              if (!response.ok)
                throw new Error(
                  'Import stopped. Already imported boards are safe; retry the remaining records.',
                );
              queue = queue.filter((entry) => entry.id !== item.id);
              setRemaining(queue);
              setCount((value) => value + 1);
            }
            await onSaved();
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Import failed.');
          } finally {
            setBusy(false);
          }
        }}
      >
        Import remaining boards
      </button>
      <button disabled={busy} onClick={onClose}>
        Close import review
      </button>
    </section>
  );
}
