import { test, expect } from '@playwright/test';
import { signUp, accessibilityScan } from './session';

test('projects explicit token costs and saves assumptions across browser contexts without a model call', async ({
  page,
  browser,
}, testInfo) => {
  const account = await signUp(page, 'Cost planner');
  let generations = 0;
  page.on('request', (request) => {
    if (/\/v1\/boards\/(generate|illustrate)/.test(request.url())) generations++;
  });
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Cost projection', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Cost projection' });
  await panel.getByRole('combobox', { name: 'Pricing', exact: true }).selectOption('custom');
  await panel.getByLabel('Uncached input USD / million tokens', { exact: true }).fill('1');
  await panel.getByLabel('Output USD / million tokens', { exact: true }).fill('5');
  await panel.getByLabel('Uncached input tokens', { exact: true }).fill('1000');
  await panel.getByLabel('Output tokens (including reasoning)', { exact: true }).fill('1000');
  await panel.getByLabel('Requests per day', { exact: true }).fill('20');
  await expect(panel.locator('.projection-totals')).toContainText('$3.6000');
  await expect(panel.getByRole('img')).toHaveAttribute('aria-label', /90 days: \$10\.8000/);
  await panel.getByRole('button', { name: 'Save projection assumptions' }).click();
  await expect(panel.getByRole('status')).toHaveText(
    'Projection assumptions saved to your account.',
  );
  await page.reload();
  await page.getByRole('button', { name: 'Cost projection', exact: true }).click();
  await expect(panel.getByLabel('Requests per day')).toHaveValue('20');
  await page.screenshot({
    path: testInfo.outputPath('cost-projection-desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Hide sidebar' }).click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  expect((await accessibilityScan(page)).violations).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath('cost-projection-mobile.png'),
    fullPage: true,
  });
  await panel.getByRole('button', { name: 'Save projection assumptions' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('cost-projection-chart.png') });
  const other = await browser.newContext();
  try {
    const second = await other.newPage();
    expect(
      (
        await second.request.post('/v1/auth/login', {
          data: { email: account.email, password: account.password },
        })
      ).status(),
    ).toBe(200);
    await second.goto('/settings');
    await second.getByRole('button', { name: 'Cost projection', exact: true }).click();
    await expect(second.getByLabel('Requests per day')).toHaveValue('20');
    await expect(second.locator('.projection-totals')).toContainText('$3.6000');
  } finally {
    await other.close();
  }
  expect(generations).toBe(0);
});
