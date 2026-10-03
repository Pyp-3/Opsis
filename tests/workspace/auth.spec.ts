import { test, expect, type Browser } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signUp } from './session';

async function agentsOnline(page: import('@playwright/test').Page) {
  await page.route('**/v1/agents', (route) =>
    route.fulfill({
      json: [
        { id: 'claude', available: true, detail: 'Fixture' },
        { id: 'codex', available: true, detail: 'Fixture' },
        { id: 'demo', available: true, detail: 'Demo' },
      ],
    }),
  );
}

test('signs up, logs out and logs back in through the page', async ({ page }) => {
  await page.goto('/boards');
  await expect(page).toHaveURL(/\/login\?next=%2Fboards$/);
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.getByRole('tab', { name: 'Sign up' }).click();
  await expect(page).toHaveURL(/\/signup\?next=%2Fboards$/);
  const email = `ui-${Date.now()}@example.com`;
  await page.getByLabel('Name').fill('Grace Hopper');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('short');
  await page.getByRole('button', { name: /^Create account/ }).click();
  await expect(page.getByRole('alert')).toHaveText('Use at least 8 characters.');
  await page.getByLabel('Password', { exact: true }).fill('Correct-horse-9');
  await expect(page.getByText('Strong')).toBeVisible();
  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(scan.violations).toEqual([]);
  await page.getByRole('button', { name: /^Create account/ }).click();
  // Back where the visitor was heading.
  await expect(page).toHaveURL(/\/boards$/);
  await expect(page.getByRole('heading', { name: 'Your boards', level: 1 })).toBeVisible();

  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Correct-horse-9');
  await page.getByRole('button', { name: /^Log in/ }).click();
  await expect(page.getByRole('heading', { name: 'See what you mean.', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Account: Grace Hopper' })).toBeVisible();
});

async function person(browser: Browser, name: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await agentsOnline(page);
  await signUp(page, name);
  await page.goto('/');
  return { context, page };
}

test('friends share public canvases read-only and can save their own copy', async ({ browser }) => {
  const ada = await person(browser, 'Ada');
  const bob = await person(browser, 'Bob');
  try {
    await ada.page.getByRole('button', { name: 'Open example: An email’s journey' }).click();
    await expect(ada.page.getByText('Saved to SQLite')).toBeVisible();
    const id = await ada.page.evaluate(async () => {
      const list = (await (await fetch('/v1/boards')).json()) as { id: string }[];
      return list[0]!.id;
    });

    // Private: Bob's link goes nowhere, and Ada's board is not listed for him.
    await bob.page.goto(`/canvas?board=${id}`);
    await expect(bob.page.getByRole('alert')).toContainText('Could not open this board.');
    await expect(bob.page.getByLabel('Board name')).toHaveCount(0);

    await ada.page.getByRole('button', { name: 'Canvas colours' }).click();
    await ada.page.getByRole('radio', { name: /Public/ }).click();
    await expect(ada.page.getByRole('button', { name: /Copy link/ })).toBeVisible();
    await expect(ada.page.getByText(`/canvas?board=${id}`)).toBeVisible();

    await bob.page.goto('/boards');
    await bob.page.getByRole('tab', { name: 'Public boards' }).click();
    await bob.page.getByRole('button', { name: /An email’s journey.*By Ada/ }).click();
    await expect(bob.page).toHaveURL(/\/canvas$/);
    await expect(bob.page.getByText('Ada’s canvas')).toBeVisible();
    await expect(bob.page.getByLabel('What would you like to understand?')).toHaveCount(0);
    await expect(bob.page.getByRole('button', { name: 'Add a concept' })).toBeDisabled();
    // Viewers can still play it.
    await bob.page.getByRole('button', { name: 'Play the process' }).click();
    await expect(bob.page.getByRole('slider', { name: 'Process timeline' })).toBeVisible();
    await bob.page.getByRole('button', { name: 'Close player' }).click();

    // Ada's later edits reach Bob's open view.
    await ada.page.getByRole('link', { name: 'Back to canvas' }).click();
    await ada.page.getByLabel('Board name').fill('Mail, explained');
    await ada.page.getByLabel('Board name').press('Tab');
    await expect(bob.page.getByRole('heading', { name: 'Mail, explained' }).first()).toBeVisible({
      timeout: 10_000,
    });

    await bob.page.getByRole('button', { name: 'Save a copy' }).click();
    await expect(bob.page.getByLabel('Board name')).toHaveValue('Mail, explained');
    await expect(bob.page.getByText('Ada’s canvas')).toHaveCount(0);
    await expect(bob.page.getByLabel('What would you like to understand?')).toBeVisible();
    await bob.page.getByLabel('Board name').fill('Bob’s mail notes');
    await bob.page.getByLabel('Board name').press('Tab');
    await expect(bob.page.getByText('Saved to SQLite')).toBeVisible();
    // The copy is Bob's; Ada's original is untouched.
    const titles = await ada.page.evaluate(async () =>
      ((await (await fetch('/v1/boards')).json()) as { title: string }[]).map((b) => b.title),
    );
    expect(titles).toEqual(['Mail, explained']);
  } finally {
    await ada.context.close();
    await bob.context.close();
  }
});
