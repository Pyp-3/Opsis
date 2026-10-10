import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
const Workspace = lazy(() =>
  import('./workspace/Workspace').then((module) => ({ default: module.Workspace })),
);
const GuestWorkspace = lazy(() =>
  import('./workspace/GuestWorkspace').then((module) => ({ default: module.GuestWorkspace })),
);
const GuestBoard = lazy(() =>
  import('./workspace/GuestBoard').then((module) => ({ default: module.GuestBoard })),
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

/** A board link (`/canvas?board=…&page=…`), which signed-out visitors may open if it is shared. */
function boardLink(path: string) {
  if (path !== '/canvas') return null;
  const params = new URLSearchParams(location.search);
  const board = params.get('board');
  return board ? { board, page: params.get('page') } : null;
}

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
    if (user.role === 'guest') {
      resetAccountSettings();
      setRecoveryScope(user.id);
      setSession({ status: 'in', user });
      return;
    }
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
  const guestLink = out ? boardLink(path) : null;
  const guest = !!guestLink;
  // A link that is not shared by link may be the reader's own board: sign in, then open it.
  const toSignIn = useCallback(() => {
    const here = appPath() + location.search;
    navigate(`/login?next=${encodeURIComponent(here)}`, true);
  }, []);
  useEffect(() => {
    if (out && !onAuthPage && !guest) {
      const here = appPath() + location.search;
      navigate(here === '/' ? '/login' : `/login?next=${encodeURIComponent(here)}`, true);
    }
    if (session.status === 'in' && onAuthPage) navigate(returnPath(), true);
    if (out && path === '/signup' && instance?.signup === false)
      navigate(`/login${location.search}`, true);
  }, [out, onAuthPage, guest, session.status, path, instance]);

  if (guestLink)
    return (
      <Suspense
        fallback={
          <div className="auth-splash" role="status">
            Opening the shared board…
          </div>
        }
      >
        <GuestBoard boardId={guestLink.board} pageId={guestLink.page} onUnavailable={toSignIn} />
      </Suspense>
    );
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
      {session.user.role === 'guest' ? (
        <GuestWorkspace
          key={session.user.id}
          onSignOut={async () => {
            await logOut();
            resetAccountSettings();
            setSession({ status: 'out' });
            navigate('/login', true);
          }}
        />
      ) : (
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
      )}
    </Suspense>
  );
}
