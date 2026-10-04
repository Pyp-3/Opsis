import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { signUp } from './session';

test('saves profiles, edits and removes them, checks invalid paths without a model call', async ({
  page,
}) => {
  await signUp(page, 'Model settings');
  await page.goto('/settings');
  const panel = page.getByRole('region', { name: 'Agents and models' });
  await expect(panel).toBeVisible();
  await panel.getByLabel('Agent', { exact: true }).selectOption('codex');
  await panel.getByLabel('Request character limit').fill('12000');
  await panel.getByLabel('Profile name').fill('Economical diagrams');
  await panel.getByRole('button', { name: 'Add profile', exact: true }).click();
  await page.reload();
  await expect(panel.getByText('Economical diagrams', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(panel.getByLabel('Request character limit')).toHaveValue('12000');
  await panel.getByLabel('Profile name').fill('Short diagrams');
  await panel.getByRole('button', { name: 'Save profile changes' }).click();
  await expect(panel.getByText('Short diagrams', { exact: true })).toBeVisible();
  await panel.getByLabel('Executable path').fill('/opsis-missing/cli');
  await panel.getByRole('button', { name: 'Check configuration (no model call)' }).click();
  await expect(panel.getByRole('status')).toContainText('Executable not found');
  await panel.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.reload();
  await expect(panel.getByText('Short diagrams', { exact: true })).toHaveCount(0);
});

test('pins, connects and reconnects with keyboard controls and saves branch metadata', async ({
  page,
}) => {
  await signUp(page, 'Connection editor');
  await page.goto('/');
  await page.getByRole('button', { name: 'Open example: An email’s journey' }).click();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  await page.locator('[data-id="sender"]').click();
  const details = page.getByRole('complementary', { name: /Details for/ });
  await details.getByLabel('Pin position').check();
  await details.getByLabel('Connect to').selectOption('app');
  const connection = page.getByRole('complementary', { name: 'Connection details' });
  await expect(connection).toBeVisible();
  await connection.getByLabel('To concept').selectOption('outgoing');
  await connection.getByLabel('From port').selectOption('bottom');
  await connection.getByLabel('Branch condition').fill('accepted');
  await connection.getByLabel('Connection description').fill('Continue after acceptance.');
  await connection.getByLabel('Connection type').focus();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const list = await (await fetch('/v1/boards')).json();
        const saved = (await (await fetch('/v1/boards/' + list[0].id)).json()).snapshot.board;
        return saved.edges.some(
          (edge: { description?: string }) => edge.description === 'Continue after acceptance.',
        );
      }),
    )
    .toBe(true);
  const saved = await page.evaluate(async () => {
    const list = await (await fetch('/v1/boards')).json();
    return (await (await fetch('/v1/boards/' + list[0].id)).json()).snapshot.board;
  });
  expect(saved.pinnedNodeIds).toContain('sender');
  const edge = saved.edges.find((item: { condition?: string }) => item.condition === 'accepted');
  expect(edge.target).toBe('outgoing');
  expect(edge.description).toBe('Continue after acceptance.');
  expect(saved.edgePorts[edge.id].source).toBe('bottom');
  await page.reload();
  await expect(page.locator('[data-id="sender"]')).toBeVisible();
  await page.locator('[data-id="sender"]').click();
  await expect(details.getByLabel('Pin position')).toBeChecked();
  await details.getByRole('button', { name: 'Edit connection: accepted' }).click();
  await expect(connection.getByLabel('Connection description')).toHaveValue(
    'Continue after acceptance.',
  );
});

