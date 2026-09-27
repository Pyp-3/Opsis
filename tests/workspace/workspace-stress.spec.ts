import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { EMAIL_DEMO } from '../../packages/schema/src/board';

const snapshot = (page: Page) =>
  page.evaluate(() => JSON.parse(sessionStorage.getItem('opsis:library-recovery:v1')!).snapshot);
const saved = (page: Page) =>
  expect(page.getByText('Saved to SQLite', { exact: true })).toBeVisible();
async function endpoints(page: Page) {
  const gaps = await page.evaluate(() => {
    const state = JSON.parse(sessionStorage.getItem('opsis:library-recovery:v1')!).snapshot;
    return state.board.edges.flatMap((edge: { id: string; source: string; target: string }) => {
      const path = document.querySelector(
        `[data-id="${edge.id}"] .react-flow__edge-path`,
      ) as SVGPathElement;
      if (!path) return [999];
      return [
        [path.getPointAtLength(0), edge.source],
        [path.getPointAtLength(path.getTotalLength()), edge.target],
      ].map(([point, id]) => {
        const p = point as DOMPoint;
        const screen = new DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM()!);
        return Math.min(
          ...Array.from(document.querySelectorAll(`[data-id="${id}"] [data-handleid]`)).map(
            (element) => {
              const box = element.getBoundingClientRect();
              return Math.hypot(
                screen.x - box.x - box.width / 2,
                screen.y - box.y - box.height / 2,
              );
            },
          ),
        );
      });
    });
  });
  gaps.forEach((gap: number) => expect(gap).toBeLessThan(1));
}

test.beforeEach(async ({ page }) => {
  await page.route('**/v1/agents', (route) =>
    route.fulfill({
      json: [
        { id: 'claude', available: true, detail: 'Fixture' },
        { id: 'codex', available: true, detail: 'Fixture' },
        { id: 'demo', available: true, detail: 'Fixture' },
      ],
    }),
  );
  await page.goto('/');
});

