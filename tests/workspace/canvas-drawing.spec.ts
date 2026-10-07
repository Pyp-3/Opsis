import { test, expect, type Page } from '@playwright/test';
import { accessibilityScan, signUp } from './session';

type Drawing = {
  id: string;
  shape: string;
  points?: [number, number][];
  x?: number;
  y?: number;
  text?: string;
  anchorId?: string;
  ink: string;
};
type Board = {
  nodes: { id: string; label: string }[];
  positions: Record<string, { x: number; y: number }>;
  drawings?: Drawing[];
};

async function savedBoard(page: Page, title?: string): Promise<Board> {
  return page.evaluate(async (title) => {
    const list: { id: string; title: string }[] = await (await fetch('/v1/boards')).json();
    const entry = title ? list.find((item) => item.title === title)! : list[0]!;
    return (await (await fetch('/v1/boards/' + entry.id)).json()).snapshot.board;
  }, title);
}
const drawings = async (page: Page, title?: string) =>
  (await savedBoard(page, title)).drawings ?? [];

/** Drags across the drawing surface between two points given as fractions of the canvas. */
async function drag(page: Page, from: [number, number], to: [number, number], shift = false) {
  const box = (await page.getByTestId('drawing-surface').boundingBox())!;
  const at = ([x, y]: [number, number]) => [box.x + box.width * x, box.y + box.height * y] as const;
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(...at(from));
  await page.mouse.down();
  for (let step = 1; step <= 6; step++)
    await page.mouse.move(
      at(from)[0] + ((at(to)[0] - at(from)[0]) * step) / 6,
      at(from)[1] + ((at(to)[1] - at(from)[1]) * step) / 6,
    );
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
}

