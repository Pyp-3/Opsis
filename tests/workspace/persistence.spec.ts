import { test, expect } from '@playwright/test';
import { signUp } from './session';

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
