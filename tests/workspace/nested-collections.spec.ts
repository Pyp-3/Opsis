import { test, expect } from '@playwright/test';
import { signUp } from './session';

test('navigates, searches, moves and deletes nested collections without losing canvases', async ({
  page,
}, testInfo) => {
  await signUp(page, 'Nested collector');
  await page.goto('/boards');
  const chips = page.getByRole('group', { name: 'Show collection' });
  const create = async (name: string) => {
    await page.getByRole('button', { name: 'New collection', exact: true }).click();
    await page.getByLabel('Collection name', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Create collection', exact: true }).click();
    await expect(chips.getByRole('button', { name: new RegExp(`^${name} 0$`) })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  };
  await create('Education');
  await create('Artificial Intelligence');
  await create('Topic 1: 日本語');
  const list = (await (await page.request.get('/v1/collections')).json()) as {
    id: string;
    name: string;
    parentId: string | null;
  }[];
  const education = list.find((item) => item.name === 'Education')!;
  const ai = list.find((item) => item.name === 'Artificial Intelligence')!;
  const topic = list.find((item) => item.name === 'Topic 1: 日本語')!;
  expect(ai.parentId).toBe(education.id);
  expect(topic.parentId).toBe(ai.id);
  const board = await (
    await page.request.post('/v1/boards', {
      data: { title: 'Neural networks', collectionId: topic.id },
    })
  ).json();
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Collection path' })).toContainText(
    'Education / Artificial Intelligence / Topic 1: 日本語',
  );
  await expect(
    page.getByRole('button', { name: 'Rename Neural networks', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('nested-library.png'), fullPage: true });
  await page.getByRole('button', { name: 'Collapse Education', exact: true }).click();
  await expect(chips.getByRole('button', { name: /^Topic 1/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Expand Education', exact: true }).click();
  await chips.getByRole('button', { name: /^All boards/ }).click();
  await page.getByLabel('Find collection').fill('Education / Artificial');
  await expect(
    chips.getByRole('button', { name: /^Education \/ Artificial Intelligence \/ Topic 1/ }),
  ).toBeVisible();
  await page.getByLabel('Find collection').fill('');
  await chips.getByRole('button', { name: /^Artificial Intelligence 0/ }).click();
  await expect(
    page.getByRole('button', { name: 'Rename Neural networks', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Move collection', exact: true }).click();
  await expect(page.getByLabel('Parent collection').locator('option')).toHaveCount(2); // root and Education; descendants excluded
  await page.getByLabel('Parent collection').selectOption('');
  await page.getByRole('button', { name: 'Save collection location' }).click();
  await expect(page.getByRole('navigation', { name: 'Collection path' })).toContainText(
    'Library / Artificial Intelligence',
  );
  await page.getByRole('button', { name: 'Delete collection', exact: true }).click();
  await page
    .getByRole('group', { name: 'Confirm collection deletion' })
    .getByRole('button', { name: 'Delete collection' })
    .click();
  await chips.getByRole('button', { name: /^Topic 1: 日本語 1/ }).click();
  await expect(
    page.getByRole('button', { name: 'Rename Neural networks', exact: true }),
  ).toBeVisible();
  expect(await (await page.request.get(`/v1/boards/${board.id}`)).json()).toEqual(board);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
