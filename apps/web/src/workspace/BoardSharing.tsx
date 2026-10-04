import { useEffect, useState } from 'react';
export function BoardSharing({ id, owner }: { id: string; owner: boolean }) {
  const [editors, setEditors] = useState<{ email: string; name: string }[]>([]);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!owner) return;
    const controller = new AbortController();
    void fetch(`/v1/boards/${id}/editors`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load editors.');
        const values = await response.json();
        if (!controller.signal.aborted) setEditors(values);
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [id, owner]);
  async function change(address: string, enabled: boolean) {
    setBusy(true);
    setError('');
    try {
      const current = await fetch(`/v1/boards/${id}`);
      if (!current.ok) throw new Error('Could not read current sharing permissions.');
      const board = await current.json();
      if (board.access !== 'owner') throw new Error('Only the owner can manage editors.');
      const revision = board.revision;
      const response = await fetch(`/v1/boards/${id}/editors`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: address, enabled, revision }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? 'Could not update editors.');
      setEditors(body);
      setEmail('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update editors.');
    } finally {
      setBusy(false);
    }
  }
  if (!owner)
    return (
      <p>You can edit this shared board. Its owner manages sharing and saved revision history.</p>
    );
  return (
    <details className="board-sharing">
      <summary>Shared editing</summary>
      <p>
        Grant editing to an existing account on this Opsis server. Editors can change all content;
        only you can manage sharing, archive, delete or browse saved revisions. Changes sync while
        idle; simultaneous edits are revision checked.
      </p>
      <label>
        Editor email
        <input
          type="email"
          value={email}
          maxLength={254}
          onChange={(event) => setEmail(event.target.value)}
          disabled={busy}
        />
      </label>
      <button disabled={busy || !email.trim()} onClick={() => void change(email.trim(), true)}>
        Grant editing
      </button>
      <ul>
        {editors.map((editor) => (
          <li key={editor.email}>
            {editor.name} · {editor.email}{' '}
            <button disabled={busy} onClick={() => void change(editor.email, false)}>
              Revoke editing for {editor.name}
            </button>
          </li>
        ))}
      </ul>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}

export function SharedBoards({ onOpen }: { onOpen: (id: string) => Promise<void> }) {
  const [boards, setBoards] = useState<{ id: string; title: string; ownerName: string }[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/v1/boards/shared', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load shared boards.');
        const body = await response.json();
        if (!controller.signal.aborted) setBoards(body);
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, []);
  return (
    <section aria-label="Shared with you">
      <h2>Shared with you</h2>
      {error && <p role="alert">{error}</p>}
      {!boards.length && !error && <p>No editing invitations on this server.</p>}
      <ul>
        {boards.map((board) => (
          <li key={board.id}>
            <button onClick={() => void onOpen(board.id)}>
              {board.title} · {board.ownerName}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
