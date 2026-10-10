import { test, expect } from '@playwright/test';
import { createEmptyBoard } from '../../packages/schema/src/index';

test('guest sees only public diagrams and loses an open board when access is revoked', async ({
  page,
}) => {
  const id = '01234567-89ab-4cde-8fab-0123456789ab';
  const board = createEmptyBoard('A public guest diagram');
  let publicBoard = true;
  const requested: string[] = [];
  await page.route('**/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    requested.push(`${route.request().method()} ${path}`);
    if (path === '/v1/instance')
      return route.fulfill({ json: { signup: false, accountExecutablePaths: false } });
    if (path === '/v1/auth/me')
      return route.fulfill({
        json: {
          user: { id: 'guest-fixture', name: 'Guest', email: 'guest@example.test', role: 'guest' },
        },
      });
    if (path === '/v1/boards/public')
      return route.fulfill({
        json: publicBoard
          ? [{ id, title: board.title, revision: 1, updatedAt: 1, visibility: 'public' }]
          : [],
      });
    if (path === `/v1/boards/${id}`)
      return publicBoard
        ? route.fulfill({
            json: { id, revision: 1, access: 'viewer', snapshot: { board, past: [], future: [] } },
          })
        : route.fulfill({ status: 404, json: { message: 'Board not found.' } });
    if (path === '/v1/auth/logout') return route.fulfill({ status: 204 });
    return route.fulfill({ status: 403, json: { message: 'Guest access denied.' } });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Public boards' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New canvas' })).toHaveCount(0);
  await page.getByRole('button', { name: board.title }).click();
  await expect(page.getByRole('heading', { name: board.title })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Read-only public diagram' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save a copy' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: board.title })).toBeVisible();
  publicBoard = false;
  await expect(page.getByRole('alert')).toHaveText('This public board is no longer available.');
  await expect(page.getByRole('region', { name: 'Read-only public diagram' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Public boards', exact: true }).click();
  await expect(page.getByText('No public boards yet.')).toBeVisible();
  expect(
    requested.filter(
      (request) =>
        !/^GET \/v1\/(instance|auth\/me|boards\/public|boards\/[a-f0-9-]+)$/u.test(request),
    ),
  ).toEqual([]);
});
