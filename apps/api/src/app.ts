import { fileURLToPath } from 'node:url';
import { sep } from 'node:path';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { ErrorResponseSchema, LOCAL_INSTANCE, type InstanceInfo } from '@opsis/schema';
import { ApiStore } from './storage.js';
import { registerBoardRoutes, type BoardClientFactory } from './boards.js';
import { registerBoardLibrary } from './board-library.js';
import { registerBoardCollections } from './board-collections.js';
import { registerAccountSettings } from './account-settings.js';
import { registerBoardChat } from './board-chat.js';
import { registerBoardSearch } from './board-search.js';
import { isInternalRequest, registerAuth, requireUser } from './auth.js';
import { registerRender } from './render.js';
import { serverModeFromEnv, WEB_APP_CSP, type ServerMode } from './server-mode.js';
import { kokoroEngine, registerSpeech, type SpeechEngine } from './speech.js';
import { ProviderKeys, registerProviderKeys } from './provider-keys';
import { localBoardClient } from './boards/client';
import { fileThreadSessionCleaner, type ThreadSessionCleaner } from './cli-sessions.js';
import { DEFAULT_SESSION_ROOT } from './harness/client.js';

const defaultDatabasePath = fileURLToPath(new URL('../data/opsis.sqlite', import.meta.url));

export type BuildAppOptions = FastifyServerOptions & {
  boardClientFactory?: BoardClientFactory;
  databasePath?: string;
  rateLimit?: number;
  rateWindowMs?: number;
  /** The natural narrator; null turns it off. Defaults to Kokoro unless OPSIS_SPEECH=off. */
  speech?: SpeechEngine | null;
  /** Removes deleted chat threads' native CLI sessions; defaults to the shared session root. */
  removeThreadSessions?: ThreadSessionCleaner;
  /** A personal server behind an HTTPS proxy; defaults to `OPSIS_PUBLIC_ORIGIN`, else local. */
  serverMode?: ServerMode | null;
};

function errorResponse(code: string, message: string, stage: string, retryable = false) {
  return ErrorResponseSchema.parse({ code, message, stage, retryable });
}

/** On a server the agent CLIs are the server's own: an account cannot point at another program. */
function serverExecutables(factory: BoardClientFactory): BoardClientFactory {
  return (agent, settings, ...rest) => {
    if (!settings?.executablePath) return factory(agent, settings, ...rest);
    const serverSettings = { ...settings };
    delete serverSettings.executablePath;
    return factory(agent, serverSettings, ...rest);
  };
}

/**
 * Behind the proxy, every browser request must arrive over HTTPS for the public origin, and
 * writes must come from pages on that origin. Agents on the server itself (the MCP server)
 * still reach the API directly over loopback.
 */
function registerServerBoundary(app: FastifyInstance, serverMode: ServerMode) {
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Strict-Transport-Security', 'max-age=31536000');
    reply.header('Content-Security-Policy', WEB_APP_CSP);
    reply.header('X-Frame-Options', 'DENY');
    // Cross-origin isolation lets the narrator's speech model use several CPU threads.
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    reply.header('Cross-Origin-Embedder-Policy', 'credentialless');
    if (isInternalRequest(request)) return;
    if (request.protocol !== 'https' || request.host !== serverMode.publicHost)
      return reply.code(421).send({ message: `Open Opsis at ${serverMode.publicOrigin}.` });
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      request.headers.origin !== serverMode.publicOrigin
    )
      return reply.code(403).send({ message: 'Cross-site writes are not allowed.' });
  });
}

/** The built web app, with page routes such as /boards falling back to its index. */
function registerWebApp(app: FastifyInstance, webRoot: string) {
  void app.register(fastifyStatic, {
    root: webRoot,
    wildcard: true,
    cacheControl: false,
    // Vite fingerprints everything under assets/; the index must be revalidated to pick them up.
    setHeaders: (response, path) =>
      response.setHeader(
        'Cache-Control',
        path.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
      ),
  });
  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?')[0] ?? '';
    if (request.method === 'GET' && !path.startsWith('/v1/') && !/\.[\w]+$/u.test(path))
      return reply.sendFile('index.html');
    return reply.code(404).send({
      message: `Route ${request.method}:${path} not found`,
      error: 'Not Found',
      statusCode: 404,
    });
  });
}

