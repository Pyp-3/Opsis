import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

/** Builds the Fastify app with all routes registered, without binding a port. */
export function buildApp(options: FastifyServerOptions = {}): FastifyInstance {
  const app = Fastify(options);

  app.get('/v1/health', async () => ({ status: 'ok' as const }));

  return app;
}
