import { test, expect } from '@playwright/test';
import { signUp } from './session';

test('saves concept links, follows them and returns, without exposing private backlinks', async ({
  page,
  browser,
}) => {
  await signUp(page, 'Link owner');
  const destination = await (
    await page.request.post('/v1/boards', { data: { title: 'Destination' } })
  ).json();
  await page.goto('/');
  await page.getByRole('button', { name: 'Open example: An email’s journey' }).click();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  const entries = await (await page.request.get('/v1/boards')).json();
  const source = entries.find((entry: { id: string }) => entry.id !== destination.id);
  await page.locator('.react-flow__node').first().click();
  await page.getByLabel('Linked board', { exact: true }).selectOption(destination.id);
  await expect(page.locator('.save-status')).toHaveText('Saved');
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/v1/boards/${destination.id}/backlinks`)).json()).length,
    )
    .toBe(1);
  await page.getByRole('button', { name: 'Open linked board', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Back to previous board' })).toBeVisible();
  await page.getByText('Linked from', { exact: true }).click();
  await expect(
    page.locator('details').filter({ has: page.getByText('Linked from', { exact: true }) }),
  ).toContainText(source.title);
  await page.getByRole('button', { name: 'Back to previous board' }).click();
  await expect(page.locator('.board-link-marker')).toBeVisible();
  const context = await browser.newContext();
  try {
    const other = await context.newPage();
    await signUp(other, 'Link reader');
    expect((await other.request.get(`/v1/boards/${destination.id}/backlinks`)).status()).toBe(404);
    await page.request.patch(`/v1/boards/${destination.id}`, {
      data: { visibility: 'public', revision: destination.revision },
    });
    expect(
      await (await other.request.get(`/v1/boards/${destination.id}/backlinks`)).json(),
    ).toEqual([]);
  } finally {
    await context.close();
  }
  await page.locator('.react-flow__node').first().click();
  await page.getByLabel('Linked board', { exact: true }).selectOption('');
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/v1/boards/${destination.id}/backlinks`)).json()).length,
    )
    .toBe(0);
});
