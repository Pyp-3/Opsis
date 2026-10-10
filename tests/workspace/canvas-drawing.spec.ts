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
  await page.keyboard.press('ControlOrMeta+c');
  await page.keyboard.press('ControlOrMeta+v');
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

test('chat sketches beside the diagram after review, and sketches rotate and resize', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signUp(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open example: An email’s journey' }).click();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await page.getByLabel('Agent', { exact: true }).selectOption('demo');
  await page.getByLabel('What would you like to understand?').fill('Sketch the mail servers');
  await page.getByRole('button', { name: 'Generate diagram', exact: true }).click();
  await page.getByRole('button', { name: 'Review on canvas' }).click();
  const review = page.getByRole('region', { name: 'Review proposed changes' });
  await expect(review).toContainText('Add agent sketch: 3 drawings');
  await review.getByRole('button', { name: 'Apply reviewed changes' }).click();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  type Layered = Board & { drawingLayers?: { id: string; name: string }[] };
  await expect
    .poll(async () =>
      (await drawings(page)).map((item) => [item.id, (item as { layerId?: string }).layerId]),
    )
    .toEqual([
      ['provider-zone', 'agent-sketch'],
      ['provider-label', 'agent-sketch'],
      ['zone-width', 'agent-sketch'],
    ]);
  expect(((await savedBoard(page)) as Layered).drawingLayers).toEqual([
    { id: 'agent-sketch', name: 'Agent sketch' },
  ]);
  await expect(
    page.locator('.drawing-labels text').filter({ hasText: 'Your provider’s data centre' }),
  ).toBeVisible();

  // Turn the zone with its rotation handle, then set an exact angle from the panel.
  await page.getByRole('button', { name: 'Close chat' }).click();
  await page.getByRole('button', { name: 'Hide the big picture' }).click();
  await page.getByRole('button', { name: 'Show drawing tools' }).click();
  const tools = page.getByRole('toolbar', { name: 'Drawing tools' });
  await tools.getByRole('button', { name: 'Select drawings' }).click();
  const zone = (await page
    .locator('.drawing-layer [data-drawing="provider-zone"] rect')
    .boundingBox())!;
  await page.mouse.click(zone.x + 12, zone.y + 40);
  const panel = page.getByRole('region', { name: 'Selected drawing' });
  await expect(panel).toBeVisible();
  const turn = (await page.locator('.drawing-handle[data-handle="rotate"] circle').boundingBox())!;
  await page.mouse.move(turn.x + turn.width / 2, turn.y + turn.height / 2);
  await page.mouse.down();
  await page.mouse.move(zone.x + zone.width + 120, zone.y + zone.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(async () => ((await drawings(page))[0] as { rotation?: number }).rotation ?? 0)
    .toBeGreaterThan(30);
  await panel.getByLabel('Rotation in degrees').fill('-30');
  await panel.getByLabel('Rotation in degrees').press('Enter');
  await expect
    .poll(async () => ((await drawings(page))[0] as { rotation?: number }).rotation)
    .toBe(-30);

  // Text is sized from its corner handles.
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  const label = (await page
    .locator('.drawing-labels text')
    .filter({ hasText: 'Your provider’s data centre' })
    .boundingBox())!;
  await page.mouse.click(label.x + 10, label.y + label.height / 2);
  await expect(panel.getByRole('textbox', { name: 'Text' })).toBeVisible();
  const corner = (await page.locator('.drawing-handle[data-handle="se"]').boundingBox())!;
  await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
  await page.mouse.down();
  await page.mouse.move(corner.x + 160, corner.y + 30, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => ((await drawings(page))[1] as { fontSize?: number }).fontSize)
    .toBeGreaterThan(14);

  // Several selected drawings turn together about their shared centre, keeping their layout.
  type Shape = { x?: number; y?: number; rotation?: number; points?: [number, number][] };
  const [zoneBefore, , widthBefore] = (await drawings(page)) as Shape[];
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+a');
  const group = page.getByRole('region', { name: 'Selected drawings' });
  await group.getByLabel('Turn selection by degrees').fill('90');
  await group.getByLabel('Turn selection by degrees').press('Enter');
  await expect.poll(async () => ((await drawings(page))[0] as Shape).rotation).toBe(60);
  const [zoneAfter, , widthAfter] = (await drawings(page)) as Shape[];
  // The zone travelled around the group's centre instead of turning in place…
  expect([zoneAfter!.x, zoneAfter!.y]).not.toEqual([zoneBefore!.x, zoneBefore!.y]);
  // …and the dimension line turned a quarter: (dx, dy) became (-dy, dx).
  const span = (shape: Shape) => {
    const [[x1, y1], [x2, y2]] = shape.points!;
    return [x2 - x1, y2 - y1];
  };
  const [dx, dy] = span(widthBefore!);
  const [tx, ty] = span(widthAfter!);
  expect(tx).toBeCloseTo(-dy!, 0);
  expect(ty).toBeCloseTo(dx!, 0);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => ((await drawings(page))[0] as Shape).rotation).toBe(-30);
  await page.keyboard.press('Escape');

  // With the agent's layer locked, a new chat request cannot change the sketch.
  await tools.getByRole('button', { name: 'Layers and scale' }).click();
  await page
    .getByRole('region', { name: 'Layers and scale' })
    .getByRole('button', { name: 'Lock Agent sketch' })
    .click();
  await expect
    .poll(async () => ((await savedBoard(page)) as Layered).drawingLayers)
    .toEqual([{ id: 'agent-sketch', name: 'Agent sketch', locked: true }]);
  const before = await drawings(page);
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await page.getByLabel('Agent', { exact: true }).selectOption('demo');
  await page.getByLabel('What would you like to understand?').fill('Sketch the mail servers');
  await page.getByRole('button', { name: 'Generate diagram', exact: true }).click();
  await page.getByRole('button', { name: 'Review on canvas' }).click();
  await expect(review).toBeVisible();
  await expect(review).not.toContainText('agent sketch');
  await review.getByRole('button', { name: 'Keep current board' }).click();
  expect(await drawings(page)).toEqual(before);
  expect((await accessibilityScan(page)).violations).toEqual([]);
});

