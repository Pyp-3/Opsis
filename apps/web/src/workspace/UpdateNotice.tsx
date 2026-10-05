import { useEffect, useState } from 'react';
import { desktopUpdates, type DesktopUpdates, type UpdateStatus } from '../desktop';

const CHECK_INTERVAL = 6 * 60 * 60 * 1000;

type State =
  | { phase: 'idle' }
  | { phase: 'available'; status: UpdateStatus }
  | { phase: 'installing'; status: UpdateStatus }
  | { phase: 'failed'; status: UpdateStatus };

/** Offers a newer signed desktop build. Nothing downloads until the user chooses to install. */
export function UpdateNotice(props: { updates?: DesktopUpdates | undefined }) {
  // Resolve the native bridge once; a new object each render would re-run the check.
  const [native] = useState(desktopUpdates);
  const updates = 'updates' in props ? props.updates : native;
  const [state, setState] = useState<State>({ phase: 'idle' });
  const [dismissed, setDismissed] = useState<string>();

  useEffect(() => {
    if (!updates) return;
    let live = true;
    const check = () =>
      updates
        .check()
        .then((status) => {
          if (!live || !status.available) return;
          // Never interrupt an install in progress with a newer check result.
          setState((current) =>
            current.phase === 'installing' ? current : { phase: 'available', status },
          );
        })
        // Offline or rate-limited: try again at the next interval.
        .catch(() => undefined);
    void check();
    const timer = window.setInterval(check, CHECK_INTERVAL);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [updates]);

  if (!updates || state.phase === 'idle' || state.status.version === dismissed) return null;
  const { status } = state;
  const installing = state.phase === 'installing';

  const install = () => {
    setState({ phase: 'installing', status });
    // On success the app quits and the installer reopens it.
    updates.install().catch(() => setState({ phase: 'failed', status }));
  };

  return (
    <aside className="update-notice" aria-label="Opsis update">
      <p role="status">
        {installing ? (
          'Downloading and verifying the update. Opsis will restart when it is ready.'
        ) : state.phase === 'failed' ? (
          'The update could not be installed. Your work is unchanged.'
        ) : (
          <>
            <strong>An Opsis update is available.</strong> {status.version}
          </>
        )}
      </p>
      {!installing && (
        <div className="update-notice-actions">
          {status.canInstall ? (
            <button type="button" className="update-notice-primary" onClick={install}>
              {state.phase === 'failed' ? 'Try again' : 'Install and restart'}
            </button>
          ) : (
            <button
              type="button"
              className="update-notice-primary"
              onClick={() => void updates.openPage().catch(() => undefined)}
            >
              Download
            </button>
          )}
          <button type="button" onClick={() => setDismissed(status.version)}>
            Later
          </button>
        </div>
      )}
    </aside>
  );
}
