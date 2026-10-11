import { expect, type Page } from '@playwright/test';

/** Opens the built-in example through the UI and waits for its first saved revision. */
export async function openEmailExample(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open example: An email’s journey' }).click();
  await expect(page.locator('.save-status')).toHaveText('Saved');
}
