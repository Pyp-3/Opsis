import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signIn } from './test-session.js';
import { ruleBasedParse, type LLMClient, type LLMRequest } from '@opsis/parse';
import { ErrorResponseSchema, ExplanationSchema, OSGSchema } from '@opsis/schema';
import { loadGoldenCases } from '../../../tests/golden/fixtures';
import { runGoldenSuite } from '../../../tests/golden/runner';
import {
  buildApp,
  createLLMStageCacheKey,
  PIPELINE_PROMPT_IDS,
  type PipelinePromptIds,
} from './app';

class SwitchableLLMClient implements LLMClient {
  readonly model = 'cache-regression-model';
  readonly identity = 'harness:codex:cache-regression-model:cli-test';
  failing = true;
  calls: LLMRequest[] = [];

  async complete(request: LLMRequest): Promise<string> {
    this.calls.push(request);
    if (this.failing) throw new Error('provider unavailable');
    if (request.promptId.startsWith('parse')) {
      const graph = ruleBasedParse('A sandwich can contain bread, tomato, ham.').sg;
      const first = graph.entities[0];
      if (first) first.summary = 'Validated model-derived summary.';
      return JSON.stringify(graph);
    }
    return JSON.stringify({ primitives: {} });
  }
}

describe('LLM cache identity', () => {
  it('includes every stage prompt version in its cache key', () => {
    for (const stage of ['parse', 'metaphor', 'explain', 'drilldown'] as const) {
      const current = createLLMStageCacheKey(stage, { input: true }, {}, 'provider');
      const entries = Object.entries(PIPELINE_PROMPT_IDS[stage]);
      const [name, version] = entries[0] as [string, string];
      const changedPrompts = {
        ...PIPELINE_PROMPT_IDS,
        [stage]: { ...PIPELINE_PROMPT_IDS[stage], [name]: `${version}-changed` },
      } as PipelinePromptIds;
      expect(
        createLLMStageCacheKey(stage, { input: true }, {}, 'provider', changedPrompts),
      ).not.toBe(current);
    }
  });

  it('caches a provider failure only as offline and retries the later healthy provider', async () => {
    const payload = {
      utterance: 'A sandwich can contain bread, tomato, ham.',
      audience: 'teen' as const,
      seed: 19,
    };
    const client = new SwitchableLLMClient();
    const providerApp = buildApp({ databasePath: ':memory:', llm: client, rateLimit: 1_000 });
    await signIn(providerApp);
    const offlineApp = buildApp({ databasePath: ':memory:', llm: null, rateLimit: 1_000 });
    await signIn(offlineApp);

    try {
      const degraded = await providerApp.inject({ method: 'POST', url: '/v1/visualize', payload });
      const offline = await offlineApp.inject({ method: 'POST', url: '/v1/visualize', payload });
      expect(degraded.statusCode).toBe(200);
      expect(degraded.body).toBe(offline.body);

      const callsAfterFailure = client.calls.length;
      expect(callsAfterFailure).toBeGreaterThan(0);
      client.failing = false;

      const healthy = await providerApp.inject({ method: 'POST', url: '/v1/visualize', payload });
      expect(healthy.statusCode).toBe(200);
      expect(client.calls.length).toBeGreaterThan(callsAfterFailure);
      expect(OSGSchema.parse(healthy.json()).sg.entities[0]?.summary).toBe(
        'Validated model-derived summary.',
      );
    } finally {
      await providerApp.close();
      await offlineApp.close();
    }
  });
});

