import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signUp } from './session';

test('saves a named template, reuses it after reload, and deletes it without deleting projects', async ({
  page,
}) => {
  await signUp(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open example: DNS lookups' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  const sourceTitle = await page.getByLabel('Board name', { exact: true }).inputValue();
  const sourceNodes = await page.locator('.react-flow__node').count();
  await page.getByRole('link', { name: 'Manage boards' }).click();
  await page.getByRole('button', { name: `Save ${sourceTitle} as template`, exact: true }).click();
  await page.getByLabel('Template name', { exact: true }).fill('DNS starter');
  await page.getByRole('button', { name: 'Save template', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Template “DNS starter” saved');
  await page.reload();
  await page.getByRole('tab', { name: 'Templates', exact: true }).click();
  await page.getByRole('button', { name: 'DNS starter Use template' }).click();
  await page.getByLabel('New project board name').fill('New DNS project');
  await page.getByRole('button', { name: 'Create from template', exact: true }).click();
  await expect(page.getByLabel('Board name', { exact: true })).toHaveValue('New DNS project');
  await expect(page.locator('.react-flow__node')).toHaveCount(sourceNodes);
  await page.getByRole('link', { name: 'Manage boards' }).click();
  await page.getByRole('tab', { name: 'Templates', exact: true }).click();
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations,
  ).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Delete template DNS starter', exact: true }).click();
  await page.getByRole('button', { name: 'Delete permanently', exact: true }).click();
  await expect(page.getByText('No templates yet.', { exact: false })).toBeVisible();
  await page.getByRole('tab', { name: 'My boards', exact: true }).click();
  await expect(page.getByRole('button', { name: /^New DNS project/ })).toBeVisible();
  await expect(page.getByRole('button', { name: new RegExp(`^${sourceTitle}`) })).toBeVisible();
});
