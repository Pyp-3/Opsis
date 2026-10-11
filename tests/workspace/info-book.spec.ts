import { test, expect, type Page } from '@playwright/test';
import { accessibilityScan, signUp } from './session';
import { openEmailExample } from './board-fixtures';

/** A 3 × 2 PNG, enough to check that a picture is stored, re-drawn and served. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAEUlEQVR4nGOQqzjxH4YZkDkAr5cOL0J6lJcAAAAASUVORK5CYII=',
  'base64',
);

const book = (page: Page) => page.getByRole('tabpanel', { name: 'Info' });
const leaf = (page: Page) => book(page).locator('article.info-leaf');
const saved = (page: Page) => expect(page.locator('.save-status')).toHaveText('Saved');

test('Info reads each page like a book, with the editor’s text, links, pictures and footnotes', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  await signUp(page, 'Book editor');
  await openEmailExample(page);
  const boards = await (await page.request.get('/v1/boards')).json();
  const boardId = boards[0].id as string;
  const stored = async () =>
    (await (await page.request.get(`/v1/boards/${boardId}`)).json()).snapshot.board;

  // The Info tab sits beside Canvas and Chat and reads the page's concepts in order.
  await page.getByRole('tab', { name: 'Info' }).click();
  await expect(page.getByRole('tab', { name: 'Info' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('region', { name: 'Interactive diagram canvas' })).toBeHidden();
  const first = (await stored()).nodes[0] as { label: string };
  await expect(leaf(page).getByRole('heading', { level: 3 }).first()).toHaveText(first.label);
  await expect(leaf(page).locator('.info-object-icon svg').first()).toBeVisible();

  // The editor writes plain text with a safe link; anything else stays literal text.
  await book(page).getByRole('button', { name: 'Edit text' }).click();
  const text = book(page).getByLabel('Page text');
  await text.fill(
    'Mail travels in hops between servers.\nA [trick](javascript:alert(1)) stays text.\n\n',
  );
  await book(page).getByRole('button', { name: 'Link', exact: true }).click();
  await book(page).getByLabel('Link text').fill('RFC 5321');
  await book(page).getByLabel('Address').fill('javascript:alert(1)');
  await book(page).getByRole('button', { name: 'Insert link' }).click();
  await expect(book(page).getByRole('alert')).toContainText('https://');
  await book(page).getByLabel('Address').fill('https://www.rfc-editor.org/rfc/rfc5321');
  await book(page).getByRole('button', { name: 'Insert link' }).click();
  await expect(text).toHaveValue(/\[RFC 5321\]\(https:\/\/www\.rfc-editor\.org\/rfc\/rfc5321\)/);

  // A picture is re-drawn in the browser, stored with the board and placed on its own line.
  await book(page).getByRole('button', { name: 'Picture', exact: true }).click();
  await book(page)
    .getByLabel('Picture', { exact: true })
    .setInputFiles({ name: 'relay.png', mimeType: 'image/png', buffer: PNG });
  await book(page).getByLabel('Description').fill('A relay rack');
  await book(page).getByRole('button', { name: 'Insert picture' }).click();
  await expect(text).toHaveValue(/!\[A relay rack\]\(image:[0-9a-f]{64}\)/);
  await book(page).getByRole('button', { name: 'Save text' }).click();
  await saved(page);

  const prose = leaf(page).locator('.info-prose');
  const link = prose.getByRole('link', { name: 'RFC 5321' });
  await expect(link).toHaveAttribute('href', 'https://www.rfc-editor.org/rfc/rfc5321');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow');
  await expect(prose).toContainText('[trick](javascript:alert(1)) stays text.');
  await expect(prose.locator('a[href^="javascript"]')).toHaveCount(0);
  const picture = prose.getByRole('img', { name: 'A relay rack' });
  await expect(picture).toBeVisible();
  await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(3);
  const source = (await picture.getAttribute('src'))!;
  const served = await page.request.get(source);
  expect(served.headers()['x-content-type-options']).toBe('nosniff');

  // Footnotes attach to objects and are numbered as the reader meets them.
  await leaf(page)
    .getByRole('button', { name: `Add a footnote to ${first.label}` })
    .click();
  await book(page).getByLabel('Note', { exact: true }).fill('The sender’s own device.');
  await book(page).getByRole('button', { name: 'Add footnote' }).click();
  await saved(page);
  await leaf(page).getByRole('button', { name: 'Add a footnote', exact: true }).click();
  const on = book(page).getByLabel('On', { exact: true });
  const connection = await on
    .locator('option')
    .filter({ hasText: '→' })
    .first()
    .getAttribute('value');
  await on.selectOption(connection!);
  await book(page)
    .getByLabel('Note', { exact: true })
    .fill('See [the spec](https://example.com/spec).');
  await book(page).getByRole('button', { name: 'Add footnote' }).click();
  await saved(page);
  const notes = leaf(page).getByRole('region', { name: 'Footnotes' }).locator('li');
  await expect(notes).toHaveCount(2);
  await expect(notes.first()).toContainText(`${first.label}: The sender’s own device.`);
  await expect(notes.nth(1).getByRole('link', { name: 'the spec' })).toHaveAttribute(
    'href',
    'https://example.com/spec',
  );
  await leaf(page).getByRole('link', { name: 'Footnote 1' }).click();
  await expect(notes.first()).toBeFocused();

  // Each edit is one undoable step, from the book's toolbar or the keyboard.
  await book(page).getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(notes).toHaveCount(1);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(notes).toHaveCount(2);
  await saved(page);
  await expect.poll(async () => (await stored()).info?.footnotes?.length).toBe(2);
  expect((await accessibilityScan(page)).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('info-light.png') });

  // Reading settings follow the account.
  await book(page).getByLabel('Text settings').click();
  await page.getByRole('radio', { name: 'Large' }).click();
  await expect.poll(() => leaf(page).evaluate((el) => getComputedStyle(el).fontSize)).toBe('21px');

  // Turning pages turns the canvas too, with a page flip.
  await page.getByRole('tab', { name: /Canvas/ }).click();
  await page.getByRole('button', { name: 'Add page' }).click();
  await page.getByRole('button', { name: 'Add a concept' }).click();
  await saved(page);
  await page.getByRole('tab', { name: 'Info' }).click();
  await expect(
    book(page).locator('.info-bar-where').filter({ hasText: 'Page 2 of 2' }),
  ).toBeVisible();
  await expect(leaf(page).locator('.info-notes li')).toHaveCount(0);
  await book(page).getByRole('button', { name: 'Previous page', exact: true }).click();
  await expect(book(page).locator('.info-leaf.is-turning')).toHaveCount(1);
  await expect(
    book(page).locator('.info-bar-where').filter({ hasText: 'Page 1 of 2' }),
  ).toBeVisible();
  await expect(book(page).locator('.info-leaf.is-turning')).toHaveCount(0);
  await expect(notes).toHaveCount(2);
  await leaf(page).focus();
  await page.keyboard.press('ArrowRight');
  await expect(
    book(page).locator('.info-bar-where').filter({ hasText: 'Page 2 of 2' }),
  ).toBeVisible();
  await page.getByRole('tab', { name: /Canvas/ }).click();
  await expect(page.getByRole('navigation', { name: 'Pages' })).toContainText('2 / 2');
  await page.keyboard.press('PageUp');
  await page.getByRole('tab', { name: 'Info' }).click();
  await expect(
    book(page).locator('.info-bar-where').filter({ hasText: 'Page 1 of 2' }),
  ).toBeVisible();

  // A chat follow-up regenerates the diagram but keeps the page's Info.
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await page.getByLabel('Agent', { exact: true }).selectOption('demo');
  await page
    .getByLabel('What would you like to understand?')
    .fill('Show delivery failure and retry');
  await page.getByRole('button', { name: 'Generate diagram', exact: true }).click();
  await page.getByRole('button', { name: 'Review on canvas' }).click();
  await page
    .getByRole('region', { name: 'Review proposed changes' })
    .getByRole('button', { name: 'Apply reviewed changes' })
    .click();
  await saved(page);
  const after = await stored();
  expect(after.info.text).toContain('RFC 5321');
  expect(after.info.footnotes).toHaveLength(2);

  // Everything survives a reload, and the canvas link reaches the concept.
  await page.reload();
  await page.getByRole('tab', { name: 'Info' }).click();
  await expect(leaf(page).locator('.info-prose')).toContainText('Mail travels in hops');
  await expect(leaf(page).locator('.info-notes li')).toHaveCount(2);
  await leaf(page).getByRole('button', { name: 'Show on canvas' }).first().click();
  await expect(page.getByRole('tab', { name: /Canvas/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: first.label }).first()).toBeVisible();

  // A viewer of a link board reads the book, picture included, but cannot write in it.
  const current = await (await page.request.get(`/v1/boards/${boardId}`)).json();
  await page.request.patch(`/v1/boards/${boardId}`, {
    data: { revision: current.revision, visibility: 'link' },
  });
  const context = await browser.newContext();
  try {
    const viewer = await context.newPage();
    await signUp(viewer, 'Book reader');
    await viewer.goto(`/canvas?board=${boardId}`);
    await viewer.getByRole('tab', { name: 'Info' }).click();
    await expect(leaf(viewer).locator('.info-prose')).toContainText('Mail travels in hops');
    const shown = leaf(viewer).getByRole('img', { name: 'A relay rack' });
    await expect.poll(() => shown.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(3);
    await expect(book(viewer).getByRole('button', { name: 'Edit text' })).toHaveCount(0);
    await expect(leaf(viewer).getByRole('button', { name: /Add a footnote/ })).toHaveCount(0);
  } finally {
    await context.close();
  }

  // Someone without an account opens the link and reads the same book, picture included.
  const anonymous = await browser.newContext();
  try {
    const visitor = await anonymous.newPage();
    await visitor.goto(`/canvas?board=${boardId}`);
    await visitor.getByRole('tab', { name: 'Info' }).click();
    const shared = visitor.locator('article.info-leaf');
    await expect(shared.locator('.info-prose')).toContainText('Mail travels in hops');
    const shown = shared.getByRole('img', { name: 'A relay rack' });
    await expect.poll(() => shown.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(3);
    await expect(visitor.getByRole('button', { name: 'Edit text' })).toHaveCount(0);
    expect((await accessibilityScan(visitor)).violations).toEqual([]);
    await visitor.setViewportSize({ width: 390, height: 844 });
    expect(await visitor.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await visitor.screenshot({ path: testInfo.outputPath('info-visitor-phone.png') });
  } finally {
    await anonymous.close();
  }

  // Dark mode and a phone keep the page readable without sideways scrolling.
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByRole('tab', { name: 'Info' }).click();
  expect((await accessibilityScan(page)).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('info-dark.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(
    await book(page).evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('info-phone.png'), fullPage: false });
});
