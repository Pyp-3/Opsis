import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { ZodError } from 'zod';
import { ErrorResponseSchema } from '@opsis/schema';
import { ApiStore } from './storage.js';
import { registerBoardRoutes, type BoardClientFactory } from './boards.js';
import { registerBoardLibrary } from './board-library.js';
import { registerAuth } from './auth.js';
import { kokoroEngine, registerSpeech, type SpeechEngine } from './speech.js';

const defaultDatabasePath = fileURLToPath(new URL('../data/opsis.sqlite', import.meta.url));

export type BuildAppOptions = FastifyServerOptions & {
  boardClientFactory?: BoardClientFactory;
  databasePath?: string;
  rateLimit?: number;
  rateWindowMs?: number;
  /** The natural narrator; null turns it off. Defaults to Kokoro unless OPSIS_SPEECH=off. */
  speech?: SpeechEngine | null;
};

function errorResponse(code: string, message: string, stage: string, retryable = false) {
  return ErrorResponseSchema.parse({ code, message, stage, retryable });
}

/** Builds the Fastify app with all routes registered, without binding a port. */
export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const {
    boardClientFactory,
    databasePath = process.env.OPSIS_DB_PATH ?? defaultDatabasePath,
    rateLimit = Number(process.env.OPSIS_RATE_LIMIT ?? 60),
    rateWindowMs = Number(process.env.OPSIS_RATE_WINDOW_MS ?? 60_000),
    speech = process.env.OPSIS_SPEECH === 'off' ? null : kokoroEngine(),
    ...fastifyOptions
  } = options;
  const app = Fastify(fastifyOptions);
  registerBoardRoutes(app, boardClientFactory);
  const store = new ApiStore(databasePath);
  registerAuth(app, store);
  // Agent runs use the local CLIs and their accounts: only signed-in people may start them.
  app.addHook('onRequest', async (request, reply) => {
    if (
      !request.user &&
      /^\/v1\/(?:agents|boards\/(?:generate|illustrate))(?:[/?]|$)/u.test(request.url)
    )
      return reply.code(401).send({ message: 'Sign in to continue.' });
  });
  registerBoardLibrary(app, store);
  registerSpeech(app, speech);
  const requests = new Map<string, number[]>();

  app.addHook('onClose', async () => store.close());
  app.addHook('onRequest', async (request, reply) => {
    // Speech is local work with its own bounded queue; a narrated board makes many requests.
    if (request.url === '/v1/health' || request.url.startsWith('/v1/speech')) return;
    const now = Date.now();
    // Multiple canvas views poll cheap library reads without consuming the write/model budget.
    const boardRead =
      request.method === 'GET' && /^\/v1\/boards(?:\/[a-f\d-]{36})?(?:\?|$)/i.test(request.url);
    // Sign-in attempts have their own budget: guessing passwords cannot also starve real work,
    // and real work cannot lock someone out of signing in.
    const bucket = boardRead ? 'board-read' : request.url.startsWith('/v1/auth/') ? 'auth' : 'work';
    const key = `${request.ip}:${bucket}`;
    const allowance = boardRead ? rateLimit * 10 : rateLimit;
    const recent = (requests.get(key) ?? []).filter((time) => now - time < rateWindowMs);
    if (recent.length >= allowance) {
      return reply
        .code(429)
        .send(
          errorResponse(
            'rate_limit_exceeded',
            'Too many requests. Please try again soon.',
            'request',
            true,
          ),
        );
    }
    recent.push(now);
    requests.set(key, recent);
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError)
      return reply
        .code(400)
        .send(
          errorResponse(
            'invalid_request',
            'Request validation failed: ' + error.issues.map((issue) => issue.message).join('; '),
            'request',
          ),
        );
    request.log.error(error);
    return reply
      .code(500)
      .send(
        errorResponse('internal_error', 'Opsis could not complete that request.', 'request', true),
      );
  });

  app.get('/v1/health', async () => ({ status: 'ok' }));

  return app;
}
