import { apiFetch as fetch } from '../app-url';
import { useRef, useState } from 'react';
import { CollectionBundleSchema, type CollectionSharing } from '@opsis/schema';
import { download } from './export';
import { collectionHtml, printCollection } from './collection-export';

export function CollectionActions({
  collection,
  boards,
  refresh,
  imported,
}: {
  collection?: { id: string; name: string } | undefined;
  boards: { id: string; revision: number; collectionId?: string | null | undefined }[];
  refresh(): Promise<unknown>;
  imported(id: string): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const members = boards.filter((board) => board.collectionId === collection?.id);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Collection action failed.');
    } finally {
      setBusy(false);
    }
  };
  const checked = async (response: Response) => {
    if (!response.ok)
      throw new Error(
        ((await response.json()) as { message?: string }).message ?? 'Collection action failed.',
      );
    return response;
  };
  const share = (change: CollectionSharing['change']) =>
    run(async () => {
      if (!collection) return;
      await checked(
        await fetch(`/v1/collections/${collection.id}/sharing`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            boards: members.map(({ id, revision }) => ({ id, revision })),
            change,
          }),
        }),
      );
      await refresh();
      setMessage(`Updated sharing for ${members.length} boards.`);
    });
  // The HTML and printout are made to be passed on, so hidden pages stay out unless asked for.
  const [hiddenPages, setHiddenPages] = useState(false);
  const exportAs = (format: 'bundle' | 'html' | 'print') =>
    run(async () => {
      if (!collection) return;
      const response = await checked(await fetch(`/v1/collections/${collection.id}/bundle`));
      const bundle = CollectionBundleSchema.parse(await response.json());
      if (format === 'bundle')
        await download(
          JSON.stringify(bundle, null, 2),
          'opsis-collection.json',
          'application/json',
        );
      else if (format === 'html')
        await download(
          collectionHtml(bundle, { hiddenPages }),
          'opsis-collection.html',
          'text/html',
        );
      else printCollection(collectionHtml(bundle, { hiddenPages }));
    });
  return (
    <section className="collection-actions" aria-label="Collection sharing and export">
      <button disabled={busy} onClick={() => input.current?.click()}>
        Import collection bundle
      </button>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        aria-label="Collection bundle file"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          void run(async () => {
            if (file.size > 16_000_000) throw new Error('Use a collection bundle up to 16 MB.');
            const bundle = CollectionBundleSchema.parse(JSON.parse(await file.text()));
            const response = await checked(
              await fetch('/v1/collections/import', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(bundle),
              }),
            );
            const result = (await response.json()) as { id: string };
            await refresh();
            imported(result.id);
            setMessage('Imported as new private boards in a new collection.');
          });
        }}
      />
      {collection && (
        <details>
          <summary>Share or export {collection.name}</summary>
          <p>
            Applies to all {members.length} boards in this collection, including archived boards.
            New boards added later keep their own sharing settings.
          </p>
          <div className="collection-action-row">
            <button
              disabled={busy || !members.length}
              onClick={() => void share({ kind: 'visibility', visibility: 'public' })}
            >
              Make all public
            </button>
            <button
              disabled={busy || !members.length}
              onClick={() => void share({ kind: 'visibility', visibility: 'link' })}
            >
              Share all by link
            </button>
            <button
              disabled={busy || !members.length}
              onClick={() => void share({ kind: 'visibility', visibility: 'private' })}
            >
              Make all private
            </button>
          </div>
          <p>
            Private boards remain accessible to invited editors. Remove an editor below to revoke
            their access.
          </p>
          <label>
            Editor email
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <div className="collection-action-row">
            <button
              disabled={busy || !email.trim() || !members.length}
              onClick={() => void share({ kind: 'editor', email: email.trim(), enabled: true })}
            >
              Invite editor to all boards
            </button>
            <button
              disabled={busy || !email.trim() || !members.length}
              onClick={() => void share({ kind: 'editor', email: email.trim(), enabled: false })}
            >
              Remove editor from all boards
            </button>
          </div>
          <div className="collection-action-row">
            <button disabled={busy} onClick={() => void exportAs('bundle')}>
              Export collection bundle
            </button>
            <button disabled={busy} onClick={() => void exportAs('html')}>
              Export read-only HTML
            </button>
            <button disabled={busy} onClick={() => void exportAs('print')}>
              Print walkthrough / Save PDF
            </button>
          </div>
          <label className="collection-hidden-pages">
            <input
              type="checkbox"
              checked={hiddenPages}
              onChange={(event) => setHiddenPages(event.target.checked)}
            />
            Include pages hidden from viewers in the HTML and printout
          </label>
          <p>
            Exports include board notes and sources. Imports create fresh private copies, remap
            links within the bundle, and remove links to boards outside it. Private chat threads are
            excluded.
          </p>
        </details>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
