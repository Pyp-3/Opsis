import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { EMAIL_DEMO } from '../../packages/schema/src/board';
import { DNS_DEMO } from '../../packages/schema/src/dns-demo';

const snapshot = (page: Page) =>
  page.evaluate(() => JSON.parse(sessionStorage.getItem('opsis:library-recovery:v1')!).snapshot);
const saved = (page: Page) =>
  expect(page.getByText('Saved to SQLite', { exact: true })).toBeVisible();

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
  // Browsers in CI have no voices, so a recording speech engine stands in. It fires the
  // same start/end events a real engine does, letting the player's pacing be verified.
  await page.addInitScript(() => {
    const voices = [
      { name: 'Google US English', lang: 'en-US', localService: false, default: true },
      { name: 'Google UK English Female', lang: 'en-GB', localService: false, default: false },
      { name: 'Google UK English Male', lang: 'en-GB', localService: false, default: false },
    ];
    const w = window as unknown as { __spoken: unknown[] };
    w.__spoken = [];
    let current: { text: string; onstart?: () => void; onend?: () => void } | null = null;
    const synth = Object.assign(new EventTarget(), {
      getVoices: () => voices,
      speak(u: {
        text: string;
        lang: string;
        rate: number;
        voice: { name: string; lang: string } | null;
        onstart?: () => void;
        onend?: () => void;
      }) {
        current = u;
        w.__spoken.push({ text: u.text, lang: u.lang, voice: u.voice, rate: u.rate });
        setTimeout(() => current === u && u.onstart?.(), 20);
        setTimeout(() => {
          if (current !== u) return;
          current = null;
          u.onend?.();
        }, 150);
      },
      cancel() {
        const u = current as { onerror?: (e: { error: string }) => void } | null;
        current = null;
        u?.onerror?.({ error: 'interrupted' });
      },
    });
    Object.defineProperty(window, 'speechSynthesis', { value: synth });
    (window as unknown as Record<string, unknown>).SpeechSynthesisUtterance = class {
      lang = '';
      voice = null;
      rate = 1;
      constructor(public text: string) {}
    };
  });
  await page.goto('/');
});

test('plays the DNS process with a British narrator, in message order, to the end', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Explore the DNS example' }).click();
  await saved(page);
  await page.getByRole('button', { name: 'Play the process' }).click();
  const timeline = page.getByRole('slider', { name: 'Process timeline' });
  await expect(timeline).toHaveAttribute('aria-valuetext', /^Step 1 of 10:/);
  // Video mode: the heading gives way to the diagram and the composer to the player.
  await expect(page.locator('.canvas-heading')).toHaveCSS('opacity', '0');
  await expect(page.getByLabel('What would you like to understand?')).toHaveCount(0);
  await page.getByRole('button', { name: 'Narrator' }).click();
  await expect(page.getByRole('combobox', { name: 'Voice' })).toHaveValue(
    'Google UK English Female',
  );
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Replay' })).toBeVisible({ timeout: 20_000 });
  await expect(timeline).toHaveAttribute('aria-valuetext', /^Step 10 of 10: 8\. Return/);
  const spoken = (await page.evaluate(
    () => (window as unknown as { __spoken: unknown[] }).__spoken,
  )) as { text: string; lang: string; voice: { lang: string } | null }[];
  expect(spoken).toHaveLength(10);
  for (const utterance of spoken) {
    expect(utterance.lang).toBe('en-GB');
    expect(utterance.voice?.lang).toBe('en-GB');
  }
  const steps = spoken
    .map((u) => /^Step (\d+):/.exec(u.text)?.[1])
    .filter(Boolean)
    .map(Number);
  expect(steps).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  // Everything has been reached, so nothing stays dimmed at the end.
  await expect(page.locator('.react-flow__node.is-dimmed')).toHaveCount(0);
  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(scan.violations).toEqual([]);
});

test('scrubs the timeline with the keyboard and dims what has not happened yet', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Explore the email example' }).click();
  await page.getByRole('button', { name: 'Play the process' }).click();
  const timeline = page.getByRole('slider', { name: 'Process timeline' });
  await timeline.focus();
  await page.keyboard.press('End');
  await expect(timeline).toHaveAttribute('aria-valuetext', /^Step 6 of 6/);
  await expect(page.locator('.react-flow__node.is-dimmed')).toHaveCount(0);
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(timeline).toHaveAttribute('aria-valuetext', /^Step 3 of 6/);
  await expect(page.locator('.react-flow__node.is-dimmed')).toHaveCount(
    EMAIL_DEMO.nodes.length - 2,
  );
  await expect(page.locator('.react-flow__edge.is-current')).toHaveCount(1);
  await expect(page.locator('.player-caption')).toContainText(EMAIL_DEMO.nodes[1]!.summary);
  await page.getByRole('button', { name: 'Close player' }).click();
  await expect(page.getByLabel('What would you like to understand?')).toBeVisible();
});

