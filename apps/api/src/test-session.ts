import { randomUUID } from 'node:crypto';
import type { FastifyInstance, InjectOptions } from 'fastify';

/**
 * Makes every later `app.inject` call carry a session cookie, so tests about other behaviour
 * run as a signed-in person. `cookie` may still be pending; calls wait for it.
 */
export function withSession(app: FastifyInstance, cookie: string | Promise<string>) {
  const inject = app.inject.bind(app) as (options: InjectOptions | string) => Promise<unknown>;
  (app as { inject: unknown }).inject = async (options: InjectOptions | string) => {
    const headers = { cookie: await cookie };
    return inject(
      typeof options === 'string'
        ? { url: options, headers }
        : { ...options, headers: { ...headers, ...options.headers } },
    );
  };
}

/** Signs a fresh account up and in for the rest of the test. Resolves to its session cookie. */
export function signIn(app: FastifyInstance, name = 'Test reader') {
  const cookie = app
    .inject({
      method: 'POST',
      url: '/v1/auth/signup',
      payload: { name, email: `reader-${randomUUID()}@example.com`, password: 'correct horse' },
    })
    .then((response) => {
      if (response.statusCode !== 201) throw new Error(`Sign-up failed: ${response.body}`);
      return String(response.headers['set-cookie']).split(';')[0]!;
    });
  withSession(app, cookie);
  return cookie;
}
