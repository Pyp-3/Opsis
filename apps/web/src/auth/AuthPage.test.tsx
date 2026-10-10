// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { passwordStrength } from './session';

vi.mock('../workspace/Workspace', () => ({
  Workspace: ({ user, onSignOut }: { user: { name: string }; onSignOut: () => void }) => (
    <div>
      <p>Workspace for {user.name}</p>
      <button onClick={onSignOut}>Log out</button>
    </div>
  ),
}));

const ada = { id: 'u1', email: 'ada@example.com', name: 'Ada' };
let signedIn = false;
let signupOpen = true;
function stubApi() {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(init.body as string) as Record<string, string>) : {};
    if (url === '/v1/instance')
      return Response.json({ signup: signupOpen, accountExecutablePaths: signupOpen });
    if (url === '/v1/auth/me')
      return signedIn ? Response.json({ user: ada }) : Response.json({}, { status: 401 });
    // Boards here are private: not shared by link.
    if (url.startsWith('/v1/guest/boards/'))
      return Response.json({ message: 'Board not found.' }, { status: 404 });
    if (url === '/v1/auth/signup') {
      if (body.email === 'taken@example.com')
        return Response.json(
          { message: 'An account with this email already exists. Log in instead.', field: 'email' },
          { status: 409 },
        );
      signedIn = true;
      return Response.json({ user: { ...ada, name: body.name } }, { status: 201 });
    }
    if (url === '/v1/auth/login') {
      if (body.password !== 'correct horse')
        return Response.json({ message: 'That email and password don’t match.' }, { status: 401 });
      signedIn = true;
      return Response.json({ user: ada });
    }
    if (url === '/v1/auth/logout') {
      signedIn = false;
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

beforeEach(() => {
  signedIn = false;
  signupOpen = true;
  // Skip the exit animation's delay.
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  stubApi();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('signing in', () => {
  it('sends signed-out visitors to log in, remembering where they were going', async () => {
    history.replaceState(null, '', '/canvas?board=abc');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeDefined();
    await waitFor(() =>
      expect(location.pathname + location.search).toBe(
        `/login?next=${encodeURIComponent('/canvas?board=abc')}`,
      ),
    );
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong pass' } });
    fireEvent.click(screen.getByRole('button', { name: /^Log in/ }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('That email and password don’t match.'),
    );
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse' } });
    fireEvent.click(screen.getByRole('button', { name: /^Log in/ }));
    expect(await screen.findByText('Workspace for Ada')).toBeDefined();
    expect(location.pathname + location.search).toBe('/canvas?board=abc');
  });

  it('switches to sign up, shows password strength, explains a taken email, and signs up', async () => {
    history.replaceState(null, '', '/login');
    render(<App />);
    await screen.findByRole('heading', { name: 'Welcome back' });
    fireEvent.click(screen.getByRole('tab', { name: 'Sign up' }));
    expect(location.pathname).toBe('/signup');
    expect(screen.getByRole('heading', { name: 'Create your account' })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'Sign up' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Grace' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'taken@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Correct-horse-9' } });
    expect(screen.getByText('Strong')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /^Create account/ }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/already exists/));
    expect(screen.getByLabelText('Email').getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'grace@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /^Create account/ }));
    expect(await screen.findByText('Workspace for Grace')).toBeDefined();
    expect(location.pathname).toBe('/');
  });

  it('keeps a session across reloads and logs out back to the sign-in page', async () => {
    signedIn = true;
    history.replaceState(null, '', '/boards');
    render(<App />);
    expect(await screen.findByText('Workspace for Ada')).toBeDefined();
    expect(location.pathname).toBe('/boards');
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(location.pathname).toBe('/login'));
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeDefined();
  });

  it('offers only logging in on a server whose operator creates the accounts', async () => {
    signupOpen = false;
    history.replaceState(null, '', '/signup?next=%2Fboards');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeDefined();
    await waitFor(() => expect(location.pathname + location.search).toBe('/login?next=%2Fboards'));
    expect(screen.queryByRole('tab', { name: 'Sign up' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create an account' })).toBeNull();
    expect(
      screen.getByText('New here? Ask the person who runs this Opsis server for an account.'),
    ).toBeDefined();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse' } });
    fireEvent.click(screen.getByRole('button', { name: /^Log in/ }));
    expect(await screen.findByText('Workspace for Ada')).toBeDefined();
    expect(location.pathname).toBe('/boards');
  });

  it('rates passwords by length and variety', () => {
    expect(passwordStrength('')).toBe(0);
    expect(passwordStrength('short')).toBe(0);
    expect(passwordStrength('longenough')).toBe(1);
    expect(passwordStrength('Longenough12')).toBe(3);
    expect(passwordStrength('Long-enough-12')).toBe(4);
  });
});
