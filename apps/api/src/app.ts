import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  type FastifyServerOptions,
} from 'fastify';
import { ZodError, z } from 'zod';
import { drilldown, ExplainError, explainNode } from '@opsis/explain';
import { layoutVisualPlan } from '@opsis/layout';
import { selectMetaphor } from '@opsis/metaphor';
import { ParseError, parseUtterance, type LLMClient } from '@opsis/parse';
import {
  createCacheKey,
  DrilldownRequestSchema,
  ErrorResponseSchema,
  ExplainRequestSchema,
  ExplanationSchema,
  OSGSchema,
  SaveOSGRequestSchema,
  SemanticGraphSchema,
  VisualizeProgressSchema,
  VisualizeRequestSchema,
  visualPlanSchemaFor,
  type ErrorResponse,
  type Explanation,
  type OSG,
  type SemanticGraph,
  type VisualPlan,
  type VisualizeProgress,
  type VisualizeRequest,
} from '@opsis/schema';
import { llmClientFromEnvironment } from './llm.js';
import { ApiStore } from './storage.js';

const IdParamsSchema = z.object({ id: z.string().uuid() }).strict();
const HealthResponseSchema = z.object({ status: z.literal('ok') }).strict();
const ShareResponseSchema = z
  .object({
    token: z.string().min(1),
    osgId: z.string().uuid(),
    url: z.string(),
    readOnly: z.literal(true),
  })
  .strict();
const defaultDatabasePath = fileURLToPath(new URL('../data/opsis.sqlite', import.meta.url));

export type BuildAppOptions = FastifyServerOptions & {
  databasePath?: string;
  llm?: LLMClient | null;
  rateLimit?: number;
  rateWindowMs?: number;
  memoryCacheEntries?: number;
};

type PipelineConfig = { audience: 'child' | 'teen' | 'adult'; seed: number };

function errorResponse(
  code: string,
  message: string,
  stage: string,
  retryable = false,
): ErrorResponse {
  return ErrorResponseSchema.parse({ code, message, stage, retryable });
}

function validationError(error: ZodError): ErrorResponse {
  const tooLong = error.issues.some(
    (issue) => issue.path[0] === 'utterance' && issue.code === 'too_big',
  );
  return errorResponse(
    tooLong ? 'utterance_too_long' : 'invalid_request',
    tooLong
      ? 'Please keep the sentence to 500 characters or fewer.'
      : `Request validation failed: ${error.issues.map((issue) => issue.message).join('; ')}`,
    tooLong ? 'parse' : 'request',
  );
}

function modelId(llm: LLMClient | null): string {
  return llm?.model ?? 'offline';
}

async function runVisualize(
  input: VisualizeRequest,
  store: ApiStore,
  llm: LLMClient | null,
  progress: (stage: VisualizeProgress) => void,
): Promise<OSG> {
  const config: PipelineConfig = { audience: input.audience ?? 'teen', seed: input.seed ?? 0 };
  const normalized = input.utterance.trim();
  const currentModel = modelId(llm);

  progress('parsing');
  const parseKey = createCacheKey(
    'parsing',
    normalized,
    { audience: config.audience },
    currentModel,
  );
  let sg = store.getCache<SemanticGraph>(parseKey);
  if (sg) sg = SemanticGraphSchema.parse(sg);
  if (!sg) {
    sg = (await parseUtterance(normalized, { llm, audience: config.audience })).sg;
    store.setCache(parseKey, sg);
  }

  progress('mapping');
  const mappingKey = createCacheKey('mapping', sg, {}, currentModel);
  let plan = store.getCache<VisualPlan>(mappingKey);
  if (plan) plan = visualPlanSchemaFor(sg).parse(plan);
  if (!plan) {
    plan = (await selectMetaphor(sg, { llm })).plan;
    store.setCache(mappingKey, plan);
  }

  progress('layout');
  const layoutKey = createCacheKey('layout', { sg, plan }, { seed: config.seed }, currentModel);
  let osg = store.getCache<OSG>(layoutKey);
  if (osg) osg = OSGSchema.parse(osg);
  if (!osg) {
    osg = await layoutVisualPlan(plan, sg, { seed: config.seed });
    store.setCache(layoutKey, osg);
  }
  const persisted = store.putOsg(OSGSchema.parse(osg));
  progress('done');
  return persisted;
}

