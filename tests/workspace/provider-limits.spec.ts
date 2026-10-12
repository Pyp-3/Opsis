import { test, expect, type Route } from '@playwright/test';
import { accessibilityScan, signUp } from './session';

// The host checks its real CLI logins, so the browser suite serves fixed reports instead.
const at = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
const claude = (session: number) => ({
  provider: 'claude',
  limits: {
    provider: 'claude',
    status: session >= 80 ? 'warning' : 'allowed',
    windows: [
      {
        id: 'session',
        label: 'Session (5 hours)',
        models: null,
        usedPercent: session,
        resetsAt: at(134),
        windowMinutes: 300,
      },
      {
        id: 'week',
        label: 'Week · all models',
        models: null,
        usedPercent: 41,
        resetsAt: at(4 * 1440),
        windowMinutes: 10080,
      },
      {
        id: 'week:sonnet',
        label: 'Week · Sonnet',
        models: 'sonnet',
        usedPercent: 100,
        resetsAt: at(2 * 1440),
        windowMinutes: 10080,
      },
    ],
    plan: 'max',
    observedAt: at(-3),
    source: 'check',
  },
  problem: null,
  checking: false,
});
const codex = {
  provider: 'codex',
  limits: null,
  problem: 'The CLI is not installed here, or its version is not supported.',
  checking: false,
};

test('the composer shows the host’s provider limits for the chosen model', async ({ page }) => {
  let session = 12;
  const refreshes: unknown[] = [];
  const serve = (route: Route) => route.fulfill({ json: { providers: [claude(session), codex] } });
  await page.route('**/v1/providers/limits', serve);
  await page.route('**/v1/providers/limits/refresh', async (route) => {
    refreshes.push(route.request().postDataJSON());
    session = 85;
    await serve(route);
  });

  await signUp(page, 'Limit watcher');
  await page.goto('/');
  await page.getByRole('button', { name: 'Open example: An email’s journey' }).click();
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await page.getByLabel('Agent', { exact: true }).selectOption('claude');

  // Haiku counts against the shared windows only.
  const pill = page.getByRole('button', { name: /^Claude limits:/ });
  await expect(pill).toHaveAccessibleName('Claude limits: 5h 12% · Week 41%');
  await pill.click();
  const panel = page.getByRole('region', { name: 'Claude limits' });
  await expect(panel).toContainText('max plan');
  await expect(panel).toContainText('Session (5 hours)12% used');
  await expect(panel.locator('li.is-other-model')).toContainText('not counted for this model');
  await expect(panel).toContainText('Checked 3 min ago');
  expect((await accessibilityScan(page)).violations).toEqual([]);

  // A check asks the host for that provider only, and the meter follows the new report.
  await panel.getByRole('button', { name: 'Check now' }).click();
  await expect(pill).toHaveAccessibleName('Claude limits: 5h 85% · Week 41%');
  await expect(pill).toHaveClass(/is-warning/);
  expect(refreshes).toEqual([{ providers: ['claude'] }]);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();

  // The model picker marks a model whose own window is used up.
  await page.getByRole('button', { name: /^Model settings:/ }).click();
  const model = page.getByLabel('Model', { exact: true });
  await expect(model.locator('option[value="claude-sonnet-5-5"]')).toHaveText(
    'Sonnet 5.5 · limit reached',
  );
  await expect(model.locator('option[value="claude-opus-5-5"]')).toHaveText('Opus 5.5');
  await model.selectOption('claude-sonnet-5-5');
  await expect(pill).toHaveAccessibleName(/^Claude limits: Limit reached · resets in 2d/);
  await expect(pill).toHaveClass(/is-limited/);
  await pill.click();
  await expect(panel.getByRole('status')).toContainText('used up');

  // A provider whose CLI is missing says so instead of showing numbers.
  await page.getByLabel('Agent', { exact: true }).selectOption('codex');
  const codexPill = page.getByRole('button', { name: /^Codex limits:/ });
  await expect(codexPill).toHaveAccessibleName('Codex limits: Limits unavailable');
  await codexPill.click();
  await expect(page.getByRole('region', { name: 'Codex limits' })).toContainText('not installed');
});

test('the limits panel fits a phone screen', async ({ page }) => {
  await page.route('**/v1/providers/limits', (route) =>
    route.fulfill({ json: { providers: [claude(12), codex] } }),
  );
  await page.setViewportSize({ width: 390, height: 780 });
  await signUp(page, 'Phone limits');
  await page.goto('/');
  await page.getByRole('button', { name: 'Open example: An email’s journey' }).click();
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await page.getByLabel('Agent', { exact: true }).selectOption('claude');
  await page.getByRole('button', { name: /^Claude limits:/ }).click();
  const panel = page.getByRole('region', { name: 'Claude limits' });
  await expect(panel).toBeVisible();
  const box = (await panel.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
