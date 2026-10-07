import { test, expect } from '@playwright/test';
import { signUp, accessibilityScan } from './session';

test('a new canvas saves its first private thread before generation', async ({ page }) => {
  await signUp(page, 'New chat');
  await page.goto('/');
  await page.getByRole('button', { name: 'New canvas', exact: true }).click();
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Chat', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByLabel('Agent', { exact: true }).selectOption('demo');
  await page.getByLabel('What would you like to understand?').fill('Explain email delivery');
  await page.getByRole('button', { name: 'Generate diagram', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('The diagram is ready on Canvas.');
  await expect(page.locator('.save-status')).toHaveText('Saved');
  const boards = await (await page.request.get('/v1/boards')).json();
  expect(boards).toHaveLength(1);
  const threads = await (await page.request.get(`/v1/boards/${boards[0].id}/chat`)).json();
  expect(threads).toHaveLength(1);
  expect(threads[0].messages[0].text).toBe('Explain email delivery');
});

test('private model threads persist separately from a shared canvas', async ({ page, browser }) => {
  await signUp(page, 'Chat owner');
  await page.goto('/');
  await page.getByRole('button', { name: 'Open example: An email’s journey' }).click();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  const boards = await (await page.request.get('/v1/boards')).json();
  const board = boards.find((entry: { title: string }) => entry.title === 'An email’s journey');
  await expect(page.getByRole('tab', { name: 'Coming soon' })).toBeDisabled();
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'What would you like to understand?' })
    .fill('Show delivery failure and retry');
  await page.getByRole('button', { name: 'Generate diagram', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('Show delivery failure and retry');
  await expect(page.getByRole('log')).toContainText('A proposal is ready for review on Canvas.');
  await page.getByRole('tab', { name: /Canvas/ }).click();
  await page.getByRole('button', { name: 'Keep current board', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Interactive diagram canvas' })).toBeVisible();
  const threads = await (await page.request.get(`/v1/boards/${board.id}/chat`)).json();
  expect(threads).toHaveLength(1);
  expect(threads[0].messages).toHaveLength(2);
  await page.reload();
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await page.locator('.chat-thread-menu summary').click();
  await page
    .getByRole('list', { name: 'Chat threads' })
    .getByRole('button', { name: /Show delivery failure and retry/ })
    .click();
  await expect(page.getByRole('log')).toContainText('Show delivery failure and retry');
  expect((await accessibilityScan(page)).violations).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('chat-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('chat-mobile.png') });
  await page.setViewportSize({ width: 1280, height: 720 });
  const context = await browser.newContext();
  try {
    const editorPage = await context.newPage();
    const editor = await signUp(editorPage, 'Chat editor');
    const latest = await (await page.request.get(`/v1/boards/${board.id}`)).json();
    const invite = await page.request.put(`/v1/boards/${board.id}/editors`, {
      data: { email: editor.email, enabled: true, revision: latest.revision },
    });
    expect(invite.ok()).toBeTruthy();
    expect(await (await editorPage.request.get(`/v1/boards/${board.id}/chat`)).json()).toEqual([]);
    const thread = {
      id: threads[0].id,
      agent: 'demo',
      model: 'built-in',
      messages: [{ role: 'user', text: 'Editor’s own private thread' }],
    };
    expect(
      (
        await editorPage.request.put(`/v1/boards/${board.id}/chat`, {
          data: { revision: 0, thread },
        })
      ).ok(),
    ).toBeTruthy();
    expect(await (await page.request.get(`/v1/boards/${board.id}/chat`)).json()).toEqual(threads);
    expect(
      (
        await page.request.put(`/v1/boards/${board.id}/chat`, { data: { revision: 0, thread } })
      ).status(),
    ).toBe(409);
  } finally {
    await context.close();
  }
});

test('chat docks beside a live canvas on wide screens and can take the full page', async ({
  page,
}) => {
  await signUp(page, 'Docked chat');
  await page.goto('/');
  await page.getByRole('button', { name: 'Open example: An email’s journey' }).click();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  const canvas = page.getByRole('region', { name: 'Interactive diagram canvas' });
  const chat = page.getByRole('region', { name: 'Private board chat' });
  // The tabs sit in the header, so no row is taken from the canvas.
  await expect(
    page.locator('.workspace-header').getByRole('tablist', { name: 'Board workspace tabs' }),
  ).toBeVisible();

  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await expect(chat).toBeVisible();
  await expect(canvas).toBeVisible();
  expect((await chat.boundingBox())!.x).toBeGreaterThan((await canvas.boundingBox())!.x);
  await expect(page.getByLabel('What would you like to understand?')).toBeFocused();

  // A proposal is reviewed beside the conversation, and the Canvas tab says one is waiting.
  await page
    .getByLabel('What would you like to understand?')
    .fill('Show delivery failure and retry');
  await page.getByRole('button', { name: 'Generate diagram', exact: true }).click();
  await expect(page.getByRole('tab', { name: /Canvas · Review ready/ })).toBeVisible();
  await page.getByRole('button', { name: 'Review on canvas' }).click();
  const review = page.getByRole('region', { name: 'Review proposed changes' });
  await expect(review).toBeVisible();
  const [reviewBox, chatBox] = [await review.boundingBox(), await chat.boundingBox()];
  expect(reviewBox!.x + reviewBox!.width).toBeLessThanOrEqual(chatBox!.x);
  await page.getByRole('button', { name: 'Keep current board', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Canvas', exact: true })).toBeVisible();

  // Expanding takes the full page, lists threads alongside, and is remembered.
  await page.getByRole('button', { name: 'Expand chat' }).click();
  await expect(canvas).toBeHidden();
  await expect(page.getByRole('list', { name: 'Chat threads' })).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await expect(canvas).toBeHidden();
  await page.getByRole('button', { name: 'Chat beside canvas' }).click();
  await expect(canvas).toBeVisible();
  expect((await accessibilityScan(page)).violations).toEqual([]);
  await page.getByRole('button', { name: 'Close chat' }).click();
  await expect(chat).toHaveCount(0);
  await expect(page.getByRole('tab', { name: /Canvas/ })).toHaveAttribute('aria-selected', 'true');
});

test('docked chat model settings stay reachable and can be closed on a short screen', async ({
  page,
}) => {
  await signUp(page, 'Short docked chat');
  await page.setViewportSize({ width: 1280, height: 640 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open example: An email’s journey' }).click();
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Interactive diagram canvas' })).toBeVisible();
  await page.getByLabel('Agent', { exact: true }).selectOption('claude');
  const toggle = page.getByRole('button', { name: /^Model settings:/ });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  // Every optional section makes the panel taller than the chat column.
  await page.getByLabel('Show task-based suggestions').check();
  await page.getByLabel('Track this agent’s usage windows and disable it at the cap').check();
  await page.getByLabel('Model', { exact: true }).selectOption('custom');

  // The panel scrolls within the chat instead of pushing its controls off the screen.
  const viewport = page.viewportSize()!;
  for (const control of [
    page.getByLabel('Named profile'),
    page.getByLabel('Model', { exact: true }),
    page.getByLabel('Weekly cap'),
  ]) {
    await control.scrollIntoViewIfNeeded();
    const box = (await control.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  }
  // Only the settings panel scrolls; a hidden-overflow page scroll would strand the layout.
  const scrolled = await page.evaluate(() =>
    [...document.querySelectorAll('*')]
      .filter((element) => element.scrollTop > 0)
      .map((element) => element.id || element.className),
  );
  expect(scrolled).toEqual(['model-settings']);
  const toggleBox = (await toggle.boundingBox())!;
  expect(toggleBox.y + toggleBox.height).toBeLessThanOrEqual(viewport.height);
  await expect(page.getByLabel('What would you like to understand?')).toBeInViewport();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#model-settings')).toHaveCount(0);
});