function sendSse(reply: FastifyReply, event: VisualizeProgress, payload: unknown): void {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function requestStage(request: FastifyRequest): string {
  if (request.url.startsWith('/v1/visualize')) return 'parse';
  if (request.url.startsWith('/v1/explain')) return 'explain';
  if (request.url.startsWith('/v1/drilldown')) return 'drilldown';
  return 'request';
}

/** Builds the Fastify app with all routes registered, without binding a port. */
export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const {
    databasePath = process.env.OPSIS_DB_PATH ?? defaultDatabasePath,
    llm: providedLlm,
    rateLimit = Number(process.env.OPSIS_RATE_LIMIT ?? 60),
    rateWindowMs = Number(process.env.OPSIS_RATE_WINDOW_MS ?? 60_000),
    memoryCacheEntries = Number(process.env.OPSIS_MEMORY_CACHE_ENTRIES ?? 256),
    ...fastifyOptions
  } = options;
  const app = Fastify(fastifyOptions);
  const store = new ApiStore(databasePath, memoryCacheEntries);
  const llm = providedLlm === undefined ? llmClientFromEnvironment() : providedLlm;
  const requests = new Map<string, number[]>();

  app.addHook('onClose', async () => store.close());
  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/v1/health') return;
    const now = Date.now();
    const recent = (requests.get(request.ip) ?? []).filter((time) => now - time < rateWindowMs);
    if (recent.length >= rateLimit) {
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
    requests.set(request.ip, recent);
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send(validationError(error));
    if (error instanceof ParseError) return reply.code(400).send(error.toErrorResponse());
    if (error instanceof ExplainError) {
      const status = error.code === 'osg_not_found' || error.code === 'node_not_found' ? 404 : 400;
      return reply.code(status).send(error.toErrorResponse());
    }
    request.log.error(error);
    return reply
      .code(500)
      .send(
        errorResponse(
          'internal_error',
          'Opsis could not complete that request.',
          requestStage(request),
          true,
        ),
      );
  });

  app.get('/v1/health', async () => HealthResponseSchema.parse({ status: 'ok' }));

  app.post('/v1/visualize', async (request, reply) => {
    const body = VisualizeRequestSchema.parse(request.body);
    const wantsSse = request.headers.accept?.includes('text/event-stream') === true;
    if (!wantsSse) {
      return OSGSchema.parse(await runVisualize(body, store, llm, () => undefined));
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    });
    try {
      const osg = await runVisualize(body, store, llm, (stage) => {
        const checked = VisualizeProgressSchema.parse(stage);
        if (checked !== 'done') sendSse(reply, checked, { stage: checked });
      });
      sendSse(reply, 'done', { stage: 'done', osg: OSGSchema.parse(osg) });
    } catch (error) {
      const response =
        error instanceof ParseError
          ? error.toErrorResponse()
          : errorResponse(
              'pipeline_error',
              'Opsis could not build that diagram.',
              'visualize',
              true,
            );
      reply.raw.write(`event: error\ndata: ${JSON.stringify(response)}\n\n`);
    } finally {
      reply.raw.end();
    }
  });

  app.post('/v1/explain', async (request) => {
    const body = ExplainRequestSchema.parse(request.body);
    const osg = store.getOsg(body.osgId);
    if (!osg) {
      throw new ExplainError(
        'osg_not_found',
        'That diagram could not be found. Try drawing it again.',
        'explain',
      );
    }
    const key = createCacheKey('explain', body, {}, modelId(llm));
    const cached = store.getCache<Explanation>(key);
    if (cached) return ExplanationSchema.parse(cached);
    const persisted = store.getExplanation(key);
    if (persisted) {
      store.setCache(key, persisted);
      return ExplanationSchema.parse(persisted);
    }
    const result = await explainNode(body.nodeId, osg, body.level, body.audience, llm);
    const explanation = ExplanationSchema.parse(result.explanation);
    store.setCache(key, explanation);
    return store.putExplanation(key, explanation);
  });

  app.post('/v1/drilldown', async (request) => {
    const body = DrilldownRequestSchema.parse(request.body);
    const key = createCacheKey('drilldown', body, {}, modelId(llm));
    const cached = store.getCache<OSG>(key);
    if (cached) return OSGSchema.parse(store.putOsg(cached));
    const child = await drilldown(body.osgId, body.nodeId, {
      loadOsg: (id) => store.getOsg(id),
      llm,
    });
    const document = OSGSchema.parse(child);
    store.setCache(key, document);
    return store.putOsg(document);
  });

  app.get('/v1/osg/:id', async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    const osg = store.getOsg(id);
    if (!osg) {
      return reply
        .code(404)
        .send(errorResponse('osg_not_found', 'That diagram could not be found.', 'storage'));
    }
    return OSGSchema.parse(osg);
  });

  app.put('/v1/osg/:id', async (request) => {
    const { id } = IdParamsSchema.parse(request.params);
    const osg = SaveOSGRequestSchema.parse(request.body);
    if (osg.id !== id) {
      throw new ZodError([{ code: 'custom', path: ['id'], message: 'path id must match body id' }]);
    }
    return OSGSchema.parse(store.putOsg(osg));
  });

  app.post('/v1/share/:id', async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    if (!store.getOsg(id)) {
      return reply
        .code(404)
        .send(errorResponse('osg_not_found', 'That diagram could not be found.', 'share'));
    }
    const token = randomBytes(24).toString('base64url');
    store.putShare(token, id);
    return ShareResponseSchema.parse({
      token,
      osgId: id,
      url: `/v1/osg/${id}?share=${token}`,
      readOnly: true,
    });
  });

  return app;
}
