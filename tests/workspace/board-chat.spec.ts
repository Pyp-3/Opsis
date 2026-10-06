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
  await page.getByLabel('Chat thread', { exact: true }).selectOption(threads[0].id);
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
