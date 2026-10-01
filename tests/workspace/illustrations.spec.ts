import { test, expect } from '@playwright/test';

const SHOTS = process.env.OPSIS_SHOTS;

test.beforeEach(async ({ page }) => {
  await page.route('**/v1/agents', (route) =>
    route.fulfill({
      json: [
        { id: 'claude', available: true, detail: 'Fixture' },
        { id: 'codex', available: true, detail: 'Fixture' },
        { id: 'demo', available: true, detail: 'Fixture' },
      ],
    }),
  );
  await page.context().route(/huggingface\.co|cdn\.jsdelivr\.net/, (route) => route.abort());
});

test('icons come alive in playback and evolve into agent illustrations', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open example: An email’s journey' }).click();
  await page.getByRole('button', { name: 'Play the process' }).click();
  const player = page.getByRole('region', { name: 'Process player' });
  await player.getByRole('button', { name: 'Next step' }).click();

  // Before any drawing exists, the current icon moves the way its subject does.
  const current = page.locator('.react-flow__node.is-current .node-symbol');
  await expect(current).toHaveAttribute('data-motion', 'draw');
  await expect(current.locator('.illustration')).toHaveCount(0);

  await player.getByRole('button', { name: 'Illustrate' }).click();
  await expect(player.getByRole('status')).toHaveText('Drew 5 illustrations.');
  await expect(player.getByRole('button', { name: 'Redraw' })).toBeVisible();

  // The current icon has evolved into an animated drawing; the icon itself fades away.
  await expect(current).toHaveClass(/is-evolved/);
  await expect(current).not.toHaveAttribute('data-motion');
  await expect(current.locator('.illustration animate').first()).toBeAttached();
  if (SHOTS) {
    await page.waitForTimeout(400);
    await current.screenshot({ path: `${SHOTS}/sender-early.png` });
    await page.waitForTimeout(1600);
    await current.screenshot({ path: `${SHOTS}/sender-late.png` });
  }

  // Moving on, the passed object keeps its drawing at rest and the next one animates.
  await player.getByRole('button', { name: 'Next step' }).click();
  const passed = page.locator('.react-flow__node[data-id="sender"] .illustration');
  await expect(passed).toBeAttached();
  await expect(passed.locator('animate, animateTransform')).toHaveCount(0);
  await expect(
    page.locator('.react-flow__node.is-current[data-id="app"] .illustration animate').first(),
  ).toBeAttached();
  if (SHOTS) {
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${SHOTS}/board.png` });
  }

  // Drawings are saved with the board and undoable; closing the player restores icons.
  await player.getByRole('button', { name: 'Close player' }).click();
  await expect(page.locator('.illustration')).toHaveCount(0);
  const saved = await page.evaluate(
    () =>
      JSON.parse(sessionStorage.getItem('opsis:library-recovery:v1')!).snapshot.board.nodes as {
        illustration?: unknown;
      }[],
  );
  expect(saved.every((node) => node.illustration)).toBe(true);
});

test('reduced motion shows drawings at rest', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open example: An email’s journey' }).click();
  await page.getByRole('button', { name: 'Play the process' }).click();
  const player = page.getByRole('region', { name: 'Process player' });
  await player.getByRole('button', { name: 'Illustrate' }).click();
  await expect(player.getByRole('status')).toHaveText('Drew 5 illustrations.');
  await player.getByRole('button', { name: 'Next step' }).click();
  const drawing = page.locator('.react-flow__node.is-current .illustration');
  await expect(drawing).toBeAttached();
  await expect(drawing.locator('animate, animateTransform, animateMotion')).toHaveCount(0);
});
