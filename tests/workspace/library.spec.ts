import { test, expect } from '@playwright/test';
import { signUp } from './session';

test('searches across boards and opens the matching concept on the canvas', async ({ page }) => {
  await signUp(page, 'Searcher');
  await page.goto('/');
  await page.getByRole('button', { name: 'Open example: An email’s journey' }).click();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  expect((await page.request.post('/v1/boards', { data: { title: 'Unrelated' } })).status()).toBe(
    201,
  );
  await page.goto('/boards');
  await expect(page.getByRole('heading', { name: 'Your boards' })).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(page).toHaveURL(/\/search$/);
  const search = page.getByLabel('Search all boards');
  await search.fill('receiving server');
  const results = page.getByRole('list', { name: 'Search results' });
  await expect(results.getByRole('listitem').first()).toBeVisible();
  await expect(results).not.toContainText('Unrelated');
  const first = results.getByRole('button').first();
  const label = (await first.locator('strong').textContent())!;
  await first.click();
  await expect(page).toHaveURL(/\/canvas$/);
  await expect(page.getByRole('complementary', { name: `Details for ${label}` })).toBeVisible();

  await page.goto('/search');
  await page.getByLabel('Search all boards').fill('zzqx nothing');
  await expect(page.getByText('Nothing matches “zzqx nothing”.')).toBeVisible();
});