test('arrows keep their chosen colour through reload and never vanish while dragging', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Explore the DNS example' }).click();
  await saved(page);
  const edge = DNS_DEMO.edges[0]!;
  await page.locator(`[data-id="${edge.id}"] .connection-label rect`).click();
  await page.getByRole('button', { name: 'mint arrow' }).click();
  await expect(page.getByRole('button', { name: 'mint arrow' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Close details' }).click();
  await expect(page.locator(`[data-id="${edge.id}"] .react-flow__edge-path`)).toHaveCSS(
    'stroke',
    'rgb(143, 227, 180)',
  );
  await saved(page);
  expect((await snapshot(page)).board.edges[0].color).toBe('mint');
  await page.reload();
  await expect(page.locator(`[data-id="${edge.id}"] .react-flow__edge-path`)).toHaveCSS(
    'stroke',
    'rgb(143, 227, 180)',
  );
  // Regression: edges used to unmount for a frame on every drag update.
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await page.waitForTimeout(400);
  const box = (await page
    .locator('.react-flow__node')
    .first()
    .locator('.node-symbol')
    .boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 15; i++) {
    await page.mouse.move(box.x + box.width / 2 + i * 12, box.y + box.height / 2 + i * 5);
    expect(await page.locator('.react-flow__edge .react-flow__edge-path').count()).toBe(
      DNS_DEMO.edges.length,
    );
  }
  await page.mouse.up();
});

test('the icon library searches by meaning and filters by category', async ({ page }) => {
  await page.getByRole('button', { name: 'Explore the email example' }).click();
  await saved(page);
  await page
    .getByRole('navigation', { name: 'Diagram steps' })
    .getByRole('button', { name: EMAIL_DEMO.nodes[0]!.label })
    .click();
  await page.getByText('Edit this concept').click();
  await page.getByRole('button', { name: 'Change icon' }).click();
  await page.getByLabel('Search icons').fill('weather');
  await expect(page.getByRole('button', { name: 'Use rain icon' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use email icon' })).toHaveCount(0);
  await page.getByLabel('Search icons').fill('');
  await page
    .getByRole('group', { name: 'Icon categories' })
    .getByRole('button', { name: 'Health' })
    .click();
  await expect(page.getByRole('button', { name: 'Use brain icon' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use server icon' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Use brain icon' }).click();
  await saved(page);
  expect((await snapshot(page)).board.nodes[0].icon).toBe('brain');
});

test('the boards page is a real page with history, search and an accessible layout', async ({
  page,
}) => {
  const stamp = Date.now();
  await page.getByRole('link', { name: 'Manage boards' }).click();
  for (const name of [`Alpha ${stamp}`, `Beta ${stamp}`]) {
    await page.getByLabel('New board name').fill(name);
    await page.getByRole('button', { name: 'Create board', exact: true }).click();
    await expect(page.getByLabel('Board name')).toHaveValue(name);
    await page.getByRole('link', { name: 'Manage boards' }).click();
  }
  await expect(page).toHaveURL(/\/boards$/);
  await page.getByLabel('Search boards').fill(`Alpha ${stamp}`);
  await expect(page.locator('.board-cards li')).toHaveCount(1);
  await page.getByRole('button', { name: new RegExp(`^Alpha ${stamp}`) }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByLabel('Board name')).toHaveValue(`Alpha ${stamp}`);
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Your boards', level: 1 })).toBeVisible();
  await page.goForward();
  await expect(page.getByLabel('Board name')).toHaveValue(`Alpha ${stamp}`);
  // Loading /boards directly works too.
  await page.goto('/boards');
  await expect(page.getByRole('heading', { name: 'Your boards', level: 1 })).toBeVisible();
  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(scan.violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('the introduction offers examples and sample questions', async ({ page }) => {
  await expect(page.getByText('Understand anything by seeing it.')).toBeVisible();
  await page.getByRole('button', { name: 'How does the water cycle work?' }).click();
  await expect(page.getByLabel('What would you like to understand?')).toHaveValue(
    'How does the water cycle work?',
  );
  await expect(page.getByLabel('What would you like to understand?')).toBeFocused();
  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(scan.violations).toEqual([]);
});
