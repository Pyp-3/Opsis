import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErrorResponseSchema, ExplanationSchema, OSGSchema } from '@opsis/schema';
import { loadGoldenCases } from '../../../tests/golden/fixtures';
import { runGoldenSuite } from '../../../tests/golden/runner';
import { buildApp } from './app';

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

  it('POST /v1/share/:id returns a read-only link and validates the id', async () => {
    const response = await app.inject({ method: 'POST', url: `/v1/share/${osg.id}` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ osgId: osg.id, readOnly: true });
    expect(response.json().url).toContain(response.json().token);

    const invalid = await app.inject({ method: 'POST', url: '/v1/share/nope' });
    expect(invalid.statusCode).toBe(400);
    expect(ErrorResponseSchema.safeParse(invalid.json()).success).toBe(true);
  });
});

describe('rate limiting', () => {
  it('limits each client with the shared error shape', async () => {
    const app = buildApp({ databasePath: ':memory:', llm: null, rateLimit: 1 });
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
});
