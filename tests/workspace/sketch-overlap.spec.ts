import { test, expect, type Page } from '@playwright/test';
import { EMAIL_DEMO, type BoardDocument, type BoardDrawing } from '../../packages/schema/src/index';
import { signUp } from './session';
import { openEmailExample } from './board-fixtures';

const ink = { ink: 'sky', line: 'solid', strokeWidth: 2 } as const;
test.beforeEach(async ({ page }) => {
  // Exercise the offline SVG font too; evidence capture must not depend on a remote CDN.
  await page.route('https://fonts.googleapis.com/**', (route) => route.abort());
});
async function savedBoard(page: Page): Promise<BoardDocument> {
  const [entry] = await (await page.request.get('/v1/boards')).json();
  return (await (await page.request.get(`/v1/boards/${entry.id}`)).json()).snapshot.board;
}

test('reviewed sketches avoid concepts and Arrange preserves reader drawings through undo and reload', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await signUp(page);
  await openEmailExample(page);
  const [entry] = await (await page.request.get('/v1/boards')).json();
  const current = await (await page.request.get(`/v1/boards/${entry.id}`)).json();
  const reader: BoardDrawing = {
    id: 'reader-note',
    shape: 'text',
    x: 650,
    y: 220,
    text: 'Reader annotation stays here',
    layerId: 'reader',
    locked: true,
    ...ink,
  };
  const before: BoardDocument = {
    ...EMAIL_DEMO,
    version: 2,
    agent: 'demo',
    nodes: EMAIL_DEMO.nodes.slice(0, 2),
    edges: [],
    positions: { sender: { x: 24, y: 24 }, app: { x: 24, y: 324 } },
    drawings: [reader],
    drawingLayers: [{ id: 'reader', name: 'Reader', locked: true }],
    pinnedNodeIds: ['sender'],
  };
  const response = await page.request.put(`/v1/boards/${entry.id}`, {
    data: { revision: current.revision, snapshot: { board: before, past: [], future: [] } },
  });
  expect(response.ok()).toBe(true);
  await page.reload();
  const sketch: BoardDrawing[] = [
    { id: 'lane', shape: 'rect', x: 64, y: 24, width: 320, height: 430, ...ink },
    { id: 'block', shape: 'rect', x: 80, y: 64, width: 150, height: 90, ...ink },
    { id: 'caption', shape: 'text', x: 90, y: 80, text: 'Reverse-engineer APK', ...ink },
    {
      id: 'arrow',
      shape: 'arrow',
      points: [
        [150, 164],
        [150, 220],
      ],
      ...ink,
    },
  ];
  await page.route('**/v1/boards/generate', (route) =>
    route.fulfill({
      json: {
        ...EMAIL_DEMO,
        nodes: before.nodes,
        edges: [],
        drawings: sketch,
      },
    }),
  );
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await page.getByLabel('Agent', { exact: true }).selectOption('demo');
  await page
    .getByLabel('What would you like to understand?')
    .fill('Draw the mobile challenge path');
  await page.getByRole('button', { name: 'Generate diagram', exact: true }).click();
  await page.getByRole('button', { name: 'Review on canvas' }).click();
  // Nothing enters saved history until the reader accepts the proposal.
  expect(await savedBoard(page)).toEqual(before);
  await page.getByRole('button', { name: 'Apply reviewed changes' }).click();
  await expect.poll(async () => (await savedBoard(page)).drawings?.length).toBe(5);
  const applied = await savedBoard(page);
  expect(applied.positions).toEqual(before.positions);
  expect(applied.drawings!.find((drawing) => drawing.id === reader.id)).toEqual(reader);
  const lane = applied.drawings!.find((drawing) => drawing.id === 'lane')!;
  const dx = lane.x! - 64,
    dy = lane.y! - 24;
  expect(Math.abs(dx) + Math.abs(dy)).toBeGreaterThan(0);
  for (const original of sketch) {
    const moved = applied.drawings!.find((drawing) => drawing.id === original.id)!;
    expect(moved.layerId).toBe('agent-sketch');
    if (original.points)
      expect(moved.points).toEqual(original.points.map(([x, y]) => [x + dx, y + dy]));
    else expect([moved.x! - original.x!, moved.y! - original.y!]).toEqual([dx, dy]);
  }
  // Reproduce the taller heading seen with CI/offline fonts, without depending on the OS.
  await page.locator('.canvas-heading').evaluate((heading) => {
    heading.style.width = '340px';
  });
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const canvas = document.querySelector('.blueprint')!.getBoundingClientRect();
        const heading = document.querySelector('.canvas-heading')!.getBoundingClientRect();
        return [...document.querySelectorAll('.drawing-labels text, .react-flow__node')].every(
          (item) => {
            const box = item.getBoundingClientRect();
            return (
              box.left >= canvas.left &&
              box.right <= canvas.right &&
              box.top >= heading.bottom &&
              box.bottom <= canvas.bottom
            );
          },
        );
      }),
    )
    .toBe(true);
  // Wait for the Fit animation before capturing evidence or measuring the canvas.
  let lastTransform: string | null = null;
  await expect
    .poll(
      async () => {
        const transform = await page.locator('.react-flow__viewport').getAttribute('style');
        const settled = transform === lastTransform;
        lastTransform = transform;
        return settled;
      },
      { intervals: [350] },
    )
    .toBe(true);
  const collisions = await page.evaluate(() => {
    const text = document
      .querySelector('[data-drawing-label="caption"] text')!
      .getBoundingClientRect();
    return [...document.querySelectorAll('.react-flow__node')].some((node) => {
      const box = node.getBoundingClientRect();
      return (
        text.left < box.right &&
        text.right > box.left &&
        text.top < box.bottom &&
        text.bottom > box.top
      );
    });
  });
  expect(collisions).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('settled-sketch.png') });
  await page.getByRole('button', { name: 'Arrange downward' }).click();
  // Arrange computes asynchronously: the old "Saved" badge can remain until it finishes.
  await expect
    .poll(async () => (await savedBoard(page)).positions.app)
    .not.toEqual(applied.positions.app);
  await expect(page.locator('.save-status')).toHaveText('Saved');
  const arranged = await savedBoard(page);
  expect(arranged.positions.sender).toEqual(before.positions.sender);
  expect(arranged.drawings!.find((drawing) => drawing.id === reader.id)).toEqual(reader);
  expect(arranged.drawings!.map((drawing) => drawing.id)).toEqual(
    applied.drawings!.map((drawing) => drawing.id),
  );
  expect(arranged.drawingLayers).toEqual(applied.drawingLayers);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => savedBoard(page)).toEqual(applied);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(async () => savedBoard(page)).toEqual(arranged);
  await page.reload();
  await expect(page.locator('[data-drawing-label="caption"]')).toBeAttached();
  expect(await savedBoard(page)).toEqual(arranged);
});