describe('Opsis API', () => {
  const app = buildApp({ databasePath: ':memory:', llm: null, rateLimit: 1_000 });
  let osg: ReturnType<typeof OSGSchema.parse>;
  let tomatoId: string;

  beforeAll(async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/visualize',
      payload: { utterance: 'A sandwich can contain bread, tomato, ham.', seed: 7 },
    });
    expect(response.statusCode).toBe(200);
    osg = OSGSchema.parse(response.json());
    tomatoId = osg.sg.entities.find((entity) => entity.lemma === 'tomato')?.id ?? '';
    expect(tomatoId).not.toBe('');
  });

  afterAll(() => app.close());

  it('GET /v1/health returns status ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('POST /v1/visualize returns a validated OSG and rejects an invalid body', async () => {
    expect(OSGSchema.parse(osg).utterance).toContain('sandwich');
    const invalid = await app.inject({ method: 'POST', url: '/v1/visualize', payload: {} });
    expect(invalid.statusCode).toBe(400);
    expect(ErrorResponseSchema.parse(invalid.json()).code).toBe('invalid_request');
  });

  it('POST /v1/visualize emits SSE progress in canonical order', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/visualize',
      headers: { accept: 'text/event-stream' },
      payload: { utterance: 'The sun rises in the east.', seed: 3 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    const events = [...response.body.matchAll(/^event: (\w+)$/gmu)].map((match) => match[1]);
    expect(events).toEqual(['parsing', 'mapping', 'layout', 'done']);
    const doneLine = response.body
      .split('\n')
      .find((line) => line.startsWith('data: {"stage":"done"'));
    const done = JSON.parse((doneLine ?? '').slice('data: '.length)) as { osg: unknown };
    expect(OSGSchema.parse(done.osg).scenes[0]?.metaphor).toBe('compass');
  });

  it('keeps a cache hit below 300 ms', async () => {
    const payload = {
      utterance: 'A bicycle has two wheels, a frame, pedals and a chain.',
      seed: 8,
    };
    await app.inject({ method: 'POST', url: '/v1/visualize', payload });
    const started = performance.now();
    const response = await app.inject({ method: 'POST', url: '/v1/visualize', payload });
    expect(response.statusCode).toBe(200);
    expect(performance.now() - started).toBeLessThan(300);
  });

  it('passes at least 70% of the golden suite through the offline endpoint', async () => {
    const cases = await loadGoldenCases();
    const report = await runGoldenSuite(cases, async (utterance) => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/visualize',
        payload: { utterance },
      });
      expect(response.statusCode).toBe(200);
      return OSGSchema.parse(response.json());
    });
    expect(report.passRate).toBeGreaterThanOrEqual(0.7);
  });

  it('rejects utterances over 500 characters with the error shape', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/visualize',
      payload: { utterance: 'x'.repeat(501) },
    });
    expect(response.statusCode).toBe(400);
    expect(ErrorResponseSchema.parse(response.json())).toMatchObject({
      code: 'utterance_too_long',
      stage: 'parse',
      retryable: false,
    });
  });

  it('POST /v1/explain persists a validated explanation and rejects invalid input', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/explain',
      payload: { osgId: osg.id, nodeId: tomatoId, level: 'explanation', audience: 'teen' },
    });
    expect(response.statusCode).toBe(200);
    expect(ExplanationSchema.parse(response.json())).toMatchObject({
      osgId: osg.id,
      nodeId: tomatoId,
      confidence: 'low',
    });
    const invalid = await app.inject({
      method: 'POST',
      url: '/v1/explain',
      payload: { osgId: 'not-a-uuid', nodeId: '', level: 'deep', audience: 'expert' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(ErrorResponseSchema.safeParse(invalid.json()).success).toBe(true);
  });

  it('POST /v1/drilldown returns a persisted child and rejects invalid input', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/drilldown',
      payload: { osgId: osg.id, nodeId: tomatoId },
    });
    expect(response.statusCode).toBe(200);
    const child = OSGSchema.parse(response.json());
    expect(child.parentId).toBe(osg.id);
    expect(child.breadcrumbs).toHaveLength(osg.breadcrumbs.length + 1);
    const loaded = await app.inject({ method: 'GET', url: `/v1/osg/${child.id}` });
    expect(loaded.statusCode).toBe(200);

    const invalid = await app.inject({ method: 'POST', url: '/v1/drilldown', payload: {} });
    expect(invalid.statusCode).toBe(400);
    expect(ErrorResponseSchema.safeParse(invalid.json()).success).toBe(true);
  });

  it('GET /v1/osg/:id loads a diagram and validates the id', async () => {
    const response = await app.inject({ method: 'GET', url: `/v1/osg/${osg.id}` });
    expect(response.statusCode).toBe(200);
    expect(OSGSchema.parse(response.json()).id).toBe(osg.id);
    const invalid = await app.inject({ method: 'GET', url: '/v1/osg/nope' });
    expect(invalid.statusCode).toBe(400);
    expect(ErrorResponseSchema.safeParse(invalid.json()).success).toBe(true);
  });

  it('PUT /v1/osg/:id saves valid edits and rejects invalid bodies', async () => {
    const edited = { ...osg, title: 'Edited sandwich' };
    const response = await app.inject({
      method: 'PUT',
      url: `/v1/osg/${osg.id}`,
      payload: edited,
    });
    expect(response.statusCode).toBe(200);
    expect(OSGSchema.parse(response.json()).title).toBe('Edited sandwich');

    const invalid = await app.inject({
      method: 'PUT',
      url: `/v1/osg/${osg.id}`,
      payload: { ...edited, schemaVersion: 'osg/2' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(ErrorResponseSchema.safeParse(invalid.json()).success).toBe(true);
  });

  it('keeps a saved edit when the same sentence is visualized again', async () => {
    const payload = {
      utterance: 'A bicycle has two wheels, a frame, pedals and a chain.',
      seed: 8,
    };
    const first = OSGSchema.parse(
      (await app.inject({ method: 'POST', url: '/v1/visualize', payload })).json(),
    );
    const saved = await app.inject({
      method: 'PUT',
      url: `/v1/osg/${first.id}`,
      payload: { ...first, title: 'MY EDIT' },
    });
    expect(saved.statusCode).toBe(200);

    const again = await app.inject({ method: 'POST', url: '/v1/visualize', payload });
    expect(again.statusCode).toBe(200);
    expect(OSGSchema.parse(again.json()).id).toBe(first.id);
    const loaded = await app.inject({ method: 'GET', url: `/v1/osg/${first.id}` });
    expect(OSGSchema.parse(loaded.json()).title).toBe('MY EDIT');
  });

  it('keeps a saved edit when the same drill-down is opened again', async () => {
    const payload = { osgId: osg.id, nodeId: tomatoId };
    const child = OSGSchema.parse(
      (await app.inject({ method: 'POST', url: '/v1/drilldown', payload })).json(),
    );
    await app.inject({
      method: 'PUT',
      url: `/v1/osg/${child.id}`,
      payload: { ...child, title: 'MY TOMATO' },
    });
    await app.inject({ method: 'POST', url: '/v1/drilldown', payload });
    const loaded = await app.inject({ method: 'GET', url: `/v1/osg/${child.id}` });
    expect(OSGSchema.parse(loaded.json()).title).toBe('MY TOMATO');
  });

  it('POST /v1/share/:id returns a token link that does not expose the editable route', async () => {
    const response = await app.inject({ method: 'POST', url: `/v1/share/${osg.id}` });
    expect(response.statusCode).toBe(200);
    const share = response.json() as { token: string; url: string };
    expect(response.json()).toMatchObject({ osgId: osg.id, readOnly: true });
    expect(share.url).toBe(`/v1/shared/${share.token}`);
    expect(share.url).not.toContain('/v1/osg/');

    const invalid = await app.inject({ method: 'POST', url: '/v1/share/nope' });
    expect(invalid.statusCode).toBe(400);
    expect(ErrorResponseSchema.safeParse(invalid.json()).success).toBe(true);
  });

  it('GET /v1/shared/:token serves the shared OSG read-only', async () => {
    const share = (await app.inject({ method: 'POST', url: `/v1/share/${osg.id}` })).json() as {
      url: string;
    };
    const response = await app.inject({ method: 'GET', url: share.url });
    expect(response.statusCode).toBe(200);
    expect(OSGSchema.parse(response.json()).id).toBe(osg.id);

    for (const method of ['PUT', 'POST', 'DELETE'] as const) {
      const write = await app.inject({ method, url: share.url, payload: osg });
      expect(write.statusCode).toBe(404);
    }
  });

  it('GET /v1/shared/:token returns 404 for an unknown token', async () => {
    const response = await app.inject({ method: 'GET', url: `/v1/shared/${'A'.repeat(32)}` });
    expect(response.statusCode).toBe(404);
    expect(ErrorResponseSchema.parse(response.json()).code).toBe('share_not_found');
  });

  it('GET /v1/shared/:token rejects a malformed token', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/shared/not-a-token!' });
    expect(response.statusCode).toBe(400);
    expect(ErrorResponseSchema.parse(response.json()).code).toBe('invalid_request');
  });
});

