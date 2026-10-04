import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { signUp } from './session';
import { EMAIL_DEMO } from '../../packages/schema/src/board';

async function savedBoard(page: Page) {
  return page.evaluate(async () => {
    const list = await (await fetch('/v1/boards')).json();
    return list.length ? await (await fetch('/v1/boards/' + list[0].id)).json() : null;
  });
}
async function example(page: Page) {
  await signUp(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open example: An email’s journey' }).click();
  await expect(page.locator('.save-status')).toHaveText('Saved');
}

test('nested groups, sources and notes survive reload and collapse without deleting concepts', async ({
  page,
}) => {
  await example(page);
  await page.locator('[data-id="sender"]').click();
  const details = page.getByRole('complementary', { name: /Details for/ });
  await details.getByLabel('Personal notes').fill('Keep the original source.');
  await details.getByLabel('Source title').fill('Reference document');
  await details.getByLabel('Source URL (optional)').fill('https://example.com/reference');
  await details.getByRole('button', { name: 'Add source', exact: true }).click();
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.locator('.board-groups summary').click();
  const groups = page.locator('.board-groups');
  await groups.getByLabel('New group name').fill('Delivery');
  await groups.getByRole('button', { name: 'Add group', exact: true }).click();
  await groups.getByLabel('You write', { exact: true }).check();
  await groups.getByLabel('Show group boundary').check();
  const outer = await groups.getByLabel('Choose group').inputValue();
  await groups.getByLabel('New group name').fill('Mail servers');
  await groups.getByRole('button', { name: 'Add group', exact: true }).click();
  await groups.getByLabel('Parent group').selectOption(outer);
  await groups.getByLabel('Sending server', { exact: true }).check();
  await groups.getByLabel('Choose group').selectOption(outer);
  await groups.getByLabel('Collapse subgraph').check();
  await expect
    .poll(
      async () =>
        (await savedBoard(page))?.snapshot.board.groups?.find(
          (group: { id: string }) => group.id === outer,
        )?.collapsed,
    )
    .toBe(true);
  const before = await savedBoard(page);
  expect(before.snapshot.board.nodes).toHaveLength(EMAIL_DEMO.nodes.length);
  expect(before.snapshot.board.nodes[0].notes).toBe('Keep the original source.');
  await page.reload();
  await expect(page.locator('[data-id="outgoing"]')).toHaveCount(0);
  await expect(page.locator('[data-id="sender"]')).toContainText('Delivery (2)');
  await page.locator('.board-groups summary').click();
  await groups.getByLabel('Choose group').selectOption(outer);
  await groups.getByLabel('Collapse subgraph').uncheck();
  await expect(page.locator('[data-id="outgoing"]')).toHaveCount(1);
  // Header menus drop over the canvas; close it before reading a concept.
  await page.keyboard.press('Escape');
  await page.locator('[data-id="sender"]').click();
  await expect(details.getByLabel('Personal notes')).toHaveValue('Keep the original source.');
  await expect(details.getByRole('link', { name: 'Reference document' })).toHaveAttribute(
    'href',
    'https://example.com/reference',
  );
});

test('reviews text and legacy imports before creating private boards and compares saved versions', async ({
  page,
}) => {
  await example(page);
  const original = await savedBoard(page);
  await page.locator('input[type="file"]').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('First documented step.\n\nSecond documented step.'),
  });
  await expect(page.getByRole('region', { name: 'Import review' })).toBeVisible();
  expect((await savedBoard(page)).id).toBe(original.id);
  await page.getByRole('button', { name: 'Discard import' }).click();
  expect((await savedBoard(page)).id).toBe(original.id);
  await page.locator('input[type="file"]').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('First documented step.\n\nSecond documented step.'),
  });
  await page.getByRole('button', { name: 'Import as new board' }).click();
  await expect.poll(async () => (await savedBoard(page))?.snapshot.board.title).toBe('notes.txt');
  const imported = await savedBoard(page);
  expect(imported.snapshot.board.nodes[1].references[0].excerpt).toBe('Second documented step.');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'sun.json',
    mimeType: 'application/json',
    buffer: await readFile('fixtures/osg/sun-east.osg.json'),
  });
  await expect(page.getByRole('region', { name: 'Import review' })).toContainText('legacy OSG');
  await page.getByRole('button', { name: 'Import as new board' }).click();
  await expect
    .poll(async () => (await savedBoard(page))?.snapshot.board.title)
    .toBe('The Sun Rises in the East');
  await page.goto('/boards');
  await page.locator('.board-comparison summary').click();
  await page.getByLabel('Before board', { exact: true }).selectOption(original.id);
  await page.getByLabel('After board', { exact: true }).selectOption(imported.id);
  await page.getByRole('button', { name: 'Compare saved content' }).click();
  await expect(page.getByRole('region', { name: 'Comparison results' })).toContainText(
    'Concept sender',
  );
  await page.getByLabel('After board', { exact: true }).selectOption(original.id);
  await page.getByRole('button', { name: 'Compare saved content' }).click();
  await expect(page.getByRole('region', { name: 'Comparison results' })).toContainText(
    '0 differences',
  );
});