test('shows measured zero separately from unavailable provider usage and retains request identity', async ({
  page,
}) => {
  await signUp(page, 'Usage reader');
  await page.route('**/v1/agents', (route) =>
    route.fulfill({
      json: [
        { id: 'claude', available: true, detail: 'Fake provider for QA' },
        { id: 'demo', available: true, detail: 'Demo' },
      ],
    }),
  );
  await page.route('**/v1/boards/generate', async (route) => {
    await route.fulfill({
      contentType: 'application/x-ndjson',
      body:
        [
          JSON.stringify({
            type: 'progress',
            progress: {
              type: 'usage',
              usage: {
                inputTokens: 0,
                outputTokens: 8,
                cachedInputTokens: null,
                cacheWriteTokens: null,
                estimatedCostUSD: null,
              },
            },
          }),
          JSON.stringify({
            type: 'result',
            status: 502,
            body: { message: 'Fake provider finished; no diagram supplied.' },
          }),
        ].join('\n') + '\n',
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open example: An email’s journey' }).click();
  await page.getByLabel('Agent', { exact: true }).selectOption('claude');
  await page
    .getByRole('textbox', { name: 'What would you like to understand?' })
    .fill('Explain the decision branch');
  await page.getByRole('button', { name: 'Generate diagram' }).click();
  await expect(page.getByText('Fake provider finished; no diagram supplied.')).toBeVisible();
  await page.goto('/settings');
  await expect(page.getByText(/Attempt 1: input 0 · output 8/)).toBeVisible();
  await expect(page.getByText(/CLI-estimated USD unavailable/)).toBeVisible();
});

test('selectively accepts a proposed concept change while keeping rejected changes and layout', async ({
  page,
}) => {
  await signUp(page, 'Selective review');
  await page.route('**/v1/agents', (route) =>
    route.fulfill({
      json: [
        { id: 'claude', available: true, detail: 'Fake provider for QA' },
        { id: 'demo', available: true, detail: 'Demo' },
      ],
    }),
  );
  await page.route('**/v1/boards/generate', async (route) => {
    const before = route.request().postDataJSON().board;
    await route.fulfill({
      status: 409,
      json: {
        candidate: {
          title: 'Unwanted title',
          description: before.description,
          nodes: before.nodes.map((node: { id: string; label: string }) =>
            ['sender', 'app'].includes(node.id)
              ? { ...node, label: node.label + ' revised' }
              : node,
          ),
          edges: before.edges,
        },
        changes: ['Updated concepts'],
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open example: An email’s journey' }).click();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  const before = await page.evaluate(async () => {
    const list = await (await fetch('/v1/boards')).json();
    return await (await fetch('/v1/boards/' + list[0].id)).json();
  });
  await page.getByLabel('Agent', { exact: true }).selectOption('claude');
  await page.getByLabel('What would you like to understand?').fill('Update these concepts');
  await page.getByRole('button', { name: 'Generate diagram' }).click();
  const review = page.getByRole('region', { name: 'Review proposed changes' });
  await expect(review).toBeVisible();
  await review.getByRole('button', { name: 'Clear selection' }).click();
  await expect(review.getByRole('button', { name: 'Apply reviewed changes' })).toBeDisabled();
  await review.getByLabel('Update concept: You write revised').check();
  await review.getByRole('button', { name: 'Apply reviewed changes' }).click();
  await expect(review).toHaveCount(0);
  await expect(page.locator('.save-status')).toHaveText('Saved');
  await expect
    .poll(async () =>
      page.evaluate(async (id) => {
        const saved = (await (await fetch('/v1/boards/' + id)).json()).snapshot.board;
        return saved.nodes.find((node: { id: string }) => node.id === 'sender').label;
      }, before.id),
    )
    .toBe('You write revised');
  const after = await page.evaluate(
    async (id) => await (await fetch('/v1/boards/' + id)).json(),
    before.id,
  );
  expect(after.snapshot.board.title).toBe(before.snapshot.board.title);
  expect(after.snapshot.board.agent).toBe('claude');
  expect(after.snapshot.board.positions).toEqual(before.snapshot.board.positions);
  expect(
    after.snapshot.board.nodes.find((node: { id: string }) => node.id === 'sender').label,
  ).toBe('You write revised');
  expect(after.snapshot.board.nodes.find((node: { id: string }) => node.id === 'app')).toEqual(
    before.snapshot.board.nodes.find((node: { id: string }) => node.id === 'app'),
  );
  expect(after.snapshot.past.at(-1)).toEqual(before.snapshot.board);
});

test('model suggestions require consent and settings fit a narrow screen', async ({ page }) => {
  await signUp(page, 'Suggestion reader');
  await page.goto('/');
  await page.getByRole('button', { name: 'Open example: An email’s journey' }).click();
  await page.getByLabel('Agent', { exact: true }).selectOption('claude');
  await page.getByRole('button', { name: /^Model settings:/ }).click();
  await page.getByLabel('Show task-based suggestions').check();
  await page.getByLabel('Task', { exact: true }).selectOption('branches');
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('haiku');
  await page.getByRole('button', { name: 'Apply suggested model and effort' }).click();
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('sonnet');
  await expect(page.getByLabel('Reasoning effort')).toHaveValue('medium');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/settings');
  await expect(page.getByRole('region', { name: 'Agents and models' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show sidebar' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(scan.violations).toEqual([]);
  await page.screenshot({ path: '/tmp/opsis-p1-settings-mobile.png', fullPage: true });
});
