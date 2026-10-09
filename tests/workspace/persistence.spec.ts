import { test, expect } from '@playwright/test';
import { accessibilityScan, signUp } from './session';

test('duplicates, archives and restores a historical private copy without changing its source', async ({
  page,
}) => {
  await signUp(page, 'Archivist');
  await page.goto('/');
  await page.getByRole('button', { name: 'Open example: An email’s journey' }).click();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  const source = await page.evaluate(async () => {
    const list = await (await fetch('/v1/boards')).json();
    return (await fetch(`/v1/boards/${list[0].id}`)).json();
  });
  await page.goto('/boards');
  await page.getByRole('button', { name: 'Duplicate An email’s journey', exact: true }).click();
  await expect(page.getByLabel('Board name')).toHaveValue('An email’s journey (copy)');
  await page.goto('/boards');
  await page.getByRole('button', { name: 'Archive An email’s journey', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Duplicate An email’s journey', exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Duplicate An email’s journey', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('tab', { name: 'Archive', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Unarchive An email’s journey', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Revision history for An email’s journey', exact: true })
    .click();
  const history = page.getByRole('region', {
    name: 'Revision history for An email’s journey',
    exact: true,
  });
  await history.getByRole('button', { name: /^Revision 1 ·/ }).click();
  await expect(history.getByLabel('Revision preview')).toContainText('An email’s journey');
  await history.getByRole('button', { name: 'Restore revision 1 as private copy' }).click();
  await expect(page.getByLabel('Board name')).toHaveValue('An email’s journey (copy)');
  const after = await page.evaluate(async (id) => {
    const list = await (await fetch('/v1/boards')).json();
    return {
      list,
      original: await (await fetch(`/v1/boards/${id}`)).json(),
      copies: await Promise.all(
        list
          .filter((item: { id: string }) => item.id !== id)
          .map(async (item: { id: string }) => (await fetch(`/v1/boards/${item.id}`)).json()),
      ),
    };
  }, source.id);
  expect(after.list).toHaveLength(3);
  expect(after.original.archived).toBe(true);
  expect(after.original.snapshot).toEqual(source.snapshot);
  for (const copy of after.copies) {
    expect(copy.visibility).toBe('private');
    expect(copy.archived).toBe(false);
    expect(copy.snapshot.board).toEqual({
      ...source.snapshot.board,
      title: 'An email’s journey (copy)',
    });
    expect(copy.snapshot.past).toEqual([]);
    expect(copy.snapshot.future).toEqual([]);
  }
  await page.goto('/boards');
  await page.getByRole('tab', { name: 'Archive', exact: true }).click();
  await page.getByRole('button', { name: 'Unarchive An email’s journey', exact: true }).click();
  await expect(page.getByText('No archived boards.', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'My boards', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Archive An email’s journey', exact: true }),
  ).toBeVisible();
});

test('files boards into private collections that survive reload, and keeps boards when a collection is deleted', async ({
  page,
}) => {
  await signUp(page, 'Collector');
  for (const title of ['Routing notes', 'Garden plan'])
    expect((await page.request.post('/v1/boards', { data: { title } })).status()).toBe(201);
  await page.goto('/boards');
  const chips = page.getByRole('group', { name: 'Show collection' });
  await page.getByRole('button', { name: 'New collection' }).click();
  await page.getByLabel('Collection name').fill('Networking');
  await page.getByRole('button', { name: 'Create collection' }).click();
  await expect(chips.getByRole('button', { name: /^Networking/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByText('No boards in this collection yet.', { exact: false })).toBeVisible();
  await expect(page.getByLabel('New board in Networking')).toBeVisible();

  await chips.getByRole('button', { name: /^All boards/ }).click();
  await page
    .getByRole('button', { name: 'Move Routing notes to a collection', exact: true })
    .click();
  await page.getByLabel('Collection for Routing notes').selectOption({ label: 'Networking' });
  await page.getByRole('button', { name: 'Move board' }).click();
  await expect(page.getByText('Moved “Routing notes” to Networking.')).toBeVisible();

  await page.reload();
  await chips.getByRole('button', { name: /^Networking/ }).click();
  await expect(
    page.getByRole('button', { name: 'Rename Routing notes', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rename Garden plan', exact: true })).toHaveCount(
    0,
  );
  await chips.getByRole('button', { name: /^Unfiled/ }).click();
  await expect(page.getByRole('button', { name: 'Rename Garden plan', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rename Routing notes', exact: true })).toHaveCount(
    0,
  );

  // Filing is organization only: the board's saved revision is unchanged.
  const routing = await page.evaluate(async () =>
    ((await (await fetch('/v1/boards')).json()) as { title: string; revision: number }[]).find(
      (board) => board.title === 'Routing notes',
    ),
  );
  expect(routing?.revision).toBe(1);

  await chips.getByRole('button', { name: /^Networking/ }).click();
  await page.getByRole('button', { name: 'Delete collection' }).click();
  await page
    .getByRole('group', { name: 'Confirm collection deletion' })
    .getByRole('button', { name: 'Delete collection' })
    .click();
  await expect(chips.getByRole('button', { name: /^Networking/ })).toHaveCount(0);
  for (const title of ['Routing notes', 'Garden plan'])
    await expect(page.getByRole('button', { name: `Rename ${title}`, exact: true })).toBeVisible();
});

test('moves several boards at once and shows recent boards by collection on home', async ({
  page,
}, testInfo) => {
  await signUp(page, 'Sorter');
  for (const title of ['Routing notes', 'DNS notes', 'Garden plan'])
    expect((await page.request.post('/v1/boards', { data: { title } })).status()).toBe(201);
  const networking = (await (
    await page.request.post('/v1/collections', { data: { name: 'Networking' } })
  ).json()) as { id: string };
  await page.goto('/boards');
  const chips = page.getByRole('group', { name: 'Show collection' });
  await page.getByRole('button', { name: 'Select boards' }).click();
  const bulk = page.getByRole('form', { name: 'Move selected boards' });
  await expect(bulk.getByRole('status')).toHaveText('0 of 3 selected');
  await expect(bulk.getByRole('button', { name: /^Move 0 boards/ })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Select Routing notes' }).check();
  await page.getByRole('checkbox', { name: 'Select DNS notes' }).check();
  await expect(bulk.getByRole('status')).toHaveText('2 of 3 selected');
  await page.screenshot({ path: testInfo.outputPath('bulk-move-desktop.png'), fullPage: true });
  expect((await accessibilityScan(page)).violations).toEqual([]);
  await bulk.getByLabel('Move to').selectOption({ label: 'Networking' });
  await bulk.getByRole('button', { name: 'Move 2 boards' }).click();
  await expect(page.getByText('Moved 2 boards to Networking.')).toBeVisible();
  await expect(bulk).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Select Routing notes' })).toHaveCount(0);
  await expect(chips.getByRole('button', { name: /^Networking/ })).toContainText('2');

  // Moving is organization only: no saved revision changes.
  const listed = (await (await page.request.get('/v1/boards')).json()) as {
    title: string;
    revision: number;
    collectionId: string | null;
  }[];
  expect(
    Object.fromEntries(listed.map((board) => [board.title, [board.collectionId, board.revision]])),
  ).toEqual({
    'Routing notes': [networking.id, 1],
    'DNS notes': [networking.id, 1],
    'Garden plan': [null, 1],
  });

  // Home lists recent boards with their collection and can narrow them to one.
  await page.goto('/');
  const recent = page.getByRole('navigation', { name: 'Saved boards' });
  await expect(recent.getByRole('button', { name: 'Routing notes' })).toContainText(
    'Networking · Updated',
  );
  await expect(recent.getByRole('button')).toHaveCount(3);
  const from = page.getByRole('group', { name: 'Recent boards from' });
  await from.getByRole('button', { name: 'Networking' }).click();
  await expect(from.getByRole('button', { name: 'Networking' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(recent.getByRole('button')).toHaveCount(2);
  await expect(recent.getByRole('button', { name: 'Garden plan' })).toHaveCount(0);
  // The full-bleed backdrop stays within the page beside the sidebar: no sideways scroll.
  expect(
    await page.evaluate(() => {
      const area = document.querySelector('.page-scroll')!;
      return area.scrollWidth <= area.clientWidth;
    }),
  ).toBe(true);
  expect((await accessibilityScan(page)).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('home-recent-collection.png') });
  await page.getByRole('link', { name: 'All in Networking' }).click();
  await expect(page).toHaveURL(`/boards?collection=${networking.id}`);
  await expect(chips.getByRole('button', { name: /^Networking/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Rename Garden plan', exact: true })).toHaveCount(
    0,
  );
  // The library keeps its filter in the address, so a reload stays in the collection.
  await page.reload();
  await expect(chips.getByRole('button', { name: /^Networking/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Selection only covers the boards shown; moving them back out of the collection.
  await page.getByRole('button', { name: 'Select boards' }).click();
  await bulk.getByRole('button', { name: 'Select all shown' }).click();
  await expect(bulk.getByRole('status')).toHaveText('2 of 2 selected');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Hide sidebar' }).click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath('bulk-move-phone.png'), fullPage: true });
  expect((await accessibilityScan(page)).violations).toEqual([]);
  await bulk.getByRole('button', { name: 'Move 2 boards' }).click();
  await expect(page.getByText('Removed 2 boards from their collections.')).toBeVisible();
  await chips.getByRole('button', { name: /^All boards/ }).click();
  await expect(page).toHaveURL('/boards');
  const after = (await (await page.request.get('/v1/boards')).json()) as {
    collectionId: string | null;
  }[];
  expect(after.map((board) => board.collectionId)).toEqual([null, null, null]);
});

test('tags boards and keeps smart collections that match by rule across reload', async ({
  page,
}) => {
  await signUp(page, 'Tagger');
  for (const title of ['DNS lookups', 'Photosynthesis', 'TLS handshake'])
    expect((await page.request.post('/v1/boards', { data: { title } })).status()).toBe(201);
  await page.goto('/boards');
  for (const [title, tags] of [
    ['DNS lookups', 'networking, exam'],
    ['TLS handshake', 'Networking'],
  ]) {
    await page.getByRole('button', { name: `Edit tags for ${title}`, exact: true }).click();
    await page.getByLabel(`Tags for ${title}`).fill(tags);
    await page.getByRole('button', { name: 'Save tags' }).click();
    await expect(page.getByText(`Tags saved for “${title}”.`)).toBeVisible();
  }
  await page.getByLabel('Filter by tag').selectOption('exam');
  await expect(page.getByRole('button', { name: 'Rename DNS lookups', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rename TLS handshake', exact: true })).toHaveCount(
    0,
  );
  await page.getByLabel('Filter by tag').selectOption('');

  await page.getByRole('button', { name: 'New smart collection' }).click();
  await page.getByLabel('Smart collection name').fill('Networking topics');
  await page.getByLabel('Has any tag').fill('networking');
  await page.getByRole('button', { name: 'Create smart collection' }).click();
  const chips = page.getByRole('group', { name: 'Show collection' });
  await expect(chips.getByRole('button', { name: /^Networking topics/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.reload();
  await chips.getByRole('button', { name: /^Networking topics/ }).click();
  for (const title of ['DNS lookups', 'TLS handshake'])
    await expect(page.getByRole('button', { name: `Rename ${title}`, exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Rename Photosynthesis', exact: true }),
  ).toHaveCount(0);
  // Tagging and smart collections are organization only: saved revisions are unchanged.
  const revisions = await page.evaluate(async () =>
    ((await (await fetch('/v1/boards')).json()) as { revision: number }[]).map((b) => b.revision),
  );
  expect(revisions).toEqual([1, 1, 1]);
  await page.getByRole('button', { name: 'Delete smart collection' }).click();
  await expect(chips.getByRole('button', { name: /^Networking topics/ })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Rename Photosynthesis', exact: true }),
  ).toBeVisible();
});
