import { test, expect, type Page } from '@playwright/test';
import { signUp, accessibilityScan } from './session';

const token = (page: Page, name: string) =>
  page.evaluate(
    (property) => getComputedStyle(document.documentElement).getPropertyValue(property).trim(),
    name,
  );

test('changes the interface colours and keeps them on the account across browsers', async ({
  page,
  browser,
}, testInfo) => {
  const account = await signUp(page, 'Colour chooser');
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('radio', { name: 'Light' }).click();
  const before = await token(page, '--paper');

  // A background palette recolours the page, panels and lines.
  await page
    .getByRole('radiogroup', { name: 'Background' })
    .getByRole('radio', { name: 'Cool' })
    .click();
  await expect.poll(() => token(page, '--paper')).toBe('#f6f8fb');
  expect(before).not.toBe('#f6f8fb');
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe('rgb(246, 248, 251)');

  // A custom accent is adjusted until white text reads on it, and the gradient follows it.
  const accents = page.getByRole('radiogroup', { name: 'Accent colour' });
  await accents.getByRole('radio', { name: 'Custom' }).click();
  await page.getByLabel('Custom colour hex').fill('#ffcc00');
  await expect.poll(() => token(page, '--accent')).not.toBe('#2d5445');
  const accent = await token(page, '--accent');
  expect(accent).not.toBe('#ffcc00');
  await expect.poll(() => token(page, '--blend')).toContain(accent);
  await expect(page.getByRole('status').filter({ hasText: 'Saved to your account' })).toBeVisible();
  expect((await accessibilityScan(page)).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('appearance-light.png'), fullPage: true });

  // Dark mode keeps the palette's dark tones.
  await page.getByRole('radio', { name: 'Dark' }).click();
  await expect.poll(() => token(page, '--paper')).toBe('#0f141b');
  await expect(page.getByRole('status').filter({ hasText: 'Saved to your account' })).toBeVisible();
  expect((await accessibilityScan(page)).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('appearance-dark.png'), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Hide sidebar' }).click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);

  // Another browser, signed in to the same account, opens with the same look.
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
    await expect.poll(() => token(second, '--paper')).toBe('#0f141b');
    await expect.poll(() => token(second, '--accent')).not.toBe('#cfe3c8');
    await second.getByRole('button', { name: 'Appearance', exact: true }).click();
    await expect(second.getByRole('radio', { name: 'Cool' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(second.getByLabel('Custom colour hex')).toHaveValue('#ffcc00');

    // Resetting there returns the account, and so the first browser, to the default look.
    await second.getByRole('button', { name: 'Reset to default' }).click();
    await expect.poll(() => token(second, '--paper')).not.toBe('#0f141b');
    await expect(
      second.getByRole('status').filter({ hasText: 'Saved to your account' }),
    ).toBeVisible();
  } finally {
    await other.close();
  }
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.hasAttribute('data-theme')))
    .toBe(false);
  await expect.poll(() => token(page, '--paper')).not.toBe('#0f141b');
});

test('a fresh account in a browser used by another account starts from the default look', async ({
  page,
}) => {
  await signUp(page, 'First');
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('radio', { name: 'Warm' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved to your account' })).toBeVisible();
  await page.request.post('/v1/auth/logout');
  await signUp(page, 'Second');
  await page.goto('/settings');
  await expect.poll(() => token(page, '--paper')).not.toBe('#fcf8f1');
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Sage' })).toHaveAttribute('aria-checked', 'true');
});
