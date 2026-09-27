import { test, expect } from '@playwright/test';
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
  await page.getByRole('button', { name: 'Explore the email example' }).click();
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
  await expect(page.getByText('Understand it by seeing it.')).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Saved boards' })
    .getByRole('button', { name: title, exact: true })
    .click();
  await expect(page.getByLabel('Board name')).toHaveValue(title);
  await page.getByRole('button', { name: 'Start walkthrough' }).click();
  await expect(page.getByRole('complementary', { name: 'Details for You write' })).toBeVisible();
  await page.getByRole('button', { name: 'Next concept' }).click();
  await expect(page.getByRole('complementary', { name: 'Details for Email app' })).toBeVisible();
  await page.getByRole('button', { name: 'End walkthrough' }).click();
  await page.getByRole('button', { name: 'Close details' }).click();
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
  await page.getByRole('button', { name: 'Explore the email example' }).click();
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
  await expect(page.getByRole('button', { name: 'Explain encryption', exact: true })).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: 'Diagram steps' })
      .getByRole('button', { name: /You write/ }),
  ).toHaveCount(0);
});

test('mobile canvas remains usable without horizontal page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole('button', { name: 'Explore the email example' }).click();
  await expect(page.getByRole('button', { name: 'Start walkthrough' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(page.getByLabel('What would you like to understand?')).toBeVisible();
});

test('reuses ports for branches and keeps arrows attached while dragging', async ({ page }) => {
  await page.getByRole('button', { name: 'Explore the email example' }).click();
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
  const before = await edge.getAttribute('d');
  const icon = await page.locator('[data-id="outgoing"] .node-symbol').boundingBox();
  await page.mouse.move(icon!.x + icon!.width / 2, icon!.y + icon!.height / 2);
  await page.mouse.down();
  await page.mouse.move(icon!.x + icon!.width / 2 + 40, icon!.y + icon!.height / 2 + 70, {
    steps: 10,
  });
  await expect(edge).not.toHaveAttribute('d', before!);
  await page.mouse.up();
  await expect(page.getByText('Saved to SQLite')).toBeVisible();
  await page.reload();
  await expect(page.locator('.react-flow__edge')).toHaveCount(6);
});
