import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { signUp } from './session';

test('collection sharing is atomic and bundles import as private linked copies', async ({
  page,
  browser,
}) => {
  await signUp(page, 'Collection owner');
  const collection = await (
    await page.request.post('/v1/collections', { data: { name: 'Linked lessons' } })
  ).json();
  const target = await (
    await page.request.post('/v1/boards', {
      data: { title: 'Destination', collectionId: collection.id },
    })
  ).json();
  await page.goto('/');
  await page.getByRole('button', { name: 'Open example: An email’s journey' }).click();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  const list = await (await page.request.get('/v1/boards')).json();
  const source = list.find((entry: { id: string }) => entry.id !== target.id);
  await page.request.put(`/v1/boards/${source.id}/collection`, {
    data: { collectionId: collection.id },
  });
  await page.locator('.react-flow__node').first().click();
  await page.getByLabel('Linked board', { exact: true }).selectOption(target.id);
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/v1/boards/${target.id}/backlinks`)).json()).length,
    )
    .toBe(1);
  await page.goto('/boards');
  await page.getByRole('button', { name: 'Linked lessons 2', exact: true }).click();
  await page.getByText('Share or export Linked lessons', { exact: true }).click();
  await page.getByRole('button', { name: 'Make all public', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Updated sharing for 2 boards.' }),
  ).toBeVisible();
  const publicEntries = await (await page.request.get('/v1/boards')).json();
  expect(
    publicEntries.every((entry: { visibility: string }) => entry.visibility === 'public'),
  ).toBeTruthy();
  const outdated = await page.request.put(`/v1/collections/${collection.id}/sharing`, {
    data: {
      boards: list.map(({ id, revision }: { id: string; revision: number }) => ({ id, revision })),
      change: { kind: 'visibility', visibility: 'private' },
    },
  });
  expect(outdated.status()).toBe(409);
  expect(
    (await (await page.request.get('/v1/boards')).json()).every(
      (entry: { visibility: string }) => entry.visibility === 'public',
    ),
  ).toBeTruthy();
  const context = await browser.newContext();
  try {
    const other = await context.newPage();
    const editor = await signUp(other, 'Collection editor');
    expect((await other.request.get(`/v1/collections/${collection.id}/bundle`)).status()).toBe(404);
    await page.getByLabel('Editor email').fill(editor.email);
    await page.getByRole('button', { name: 'Invite editor to all boards' }).click();
    await expect
      .poll(async () => (await (await other.request.get(`/v1/boards/${target.id}`)).json()).access)
      .toBe('editor');
    await page.getByRole('button', { name: 'Remove editor from all boards' }).click();
    await expect
      .poll(async () => (await (await other.request.get(`/v1/boards/${target.id}`)).json()).access)
      .toBe('viewer');
  } finally {
    await context.close();
  }
  const bundle = await (await page.request.get(`/v1/collections/${collection.id}/bundle`)).json();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export read-only HTML' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('opsis-collection.html');
  await page.addInitScript(() => {
    window.print = () => window.frameElement?.setAttribute('data-print-requested', 'true');
  });
  await page.getByRole('button', { name: 'Print walkthrough / Save PDF' }).click();
  await expect(page.locator('iframe[title="Printable collection walkthrough"]')).toHaveAttribute(
    'data-print-requested',
    'true',
  );
  await page.getByLabel('Collection bundle file').setInputFiles({
    name: 'lessons.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(bundle)),
  });
  await expect(
    page.getByText('Imported as new private boards in a new collection.', { exact: true }),
  ).toBeVisible();
  const imported = (await (await page.request.get('/v1/boards')).json()).filter(
    (entry: { id: string }) => entry.id !== source.id && entry.id !== target.id,
  );
  expect(imported).toHaveLength(2);
  expect(
    imported.every(
      (entry: { visibility: string; collectionId: string }) =>
        entry.visibility === 'private' && entry.collectionId !== collection.id,
    ),
  ).toBeTruthy();
  const copiedSource = imported.find((entry: { title: string }) => entry.title === source.title);
  const copiedTarget = imported.find((entry: { title: string }) => entry.title === 'Destination');
  const saved = await (await page.request.get(`/v1/boards/${copiedSource.id}`)).json();
  expect(saved.snapshot.board.nodes[0].linkedBoardId).toBe(copiedTarget.id);
  expect(saved.snapshot.past).toEqual([]);
  expect(await (await page.request.get(`/v1/boards/${copiedSource.id}/chat`)).json()).toEqual([]);
});

test('a filed board’s JSON export names its collection, and importing files the copy there', async ({
  page,
}) => {
  await signUp(page, 'Board filer');
  const collection = await (
    await page.request.post('/v1/collections', { data: { name: 'Field notes' } })
  ).json();
  await page.goto('/');
  await page.getByRole('button', { name: 'Open example: An email’s journey' }).click();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  const [source] = await (await page.request.get('/v1/boards')).json();
  await page.request.put(`/v1/boards/${source.id}/collection`, {
    data: { collectionId: collection.id },
  });
  await page.reload();
  await expect(page.locator('.react-flow__node').first()).toBeVisible();

  const exportBoard = async () => {
    await page.locator('.export-menu summary').click();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: /^Editable board/ }).click();
    return readFile((await (await pending).path())!);
  };
  // The name sits beside the board document; the document itself is unchanged.
  await expect
    .poll(async () => JSON.parse((await exportBoard()).toString()).collection)
    .toBe('Field notes');
  const bytes = await exportBoard();
  const { collection: name, ...board } = JSON.parse(bytes.toString());
  expect(name).toBe('Field notes');
  const saved = await (await page.request.get(`/v1/boards/${source.id}`)).json();
  expect(board).toEqual(saved.snapshot.board);

  const importFile = async () => {
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: 'filed.json', mimeType: 'application/json', buffer: bytes });
    const review = page.getByRole('region', { name: 'Import review' });
    await expect(review).toContainText('Files into your “Field notes” collection');
    await review.getByRole('button', { name: 'Import as new board', exact: true }).click();
  };
  const filedIn = async () =>
    (
      (await (await page.request.get('/v1/boards')).json()) as {
        id: string;
        collectionId?: string;
      }[]
    )
      .filter((entry) => entry.id !== source.id)
      .map((entry) => entry.collectionId ?? null);

  // An existing collection is matched by name, ignoring case.
  await page.request.patch(`/v1/collections/${collection.id}`, { data: { name: 'FIELD NOTES' } });
  await importFile();
  await expect.poll(filedIn).toEqual([collection.id]);

  // Without one, the collection is created.
  await page.request.delete(`/v1/collections/${collection.id}`);
  await importFile();
  await expect
    .poll(async () => (await (await page.request.get('/v1/collections')).json()).length)
    .toBe(1);
  const [created] = await (await page.request.get('/v1/collections')).json();
  expect(created.name).toBe('Field notes');
  await expect
    .poll(async () => (await filedIn()).filter((id) => id === created.id))
    .toHaveLength(1);
});
