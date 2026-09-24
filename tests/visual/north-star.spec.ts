import type { Page } from '@playwright/test';
import { expect, test } from '../browser-fixture';

async function openSample(page: Page, sentence: string): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: sentence }).click();
  await expect(page.getByRole('navigation', { name: 'Diagram as list' })).toBeVisible();
  await page.waitForTimeout(500);
}

test.use({ reducedMotion: 'reduce', viewport: { width: 1280, height: 900 } });

test('sun/east North Star scene', async ({ page }) => {
  await openSample(page, 'The sun rises in the east.');
  await expect(page.locator('.opsis-editor__flow')).toBeVisible();
  await expect(page.locator('.opsis-app')).toHaveScreenshot('sun-east.png');
});

test('sandwich North Star assembled and exploded', async ({ page }) => {
  await openSample(page, 'A sandwich can contain bread, tomato, ham.');
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('.opsis-app')).toHaveScreenshot('sandwich-assembled.png');
  await page.getByRole('button', { name: 'Explode' }).click();
  await expect(page.getByRole('button', { name: 'Assemble' })).toBeVisible();
  await expect(page.locator('.opsis-app')).toHaveScreenshot('sandwich-exploded.png');
});
