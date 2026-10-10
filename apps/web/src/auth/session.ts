import { apiFetch as fetch } from '../app-url';
import { z } from 'zod';

export const UserSchema = z.object({ id: z.string(), email: z.string(), name: z.string() });
export type User = z.infer<typeof UserSchema>;

/** A message for the person, and the form field it is about when there is one. */
export class AuthError extends Error {
  constructor(
    message: string,
    readonly field?: 'name' | 'email' | 'password',
  ) {
    super(message);
  }
}

/** The signed-in account, or null when there is no valid session. */
export async function currentUser(): Promise<User | null> {
  const response = await fetch('/v1/auth/me');
  if (response.status === 401) return null;
  if (!response.ok) throw new Error('Opsis is not reachable. Start the API and reload.');
  return UserSchema.parse(((await response.json()) as { user: unknown }).user);
}

async function submit(path: string, body: Record<string, string>) {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthError('Opsis is not reachable. Check that the API is running.');
  }
  const payload = (await response.json().catch(() => ({}))) as {
    user?: unknown;
    message?: string;
    field?: string;
  };
  if (!response.ok) {
    const field = ['name', 'email', 'password'].includes(payload.field ?? '')
      ? (payload.field as 'name' | 'email' | 'password')
      : undefined;
    throw new AuthError(
      response.status === 429
        ? 'Too many attempts. Wait a minute and try again.'
        : (payload.message ?? 'Something went wrong. Try again.'),
      field,
    );
  }
  return UserSchema.parse(payload.user);
}

export const logIn = (email: string, password: string) =>
  submit('/v1/auth/login', { email, password });
export const signUp = (name: string, email: string, password: string) =>
  submit('/v1/auth/signup', { name, email, password });
export async function logOut() {
  await fetch('/v1/auth/logout', { method: 'POST' }).catch(() => undefined);
}

/** 0–4: length and variety, as a nudge rather than a rule. */
export function passwordStrength(password: string) {
  if (!password) return 0;
  let score = password.length >= 8 ? 1 : 0;
  if (password.length >= 12) score++;
  if (/[a-z]/u.test(password) && /[A-Z]/u.test(password)) score++;
  if (/\d/u.test(password) && /[^A-Za-z0-9]/u.test(password)) score++;
  else if (password.length >= 16) score++;
  return Math.min(4, score);
}