test('owner invites an editor, sees edits sync and revokes access without exposing private history', async ({
  page,
  browser,
}) => {
  await example(page);
  const original = await savedBoard(page);
  const editorContext = await browser.newContext({
    baseURL: page.url().split('/').slice(0, 3).join('/'),
  });
  const editor = await editorContext.newPage();
  try {
    const account = await signUp(editor, 'Invited editor');
    await page.locator('.board-sharing summary').click();
    await page.getByLabel('Editor email').fill(account.email);
    await page.getByRole('button', { name: 'Grant editing' }).click();
    await expect(
      page.getByRole('button', { name: 'Revoke editing for Invited editor' }),
    ).toBeVisible();
    await editor.goto('/boards');
    await editor.getByRole('region', { name: 'Shared with you' }).getByRole('button').click();
    await expect(editor.locator('[data-id="sender"]')).toBeVisible();
    await editor.locator('[data-id="sender"]').click();
    await editor.getByLabel('Personal notes').fill('Editor note');
    await editor.getByLabel('Source title').focus();
    await expect
      .poll(async () => (await savedBoard(page)).snapshot.board.nodes[0].notes)
      .toBe('Editor note');
    // Header menus drop over the canvas; close sharing before reading a concept.
    await page.keyboard.press('Escape');
    await page.locator('[data-id="sender"]').click();
    await expect(page.getByLabel('Personal notes')).toHaveValue('Editor note');
    expect((await editor.request.get(`/v1/boards/${original.id}/revisions`)).status()).toBe(404);
    await page.locator('.board-sharing summary').click();
    await page.getByRole('button', { name: 'Revoke editing for Invited editor' }).click();
    await expect
      .poll(async () => (await editor.request.get(`/v1/boards/${original.id}`)).status())
      .toBe(404);
    await expect(editor.locator('[data-id="sender"]')).toHaveCount(0);
  } finally {
    await editorContext.close();
  }
});

test('network loss retains unsaved work and retry saves it', async ({ page }) => {
  await example(page);
  let offline = true;
  await page.route('**/v1/boards/*', (route) =>
    route.request().method() === 'PUT' && offline ? route.abort('failed') : route.continue(),
  );
  await page.locator('[data-id="sender"]').click();
  await page.getByLabel('Personal notes').fill('Saved after reconnect');
  await page.getByLabel('Source title').focus();
  await expect(page.locator('.save-status')).toContainText('Could not save');
  offline = false;
  await page.getByRole('button', { name: 'Retry save', exact: true }).click();
  await expect
    .poll(async () => (await savedBoard(page))?.snapshot.board.nodes[0].notes)
    .toBe('Saved after reconnect');
  await page.reload();
  await page.locator('[data-id="sender"]').click();
  await expect(page.getByLabel('Personal notes')).toHaveValue('Saved after reconnect');
});

test('validated streamed concepts appear before completion and cancellation retains the saved board', async ({
  page,
}) => {
  await example(page);
  const original = await savedBoard(page);
  await page.route('**/v1/agents', (route) =>
    route.fulfill({
      json: [
        { id: 'claude', available: true, detail: 'Fake CLI' },
        { id: 'demo', available: true, detail: 'Demo' },
      ],
    }),
  );
  await page.addInitScript(
    (node) => {
      const originalFetch = window.fetch;
      window.fetch = async (input, init) => {
        if (String(input) === '/v1/boards/generate') {
          const encoder = new TextEncoder();
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(
                  encoder.encode(
                    JSON.stringify({ type: 'progress', progress: { type: 'node', node } }) + '\n',
                  ),
                );
                setTimeout(() => {
                  controller.enqueue(
                    encoder.encode(
                      JSON.stringify({
                        type: 'result',
                        status: 502,
                        body: { message: 'Fixture incomplete output' },
                      }) + '\n',
                    ),
                  );
                  controller.close();
                }, 2500);
              },
            }),
            { headers: { 'content-type': 'application/x-ndjson' } },
          );
        }
        return originalFetch(input, init);
      };
    },
    { ...EMAIL_DEMO.nodes[0]!, label: 'Arriving draft concept' },
  );
  await page.reload();
  await page.getByLabel('Agent', { exact: true }).selectOption('claude');
  await page.getByLabel('What would you like to understand?').fill('Show a draft');
  await page.getByRole('button', { name: 'Generate diagram' }).click();
  await expect(page.getByRole('region', { name: 'Draft concepts' })).toContainText(
    'Arriving draft concept',
  );
  expect((await savedBoard(page)).snapshot.board).toEqual(original.snapshot.board);
  await page.getByRole('button', { name: 'Cancel generation' }).click();
  await expect(page.getByRole('region', { name: 'Draft concepts' })).toHaveCount(0);
  await page.waitForTimeout(2700);
  expect((await savedBoard(page)).snapshot.board).toEqual(original.snapshot.board);
});

