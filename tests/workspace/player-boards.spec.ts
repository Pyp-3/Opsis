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
  // The natural voice model must never download in tests; without it the player falls back.
  await page.context().route(/huggingface\.co|cdn\.jsdelivr\.net/, (route) => route.abort());
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
  await page.getByRole('button', { name: 'Open example: DNS lookups' }).click();
  await saved(page);
  await page.getByRole('button', { name: 'Play the process' }).click();
  const timeline = page.getByRole('slider', { name: 'Process timeline' });
  await expect(timeline).toHaveAttribute('aria-valuetext', /^Step 1 of 10:/);
  // Video mode: the heading gives way to the diagram and the composer to the player.
  await expect(page.locator('.canvas-heading')).toHaveCSS('opacity', '0');
  await expect(page.getByLabel('What would you like to understand?')).toHaveCount(0);
  await page.getByRole('button', { name: 'Narrator' }).click();
  const voice = page.getByRole('combobox', { name: 'Voice' });
  await voice.selectOption('system:Google UK English Female');
  await expect(voice).toHaveValue('system:Google UK English Female');
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
  // The narrator reads the board's own spoken lines, arrow by arrow in message order.
  const arrows = DNS_DEMO.edges.map((edge) => edge.narration!);
  const told = arrows.map((line) => spoken.findIndex((u) => u.text.startsWith(line)));
  expect(told.every((at) => at > 0)).toBe(true);
  expect(told).toEqual([...told].sort((a, b) => a - b));
  expect(spoken[0]!.text).toBe(DNS_DEMO.narration);
  // Everything has been reached, so nothing stays dimmed at the end.
  await expect(page.locator('.react-flow__node.is-dimmed')).toHaveCount(0);
  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(scan.violations).toEqual([]);
});

/** A tenth of a second of silence: a real WAV the browser can play to its end. */
function silentWav() {
  const rate = 8000,
    samples = rate / 10,
    wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + samples * 2, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  return wav;
}

test('narrates with the natural voice from the Opsis API, sentence by sentence', async ({
  page,
}) => {
  const lines: { text: string; voice: string }[] = [];
  await page.route('**/v1/speech/warm', (route) => route.fulfill({ json: { state: 'ready' } }));
  await page.route('**/v1/speech', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { state: 'ready' } });
    lines.push(route.request().postDataJSON());
    return route.fulfill({ body: silentWav(), contentType: 'audio/wav' });
  });
  await page.getByRole('button', { name: 'Open example: An email’s journey' }).click();
  await page.getByRole('button', { name: 'Play the process' }).click();
  await page.getByRole('button', { name: 'Narrator' }).click();
  await expect(page.getByRole('combobox', { name: 'Voice' })).toHaveValue('natural:bf_emma');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Replay' })).toBeVisible({ timeout: 20_000 });
  expect(lines.every((line) => line.voice === 'bf_emma')).toBe(true);
  // Every sentence of the walkthrough was spoken, and no line is sent as more than one sentence.
  expect(lines.length).toBeGreaterThan(EMAIL_DEMO.nodes.length);
  for (const line of lines) expect(line.text.trim()).not.toMatch(/[.!?]\s+\S/);
  // The browser's own speech was never used.
  expect(
    await page.evaluate(() => (window as unknown as { __spoken: unknown[] }).__spoken),
  ).toEqual([]);
});

test('falls back to a device voice when the natural voice cannot load', async ({ page }) => {
  await page.route('**/v1/speech', (route) => route.fulfill({ json: { state: 'off' } }));
  await page.getByRole('button', { name: 'Open example: An email’s journey' }).click();
  await page.getByRole('button', { name: 'Play the process' }).click();
  await page.getByRole('button', { name: 'Narrator' }).click();
  await expect(page.locator('.player-voice [role=status]')).toContainText(
    'device voice is reading instead',
    { timeout: 20_000 },
  );
  await expect(page.getByRole('combobox', { name: 'Voice' })).toHaveValue(
    'system:Google UK English Female',
  );
});

test('scrubs the timeline with the keyboard and dims what has not happened yet', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Open example: An email’s journey' }).click();
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
  // Captions show what the narrator says: the arrow's line, then the object's.
  await expect(page.locator('.player-caption')).toContainText(EMAIL_DEMO.nodes[1]!.narration!);
  await page.getByRole('button', { name: 'Close player' }).click();
  await expect(page.getByLabel('What would you like to understand?')).toBeVisible();
});

test('arrows keep their chosen colour through reload and never vanish while dragging', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Open example: DNS lookups' }).click();
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
  await page.getByRole('button', { name: 'Open example: An email’s journey' }).click();
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

test('a new canvas offers questions, and examples live in the sidebar', async ({ page }) => {
  await expect(page.getByText('Start with a question')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Examples' }).getByRole('button')).toHaveCount(
    2,
  );
  await page.getByRole('button', { name: 'How does the water cycle work?' }).click();
  await expect(page.getByLabel('What would you like to understand?')).toHaveValue(
    'How does the water cycle work?',
  );
  await expect(page.getByLabel('What would you like to understand?')).toBeFocused();
  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(scan.violations).toEqual([]);
});
