import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { expect, test } from '../browser-fixture';

test('initial JavaScript bundle is below 400 KiB gzipped', async () => {
  const assets = resolve(import.meta.dirname, '../../apps/web/dist/assets');
  const files = await readdir(assets);
  const entry = files.find((file) => /^index-.*\.js$/u.test(file));
  expect(entry, 'Vite entry bundle; run the build before performance tests').toBeDefined();
  const bytes = await readFile(resolve(assets, entry!));
  const gzipBytes = gzipSync(bytes).byteLength;
  expect(gzipBytes).toBeLessThan(400 * 1024);
});

test('a cached diagram is returned in under 300 ms', async ({ request }) => {
  const body = { utterance: 'A sandwich can contain bread, tomato, ham.', audience: 'teen' };
  const headers = { accept: 'application/json' };
  expect((await request.post('/v1/visualize', { data: body, headers })).ok()).toBe(true);
  const started = performance.now();
  const response = await request.post('/v1/visualize', { data: body, headers });
  const elapsed = performance.now() - started;
  expect(response.ok()).toBe(true);
  expect(elapsed).toBeLessThan(300);
});

test('a hardware-rendered 50-node scene renders at least 30 frames per second', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel(/type a sentence/i).fill('A sandwich can contain bread, tomato, ham.');
  await page.getByRole('button', { name: 'Draw it' }).click();
  await expect(page.getByRole('navigation', { name: 'Diagram as list' })).toBeVisible();
  await page.getByRole('button', { name: '2D' }).click();
  const add = page.getByRole('button', { name: 'Add' });
  const initialCount = await page.locator('.opsis-flow-node').count();
  for (let count = initialCount; count < 50; count += 1) {
    await add.click();
    await expect(page.locator('.opsis-flow-node')).toHaveCount(count + 1);
  }
  // Keep the render sample isolated from the side panel's explanation request for an unsaved node.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '3D' }).click();
  await expect(page.locator('canvas')).toBeVisible();
  const sample = await page.evaluate(
    () =>
      new Promise<{ measurable: boolean; fps: number; renderer: string }>((resolveSample) => {
        type Metrics = { renderedFrames: number; renderer: string };
        const canvas = document.querySelector('canvas') as
          (HTMLCanvasElement & { __opsisRenderMetrics?: Metrics }) | null;
        const startedMetrics = canvas?.__opsisRenderMetrics;
        if (document.hidden || !startedMetrics) {
          resolveSample({
            measurable: false,
            fps: 0,
            renderer: startedMetrics?.renderer ?? 'unavailable',
          });
          return;
        }
        const started = performance.now();
        setTimeout(() => {
          const finished = canvas.__opsisRenderMetrics;
          const elapsed = performance.now() - started;
          const renderedFrames = finished
            ? finished.renderedFrames - startedMetrics.renderedFrames
            : 0;
          resolveSample({
            measurable: Boolean(finished) && elapsed > 0,
            fps: (renderedFrames * 1_000) / elapsed,
            renderer: finished?.renderer ?? startedMetrics.renderer,
          });
        }, 1_000);
      }),
  );
  await test.info().attach('frame-rate.json', {
    body: JSON.stringify(sample, null, 2),
    contentType: 'application/json',
  });
  test.skip(!sample.measurable, 'Three.js render telemetry is unavailable in this browser');
  test.skip(
    /swiftshader|llvmpipe|software/iu.test(sample.renderer),
    `hardware frame budget is not measurable with ${sample.renderer}; observed ${sample.fps.toFixed(1)} fps`,
  );
  expect(sample.fps).toBeGreaterThanOrEqual(30);
});
