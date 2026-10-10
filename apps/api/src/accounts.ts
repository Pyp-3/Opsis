import { randomBytes, randomUUID } from 'node:crypto';
import { hashPassword } from './auth.js';
import { SignUpSchema } from './auth-contract.js';
import type { ApiStore } from './storage.js';

/**
 * Operator account management for a personal server, where sign-up is closed: the person
 * running the server creates accounts and resets forgotten passwords from its shell.
 */

/** 18 random bytes (24 characters): a strong password the operator passes on once. */
export const generatedPassword = () => randomBytes(18).toString('base64url');

const problem = (error: { issues: { message: string }[] }) =>
  error.issues[0]?.message ?? 'Check the account details.';

export async function createAccount(
  store: ApiStore,
  input: { email: string; name: string; password: string },
) {
  const parsed = SignUpSchema.safeParse(input);
  if (!parsed.success) throw new Error(problem(parsed.error));
  const user = store.createUser({
    id: randomUUID(),
    email: parsed.data.email,
    name: parsed.data.name,
    password: await hashPassword(parsed.data.password),
  });
  if (!user) throw new Error(`An account with ${parsed.data.email} already exists.`);
  return user;
}

export async function resetAccountPassword(store: ApiStore, email: string, password: string) {
  const parsed = SignUpSchema.pick({ email: true, password: true }).safeParse({ email, password });
  if (!parsed.success) throw new Error(problem(parsed.error));
  const account = store.findUserByEmail(parsed.data.email);
  if (!account) throw new Error(`No account uses ${parsed.data.email}.`);
  store.resetPassword(account.id, await hashPassword(parsed.data.password));
  return { id: account.id, email: account.email, name: account.name };
}
