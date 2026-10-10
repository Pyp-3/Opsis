import { test, expect, type Page } from '@playwright/test';
import { accessibilityScan, signUp } from './session';

const pager = (page: Page) => page.getByRole('navigation', { name: 'Pages' });
const concepts = (page: Page) => page.locator('.react-flow__node');
/** The page list's disclosure, named for the page on screen. */
const pageList = (page: Page) => pager(page).locator('summary');

test('turns pages like a book, hides one from viewers and shares the board by link', async ({
  page,
  browser,
}) => {
  await signUp(page, 'Pitch owner');
  await page.goto('/');
  await page.getByRole('button', { name: 'Open example: An email’s journey' }).click();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  const cover = await concepts(page).count();
  expect(cover).toBeGreaterThan(3);

  // A second page is a fresh canvas; the first keeps its diagram.
  await page.getByRole('button', { name: 'Add page' }).click();
  await expect(pager(page)).toContainText('2 / 2');
  await expect(concepts(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'See what you mean.' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add a concept' }).click();
  await expect(concepts(page)).toHaveCount(1);
  await page.getByRole('button', { name: 'Previous page' }).click();
  await expect(pager(page)).toContainText('1 / 2');
  await expect(concepts(page)).toHaveCount(cover);
  await page.locator('.react-flow__pane').click();
  await page.keyboard.press('PageDown');
  await expect(pager(page)).toContainText('2 / 2');
  await expect(concepts(page)).toHaveCount(1);

  // Undo turns back to the page it changes.
  await page.keyboard.press('PageUp');
  await expect(pager(page)).toContainText('1 / 2');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(pager(page)).toContainText('2 / 2');
  await expect(concepts(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(concepts(page)).toHaveCount(1);

  // Name the page and hide it from people who only view the board.
  await expect(pageList(page)).toHaveAttribute('aria-label', 'Page 2 of 2: Page 2. Show pages');
  await pageList(page).click();
  await page.getByLabel('Name of page 2').fill('Pricing');
  await page.getByLabel('Name of page 2').press('Enter');
  await page.getByRole('button', { name: 'Hide page 2 from viewers' }).click();
  await expect(page.getByRole('button', { name: 'Hide page 2 from viewers' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(pageList(page)).toHaveAttribute('aria-label', /Page 2 of 2: Pricing/);
  const scan = await accessibilityScan(page);
  expect(scan.violations).toEqual([]);
  await page.getByRole('button', { name: 'Go to page 1: Page 1' }).click();
  await expect(pager(page)).toContainText('1 / 2');
  await expect(page.locator('.save-status')).toHaveText('Saved');

  // Anyone with the link: no account needed.
  await page.getByRole('button', { name: 'Canvas colours' }).click();
  await page.getByRole('radio', { name: /Anyone with the link/ }).click();
  await expect(page.getByRole('button', { name: /Copy link/ })).toBeVisible();
  await expect(page.locator('.visibility-badge')).toHaveText('Anyone with the link');
  const [entry] = await (await page.request.get('/v1/boards')).json();
  expect(entry.visibility).toBe('link');
  const saved = await (await page.request.get(`/v1/boards/${entry.id}`)).json();
  const hidden = saved.snapshot.board.pages[1];
  expect(hidden).toMatchObject({ title: 'Pricing', hidden: true });

  const guestContext = await browser.newContext();
  const viewerContext = await browser.newContext();
  try {
    const guest = await guestContext.newPage();
    await guest.goto(`/canvas?board=${entry.id}`);
    await expect(guest.getByRole('heading', { name: 'An email’s journey' })).toBeVisible();
    await expect(guest.getByText('Shared by Pitch owner · view only')).toBeVisible();
    await expect(guest).toHaveURL(new RegExp(`/canvas\\?board=${entry.id}$`));
    await expect(pager(guest)).toContainText('1 / 1');
    await expect(guest.getByText('Pricing')).toHaveCount(0);
    await expect(guest.getByRole('img', { name: 'Diagram: An email’s journey' })).toBeVisible();
    const guestScan = await accessibilityScan(guest);
    expect(guestScan.violations).toEqual([]);

    // The hidden page's own link opens at that page, and the pages turn.
    await guest.goto(`/canvas?board=${entry.id}&page=${hidden.id}`);
    await expect(pager(guest)).toContainText('2 / 2');
    await expect(pager(guest)).toContainText('Pricing');
    await expect(guest.getByText('New concept', { exact: true })).toBeVisible();
    await guest.getByRole('button', { name: 'Previous page' }).click();
    await expect(pager(guest)).toContainText('1 / 2');
    await expect(guest.getByText('New concept', { exact: true })).toHaveCount(0);

    // A signed-in viewer opens it read-only, without the hidden page or ways to change pages.
    const viewer = await viewerContext.newPage();
    await signUp(viewer, 'Pitch viewer');
    await viewer.goto(`/canvas?board=${entry.id}`);
    await expect(viewer.getByText('Pitch owner’s canvas')).toBeVisible();
    await expect(pager(viewer)).toContainText('1 / 1');
    await expect(viewer.getByRole('button', { name: 'Add page' })).toHaveCount(0);
    await viewer.goto(`/canvas?board=${entry.id}&page=${hidden.id}`);
    await expect(pager(viewer)).toContainText('2 / 2');
    await expect(concepts(viewer)).toHaveCount(1);

    // Private again: the link now leads to sign-in.
    await page.getByRole('radio', { name: /Private/ }).click();
    await expect(page.locator('.visibility-badge')).toHaveText('Private');
    await guest.goto(`/canvas?board=${entry.id}`);
    await expect(guest).toHaveURL(/\/login\?next=/);
  } finally {
    await guestContext.close();
    await viewerContext.close();
  }

  // Pages, names and hiding survive a reload.
  await page.goto('/canvas');
  await expect(pager(page)).toContainText('1 / 2');
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(pageList(page)).toHaveAttribute('aria-label', /Page 2 of 2: Pricing/);
  await expect(concepts(page)).toHaveCount(1);
});

test('the page bar fits a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signUp(page, 'Phone reader');
  await page.goto('/');
  await page.getByRole('button', { name: 'Open example: An email’s journey' }).click();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  await page.getByRole('button', { name: 'Add page' }).click();
  await expect(pager(page)).toContainText('2 / 2');
  await pageList(page).click();
  const panel = page.locator('.board-pages-panel');
  await expect(panel).toBeVisible();
  for (const box of [await pager(page).boundingBox(), await panel.boundingBox()]) {
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
