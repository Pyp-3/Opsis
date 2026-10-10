import { apiFetch as fetch } from '../app-url';
import { useCallback, useEffect, useState } from 'react';
import { Bot, Check, Copy, KeyRound, LogOut, Plus, Trash2, UserRound } from 'lucide-react';
import type { User } from '../auth/session';
import { initials } from './AppSidebar';
import { updatedLabel } from './BoardsPage';
import { copyText } from '../desktop';

type AgentKey = { id: string; name: string; createdAt: number; lastUsedAt: number | null };

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="secondary-button"
      aria-label={copied ? 'Copied' : label}
      onClick={() => {
        void copyText(text)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          })
          .catch(() => setCopied(false));
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

/** Who is signed in, and the keys that let their own local agents work on their canvases. */
export function AccountPage({
  user,
  onSignOut,
}: {
  user: User;
  onSignOut?: (() => void) | undefined;
}) {
  const [keys, setKeys] = useState<AgentKey[] | null>(null);
  const [name, setName] = useState('Claude Code');
  const [fresh, setFresh] = useState<{ name: string; key: string } | null>(null);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch('/v1/auth/agent-keys');
    if (!response.ok) throw new Error('Could not load your agent keys.');
    setKeys((await response.json()) as AgentKey[]);
  }, []);
  useEffect(() => {
    document.title = 'Account · Opsis';
    // Async network completion synchronizes the list with the server.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load().catch((e: Error) => setError(e.message));
  }, [load]);

  const mcpPath = '/path/to/Opsis/apps/mcp';
  const command = fresh
    ? `claude mcp add opsis --env OPSIS_AGENT_KEY=${fresh.key} -- ${mcpPath}/node_modules/.bin/tsx ${mcpPath}/src/main.ts`
    : '';
  return (
    <main className="page-main account-page">
      <header className="page-head">
        <span className="eyebrow">
          <UserRound size={13} /> Account
        </span>
        <h1>{user.name}</h1>
        <p>{user.email}</p>
      </header>

      <section className="settings-card account-card">
        <h2 className="settings-title">
          <KeyRound size={14} /> Agent keys
        </h2>
        <p className="account-note">
          Let your own agents (Claude Code, Codex) work on your canvases through the Opsis MCP
          server. A key acts as you, and only works for agents on this computer: Opsis refuses it
          from browsers and from other machines.
        </p>
        <form
          className="account-new-key"
          onSubmit={async (event) => {
            event.preventDefault();
            setError('');
            const response = await fetch('/v1/auth/agent-keys', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ name: name.trim() }),
            });
            if (!response.ok) return setError('Could not create the key. Name it and try again.');
            setFresh((await response.json()) as { name: string; key: string });
            await load();
          }}
        >
          <label>
            Key name
            <input
              value={name}
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Claude Code on my laptop"
            />
          </label>
          <button className="primary-button" disabled={!name.trim()}>
            <Plus size={15} /> Create key
          </button>
        </form>
        {fresh && (
          <div className="account-fresh" role="status">
            <strong>
              <Check size={15} /> “{fresh.name}” created. Copy it now; it won’t be shown again.
            </strong>
            <div className="account-secret">
              <code>{fresh.key}</code>
              <CopyButton text={fresh.key} label="Copy key" />
            </div>
            <p>Register the MCP server with this key (replace the path with your checkout):</p>
            <div className="account-secret">
              <code>{command}</code>
              <CopyButton text={command} label="Copy command" />
            </div>
          </div>
        )}
        {error && (
          <p className="workspace-error" role="alert">
            {error}
          </p>
        )}
        {keys && keys.length > 0 ? (
          <ul className="account-keys">
            {keys.map((key) => (
              <li key={key.id}>
                <span className="account-key-icon">
                  <Bot size={16} />
                </span>
                <span className="account-key-text">
                  <strong>{key.name}</strong>
                  <small>
                    {key.lastUsedAt
                      ? updatedLabel(key.lastUsedAt).replace('Updated', 'Used')
                      : 'Never used'}{' '}
                    · {updatedLabel(key.createdAt).replace('Updated', 'Created')}
                  </small>
                </span>
                {confirming === key.id ? (
                  <span className="account-confirm">
                    <button
                      className="delete-concept"
                      onClick={async () => {
                        await fetch(`/v1/auth/agent-keys/${key.id}`, { method: 'DELETE' });
                        setConfirming(null);
                        await load();
                      }}
                    >
                      Revoke
                    </button>
                    <button className="secondary-button" onClick={() => setConfirming(null)}>
                      Keep
                    </button>
                  </span>
                ) : (
                  <button
                    className="secondary-button"
                    aria-label={`Revoke ${key.name}`}
                    onClick={() => setConfirming(key.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          keys && <p className="rail-empty">No agent keys yet.</p>
        )}
      </section>

      <section className="settings-card account-card">
        <h2 className="settings-title">
          <span className="avatar" aria-hidden>
            {initials(user.name)}
          </span>
          Session
        </h2>
        <div className="settings-actions">
          <small>Signed in on this browser for 30 days, or until you log out.</small>
          <button className="secondary-button" onClick={onSignOut}>
            <LogOut size={14} /> Log out
          </button>
        </div>
      </section>
    </main>
  );
}