/** Builds the Fastify app with all routes registered, without binding a port. */
export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const {
    boardClientFactory,
    databasePath = process.env.OPSIS_DB_PATH ?? defaultDatabasePath,
    rateLimit = Number(process.env.OPSIS_RATE_LIMIT ?? 60),
    rateWindowMs = Number(process.env.OPSIS_RATE_WINDOW_MS ?? 60_000),
    speech = process.env.OPSIS_SPEECH === 'off' ? null : kokoroEngine(),
    removeThreadSessions = fileThreadSessionCleaner(DEFAULT_SESSION_ROOT),
    serverMode = serverModeFromEnv(),
    ...fastifyOptions
  } = options;
  const app = Fastify({
    ...fastifyOptions,
    ...(serverMode ? { trustProxy: serverMode.trustedProxy } : {}),
  });
  if (serverMode) registerServerBoundary(app, serverMode);
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    if (request.url.startsWith('/v1/')) reply.header('Cache-Control', 'no-store');
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      request.headers['sec-fetch-site'] === 'cross-site'
    )
      return reply.code(403).send({ message: 'Cross-site writes are not allowed.' });
  });
  const providerKeys = new ProviderKeys(databasePath);
  const factory: BoardClientFactory =
    boardClientFactory ??
    ((agent, settings, schema) =>
      localBoardClient(agent, settings, schema, providerKeys.get(agent)));
  registerBoardRoutes(app, serverMode ? serverExecutables(factory) : factory);
  const store = new ApiStore(databasePath);
  registerAuth(app, store, { signup: !serverMode, secureCookies: !!serverMode });
  registerProviderKeys(app, providerKeys);
  // Generation spends the instance's API/CLI quota: only signed-in people may start it.
  // Checks use the matched route: the router decodes paths, so `/v1/boards/%67enerate` is
  // `/v1/boards/generate` too.
  app.addHook('onRequest', async (request, reply) => {
    if (
      !request.user &&
      /^\/v1\/(?:agents|boards\/(?:generate|illustrate|check-agent))$/u.test(
        request.routeOptions.url ?? '',
      )
    )
      return reply.code(401).send({ message: 'Sign in to continue.' });
  });
  registerBoardLibrary(app, store, removeThreadSessions);
  registerBoardCollections(app, store);
  registerAccountSettings(app, store);
  registerBoardChat(app, store, removeThreadSessions);
  registerBoardSearch(app, store);
  registerSpeech(app, speech);
  registerRender(app, { requireUser });
  const requests = new Map<string, number[]>();

  app.addHook('onClose', async () => store.close());
  app.addHook('onRequest', async (request, reply) => {
    // Speech is local work with its own bounded queue; a narrated board makes many requests.
    // Only API routes count, never the files of the web app a personal server serves.
    const route = request.routeOptions.url ?? '';
    if (!route.startsWith('/v1/') || route === '/v1/health' || route.startsWith('/v1/speech'))
      return;
    const now = Date.now();
    // Multiple canvas views poll cheap library reads without consuming the write/model budget.
    const boardRead =
      request.method === 'GET' && (route === '/v1/boards' || route === '/v1/boards/:id');
    // Sign-in attempts have their own budget: guessing passwords cannot also starve real work,
    // and real work cannot lock someone out of signing in.
    const bucket = boardRead ? 'board-read' : route.startsWith('/v1/auth/') ? 'auth' : 'work';
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
  const instance: InstanceInfo = serverMode
    ? { signup: false, accountExecutablePaths: false }
    : LOCAL_INSTANCE;
  app.get('/v1/instance', async () => instance);
  if (serverMode) registerWebApp(app, serverMode.webRoot);

  return app;
}