describe('rate limiting', () => {
  it('bounds board polling separately without consuming the edit/model allowance', async () => {
    const app = buildApp({ databasePath: ':memory:', llm: null, rateLimit: 1 });
    await signIn(app);
    for (let i = 0; i < 10; i++) {
      expect((await app.inject({ method: 'GET', url: '/v1/boards' })).statusCode).toBe(200);
    }
    expect((await app.inject({ method: 'GET', url: '/v1/boards' })).statusCode).toBe(429);
    expect(
      (await app.inject({ method: 'POST', url: '/v1/boards', payload: { title: 'New board' } }))
        .statusCode,
    ).toBe(201);
    expect(
      (await app.inject({ method: 'POST', url: '/v1/boards', payload: { title: 'Another board' } }))
        .statusCode,
    ).toBe(429);
    await app.close();
  });
  it('limits each client with the shared error shape', async () => {
    const app = buildApp({ databasePath: ':memory:', llm: null, rateLimit: 1 });
    await signIn(app);
    const id = '00000000-0000-4000-8000-000000000000';
    await app.inject({ method: 'GET', url: `/v1/osg/${id}` });
    const response = await app.inject({ method: 'GET', url: `/v1/osg/${id}` });
    expect(response.statusCode).toBe(429);
    expect(ErrorResponseSchema.parse(response.json())).toEqual({
      code: 'rate_limit_exceeded',
      message: 'Too many requests. Please try again soon.',
      stage: 'request',
      retryable: true,
    });
    await app.close();
  });

  it('applies to shared links too', async () => {
    const app = buildApp({ databasePath: ':memory:', llm: null, rateLimit: 1 });
    await signIn(app);
    const url = `/v1/shared/${'A'.repeat(32)}`;
    await app.inject({ method: 'GET', url });
    const response = await app.inject({ method: 'GET', url });
    expect(response.statusCode).toBe(429);
    expect(ErrorResponseSchema.parse(response.json()).code).toBe('rate_limit_exceeded');
    await app.close();
  });
});
