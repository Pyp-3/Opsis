import { test, expect, type Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { EMAIL_DEMO } from '../../packages/schema/src/board';

test.beforeEach(async ({ page }) => {
  await page.route('**/v1/agents', (route) =>
    route.fulfill({
      json: [
        { id: 'claude', available: true, detail: 'Test fixture' },
        { id: 'demo', available: true, detail: 'Demo' },
      ],
    }),
  );
  await page.goto('/');
});

test('keeps named boards and undo history after reload, exports and walks through them', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Open example: An email’s journey' }).click();
  await expect(page.getByText('Saved to SQLite')).toBeVisible();
  const title = `Email ${Date.now()}`;
  await page.getByLabel('Board name').fill(title);
  await page.getByLabel('Board name').press('Tab');
  await expect(page.getByRole('heading', { name: title, exact: true }).first()).toBeVisible();
  await expect(page.getByText('Saved to SQLite')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByLabel('Board name')).toHaveValue(EMAIL_DEMO.title);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await page.getByRole('button', { name: 'New canvas', exact: true }).click();
  await expect(page.getByText('Start with a question')).toBeVisible();
  await page.getByRole('link', { name: 'Opsis home' }).click();
  await page
    .getByRole('navigation', { name: 'Saved boards' })
    .getByRole('button', { name: title, exact: true })
    .click();
  await expect(page.getByLabel('Board name')).toHaveValue(title);
  await page.getByRole('button', { name: 'Play the process' }).click();
  const timeline = page.getByRole('slider', { name: 'Process timeline' });
  await expect(timeline).toHaveAttribute('aria-valuetext', /^Step 1 of 6/);
  await page.getByRole('button', { name: 'Next step' }).click();
  await expect(page.locator('.react-flow__node.is-current')).toContainText('You write');
  await page.getByRole('button', { name: 'Next step' }).click();
  await expect(page.locator('.react-flow__node.is-current')).toContainText('Email app');
  await expect(page.locator('.react-flow__node.is-dimmed')).toHaveCount(3);
  await page.getByRole('button', { name: 'Close player' }).click();
  await expect(page.locator('.react-flow__node.is-dimmed')).toHaveCount(0);
  for (const name of ['Markdown notes', 'PNG image']) {
    await page.locator('.export-menu summary').click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name, exact: true }).click();
    expect((await download).suggestedFilename()).toMatch(/\.(md|png)$/);
  }
  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(scan.violations).toEqual([]);
});

test('reviews changed content, keeps existing board on discard, and uses generated suggestions', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Open example: An email’s journey' }).click();
  await page.getByLabel('Agent', { exact: true }).selectOption('claude');
  const candidate = {
    ...EMAIL_DEMO,
    nodes: EMAIL_DEMO.nodes.slice(1),
    edges: EMAIL_DEMO.edges.slice(1),
    suggestions: ['Explain encryption'],
  };
  await page.route('**/v1/boards/generate', (route) =>
    route.fulfill({ status: 409, json: { candidate, changes: ['Remove concept: sender'] } }),
  );
  await page.getByLabel('What would you like to understand?').fill('Expand one step');
  await page.getByRole('button', { name: 'Generate diagram' }).click();
  await expect(page.getByRole('region', { name: 'Review proposed changes' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep current board' }).click();
  await expect(
    page
      .getByRole('navigation', { name: 'Diagram steps' })
      .getByRole('button', { name: /You write/ }),
  ).toBeVisible();
  await page.getByLabel('What would you like to understand?').fill('Try again');
  await page.getByRole('button', { name: 'Generate diagram' }).click();
  await page.getByRole('button', { name: 'Apply reviewed changes' }).click();
  await page.getByRole('button', { name: /Next steps/ }).click();
  await expect(page.getByRole('button', { name: 'Explain encryption', exact: true })).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: 'Diagram steps' })
      .getByRole('button', { name: /You write/ }),
  ).toHaveCount(0);
});

/** Fails if two on-canvas controls or texts cover each other. */
async function expectApart(a: Locator, b: Locator) {
  const [boxA, boxB] = [await a.boundingBox(), await b.boundingBox()];
  expect(boxA && boxB).toBeTruthy();
  const overlap =
    boxA!.x < boxB!.x + boxB!.width &&
    boxB!.x < boxA!.x + boxA!.width &&
    boxA!.y < boxB!.y + boxB!.height &&
    boxB!.y < boxA!.y + boxA!.height;
  expect(overlap, `${await a.textContent()} overlaps ${await b.textContent()}`).toBe(false);
}