test('board manager stays usable on a narrow mobile viewport and removes the sidebar legend', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole('button', { name: 'Show sidebar' }).click();
  await expect(page.getByLabel('Connection color legend')).toHaveCount(0);
  await page.getByRole('button', { name: 'Manage boards' }).click();
  await expect(page.getByRole('dialog', { name: 'Your boards' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel('New board name').fill(`Mobile ${Date.now()}`);
  await page.getByRole('button', { name: 'Create board', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('manager creates, renames, cancels deletion, deletes and never resurrects a board', async ({
  page,
}) => {
  const name = `Managed ${Date.now()}`;
  await page.getByRole('button', { name: 'Manage boards' }).click();
  await page.getByLabel('New board name').fill(name);
  await page.getByRole('button', { name: 'Create board', exact: true }).click();
  await expect(page.getByLabel('Board name')).toHaveValue(name);
  await saved(page);
  expect((await snapshot(page)).board.nodes).toHaveLength(0);
  await expect(page.getByRole('button', { name: 'Start walkthrough' })).toBeDisabled();
  await page.getByRole('button', { name: 'Add a concept' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await page.getByRole('button', { name: 'Manage boards' }).click();
  await page.getByRole('button', { name: `Rename ${name}`, exact: true }).click();
  await page.getByLabel('Rename board', { exact: true }).fill(`${name} renamed`);
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(
    page.getByRole('button', { name: `Delete ${name} renamed`, exact: true }),
  ).toBeVisible();
  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(scan.violations).toEqual([]);
  await page.getByRole('button', { name: `Delete ${name} renamed`, exact: true }).click();
  await page.getByRole('button', { name: 'Keep board' }).click();
  await expect(page.getByRole('group', { name: 'Confirm board deletion' })).toHaveCount(0);
  await page.getByRole('button', { name: `Delete ${name} renamed`, exact: true }).click();
  await page.getByRole('button', { name: 'Delete permanently' }).click();
  await expect(
    page.getByRole('button', { name: `Delete ${name} renamed`, exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Close board manager' }).click();
  await page.reload();
  await expect(page.getByText('Understand it by seeing it.')).toBeVisible();
  expect((await page.request.get('/v1/boards')).ok()).toBe(true);
  await expect(
    page
      .getByRole('navigation', { name: 'Saved boards' })
      .getByText(`${name} renamed`, { exact: true }),
  ).toHaveCount(0);
});

test('repeated drags, undo, redo and reload keep every endpoint attached and history exact', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Explore the email example' }).click();
  await saved(page);
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await page.waitForTimeout(400);
  for (const delta of [8, 25, -35, 90, -80]) {
    const before = await snapshot(page);
    const icon = await page.locator('[data-id="outgoing"] .node-symbol').boundingBox();
    await page.mouse.move(icon!.x + icon!.width / 2, icon!.y + icon!.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      icon!.x + icon!.width / 2 + delta,
      icon!.y + icon!.height / 2 + delta / 2,
      { steps: 6 },
    );
    await page.waitForTimeout(400); // Cross autosave debounce while the pointer is still down.
    expect(await snapshot(page)).toEqual(before);
    await endpoints(page);
    await page.mouse.up();
    await saved(page);
    const after = await snapshot(page);
    await endpoints(page);
    if (JSON.stringify(after.board) === JSON.stringify(before.board)) {
      expect(after.past).toHaveLength(before.past.length);
      continue;
    }
    expect(after.past).toHaveLength(before.past.length + 1);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).board).toEqual(before.board);
    await endpoints(page);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).board).toEqual(after.board);
    await endpoints(page);
  }
  const beforeReload = await snapshot(page);
  await saved(page);
  await page.reload();
  await expect(page.locator('.react-flow__node')).toHaveCount(5);
  expect(await snapshot(page)).toEqual(beforeReload);
  await endpoints(page);
});

test('edits, icon changes, deletion and all export formats round trip without losing history', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Explore the email example' }).click();
  await saved(page);
  await page
    .getByRole('navigation', { name: 'Diagram steps' })
    .getByRole('button', { name: 'You write', exact: true })
    .click();
  await page.locator('.edit-concept summary').click();
  await page.getByLabel('Label', { exact: true }).fill('Edited sender');
  await page.getByLabel('Label', { exact: true }).press('Tab');
  await page.getByRole('button', { name: 'Change icon' }).click();
  await page.getByLabel('Search icons').fill('cloud');
  await page.getByRole('button', { name: 'Use cloud icon' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(5);
  expect((await snapshot(page)).board.nodes[0]).toMatchObject({
    label: 'Edited sender',
    icon: 'cloud',
  });
  for (const name of [
    'Editable board .json · import it again later',
    'Diagram image .svg · for slides and documents',
    'Markdown notes',
    'PNG image',
  ]) {
    await page.locator('.export-menu summary').click();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name, exact: true }).click();
    const download = await pending;
    expect(await download.failure()).toBeNull();
    const bytes = await readFile((await download.path())!);
    expect(bytes.length).toBeGreaterThan(50);
    if (name.startsWith('Editable board')) {
      const exported = JSON.parse(bytes.toString());
      expect(exported).toEqual((await snapshot(page)).board);
      await page
        .locator('input[type="file"]')
        .setInputFiles({ name: 'roundtrip.json', mimeType: 'application/json', buffer: bytes });
      await expect.poll(async () => (await snapshot(page)).board).toEqual(exported);
    }
  }
});

test('invalid imports and generation errors preserve the board; cancellation ignores late output', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Explore the email example' }).click();
  await saved(page);
  const before = (await snapshot(page)).board;
  await page.locator('input[type="file"]').setInputFiles({
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{broken'),
  });
  await expect(page.getByRole('alert')).toContainText('could not be imported');
  expect((await snapshot(page)).board).toEqual(before);
  await page.locator('input[type="file"]').setInputFiles({
    name: 'too-large.json',
    mimeType: 'application/json',
    buffer: Buffer.alloc(1_000_001, 32),
  });
  expect((await snapshot(page)).board).toEqual(before);
  await page.getByLabel('Agent', { exact: true }).selectOption('claude');
  await page.route('**/v1/boards/generate', (route) =>
    route.fulfill({ status: 502, json: { message: 'Fixture timeout' } }),
  );
  await page.getByLabel('What would you like to understand?').fill('Test error');
  await page.getByRole('button', { name: 'Generate diagram' }).click();
  await expect(page.getByRole('alert')).toContainText('Fixture timeout');
  expect((await snapshot(page)).board).toEqual(before);
  await page.unroute('**/v1/boards/generate');
  let delayedCalls = 0;
  await page.route('**/v1/boards/generate', async (route) => {
    delayedCalls++;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route
      .fulfill({ json: { ...EMAIL_DEMO, title: 'Late unwanted result' } })
      .catch(() => undefined);
  });
  await page.getByRole('button', { name: 'Generate diagram' }).click();
  await page.getByRole('button', { name: 'Cancel generation' }).click();
  await page.waitForTimeout(1400);
  expect(delayedCalls).toBe(1);
  expect((await snapshot(page)).board).toEqual(before);
});

test('connection editing, keyboard undo/redo, arrangement and model settings are reversible and durable', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Explore the email example' }).click();
  await saved(page);
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await page.waitForTimeout(400);
  await page.locator('[data-id="submit"] .connection-label').click();
  await page.getByLabel('Relationship', { exact: true }).fill('A revised relationship');
  await page.getByLabel('Relationship', { exact: true }).press('Tab');
  await page.getByLabel('Connection type').selectOption('feedback');
  await page.getByRole('button', { name: 'Remove connection' }).click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(3);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.react-flow__edge')).toHaveCount(4);
  expect(
    (await snapshot(page)).board.edges.find((edge: { id: string }) => edge.id === 'submit'),
  ).toMatchObject({ label: 'A revised relationship', kind: 'feedback' });
  await page.keyboard.press('Control+y');
  await expect(page.locator('.react-flow__edge')).toHaveCount(3);
  await page.keyboard.press('Control+Shift+z'); // At the redo boundary this must do nothing.
  await expect(page.locator('.react-flow__edge')).toHaveCount(3);
  await page.getByRole('button', { name: 'Add a concept' }).click();
  await page.getByRole('button', { name: 'Close details' }).click();
  const before = (await snapshot(page)).board;
  await page.getByRole('button', { name: 'Arrange downward' }).click();
  await saved(page);
  await endpoints(page);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).board).toEqual(before);
  await page.getByLabel('Agent', { exact: true }).selectOption('claude');
  await page.getByRole('button', { name: /Model settings:/ }).click();
  await page.getByLabel('Model', { exact: true }).selectOption('opus');
  await page.getByLabel('Reasoning effort').selectOption('medium');
  await page.reload();
  await page.getByLabel('Agent', { exact: true }).selectOption('claude');
  await page.getByRole('button', { name: /Model settings: Opus/ }).click();
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('opus');
  await expect(page.getByLabel('Reasoning effort')).toHaveValue('medium');
  await page.getByLabel('Model', { exact: true }).selectOption('haiku');
  await expect(page.getByLabel('Reasoning effort')).toBeDisabled();
});