test('connection paths and labels avoid the actual painted drawing font', async ({
  page,
}, testInfo) => {
  await signUp(page);
  await openEmailExample(page);
  const [entry] = await (await page.request.get('/v1/boards')).json();
  const current = await (await page.request.get(`/v1/boards/${entry.id}`)).json();
  const board: BoardDocument = {
    ...EMAIL_DEMO,
    version: 2,
    agent: 'demo',
    nodes: EMAIL_DEMO.nodes.slice(0, 2),
    positions: { sender: { x: 0, y: 0 }, app: { x: 420, y: 0 } },
    edges: [{ id: 'connection', source: 'sender', target: 'app', label: 'Mobile admission' }],
    edgePorts: { connection: { source: 'right', target: 'left' } },
    drawings: [{ id: 'warning', shape: 'text', x: 272, y: 32, text: 'MMMMM', ...ink }],
  };
  expect(
    (
      await page.request.put(`/v1/boards/${entry.id}`, {
        data: {
          revision: current.revision,
          snapshot: { board, past: [], future: [] },
        },
      })
    ).ok(),
  ).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: 'Hide the big picture' }).click();
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await expect(page.locator('.react-flow__edge-path')).toBeAttached();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const text = document
          .querySelector('[data-drawing-label="warning"] text')!
          .getBoundingClientRect();
        const path = document.querySelector<SVGPathElement>('.react-flow__edge-path')!;
        const matrix = path.getScreenCTM()!;
        const length = path.getTotalLength();
        const inside = (x: number, y: number) =>
          x > text.left - 2 && x < text.right + 2 && y > text.top - 2 && y < text.bottom + 2;
        for (let distance = 0; distance <= length; distance += 1) {
          const point = path.getPointAtLength(distance);
          const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
          if (inside(screen.x, screen.y)) return false;
        }
        const label = document.querySelector('.connection-label')!.getBoundingClientRect();
        return !(
          label.left < text.right &&
          label.right > text.left &&
          label.top < text.bottom &&
          label.bottom > text.top
        );
      }),
    )
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath('drawing-aware-connection.png') });
  expect(await savedBoard(page)).toEqual(board);
});
