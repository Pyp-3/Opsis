import { test, expect, type Page } from '@playwright/test';
import { accessibilityScan, signUp } from './session';
import { openEmailExample } from './board-fixtures';

const pager = (page: Page) => page.getByRole('navigation', { name: 'Pages' });
const prompt = (page: Page) => page.getByLabel('What would you like to understand?');

test('chat references pages with @, compacts its thread and sets agent access', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signUp(page, 'Harness chat');
  await openEmailExample(page);

  // A second page, named, so one thread can refer to it from the first.
  await page.getByRole('button', { name: 'Add page' }).click();
  await expect(pager(page)).toContainText('2 / 2');
  await pager(page).locator('summary').click();
  await page.getByLabel('Name of page 2').fill('Delivery failures');
  await page.getByLabel('Name of page 2').press('Enter');
  await page.getByRole('button', { name: 'Go to page 1: Page 1' }).click();
  await expect(pager(page)).toContainText('1 / 2');
  await expect(page.locator('.save-status')).toHaveText('Saved');

  // Typing @ lists the board's pages; choosing one writes @page2 and shows what it names.
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Private board chat' })).toContainText(
    'Type @ to reference a page',
  );
  await prompt(page).fill('Show delivery failure and retry, as on ');
  await prompt(page).press('End');
  await prompt(page).pressSequentially('@');
  const options = page.getByRole('listbox', { name: 'Pages to reference' }).getByRole('option');
  await expect(options).toHaveCount(2);
  await expect(prompt(page)).toHaveAttribute('aria-activedescendant', 'page-mention-list-1');
  expect((await accessibilityScan(page)).violations).toEqual([]);
  await prompt(page).pressSequentially('2');
  await expect(options).toHaveCount(1);
  await expect(options.first()).toContainText('Delivery failures');
  await prompt(page).press('Enter');
  await expect(prompt(page)).toHaveValue('Show delivery failure and retry, as on @page2 ');
  await expect(page.getByRole('listbox', { name: 'Pages to reference' })).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Pages this message references' })).toHaveText(
    /Page 2 · Delivery failures/,
  );
  // The @ button starts another reference; Escape closes the list without sending.
  await page.getByRole('button', { name: 'Reference a page' }).click();
  await expect(options).toHaveCount(2);
  await prompt(page).press('Escape');
  await expect(options).toHaveCount(0);
  await prompt(page).fill('Show delivery failure and retry, as on @page2');
  await page.getByRole('button', { name: 'Generate diagram', exact: true }).click();
  const log = page.getByRole('log');
  await expect(log).toContainText('A proposal is ready for review on Canvas.');
  await expect(log.locator('mark.chat-mention')).toHaveText('@page2');
  await expect(log.getByRole('list', { name: 'Pages referenced' })).toHaveText(
    /Page 2 · Delivery failures/,
  );
  await page.getByRole('button', { name: 'Review on canvas' }).click();
  await page.getByRole('button', { name: 'Keep current board', exact: true }).click();

  // The thread saved which page the message named.
  const boards = await (await page.request.get('/v1/boards')).json();
  const board = boards.find((entry: { title: string }) => entry.title === 'An email’s journey');
  const document = await (await page.request.get(`/v1/boards/${board.id}`)).json();
  const pageTwo = document.snapshot.board.pages[1].id;
  let [thread] = await (await page.request.get(`/v1/boards/${board.id}/chat`)).json();
  expect(thread.messages[0].pages).toEqual([pageTwo]);

  // A page chip opens that page on the canvas.
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await page.getByRole('button', { name: 'Page 2 · Delivery failures' }).click();
  await expect(page.getByRole('tab', { name: /Canvas/ })).toHaveAttribute('aria-selected', 'true');
  await expect(pager(page)).toContainText('2 / 2');

  // Compacting folds the thread and starts the agent's next reply in a fresh session.
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await page.getByRole('button', { name: 'Compact thread' }).click();
  await expect(page.locator('.chat-memory summary')).toContainText('compacted');
  await expect(page.getByRole('button', { name: 'Compact thread' })).toBeDisabled();
  [thread] = await (await page.request.get(`/v1/boards/${board.id}/chat`)).json();
  expect(thread.restart).toBe(true);

  // The thread list keeps each title inside its item.
  const overflow = await page.locator('.chat-thread-item:not(.is-new)').evaluateAll((items) =>
    items.some((item) => {
      const title = item.querySelector('.chat-thread-title')!.getBoundingClientRect();
      return title.right > item.getBoundingClientRect().right - 8;
    }),
  );
  expect(overflow).toBe(false);
  await page.screenshot({ path: test.info().outputPath('chat-threads.png') });

  // Full access and fast mode are per agent, saved to the account, and shown while chatting.
  await page.getByLabel('Agent', { exact: true }).selectOption('claude');
  await page.getByRole('button', { name: /Model settings/ }).click();
  const access = page.getByRole('radiogroup', { name: 'Agent access' });
  await expect(access.getByRole('radio', { name: /Restricted/ })).toBeChecked();
  await access.getByRole('radio', { name: /Full access/ }).check();
  await page.getByRole('checkbox', { name: /Fast mode/ }).check();
  await expect(page.locator('.agent-access-note')).toContainText('trusts the agent');
  await expect(page.locator('.chat-head .mode-badge')).toHaveText(['Full access', 'Fast']);
  expect((await accessibilityScan(page)).violations).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('chat-access.png') });
  await expect
    .poll(async () => {
      const settings = await (await page.request.get('/v1/account/settings')).json();
      return JSON.stringify(settings);
    })
    .toContain('"access":"full"');
  await page.reload();
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await page.getByLabel('Agent', { exact: true }).selectOption('claude');
  await expect(page.locator('.chat-head .mode-badge')).toHaveText(['Full access', 'Fast']);
  await page.getByRole('button', { name: /Model settings/ }).click();
  await access.getByRole('radio', { name: /Restricted/ }).check();
  await page.getByRole('checkbox', { name: /Fast mode/ }).uncheck();
  await expect(page.locator('.chat-head .mode-badge')).toHaveCount(0);

  // On a phone the chat still fits the screen.
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
