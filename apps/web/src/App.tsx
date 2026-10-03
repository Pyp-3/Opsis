import { useCallback, useEffect, useState } from 'react';
import { Workspace } from './workspace/Workspace';
import { BrandMark } from './workspace/BrandMark';
import { AUTH_EXPIRED, setRecoveryScope } from './workspace/useBoardLibrary';
import { AuthPage } from './auth/AuthPage';
import { currentUser, logOut, type User } from './auth/session';
import { navigate, usePath } from './router';

type Session = { status: 'loading' } | { status: 'out' } | { status: 'in'; user: User };
const AUTH_PATHS = new Set(['/login', '/signup']);

/** Where to go after signing in: the `next` the sign-in page was opened with, if it is ours. */
function returnPath() {
  const next = new URLSearchParams(location.search).get('next');
  return next?.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export function App() {
  const [session, setSession] = useState<Session>({ status: 'loading' });
  const path = usePath();

  const signedIn = useCallback((user: User) => {
    // Before the workspace mounts, so it restores this account's own recovery copy.
    setRecoveryScope(user.id);
    setSession({ status: 'in', user });
  }, []);
  useEffect(() => {
    let live = true;
    currentUser()
      .then((user) => {
        if (!live) return;
        if (user) signedIn(user);
        else setSession({ status: 'out' });
      })
      .catch(() => live && setSession({ status: 'out' }));
    const expired = () => setSession({ status: 'out' });
    window.addEventListener(AUTH_EXPIRED, expired);
    return () => {
      live = false;
      window.removeEventListener(AUTH_EXPIRED, expired);
    };
  }, [signedIn]);

  // Keep the URL in step with the session: sign-in pages only when signed out, and back.
  const out = session.status === 'out';
  const onAuthPage = AUTH_PATHS.has(path);
  useEffect(() => {
    if (out && !onAuthPage) {
      const here = location.pathname + location.search;
      navigate(here === '/' ? '/login' : `/login?next=${encodeURIComponent(here)}`, true);
    }
    if (session.status === 'in' && onAuthPage) navigate(returnPath(), true);
  }, [out, onAuthPage, session.status]);

  if (session.status === 'loading' || (session.status === 'in' && onAuthPage))
    return (
      <div className="auth-splash" aria-busy="true" aria-label="Loading Opsis">
        <BrandMark size={48} />
      </div>
    );
  if (session.status === 'out')
    return (
      <AuthPage
        mode={path === '/signup' ? 'signup' : 'login'}
        onSignedIn={(user) => {
          const next = returnPath();
          signedIn(user);
          navigate(next, true);
        }}
      />
    );
  return (
    <Workspace
      // A different account starts from a clean workspace.
      key={session.user.id}
      user={session.user}
      onSignOut={async () => {
        await logOut();
        setSession({ status: 'out' });
        navigate('/login', true);
      }}
    />
  );
}
