import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
const Workspace = lazy(() =>
  import('./workspace/Workspace').then((module) => ({ default: module.Workspace })),
);
import './workspace/styles/foundation.css';
import { BrandMark } from './workspace/BrandMark';
import { AUTH_EXPIRED, setRecoveryScope } from './workspace/useBoardLibrary';
import { AuthPage } from './auth/AuthPage';
import { currentUser, logOut, type User } from './auth/session';
import { navigate, usePath } from './router';
import { appPath } from './app-url';
import { useInstance } from './instance';
import { UpdateNotice } from './workspace/UpdateNotice';
import { loadAccountSettings, resetAccountSettings } from './workspace/account-settings';
import { adoptAccountAppearance } from './workspace/app-theme';

type Session =
  { status: 'loading' } | { status: 'out' } | { status: 'in'; user: User; settingsError?: string };
const AUTH_PATHS = new Set(['/login', '/signup']);

/** Where to go after signing in: the `next` the sign-in page was opened with, if it is ours. */
function returnPath() {
  const next = new URLSearchParams(location.search).get('next');
  return next?.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export function App() {
  return (
    <>
      <Shell />
      <UpdateNotice />
    </>
  );
}

function Shell() {
  const [session, setSession] = useState<Session>({ status: 'loading' });
  const path = usePath();
  // Whether this host offers sign-up; known before the sign-in page shows its choices.
  const instance = useInstance();

  const signedIn = useCallback(async (user: User) => {
    // Before the workspace mounts, so it restores this account's own recovery copy.
    setRecoveryScope(user.id);
    // Account settings load first so the workspace starts with this account's models.
    let settingsError: string | undefined;
    try {
      await loadAccountSettings();
      await adoptAccountAppearance(user.id);
    } catch (e) {
      settingsError = e instanceof Error ? e.message : 'Could not load your account settings.';
    }
    setSession({ status: 'in', user, ...(settingsError ? { settingsError } : {}) });
  }, []);
  useEffect(() => {
    let live = true;
    currentUser()
      .then((user) => {
        if (!live) return;
        if (user) void signedIn(user);
        else setSession({ status: 'out' });
      })
      .catch(() => live && setSession({ status: 'out' }));
    const expired = () => {
      resetAccountSettings();
      setSession({ status: 'out' });
    };
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
      const here = appPath() + location.search;
      navigate(here === '/' ? '/login' : `/login?next=${encodeURIComponent(here)}`, true);
    }
    if (session.status === 'in' && onAuthPage) navigate(returnPath(), true);
    if (out && path === '/signup' && instance?.signup === false)
      navigate(`/login${location.search}`, true);
  }, [out, onAuthPage, session.status, path, instance]);

  if (
    session.status === 'loading' ||
    (session.status === 'in' && onAuthPage) ||
    (session.status === 'out' && !instance)
  )
    return (
      <div className="auth-splash" aria-busy="true" aria-label="Loading Opsis">
        <BrandMark size={48} />
      </div>
    );
  if (session.status === 'out')
    return (
      <AuthPage
        mode={path === '/signup' && instance?.signup ? 'signup' : 'login'}
        signup={!!instance?.signup}
        onSignedIn={async (user) => {
          const next = returnPath();
          await signedIn(user);
          navigate(next, true);
        }}
      />
    );
  return (
    <Suspense
      fallback={
        <div className="auth-splash" role="status">
          Loading workspace…
        </div>
      }
    >
      <Workspace
        // A different account starts from a clean workspace.
        key={session.user.id}
        user={session.user}
        {...(session.settingsError ? { settingsError: session.settingsError } : {})}
        onSignOut={async () => {
          await logOut();
          resetAccountSettings();
          setSession({ status: 'out' });
          navigate('/login', true);
        }}
      />
    </Suspense>
  );
}
