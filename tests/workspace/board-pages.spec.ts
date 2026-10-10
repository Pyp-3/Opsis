import { readFile } from 'node:fs/promises';
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
    // The live, read-only canvas: concepts to pan and zoom around, nothing to edit.
    await expect(concepts(guest)).not.toHaveCount(0);
    await expect(guest.getByRole('button', { name: 'Add a concept' })).toHaveCount(0);
    const guestScan = await accessibilityScan(guest);
    expect(guestScan.violations).toEqual([]);

    // The hidden page's own link opens at that page, and the pages turn.
    await guest.goto(`/canvas?board=${entry.id}&page=${hidden.id}`);
    await expect(pager(guest)).toContainText('2 / 2');
    await expect(pager(guest)).toContainText('Pricing');
    const guestConcepts = guest.getByRole('region', { name: 'Concepts' });
    await expect(guestConcepts.getByText('New concept', { exact: true })).toBeVisible();
    await guest.getByRole('button', { name: 'Previous page' }).click();
    await expect(pager(guest)).toContainText('1 / 2');
    await expect(guestConcepts.getByText('New concept', { exact: true })).toHaveCount(0);

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

test('chat answers on a new page, exports cover every page, and guests explore and play', async ({
  page,
  browser,
}) => {
  await signUp(page, 'Deck author');
  await page.goto('/');
  await page.getByRole('button', { name: 'Open example: An email’s journey' }).click();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  const cover = await concepts(page).count();

  // Chat puts its answer on a new page after this one; the first page and the board's name stay.
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  const newPage = page.getByRole('button', { name: 'New page', exact: true });
  await newPage.click();
  await expect(newPage).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('What would you like to understand?').fill('Explain email delivery');
  await page.getByRole('button', { name: 'Generate diagram', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('The diagram is ready on Canvas.');
  await expect(newPage).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('tab', { name: /Canvas/ }).click();
  await expect(pager(page)).toContainText('2 / 2');
  await expect(concepts(page)).not.toHaveCount(0);
  const [entry] = await (await page.request.get('/v1/boards')).json();
  const read = async () =>
    (await (await page.request.get(`/v1/boards/${entry.id}`)).json()).snapshot.board;
  // The answer is saved once the page takes its title.
  await expect.poll(async () => (await read()).pages?.[1]?.title).toBe('An email’s journey');
  const saved = await read();
  expect(saved.title).toBe('An email’s journey');
  expect(saved.nodes).toHaveLength(cover);
  expect(saved.pages[1].content.nodes.length).toBeGreaterThan(0);

  // A reload returns to the page this tab was on.
  await page.reload();
  await expect(pager(page)).toContainText('2 / 2');

  // Notes for every page, each under its own heading.
  await page.locator('.export-menu summary').click();
  await page.getByRole('radio', { name: 'All pages' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Markdown notes/ }).click();
  const notes = await (await download).path().then((path) => readFile(path, 'utf8'));
  expect(notes).toMatch(/^# An email’s journey/);
  expect(notes).toContain('## Page 1: Page 1');
  expect(notes).toContain(`## Page 2: ${saved.pages[1].title}`);

  // Hide page 2, then share the board by link.
  await page.keyboard.press('Escape');
  await pageList(page).click();
  await page.getByRole('button', { name: 'Hide page 2 from viewers' }).click();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  const current = (await (await page.request.get('/v1/boards')).json())[0];
  await page.request.patch(`/v1/boards/${entry.id}`, {
    data: { visibility: 'link', revision: current.revision },
  });

  const guestContext = await browser.newContext();
  const viewerContext = await browser.newContext();
  try {
    // A guest explores the live canvas and plays the process.
    const guest = await guestContext.newPage();
    await guest.goto(`/canvas?board=${entry.id}`);
    await expect(pager(guest)).toContainText('1 / 1');
    await expect(concepts(guest)).toHaveCount(cover);
    await expect(guest.locator('.react-flow__edge')).toHaveCount(cover - 1);
    await guest.getByRole('button', { name: 'Play the process' }).click();
    await expect(guest.getByRole('slider', { name: 'Process timeline' })).toBeVisible();
    await guest.getByRole('button', { name: 'Close player' }).click();
    const scan = await accessibilityScan(guest);
    expect(scan.violations).toEqual([]);

    // A signed-in viewer who opened the hidden page's link keeps seeing it after a reload.
    const viewer = await viewerContext.newPage();
    await signUp(viewer, 'Deck viewer');
    await viewer.goto(`/canvas?board=${entry.id}&page=${saved.pages[1].id}`);
    await expect(pager(viewer)).toContainText('2 / 2');
    await viewer.reload();
    await expect(pager(viewer)).toContainText('2 / 2');
    await viewer.waitForTimeout(2_000);
    await expect(pager(viewer)).toContainText('2 / 2');
  } finally {
    await guestContext.close();
    await viewerContext.close();
  }
});
