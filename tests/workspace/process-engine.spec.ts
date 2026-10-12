import { test, expect } from '@playwright/test';
import { benchmarkCases } from '../../packages/engine/scripts/benchmark-cases.mjs';
import { TERMINAL_PIPELINE_EXAMPLE } from '../../packages/schema/src/index';
import { signUp } from './session';

test('measures real worker calculations and preserves saves while obsolete previews are cancelled', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  const measurements = await page.evaluate(async (cases) => {
    const modulePath = '/src/workspace/process-engine.ts';
    const { calculateProcess } = await import(modulePath);
    const values: Record<string, unknown> = {};
    for (const [name, request] of Object.entries(cases)) {
      const start = performance.now();
      const result = await calculateProcess(request);
      if (result.nodes.some((node: { status: string }) => node.status !== 'ok'))
        throw new Error(`${name} failed`);
      const firstMs = performance.now() - start;
      const cached = performance.now();
      await calculateProcess(request);
      values[name] = { firstMs, cachedMs: performance.now() - cached };
    }
    const warm = [];
    for (let i = 0; i < 20; i++) {
      const request = structuredClone(cases.maximum);
      request.nodes[0].process.text =
        String(i).padStart(3, '0') + request.nodes[0].process.text.slice(3);
      const start = performance.now();
      await calculateProcess(request);
      warm.push(performance.now() - start);
    }
    warm.sort((a, b) => a - b);
    values.maximumWarm = { p50Ms: warm[9], p95Ms: warm[18] };
    const saves = calculateProcess({
      version: 3,
      nodes: [{ id: 'save', process: { op: 'source', text: 'durable\n' } }],
    });
    const cancelled = [];
    for (let i = 0; i < 20; i++) {
      const controller = new AbortController();
      const preview = calculateProcess(
        {
          version: 3,
          nodes: [{ id: `preview-${i}`, process: { op: 'source', text: 'temporary\n' } }],
        },
        { signal: controller.signal },
      );
      cancelled.push(
        preview.then(
          () => 'unexpected',
          (error: Error) => error.name,
        ),
      );
      controller.abort();
    }
    const current = await calculateProcess({
      version: 3,
      nodes: [{ id: 'current', process: { op: 'source', text: 'latest\n' } }],
    });
    return { values, cancellations: await Promise.all(cancelled), saved: await saves, current };
  }, benchmarkCases());
  expect(measurements.cancellations).toEqual(Array(20).fill('AbortError'));
  expect(measurements.saved.nodes[0]).toMatchObject({ output: 'durable\n' });
  expect(measurements.current.nodes[0]).toMatchObject({ output: 'latest\n' });
  await testInfo.attach('worker-measurements.json', {
    body: JSON.stringify(measurements.values, null, 2),
    contentType: 'application/json',
  });
});

test('sample recalculation remains one undoable saved edit across reload', async ({ page }) => {
  test.setTimeout(60_000);
  await signUp(page, 'Process reader');
  await page.goto('/canvas', { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="file"]').setInputFiles({
    name: 'process.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({ ...TERMINAL_PIPELINE_EXAMPLE, version: 2, agent: 'demo', positions: {} }),
    ),
  });
  await page.getByRole('button', { name: 'Import as new board' }).click();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  await page.getByRole('button', { name: 'Hide the big picture' }).click();
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  const saved = () =>
    page.evaluate(async () => {
      const list = await (await fetch('/v1/boards')).json();
      return (await (await fetch('/v1/boards/' + list[0].id)).json()).snapshot;
    });
  const before = await saved();
  const source = TERMINAL_PIPELINE_EXAMPLE.nodes.find((node) => node.process?.op === 'source')!;
  await page.getByRole('button', { name: 'Play the process', exact: true }).click();
  const player = page.getByRole('region', { name: 'Process player' });
  await player.getByRole('button', { name: 'Play', exact: true }).click();
  const traces = player.locator('.process-data svg');
  await expect(traces.locator('animateMotion')).toHaveCount(12);
  expect(
    await traces
      .locator('animateMotion')
      .evaluateAll((motions) => motions.every((motion) => motion.getAttribute('begin') === '0s')),
  ).toBe(true);
  await expect
    .poll(() => traces.evaluate((element) => (element as SVGSVGElement).getCurrentTime()))
    .toBeGreaterThan(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(traces.locator('animateMotion')).toHaveCount(0);
  await expect(traces.locator('path')).toHaveCount(12);
  await player.getByRole('button', { name: 'Close player', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator(`[data-id="${source.id}"]`).click();
  await page.getByRole('textbox', { name: 'Sample data' }).fill('asha\nzuri\n');
  await page.getByRole('button', { name: 'Update sample' }).click();
  await expect
    .poll(
      async () =>
        (await saved()).board.nodes.find((node: { id: string }) => node.id === source.id).process
          .text,
    )
    .toBe('asha\nzuri\n');
  const changed = await saved();
  expect(changed.past).toHaveLength(before.past.length + 1);
  expect(changed.past.at(-1)).toEqual(before.board);
  for (const node of changed.board.nodes.filter(
    (node: { process?: unknown; terminal?: unknown }) => node.process && node.terminal,
  ))
    expect(node.terminal.output).toBe('asha\nzuri\n');
  await page.reload({ waitUntil: 'domcontentloaded' });
  const heading = page.getByRole('button', { name: 'Hide the big picture' });
  if (await heading.isVisible()) await heading.click();
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await page.locator(`[data-id="${source.id}"]`).click();
  await expect(page.getByRole('textbox', { name: 'Sample data' })).toHaveValue('asha\nzuri\n');
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await saved()).board.nodes.find((node: { id: string }) => node.id === source.id).process
          .text,
    )
    .toBe(source.process?.op === 'source' ? source.process.text : '');
});