test('imports a reviewed legacy batch as independent private boards', async ({ page }) => {
  await example(page);
  const original = await savedBoard(page);
  const bundle = {
    format: 'opsis-legacy-bundle/v1',
    boards: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        sourceId: 'old-one',
        board: { ...original.snapshot.board, title: 'Legacy batch copy' },
      },
    ],
    rejected: [{ sourceId: 'bad-record', reason: 'Unsupported record; source retained.' }],
  };
  await page.locator('input[type="file"]').setInputFiles({
    name: 'bundle.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(bundle)),
  });
  await expect(page.getByRole('region', { name: 'Bulk legacy import review' })).toContainText(
    '1 source records rejected',
  );
  await page.getByRole('button', { name: 'Import remaining boards' }).click();
  await expect(page.getByRole('region', { name: 'Bulk legacy import review' })).toContainText(
    '1 imported',
  );
  expect((await savedBoard(page)).visibility).toBe('private');
  expect((await page.request.get(`/v1/boards/${original.id}`)).status()).toBe(200);
  // Selecting another file while the completed review is open starts a fresh queue.
  bundle.boards[0]!.board.title = 'Second legacy batch';
  await page.locator('input[type="file"]').setInputFiles({
    name: 'second-bundle.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(bundle)),
  });
  await expect(page.getByRole('region', { name: 'Bulk legacy import review' })).toContainText(
    '0 imported',
  );
  await page.getByRole('button', { name: 'Import remaining boards' }).click();
  await expect
    .poll(async () => (await savedBoard(page)).snapshot.board.title)
    .toBe('Second legacy batch');
});

test('branching canvas has a stable visual baseline', async ({ page }) => {
  await signUp(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  // Use the same installed font as Linux CI; do not make the baseline depend on Google Fonts.
  await page.addStyleTag({
    content: '.blueprint, .blueprint * { font-family: Arial, sans-serif !important; }',
  });
  await page.getByRole('button', { name: 'Open example: A request and approval process' }).click();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  await page.getByRole('button', { name: 'Hide the big picture' }).click();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await page.waitForTimeout(400);
  const last = await page.locator('[data-id="closed"]').boundingBox();
  const composer = await page.locator('.composer-wrap').boundingBox();
  expect(last!.y + last!.height).toBeLessThan(composer!.y);
  await expect(page.locator('.blueprint')).toHaveScreenshot('approval-canvas.png', {
    animations: 'disabled',
  });
});

test('handles a maximum-sized board and keeps malformed generation from changing it', async ({
  page,
}) => {
  await signUp(page);
  const board = {
    version: 2,
    agent: 'demo',
    title: 'Fifty concepts',
    description: 'Bounded stress fixture',
    nodes: Array.from({ length: 50 }, (_, i) => ({
      ...EMAIL_DEMO.nodes[0]!,
      id: `n${i}`,
      label: `Concept ${i}`,
    })),
    edges: Array.from({ length: 100 }, (_, i) => ({
      id: `e${i}`,
      source: `n${i % 50}`,
      target: `n${(i + 7) % 50}`,
      label: `Path ${i}`,
    })),
    positions: Object.fromEntries(
      Array.from({ length: 50 }, (_, i) => [
        `n${i}`,
        { x: (i % 5) * 220, y: Math.floor(i / 5) * 240 },
      ]),
    ),
  };
  const id = crypto.randomUUID();
  expect(
    (
      await page.request.put(`/v1/boards/${id}`, {
        data: { revision: 0, snapshot: { board, past: [], future: [] } },
      })
    ).status(),
  ).toBe(200);
  await page.route('**/v1/agents', (route) =>
    route.fulfill({ json: [{ id: 'claude', available: true, detail: 'Fake CLI' }] }),
  );
  await page.goto(`/canvas?board=${id}`);
  await expect(page.locator('.react-flow__node')).toHaveCount(50);
  await expect(page.locator('.react-flow__edge')).toHaveCount(100);
  await page.getByLabel('Agent', { exact: true }).selectOption('claude');
  await page.route('**/v1/boards/generate', (route) =>
    route.fulfill({ json: { title: 'Invalid output', nodes: [{ id: 'broken' }] } }),
  );
  await page.getByLabel('What would you like to understand?').fill('Test malformed completion');
  await page.getByRole('button', { name: 'Generate diagram' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect((await (await page.request.get(`/v1/boards/${id}`)).json()).snapshot.board).toEqual(board);
});
