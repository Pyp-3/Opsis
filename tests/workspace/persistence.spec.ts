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
