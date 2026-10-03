// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { currentUser, logOut, type User } from './auth/session';
import { AUTH_EXPIRED, setRecoveryScope } from './workspace/useBoardLibrary';

const user: User = { id: 'account-one', name: 'Reader', email: 'reader@example.com' };

vi.mock('./auth/session', () => ({ currentUser: vi.fn(), logOut: vi.fn() }));
vi.mock('./workspace/useBoardLibrary', () => ({
  AUTH_EXPIRED: 'opsis:auth-expired',
  setRecoveryScope: vi.fn(),
}));
vi.mock('./workspace/Workspace', () => ({
  Workspace: ({ user, onSignOut }: { user: User; onSignOut: () => void }) => (
    <div>
      <h1>{user.name}'s workspace</h1>
      <button onClick={onSignOut}>Sign out</button>
    </div>
  ),
}));
vi.mock('./auth/AuthPage', () => ({
  AuthPage: ({ mode, onSignedIn }: { mode: string; onSignedIn: (user: User) => void }) => (
    <div>
      <h1>{mode}</h1>
      <button onClick={() => onSignedIn(user)}>Sign in</button>
    </div>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  history.replaceState(null, '', '/');
  vi.mocked(currentUser).mockResolvedValue(null);
  vi.mocked(logOut).mockResolvedValue(undefined);
});
afterEach(cleanup);

it('shows the loading state until the current session resolves', async () => {
  let resolve!: (value: User | null) => void;
  vi.mocked(currentUser).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  render(<App />);
  expect(screen.getByLabelText('Loading Opsis')).toBeDefined();
  await act(async () => resolve(user));
  expect(screen.getByRole('heading', { name: "Reader's workspace" })).toBeDefined();
  expect(setRecoveryScope).toHaveBeenCalledWith(user.id);
});

it('preserves a board deep link through login', async () => {
  history.replaceState(null, '', '/canvas?board=shared-board');
  render(<App />);
  await screen.findByRole('heading', { name: 'login' });
  expect(location.pathname).toBe('/login');
  expect(new URLSearchParams(location.search).get('next')).toBe('/canvas?board=shared-board');
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByRole('heading', { name: "Reader's workspace" });
  expect(location.pathname + location.search).toBe('/canvas?board=shared-board');
});

it('returns an existing session from an auth page to its local destination', async () => {
  history.replaceState(null, '', '/signup?next=%2Fboards');
  vi.mocked(currentUser).mockResolvedValue(user);
  render(<App />);
  await screen.findByRole('heading', { name: "Reader's workspace" });
  expect(location.pathname).toBe('/boards');
});

it.each(['https://example.com', '//example.com'])(
  'does not use an external return path: %s',
  async (next) => {
    history.replaceState(null, '', `/login?next=${encodeURIComponent(next)}`);
    vi.mocked(currentUser).mockResolvedValue(user);
    render(<App />);
    await screen.findByRole('heading', { name: "Reader's workspace" });
    expect(location.pathname).toBe('/');
  },
);

it('returns to login when the session expires', async () => {
  vi.mocked(currentUser).mockResolvedValue(user);
  render(<App />);
  await screen.findByRole('heading', { name: "Reader's workspace" });
  act(() => window.dispatchEvent(new Event(AUTH_EXPIRED)));
  await screen.findByRole('heading', { name: 'login' });
  expect(location.pathname).toBe('/login');
});

it('signs out the active account and removes its workspace', async () => {
  vi.mocked(currentUser).mockResolvedValue(user);
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
  await screen.findByRole('heading', { name: 'login' });
  expect(logOut).toHaveBeenCalledOnce();
  expect(screen.queryByRole('heading', { name: "Reader's workspace" })).toBeNull();
});

it('treats an unavailable session service as signed out', async () => {
  vi.mocked(currentUser).mockRejectedValue(new Error('offline'));
  render(<App />);
  await waitFor(() => expect(location.pathname).toBe('/login'));
  expect(screen.getByRole('heading', { name: 'login' })).toBeDefined();
});
