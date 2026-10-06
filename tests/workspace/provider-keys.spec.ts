import { test, expect } from '@playwright/test';
import { signUp, accessibilityScan } from './session';

test('instance keys are write-only and shared while model preferences remain account settings', async ({
  page,
  browser,
}, testInfo) => {
  await signUp(page, 'Instance operator');
  await page.goto('/settings');
  await page.getByRole('button', { name: 'API keys', exact: true }).click();
  const panel = page.getByRole('region', { name: 'API keys' });
  await panel.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('kimi');
  await panel.getByLabel('New API key').fill('fixture-not-a-real-key');
  await panel.getByRole('button', { name: 'Save instance key' }).click();
  await expect(panel.getByRole('status')).toContainText('saved for this Opsis instance');
  await expect(panel.getByLabel('New API key')).toHaveValue('');
  const context = await browser.newContext();
  try {
    const second = await context.newPage();
    await signUp(second, 'Other instance reader');
    await second.goto('/settings');
    await second.getByRole('button', { name: 'API keys', exact: true }).click();
    await expect(second.getByText('Kimi · configured (instance)')).toBeVisible();
    expect(
      await second.request.get('/v1/instance/provider-keys').then((r) => r.text()),
    ).not.toContain('fixture-not-a-real-key');
    await second.getByRole('button', { name: 'Agents and models', exact: true }).click();
    await second.getByLabel('Agent', { exact: true }).selectOption('kimi');
    await second.getByRole('button', { name: 'Check configuration (no model call)' }).click();
    await expect(second.getByRole('status')).toContainText(
      'Instance API key and model settings are configured',
    );
    await second.getByRole('button', { name: 'API keys', exact: true }).click();
    await second.getByRole('button', { name: 'Remove Kimi key' }).click();
    await expect(second.getByText('Kimi · not configured')).toBeVisible();
  } finally {
    await context.close();
  }
  await page.reload();
  await page.getByRole('button', { name: 'API keys', exact: true }).click();
  await expect(panel.getByText('Kimi · not configured')).toBeVisible();
  expect(await page.request.get('/v1/account/settings').then((r) => r.text())).not.toContain(
    'fixture-not-a-real-key',
  );
  await page.screenshot({ path: testInfo.outputPath('instance-keys-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Hide sidebar' }).click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  expect((await accessibilityScan(page)).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('instance-keys-mobile.png'), fullPage: true });
});
