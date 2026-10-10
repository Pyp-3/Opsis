import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { boardPreviewSvg, createEmptyBoard } from '@opsis/schema';
import { buildApp } from './app.js';
import { registerRender } from './render.js';
import { signIn } from './test-session.js';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
const preview = boardPreviewSvg({
  ...createEmptyBoard(),
  drawings: [
    { id: 'w', shape: 'path', d: 'M0 0L96 48', ink: 'ink', line: 'solid', strokeWidth: 2 },
  ],
}).svg;

describe('board preview rendering', () => {
  it('renders a preview to PNG for signed-in people and agents only', async () => {
    const app = buildApp({ databasePath: ':memory:', speech: null });
    apps.push(app);
    const signedOut = await app.inject({
      method: 'POST',
      url: '/v1/render',
      payload: { svg: preview },
    });
    expect(signedOut.statusCode).toBe(401);
    void signIn(app);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/render',
      payload: { svg: preview },
    });
    expect(response.statusCode).toBe(200);
    const { mimeType, data } = response.json() as { mimeType: string; data: string };
    expect(mimeType).toBe('image/png');
    expect(Buffer.from(data, 'base64').subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });

  it('refuses markup outside the preview’s plain shapes before rasterising it', async () => {
    const app = buildApp({ databasePath: ':memory:', speech: null });
    apps.push(app);
    void signIn(app);
    for (const svg of [
      '<svg><image href="file:///etc/passwd" width="10" height="10"/></svg>',
      '<!DOCTYPE svg><svg/>',
      'not svg',
    ]) {
      const response = await app.inject({ method: 'POST', url: '/v1/render', payload: { svg } });
      expect(response.statusCode).toBe(400);
    }
    const extra = await app.inject({
      method: 'POST',
      url: '/v1/render',
      payload: { svg: preview, more: true },
    });
    expect(extra.statusCode).toBe(400);
  });

  it('reports a failed render without crashing, one render at a time', async () => {
    const app = Fastify();
    apps.push(app);
    let running = 0;
    let most = 0;
    registerRender(app, {
      requireUser: () => true,
      rasterise: async (svg) => {
        running++;
        most = Math.max(most, running);
        await new Promise((done) => setTimeout(done, 10));
        running--;
        if (svg.includes('fail')) throw new Error('broken');
        return Buffer.from('png');
      },
    });
    const send = (svg: string) =>
      app.inject({ method: 'POST', url: '/v1/render', payload: { svg } });
    const [ok, failed, again] = await Promise.all([
      send(preview),
      send(preview.replace('</svg>', '<title>fail</title></svg>')),
      send(preview),
    ]);
    expect([ok.statusCode, failed.statusCode, again.statusCode]).toEqual([200, 422, 200]);
    expect(most).toBe(1);
  });
});