for (const [width, height] of [
  [1440, 900],
  [900, 800],
  [390, 844],
] as const)
  test(`heading, play button and tools never overlap at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.reload();
    // Examples live on the landing page, so narrow screens reach them without the sidebar.
    await page.getByRole('button', { name: 'Open example: DNS lookups' }).click();
    const play = page.getByRole('button', { name: 'Play the process' });
    await expect(play).toBeVisible();
    const tools = page.getByRole('toolbar', { name: 'Canvas tools' });
    const title = page.locator('.canvas-heading h2');
    const description = page.locator('.canvas-heading p');
    await expectApart(play, description);
    await expectApart(tools, description);
    await expectApart(tools, title);
    await expectApart(tools, play);
  });

test('next steps stay tucked away until opened, and remember being opened', async ({ page }) => {
  await page.getByRole('button', { name: 'Open example: DNS lookups' }).click();
  const toggle = page.getByRole('button', { name: /Next steps/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('group', { name: 'Next steps' })).toHaveCount(0);
  await toggle.click();
  await expect(page.getByRole('group', { name: 'Next steps' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('group', { name: 'Next steps' })).toBeVisible();
  await page.getByRole('button', { name: 'Hide next steps' }).click();
  await expect(page.getByRole('group', { name: 'Next steps' })).toHaveCount(0);
});

test('mobile canvas remains usable without horizontal page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole('button', { name: 'Open example: An email’s journey' }).click();
  await expect(page.getByRole('button', { name: 'Play the process' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(page.getByLabel('What would you like to understand?')).toBeVisible();
});

test('reuses ports for branches and keeps arrows attached while dragging', async ({ page }) => {
  await page.getByRole('button', { name: 'Open example: An email’s journey' }).click();
  // Reading mode intentionally keeps distant nodes offscreen at a legible zoom.
  // Use the explicit overview for this whole-graph connection-editing scenario.
  await expect(page.getByText('Saved to SQLite')).toBeVisible();
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await page.waitForTimeout(400); // The overview transition lasts 300ms.
  const port = (node: string, side: string) =>
    page.locator(`[data-id="${node}"] [data-handleid="${side}"]`);
  for (const target of ['sender', 'recipient']) {
    const source = await port('outgoing', 'bottom').boundingBox();
    const destination = await port(target, 'bottom').boundingBox();
    await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      destination!.x + destination!.width / 2,
      destination!.y + destination!.height / 2,
      { steps: 12 },
    );
    await page.mouse.up();
  }
  await expect(page.locator('.react-flow__edge')).toHaveCount(6);
  const edge = page.locator('[data-id="transfer"] .react-flow__edge-path');
  const expectAttached = async () => {
    const gaps = await edge.evaluate((element) => {
      const path = element as SVGPathElement;
      const matrix = path.getScreenCTM()!;
      return [
        { point: path.getPointAtLength(0), node: 'outgoing', side: 'right' },
        { point: path.getPointAtLength(path.getTotalLength()), node: 'incoming', side: 'top' },
      ].map(({ point, node, side }) => {
        const anchor = new DOMPoint(point.x, point.y).matrixTransform(matrix);
        const handle = document
          .querySelector(`[data-id="${node}"] [data-handleid="${side}"]`)!
          .getBoundingClientRect();
        return Math.hypot(
          anchor.x - handle.x - handle.width / 2,
          anchor.y - handle.y - handle.height / 2,
        );
      });
    });
    gaps.forEach((gap) => expect(gap).toBeLessThan(1));
  };
  await expectAttached();
  const before = await edge.getAttribute('d');
  const icon = await page.locator('[data-id="outgoing"] .node-symbol').boundingBox();
  await page.mouse.move(icon!.x + icon!.width / 2, icon!.y + icon!.height / 2);
  await page.mouse.down();
  await page.mouse.move(icon!.x + icon!.width / 2 + 40, icon!.y + icon!.height / 2 + 70, {
    steps: 10,
  });
  await expect(edge).not.toHaveAttribute('d', before!);
  await page.mouse.up();
  await expectAttached();
  await expect(page.getByText('Saved to SQLite')).toBeVisible();
  await page.reload();
  await expect(page.locator('.react-flow__edge')).toHaveCount(6);
});

test('a shared /canvas?board= link opens that board, as agents link to it', async ({ page }) => {
  const title = `Linked ${Date.now()}`;
  const created = await page.request.post('/v1/boards', { data: { title } });
  const { id } = (await created.json()) as { id: string };
  await page.goto(`/canvas?board=${id}`);
  await expect(page.getByLabel('Board name')).toHaveValue(title);
  await expect(page).toHaveURL(/\/canvas$/);
});