test('draws blueprint shapes beside the diagram, saves them and attaches one to a concept', async ({
  page,
}) => {
  // One continuous scenario: drawing, persistence, undo, attachment, erasing and accessibility.
  test.setTimeout(90_000);
  await signUp(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open example: An email’s journey' }).click();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  await page.getByRole('button', { name: 'Hide the big picture' }).click();

  // Diagram mode stays the default: no capture surface until a drawing tool is chosen.
  await expect(page.getByTestId('drawing-surface')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show drawing tools' }).click();
  const tools = page.getByRole('toolbar', { name: 'Drawing tools' });
  await expect(tools.getByRole('button', { name: 'Diagram (move concepts)' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await tools.getByRole('button', { name: 'Box', exact: true }).click();
  await page.getByRole('radio', { name: 'coral ink' }).click();
  // Shapes are drawn clear of the drawing panel on the left and the composer below.
  await drag(page, [0.55, 0.25], [0.75, 0.45]);
  await tools.getByRole('button', { name: 'Pen', exact: true }).click();
  await drag(page, [0.55, 0.6], [0.75, 0.64]);
  await tools.getByRole('button', { name: 'Dimension', exact: true }).click();
  await drag(page, [0.5, 0.55], [0.75, 0.56], true);
  await expect(page.locator('.save-status')).toHaveText('Saved');
  await expect
    .poll(async () => (await drawings(page)).map((item) => item.shape))
    .toEqual(['rect', 'stroke', 'dimension']);
  const saved = await drawings(page);
  expect(saved[0]!.ink).toBe('coral');
  // Shift keeps a dimension horizontal; straight shapes snap to half grid squares.
  const [[, y1], [, y2]] = saved[2]!.points!;
  expect(y1).toBe(y2);
  expect(Math.abs(saved[0]!.x! % 12)).toBe(0);
  await expect(page.locator('.drawing-labels [data-shape="dimension"] text')).toHaveText(/\d u$/);

  // Text is written in place and edited from the panel.
  await tools.getByRole('button', { name: 'Text', exact: true }).click();
  await drag(page, [0.6, 0.12], [0.6, 0.12]);
  const text = page.getByRole('textbox', { name: 'Text' });
  await expect(text).toBeFocused();
  await text.fill('Plant room');
  await text.blur();
  await expect
    .poll(async () => (await drawings(page)).find((item) => item.shape === 'text')?.text)
    .toBe('Plant room');
  await expect(
    page.locator('.drawing-labels text').filter({ hasText: 'Plant room' }),
  ).toBeVisible();

  // Each drawing and each edit to it is one undoable step.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await drawings(page)).length).toBe(3);
  await page.keyboard.press('Control+y');
  await expect.poll(async () => (await drawings(page)).length).toBe(4);

  // Attach the box to a concept without moving it; it then moves with that concept.
  await tools.getByRole('button', { name: 'Select drawings' }).click();
  const before = await savedBoard(page);
  const concept = before.nodes[0]!;
  // Click the middle of the box's top edge.
  await drag(page, [0.65, 0.25], [0.65, 0.25]);
  const panel = page.getByRole('region', { name: 'Selected drawing' });
  await expect(panel).toBeVisible();
  await panel.getByLabel('Moves with').selectOption(concept.id);
  await expect.poll(async () => (await drawings(page))[0]!.anchorId).toBe(concept.id);
  const attached = (await drawings(page))[0]!;
  expect({
    x: attached.x! + before.positions[concept.id]!.x,
    y: attached.y! + before.positions[concept.id]!.y,
  }).toEqual({ x: saved[0]!.x, y: saved[0]!.y });

  await tools.getByRole('button', { name: 'Diagram (move concepts)' }).click();
  await expect(page.getByTestId('drawing-surface')).toHaveCount(0);
  const rect = page.locator('.drawing-layer [data-shape="rect"] rect');
  const rectBefore = (await rect.boundingBox())!;
  const icon = (await page.locator(`[data-id="${concept.id}"] .node-symbol`).boundingBox())!;
  await page.mouse.move(icon.x + icon.width / 2, icon.y + icon.height / 2);
  await page.mouse.down();
  await page.mouse.move(icon.x + icon.width / 2 + 120, icon.y + icon.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await rect.boundingBox())!.x).toBeGreaterThan(rectBefore.x + 60);

  // Drawings survive a reload; an eraser sweep removes what it crosses.
  await page.reload();
  await expect(page.locator('.drawing-layer [data-drawing]')).toHaveCount(4);
  await page.getByRole('button', { name: 'Eraser' }).click();
  // Reload reframes the canvas with a short animation, so wait for the view to settle
  // and erase at a point on the stroke where it is rendered now.
  const transform = () => page.locator('.drawing-layer > g').first().getAttribute('transform');
  let previous: string | null = null;
  await expect
    .poll(
      async () => {
        const [current, settled] = [await transform(), previous];
        previous = current;
        return current === settled;
      },
      { intervals: [400] },
    )
    .toBe(true);
  const surface = (await page.getByTestId('drawing-surface').boundingBox())!;
  const onStroke = await page
    .locator('.drawing-layer [data-shape="stroke"] path')
    .first()
    .evaluate((path: SVGPathElement) => {
      const point = path.getPointAtLength(path.getTotalLength() / 2);
      const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!);
      return [screen.x, screen.y] as const;
    });
  const at: [number, number] = [
    (onStroke[0] - surface.x) / surface.width,
    (onStroke[1] - surface.y) / surface.height,
  ];
  await drag(page, at, at);
  await expect.poll(async () => (await drawings(page)).length).toBe(3);
  expect((await drawings(page)).some((item) => item.shape === 'stroke')).toBe(false);

  const scan = await accessibilityScan(page);
  expect(scan.violations).toEqual([]);
});

test('a board can be a sketch without any concepts', async ({ page }) => {
  await signUp(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open example: An email’s journey' }).click();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  // Remove every concept so only the drawing remains.
  const board = await savedBoard(page);
  for (const node of board.nodes) {
    await page.locator(`[data-id="${node.id}"]`).click();
    await page.keyboard.press('Delete');
  }
  await expect(page.getByRole('region', { name: 'Welcome to Opsis' })).toBeVisible();
  await page.getByRole('button', { name: 'Show drawing tools' }).click();
  await page.getByRole('button', { name: 'Box', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Welcome to Opsis' })).toHaveCount(0);
  await drag(page, [0.5, 0.3], [0.7, 0.6]);
  await page.getByRole('button', { name: 'Diagram (move concepts)' }).click();
  // A board with only drawings is a sketch in progress, not an empty canvas.
  await expect(page.getByRole('region', { name: 'Welcome to Opsis' })).toHaveCount(0);
  await expect.poll(async () => (await drawings(page)).length).toBe(1);
  await page.reload();
  await expect(page.locator('.drawing-layer [data-drawing]')).toHaveCount(1);
});

test('selects several drawings, copies, resizes, locks, layers and scales them', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signUp(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open example: An email’s journey' }).click();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  await page.getByRole('button', { name: 'Hide the big picture' }).click();
  await page.getByRole('button', { name: 'Show drawing tools' }).click();
  const tools = page.getByRole('toolbar', { name: 'Drawing tools' });
  await tools.getByRole('button', { name: 'Box', exact: true }).click();
  await drag(page, [0.5, 0.2], [0.6, 0.3]);
  await drag(page, [0.7, 0.2], [0.8, 0.3]);
  await expect.poll(async () => (await drawings(page)).length).toBe(2);

  // A selection rectangle picks both; copy and paste adds offset copies as one step.
  await tools.getByRole('button', { name: 'Select drawings' }).click();
  await drag(page, [0.45, 0.15], [0.85, 0.35]);
  await expect(page.getByRole('region', { name: 'Selected drawings' })).toContainText(
    '2 drawings selected',
  );
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await expect(page.getByRole('status').filter({ hasText: 'Pasted 2 drawings.' })).toBeVisible();
  await expect.poll(async () => (await drawings(page)).length).toBe(4);
  const [first, , copy] = await drawings(page);
  expect(copy!.x! - first!.x!).toBe(24);
  expect(copy!.id).not.toBe(first!.id);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await drawings(page)).length).toBe(2);

  // One selected box shows handles; dragging a corner resizes it as one edit.
  await drag(page, [0.55, 0.2], [0.55, 0.2]);
  await expect(page.getByRole('region', { name: 'Selected drawing' })).toBeVisible();
  const handle = (await page.locator('.drawing-handle[data-handle="se"]').boundingBox())!;
  const width = (await drawings(page))[0]!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + 80, handle.y + 40, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => ((await drawings(page))[0] as { width?: number }).width)
    .toBeGreaterThan((width as { width?: number }).width! + 40);

  // A locked drawing stays put and cannot be deleted until unlocked.
  const panel = page.getByRole('region', { name: 'Selected drawing' });
  await panel.getByLabel('Lock (no moving or changes)').check();
  await expect.poll(async () => (await drawings(page))[0]!).toHaveProperty('locked', true);
  const locked = (await drawings(page))[0]!;
  await drag(page, [0.55, 0.2], [0.65, 0.4]);
  await page.keyboard.press('Delete');
  await expect(panel).toContainText('Locked');
  expect((await drawings(page))[0]).toEqual(locked);

  // Layers: a new layer takes new drawings; hiding it hides them on the canvas and reload.
  await tools.getByRole('button', { name: 'Layers and scale' }).click();
  const layers = page.getByRole('region', { name: 'Layers and scale' });
  await layers.getByLabel('Grid square size').fill('0.5');
  await layers.getByLabel('Unit').fill('m');
  await layers.getByRole('button', { name: 'Apply scale' }).click();
  await layers.getByRole('button', { name: 'New layer' }).click();
  await layers.getByLabel('Layer name: Layer 1').fill('Walls');
  await layers.getByLabel('Layer name: Layer 1').press('Enter');
  await expect(layers.getByLabel('Draw on Walls')).toBeChecked();
  expect((await accessibilityScan(page)).violations).toEqual([]);
  await tools.getByRole('button', { name: 'Dimension', exact: true }).click();
  await drag(page, [0.5, 0.6], [0.7, 0.6], true);
  await expect.poll(async () => (await drawings(page)).length).toBe(3);
  const board = await savedBoard(page);
  const dimension = board.drawings!.at(-1)!;
  expect(dimension).toMatchObject({ shape: 'dimension', layerId: expect.any(String) });
  await expect(page.locator('.drawing-labels [data-shape="dimension"] text')).toHaveText(/ m$/);

  await tools.getByRole('button', { name: 'Layers and scale' }).click();
  await layers.getByRole('button', { name: 'Hide Walls' }).click();
  await expect(page.locator(`.drawing-layer [data-drawing="${dimension.id}"]`)).toHaveCount(0);
  await expect(page.locator('.save-status')).toHaveText('Saved');
  await page.reload();
  await expect(page.locator('.drawing-layer [data-drawing]')).toHaveCount(2);
  const saved = (await savedBoard(page)) as Board & {
    drawingLayers?: { name: string; hidden?: boolean }[];
    drawingScale?: { gridValue: number; unit: string };
  };
  await expect
    .poll(async () => ((await savedBoard(page)) as typeof saved).drawingLayers)
    .toEqual([expect.objectContaining({ name: 'Walls', hidden: true })]);
  expect(saved.drawingScale).toEqual({ gridValue: 0.5, unit: 'm' });
});
