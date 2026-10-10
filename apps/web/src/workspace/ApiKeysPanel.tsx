import { apiFetch as fetch } from '../app-url';
import { useEffect, useState } from 'react';
import { PROVIDER_LABELS, type ProviderAgent } from '@opsis/schema';

type KeyStatus = { id: ProviderAgent; configured: boolean; source: string };
export function ApiKeysPanel() {
  const [statuses, setStatuses] = useState<KeyStatus[]>([]);
  const [provider, setProvider] = useState('kimi');
  const [secret, setSecret] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  async function refresh() {
    const response = await fetch('/v1/instance/provider-keys');
    if (!response.ok) throw new Error('Could not load instance key status.');
    setStatuses((await response.json()) as KeyStatus[]);
  }
  useEffect(() => {
    let live = true;
    void fetch('/v1/instance/provider-keys')
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const values = (await response.json()) as KeyStatus[];
        if (live) setStatuses(values);
      })
      .catch(() => {
        if (live) setNotice('Could not load instance key status.');
      });
    return () => {
      live = false;
    };
  }, []);
  async function update(id: string, key?: string) {
    setBusy(true);
    try {
      const response = await fetch(`/v1/instance/provider-keys/${id}`, {
        method: key === undefined ? 'DELETE' : 'PUT',
        ...(key === undefined
          ? {}
          : { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key }) }),
      });
      if (!response.ok) throw new Error();
      await refresh();
      setNotice(
        key === undefined
          ? 'Saved key removed. Environment settings still apply.'
          : 'API key saved for this Opsis instance.',
      );
    } catch {
      setNotice('Could not update the instance key.');
    } finally {
      setBusy(false);
      setSecret('');
    }
  }
  return (
    <section className="agent-settings" aria-label="API keys">
      <h2>API keys for this Opsis instance</h2>
      <p>
        All accounts using this server share these provider credentials and their billing. Keys stay
        on the server, outside account settings, profiles and board exports. Saved keys are never
        shown again.
      </p>
      <div className="settings-card">
        <form
          className="instance-key-form"
          onSubmit={(event) => {
            event.preventDefault();
            void update(provider, secret.trim());
          }}
        >
          <label>
            Provider
            <select
              value={provider}
              disabled={busy}
              onChange={(event) => setProvider(event.target.value)}
            >
              {(['kimi', 'grok', 'antigravity'] as const).map((id) => (
                <option key={id} value={id}>
                  {PROVIDER_LABELS[id]}
                </option>
              ))}
            </select>
          </label>
          <label>
            New API key
            <input
              type="password"
              autoComplete="off"
              maxLength={4096}
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              disabled={busy}
            />
          </label>
          <button disabled={busy || !secret.trim()}>Save instance key</button>
        </form>
        <ul>
          {statuses.map(({ id, configured, source }) => (
            <li key={id}>
              {PROVIDER_LABELS[id]} · {configured ? `configured (${source})` : 'not configured'}{' '}
              <button disabled={busy || source !== 'instance'} onClick={() => void update(id)}>
                Remove {PROVIDER_LABELS[id]} key
              </button>
            </li>
          ))}
        </ul>
        <p>
          Server environment variables override saved keys. Removing a saved key does not revoke it
          with the provider.
        </p>
        <p role="status">{notice}</p>
      </div>
    </section>
  );
}
