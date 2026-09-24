import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '../browser-fixture';

const SANDWICH = 'A sandwich can contain bread, tomato, ham.';
const EDIT_SANDWICH = 'A sandwich can contain bread, tomato, ham, and lettuce.';

async function cleanStart(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
}

async function draw(page: Page, sentence: string): Promise<void> {
  await page.getByLabel(/type a sentence/i).fill(sentence);
  await page.getByRole('button', { name: 'Draw it' }).click();
  await expect(page.getByRole('navigation', { name: 'Diagram as list' })).toBeVisible();
}

async function tabUntil(page: Page, label: RegExp, maximum = 40): Promise<void> {
  for (let step = 0; step < maximum; step += 1) {
    await page.keyboard.press('Tab');
    const name = await page.evaluate(() => {
      const active = document.activeElement;
      return active?.getAttribute('aria-label') ?? active?.textContent ?? '';
    });
    if (label.test(name.trim())) return;
  }
  throw new Error(`Keyboard focus did not reach ${String(label)} within ${maximum} tabs`);
}

test.beforeEach(async ({ page }) => cleanStart(page));

test('sentence → diagram → summary → explanation is accessible', async ({ page }) => {
  await draw(page, SANDWICH);
  const outline = page.getByRole('navigation', { name: 'Diagram as list' });
  await outline.getByRole('button', { name: /^Tomato/ }).click();
  const panel = page.getByRole('complementary', { name: 'Tomato' });
  await expect(panel.getByRole('tab', { name: 'Summary' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(panel.getByRole('tabpanel')).not.toBeEmpty();
  await panel.getByRole('button', { name: 'Explain more' }).click();
  await expect(panel.getByRole('tab', { name: 'Explanation' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(panel.getByText('Why it matters here')).toBeVisible();

  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(audit.violations).toEqual([]);
});

test('sandwich explodes, opens Tomato, and returns through the breadcrumb', async ({ page }) => {
  await draw(page, SANDWICH);
  await page.getByRole('button', { name: 'Explode' }).click();
  await expect(page.getByRole('button', { name: 'Assemble' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page
    .getByRole('navigation', { name: 'Diagram as list' })
    .getByRole('button', { name: /^Tomato/ })
    .click();
  await page.getByRole('button', { name: 'Open' }).click();
  const breadcrumbs = page.getByRole('navigation', { name: 'Diagram path' });
  await expect(breadcrumbs).toContainText('Tomato');
  await breadcrumbs.getByRole('button').first().click();
  await expect(page.getByRole('button', { name: 'Explode' })).toBeVisible();
});

test('2D edits persist in 3D and after save/reload', async ({ page }) => {
  // A distinct source sentence keeps this persistence test independent of the North Star scene.
  await draw(page, EDIT_SANDWICH);
  await page.getByRole('button', { name: '2D' }).click();
  const label = page.getByRole('textbox', { name: 'Label for Tomato' });
  await label.fill('Cherry tomato');
  await label.press('Enter');
  await page.getByRole('button', { name: '3D' }).click();
  await expect(
    page
      .getByRole('navigation', { name: 'Diagram as list' })
      .getByRole('button', { name: /^Cherry tomato/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: '2D' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status')).toContainText('Saved');
  await page.reload();
  await expect(
    page
      .getByRole('navigation', { name: 'Diagram as list' })
      .getByRole('button', { name: /^Cherry tomato/ }),
  ).toBeVisible();
});

test('animated presentation reveals direction, locks edits, then restores editing', async ({
  page,
}) => {
  await draw(page, 'The sun rises in the east.');
  // Presentation may move a primitive outside React Flow's accessible viewport while fitting the
  // current step; include it so this assertion checks edit locking rather than viewport culling.
  const label = page.getByRole('textbox', { name: 'Label for Sun', includeHidden: true });
  await page.getByRole('button', { name: 'Present' }).click();
  await expect(label).toBeDisabled();
  await page.getByRole('button', { name: 'Next step' }).click();
  await expect(page.locator('.opsis-flow-edge--emphasized')).toHaveCount(1);
  await page.getByRole('button', { name: 'Play presentation' }).click();
  await expect(page.getByRole('button', { name: 'Pause presentation' })).toBeVisible();

  await page.getByRole('button', { name: 'Exit presentation' }).click();
  await expect(label).toBeEnabled();
  await label.fill('Morning sun');
  await label.press('Enter');
  await page.getByRole('button', { name: '3D' }).click();
  await expect(
    page
      .getByRole('navigation', { name: 'Diagram as list' })
      .getByRole('button', { name: /^Morning sun/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Auto' }).click();
  await expect(page.getByRole('textbox', { name: 'Label for Morning sun' })).toHaveValue(
    'Morning sun',
  );
});

test('offline fallback draws an unknown sentence without a provider or crash', async ({ page }) => {
  await draw(page, 'Flibbertigibbet quuxes the zorbulator.');
  await expect(page.getByText(/2D selected for clarity/)).toBeVisible();
  await expect(page.locator('.opsis-flow-node')).toHaveCount(1);
  await expect(page.getByRole('navigation', { name: 'Diagram as list' })).toContainText(
    'Flibbertigibbet quuxes the zorbulator',
  );
});

test('keyboard-only sandwich flow supports summary, explanation, drill-down and back', async ({
  page,
}) => {
  await page.keyboard.press('Tab'); // skip link
  await page.keyboard.press('Tab'); // sentence input
  await page.keyboard.type(SANDWICH);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('navigation', { name: 'Diagram as list' })).toBeVisible();

  await page.keyboard.press('e');
  await expect(page.getByRole('button', { name: 'Assemble' })).toBeVisible();
  await tabUntil(page, /^Tomato/);
  await page.keyboard.press('Shift+Enter');
  await expect(page.getByRole('tab', { name: 'Explanation' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('Escape');
  await page.keyboard.press('o');
  await expect(page.getByRole('navigation', { name: 'Diagram path' })).toContainText('Tomato');
  await page.keyboard.press('Backspace');
  await expect(page.getByRole('button', { name: 'Explode' })).toBeVisible();
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('explode is an instant state change when the preference is reduced', async ({ page }) => {
    await draw(page, SANDWICH);
    await expect(page.getByLabel('Reduce motion')).toBeChecked();
    await expect(page.locator('.opsis-app')).toHaveClass(/opsis-reduce-motion/);
    await page.getByRole('button', { name: 'Explode' }).click();
    await expect(page.getByRole('button', { name: 'Assemble' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

test.describe('mobile Auto view', () => {
  test.use({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });

  test('keeps the complete learning flow available when changing modes', async ({ page }) => {
    await draw(page, 'The sun rises in the east.');
    await expect(page.getByRole('button', { name: 'Auto' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByText(/2D selected for clarity/)).toBeVisible();
    await expect(page.locator('.opsis-editor__flow')).toBeVisible();

    await page.getByLabel('Reading level').selectOption('child');
    const outline = page.getByRole('navigation', { name: 'Diagram as list' });
    await outline.getByRole('button', { name: 'Rise' }).focus();
    await page.keyboard.press('Shift+Enter');
    await expect(page.getByRole('complementary', { name: 'Rise' })).toContainText('Did you know?');

    await page.getByRole('button', { name: '3D' }).click();
    await expect(page.locator('canvas')).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Rise' })).toBeVisible();
    await expect(page.getByLabel('Reading level')).toHaveValue('child');

    await page.getByRole('button', { name: 'Auto' }).click();
    await expect(page.locator('.opsis-editor__flow')).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Rise' })).toBeVisible();

    await page.getByRole('button', { name: 'Present' }).click();
    await page.getByRole('button', { name: 'Play presentation' }).click();
    await expect(page.getByRole('button', { name: 'Replay' })).toBeVisible();

    const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(audit.violations).toEqual([]);
  });
});
