import { useEffect, useId, useState, type FormEvent } from 'react';
import { HardDrive, LoaderCircle, Server } from 'lucide-react';
import { desktopServers, type ServerStatus } from '../desktop';
import { appUrl } from '../app-url';
import './server-picker.css';

/** Starts the app again against the chosen server, so every page reloads its data from it. */
function reopen() {
  window.location.assign(appUrl('/'));
}

const reason = (error: unknown) =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : 'Could not connect.';

/**
 * In the desktop app, which Opsis to work with: this computer's own, or a personal Opsis
 * server (docs/SERVER.md), signed in with an account there. Only the server's data comes over
 * the network; the app's pages stay its own. Shown nowhere outside the desktop app.
 */
export function ServerPicker({ variant }: { variant: 'sign-in' | 'account' }) {
  const servers = desktopServers();
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ids = { address: useId(), error: useId() };
  useEffect(() => {
    if (!servers) return;
    let live = true;
    void servers.current().then((value) => live && setStatus(value));
    return () => {
      live = false;
    };
    // The bridge is fixed for the life of the window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!servers || !status) return null;

  const run = async (change: () => Promise<ServerStatus>) => {
    setBusy(true);
    setError('');
    try {
      await change();
      reopen();
    } catch (cause) {
      setError(reason(cause));
      setBusy(false);
    }
  };
  const connect = (event: FormEvent) => {
    event.preventDefault();
    if (address.trim()) void run(() => servers.connect(address));
  };
  const Icon = status.remote ? Server : HardDrive;
  return (
    <section className={`server-picker is-${variant}`} aria-label="Opsis server">
      <div className="server-picker-current">
        <Icon size={16} aria-hidden />
        <span>
          <small>{status.remote ? 'Opsis server' : 'Working on'}</small>
          <strong>{status.label}</strong>
        </span>
        {!open && (
          <button type="button" onClick={() => setOpen(true)}>
            Change
          </button>
        )}
      </div>
      {open && (
        <form className="server-picker-form" onSubmit={connect} noValidate>
          <label htmlFor={ids.address}>Server address</label>
          <input
            id={ids.address}
            type="url"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            placeholder="https://example.com/opsis"
            value={address}
            disabled={busy}
            aria-describedby={error ? ids.error : undefined}
            onChange={(event) => setAddress(event.target.value)}
          />
          <p className="server-picker-note">
            Sign in with an account on that server. Boards, chats and pictures stay on the server;
            this app only shows them. HTTPS is required.
          </p>
          {error && (
            <p id={ids.error} className="server-picker-error" role="alert">
              {error}
            </p>
          )}
          <div className="server-picker-actions">
            {status.remote && (
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => void run(() => servers.useThisComputer())}
              >
                <HardDrive size={14} aria-hidden /> Use this computer
              </button>
            )}
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setError('');
              }}
            >
              Cancel
            </button>
            <button type="submit" className="primary-button" disabled={busy || !address.trim()}>
              {busy ? <LoaderCircle size={14} className="spin" aria-hidden /> : null} Connect
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