test('paints paths, polygons, arcs and hatching, and picks and restyles groups as one', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signUp(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open example: An email’s journey' }).click();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  // An agent's drawings arrive through the saved-board API, as MCP tools save them.
  const style = { ink: 'sky', line: 'solid', strokeWidth: 2 };
  await page.evaluate(async (style) => {
    const [entry] = (await (await fetch('/v1/boards')).json()) as { id: string }[];
    const current = await (await fetch('/v1/boards/' + entry!.id)).json();
    const board = current.snapshot.board;
    const first = Object.values(board.positions as Record<string, { x: number; y: number }>)[0]!;
    // To the right of the diagram, clear of the drawing panel on the left.
    const x = first.x + 720;
    const y = first.y;
    board.drawings = [
      {
        id: 'zone',
        shape: 'polygon',
        points: [
          [x - 300, y],
          [x - 120, y],
          [x - 210, y + 140],
        ],
        ...style,
        fillInk: 'coral',
        fillOpacity: 0.3,
        hatch: 'diagonal',
      },
      {
        id: 'pipe',
        shape: 'path',
        d: `M${x - 300} ${y + 200}C${x - 240} ${y + 140} ${x - 180} ${y + 260} ${x - 120} ${y + 200}`,
        ...style,
        line: 'dotted',
        startMarker: 'dot',
        endMarker: 'arrow',
      },
      {
        id: 'swing',
        shape: 'arc',
        points: [
          [x - 300, y + 320],
          [x - 210, y + 260],
          [x - 120, y + 320],
        ],
        ...style,
      },
      {
        id: 'pair-a',
        shape: 'rect',
        x: x - 300,
        y: y + 380,
        width: 60,
        height: 40,
        ...style,
        fill: true,
        groupId: 'pair',
      },
      {
        id: 'pair-b',
        shape: 'rect',
        x: x - 200,
        y: y + 380,
        width: 60,
        height: 40,
        ...style,
        fill: true,
        groupId: 'pair',
      },
      {
        id: 'title',
        shape: 'text',
        x: x - 210,
        y: y - 60,
        text: 'Plant room',
        align: 'middle',
        bold: true,
        background: true,
        ...style,
      },
    ];
    await fetch('/v1/boards/' + entry!.id, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ snapshot: current.snapshot, revision: current.revision }),
    });
  }, style);
  await page.reload();
  await expect(page.locator('.drawing-layer [data-drawing]')).toHaveCount(6);
  await expect(page.locator('#opsis-hatch-zone')).toHaveCount(1);
  await expect(page.locator('[data-drawing="pipe"] path').first()).toHaveAttribute(
    'stroke-dasharray',
    '0.1 7',
  );
  // The arc is drawn as a circular arc, and the text is centred and bold.
  await expect(page.locator('[data-drawing="swing"] path')).toHaveAttribute('d', /A/);
  await expect(page.locator('[data-drawing-label="title"] text')).toHaveAttribute(
    'font-weight',
    '700',
  );

  // Clicking one drawing of a group selects the whole group.
  await page.getByRole('button', { name: 'Hide the big picture' }).click();
  await page.getByRole('button', { name: 'Show drawing tools' }).click();
  await page
    .getByRole('toolbar', { name: 'Drawing tools' })
    .getByRole('button', { name: 'Select drawings' })
    .click();
  const pair = (await page.locator('[data-drawing="pair-a"]').boundingBox())!;
  await page.mouse.click(pair.x + pair.width / 2, pair.y + pair.height / 2);
  const panel = page.getByRole('region', { name: 'Selected drawings' });
  await expect(panel).toContainText('2 drawings selected');
  await panel.getByLabel('Hatch').selectOption('dots');
  await panel.getByLabel('Fill ink').selectOption('mint');
  await expect
    .poll(async () =>
      (await drawings(page))
        .filter((item) => item.id.startsWith('pair'))
        .map((item) => [
          (item as { hatch?: string }).hatch,
          (item as { fillInk?: string }).fillInk,
        ]),
    )
    .toEqual([
      ['dots', 'mint'],
      ['dots', 'mint'],
    ]);
  expect((await accessibilityScan(page)).violations).toEqual([]);

  // Dragging the group moves both as one undoable edit.
  const before = (await drawings(page)).filter((item) => item.id.startsWith('pair'));
  const centre = (await page.locator('[data-drawing="pair-a"]').boundingBox())!;
  await page.mouse.move(centre.x + centre.width / 2, centre.y + centre.height / 2);
  await page.mouse.down();
  await page.mouse.move(centre.x + centre.width / 2 + 60, centre.y + centre.height / 2 + 30, {
    steps: 8,
  });
  await page.mouse.up();
  await expect
    .poll(async () => (await drawings(page)).find((item) => item.id === 'pair-b')!.x)
    .not.toBe(before[1]!.x);
  const after = (await drawings(page)).filter((item) => item.id.startsWith('pair'));
  expect(after[0]!.x! - before[0]!.x!).toBe(after[1]!.x! - before[1]!.x!);
  expect(after[0]!.y! - before[0]!.y!).toBe(after[1]!.y! - before[1]!.y!);
  await page.keyboard.press('ControlOrMeta+z');
  await expect
    .poll(async () => (await drawings(page)).find((item) => item.id === 'pair-b')!.x)
    .toBe(before[1]!.x);

  // Everything survives a reload.
  await page.reload();
  await expect(page.locator('#opsis-hatch-pair-a')).toHaveCount(1);
  await expect(page.locator('#opsis-hatch-zone')).toHaveCount(1);
});

