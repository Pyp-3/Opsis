import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ApiStore, User } from './storage.js';
import { SignUpSchema, LogInSchema, AgentKeyNameSchema } from './auth-contract.js';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  length: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SESSION_COOKIE = 'opsis_session';
const SESSION_DAYS = 30;
const AGENT_KEY_PREFIX = 'opsis_agent_';

declare module 'fastify' {
  interface FastifyRequest {
    /** The signed-in account, from the session cookie or a local agent key. */
    user: User | null;
    /** True when `user` came from an agent key rather than a browser session. */
    viaAgent: boolean;
  }
}

/** `scrypt$<salt>$<hash>`, both base64url. */
export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password.normalize('NFKC'), salt, 64, SCRYPT);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = await scryptAsync(
    password.normalize('NFKC'),
    Buffer.from(salt, 'base64url'),
    expected.length,
    SCRYPT,
  );
  return timingSafeEqual(actual, expected);
}

/** Tokens are stored only as hashes, so a leaked database cannot be replayed as a login. */
const digest = (token: string) => createHash('sha256').update(token).digest('base64url');

function cookie(request: FastifyRequest, name: string) {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

function sessionCookie(
  request: FastifyRequest,
  value: string,
  maxAge: number,
  alwaysSecure: boolean,
) {
  const secure = alwaysSecure || request.protocol === 'https' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
/**
 * Agent keys are for agents on this machine only (the MCP server). A request qualifies when it
 * reaches the API directly over loopback and carries none of the headers a browser or a
 * forwarding proxy adds, so a key cannot be used from a web page or from elsewhere on a network.
 */
export function isInternalRequest(request: FastifyRequest) {
  const headers = request.headers;
  return (
    LOOPBACK.has(request.socket.remoteAddress ?? '') &&
    // Browsers always send Sec-Fetch-Site/Dest; Node's fetch sends neither (only -Mode).
    !headers.origin &&
    !headers['sec-fetch-site'] &&
    !headers['sec-fetch-dest'] &&
    !headers['x-forwarded-for'] &&
    !headers.forwarded
  );
}

/** Same work whether or not the email exists, so timing does not reveal accounts. */
const DUMMY_HASH = hashPassword(randomUUID());

export type AuthOptions = {
  /** False on a personal server: its operator creates accounts (`pnpm --filter api accounts`). */
  signup?: boolean;
  /** Mark the session cookie Secure even when this hop is plain HTTP (behind a TLS proxy). */
  secureCookies?: boolean;
  guestEmails?: readonly string[];
};

export function registerAuth(
  app: FastifyInstance,
  store: ApiStore,
  { signup = true, secureCookies = false, guestEmails = [] }: AuthOptions = {},
) {
  const guests = new Set(guestEmails.map((email) => email.toLowerCase()));
  const publicUser = (user: User): User =>
    guests.has(user.email.toLowerCase()) ? { ...user, role: 'guest' } : user;
  app.decorateRequest('user', null);
  app.decorateRequest('viaAgent', false);
  app.addHook('onRequest', async (request) => {
    const session = cookie(request, SESSION_COOKIE);
    if (session) {
      const user = store.sessionUser(digest(session));
      request.user = user ? publicUser(user) : null;
      if (request.user) return;
    }
    const bearer = /^Bearer (\S+)$/u.exec(request.headers.authorization ?? '')?.[1];
    if (bearer?.startsWith(AGENT_KEY_PREFIX) && isInternalRequest(request)) {
      const user = store.agentKeyUser(digest(bearer));
      request.user = user ? publicUser(user) : null;
      request.viaAgent = !!request.user;
    }
  });

  const startSession = (request: FastifyRequest, reply: FastifyReply, user: User) => {
    const token = randomBytes(32).toString('base64url');
    store.createSession(digest(token), user.id, Date.now() + SESSION_DAYS * 86_400_000);
    reply.header('set-cookie', sessionCookie(request, token, SESSION_DAYS * 86_400, secureCookies));
    return { user: publicUser(user) };
  };
  const invalid = (reply: FastifyReply, error: z.ZodError) =>
    reply.code(400).send({
      message: error.issues[0]?.message ?? 'Check the form and try again.',
      field: error.issues[0]?.path[0],
    });

  app.post('/v1/auth/signup', async (request, reply) => {
    if (!signup)
      return reply.code(403).send({
        message: 'Sign-up is closed on this server. Ask its operator for an account.',
      });
    const body = SignUpSchema.safeParse(request.body);
    if (!body.success) return invalid(reply, body.error);
    const user = store.createUser({
      id: randomUUID(),
      email: body.data.email,
      name: body.data.name,
      password: await hashPassword(body.data.password),
    });
    if (!user)
      return reply.code(409).send({
        message: 'An account with this email already exists. Log in instead.',
        field: 'email',
      });
    return reply.code(201).send(startSession(request, reply, user));
  });

  app.post('/v1/auth/login', async (request, reply) => {
    const body = LogInSchema.safeParse(request.body);
    if (!body.success) return invalid(reply, body.error);
    const account = store.findUserByEmail(body.data.email);
    const valid = await verifyPassword(body.data.password, account?.password ?? (await DUMMY_HASH));
    if (!account || !valid)
      return reply.code(401).send({ message: 'That email and password don’t match.' });
    return startSession(request, reply, {
      id: account.id,
      email: account.email,
      name: account.name,
    });
  });

  app.post('/v1/auth/logout', async (request, reply) => {
    const session = cookie(request, SESSION_COOKIE);
    if (session) store.deleteSession(digest(session));
    reply.header('set-cookie', sessionCookie(request, '', 0, secureCookies));
    return reply.code(204).send();
  });

  app.get('/v1/auth/me', async (request, reply) =>
    request.user ? { user: request.user } : reply.code(401).send({ message: 'Not signed in.' }),
  );

  // Agent keys are managed from a browser session only; an agent cannot mint more keys.
  const sessionOnly = (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user || request.viaAgent) {
      void reply.code(401).send({ message: 'Sign in to manage agent keys.' });
      return null;
    }
    return request.user;
  };
  app.get('/v1/auth/agent-keys', async (request, reply) => {
    const user = sessionOnly(request, reply);
    return user ? store.listAgentKeys(user.id) : reply;
  });
  app.post('/v1/auth/agent-keys', async (request, reply) => {
    const user = sessionOnly(request, reply);
    if (!user) return reply;
    const body = AgentKeyNameSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ message: 'Name the key (1–60 characters).' });
    const key = `${AGENT_KEY_PREFIX}${randomBytes(24).toString('base64url')}`;
    const id = randomUUID();
    store.createAgentKey({ id, userId: user.id, name: body.data.name, tokenHash: digest(key) });
    // The only time the key is shown; only its hash is kept.
    return reply.code(201).send({ id, name: body.data.name, key });
  });
  app.delete('/v1/auth/agent-keys/:id', async (request, reply) => {
    const user = sessionOnly(request, reply);
    if (!user) return reply;
    const id = (request.params as { id: string }).id;
    return store.deleteAgentKey(id, user.id)
      ? reply.code(204).send()
      : reply.code(404).send({ message: 'Key not found.' });
  });
}

/** Ends a request with 401 unless someone is signed in; returns the account otherwise. */
export function requireUser(request: FastifyRequest, reply: FastifyReply) {
  if (request.user) return request.user;
  void reply.code(401).send({ message: 'Sign in to continue.' });
  return null;
}
