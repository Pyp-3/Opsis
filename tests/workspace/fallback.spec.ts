import { test, expect } from '@playwright/test';
import { signUp } from './session';

test('saves a fallback copy and switches only with consent without retrying a failed request', async ({
  page,
  browser,
}) => {
  const account = await signUp(page, 'Fallback reader');
  await page.route('**/v1/agents', (route) =>
    route.fulfill({
      json: [
        { id: 'claude', available: true, detail: 'Fixture' },
        { id: 'codex', available: true, detail: 'Fixture' },
        { id: 'demo', available: true, detail: 'Demo' },
      ],
    }),
  );
  await page.goto('/settings');
  const panel = page.getByRole('region', { name: 'Agents and models' });
  await panel.getByLabel('Agent', { exact: true }).selectOption('codex');
  await panel.getByLabel('Profile name').fill('Backup model');
  await panel.getByRole('button', { name: 'Add profile', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Profiles saved');
  await panel.getByLabel('Agent', { exact: true }).selectOption('claude');
  await panel
    .getByLabel('Fallback profile')
    .selectOption({ label: 'Backup model · codex · gpt-6-luna' });
  await expect(panel.getByRole('status')).toContainText('Fallback saved');
  // Removing the source profile does not silently change the saved fallback.
  await panel.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.reload();
  await expect(panel.getByText(/Saved alternative: codex/)).toBeVisible();

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
    await expect(second.getByText(/Saved alternative: codex/)).toBeVisible();
  } finally {
    await other.close();
  }

  await page.goto('/');
  await page.getByRole('button', { name: 'Open example: An email’s journey' }).click();
  await page.getByLabel('Agent', { exact: true }).selectOption('claude');
  const requests: { agent: string; settings: { model: string } }[] = [];
  await page.route('**/v1/boards/generate', (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ status: 502, json: { message: 'Fixture authentication failure' } });
  });
  await page.getByLabel('What would you like to understand?').fill('Explain the failure branch');
  await page.getByRole('button', { name: 'Generate diagram' }).click();
  await expect(page.getByRole('alert')).toContainText('Fixture authentication failure');
  await expect(page.getByLabel('Agent', { exact: true })).toHaveValue('claude');
  await page.getByRole('button', { name: /^Model settings:/ }).click();
  await page.getByRole('button', { name: 'Switch to saved fallback' }).click();
  await expect(page.getByLabel('Agent', { exact: true })).toHaveValue('codex');
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('gpt-6-luna');
  expect(requests).toHaveLength(1);
  await expect(page.getByLabel('What would you like to understand?')).toHaveValue(
    'Explain the failure branch',
  );
  await page.getByRole('button', { name: 'Generate diagram' }).click();
  await expect(page.getByRole('alert')).toContainText('Fixture authentication failure');
  expect(requests).toHaveLength(2);
  expect(requests[1]).toMatchObject({ agent: 'codex', settings: { model: 'gpt-6-luna' } });

  await page.goto('/settings');
  await panel.getByLabel('Fallback profile').selectOption('');
  await expect(panel.getByRole('status')).toContainText('Fallback removed');
  await page.reload();
  await expect(panel.getByText(/Saved alternative:/)).toHaveCount(0);
});