test('an agent sketch streams onto the canvas, then changes by edits after review', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await signUp(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open example: An email’s journey' }).click();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await page.getByLabel('Agent', { exact: true }).selectOption('demo');
  await page.getByLabel('What would you like to understand?').fill('Sketch the mail servers');
  await page.getByRole('button', { name: 'Generate diagram', exact: true }).click();

  // Drawings appear faintly on the docked canvas as they arrive, before any review.
  const provisional = page.locator('.drawing-provisional [data-provisional-drawing]');
  await expect(provisional.first()).toBeAttached();
  await expect(
    page.getByRole('status').filter({ hasText: /Sketching on the canvas/ }),
  ).toBeVisible();
  await expect(provisional).toHaveCount(3);
  await page.screenshot({ path: testInfo.outputPath('streaming-sketch.png') });
  expect(await drawings(page)).toEqual([]);
  await page.getByRole('button', { name: 'Review on canvas' }).click();
  await expect(provisional).toHaveCount(0);
  const review = page.getByRole('region', { name: 'Review proposed changes' });
  await review.getByRole('button', { name: 'Apply reviewed changes' }).click();
  await expect(page.locator('.save-status')).toHaveText('Saved');

  // A follow-up changes the sketch by two edits; the rest of the sketch is kept as it was.
  await expect.poll(async () => (await drawings(page)).length).toBe(3);
  const before = await drawings(page);
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await page.getByLabel('What would you like to understand?').fill('Widen the zone');
  await page.getByRole('button', { name: 'Generate diagram', exact: true }).click();
  await expect(provisional).toHaveCount(2);
  await page.getByRole('button', { name: 'Review on canvas' }).click();
  await expect(review).toContainText('agent sketch');
  await review.getByRole('button', { name: 'Apply reviewed changes' }).click();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  await expect
    .poll(async () => (await drawings(page)).map((item) => item.id))
    .toEqual(['provider-zone', 'provider-label', 'zone-width', 'zone-note']);
  const after = await drawings(page);
  expect((after[0] as { width?: number }).width).toBe(368);
  expect(after[1]).toEqual(before[1]);
  await expect(
    page.locator('.drawing-labels text').filter({ hasText: 'Room for the outgoing queue' }),
  ).toBeVisible();
  expect((await accessibilityScan(page)).violations).toEqual([]);
});
