import { test, expect } from '@playwright/test';
import {
  boardFromPages,
  boardPage,
  createEmptyBoard,
  withBoardPage,
  type BoardDocument,
} from '../../packages/schema/src/index';
import { signUp } from './session';

test('a shared hidden page refreshes narration without interrupting unchanged playback and closes on revocation', async ({
  page,
  browser,
}) => {
  test.setTimeout(45_000);
  await signUp(page, 'Shared board author');
  const hiddenPage = 'hidden-page-0002';
  const originalLine = 'The original shared introduction.';
  const updatedLine = 'The updated shared introduction.';
  const base: BoardDocument = {
    ...createEmptyBoard('A live shared board'),
    narration: 'The public introduction.',
    nodes: [
      {
        id: 'step',
        label: 'Shared step',
        kind: 'step',
        icon: 'server',
        summary: 'A saved step.',
        explanation: 'A saved explanation.',
        narration: 'The saved step is ready.',
      },
    ],
    positions: { step: { x: 24, y: 24 } },
  };
  const board = boardFromPages([
    { id: 'public-page-0001', title: 'Cover', board: base },
    { id: hiddenPage, title: 'Notes', hidden: true, board: { ...base, narration: originalLine } },
  ]);
  const created = await page.request.post('/v1/boards', { data: { title: board.title } });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  const read = async () => (await page.request.get(`/v1/boards/${id}`)).json();
  const save = async (document: BoardDocument) => {
    const { revision } = await read();
    const response = await page.request.put(`/v1/boards/${id}`, {
      data: { revision, snapshot: { board: document, past: [], future: [] } },
    });
    expect(response.ok()).toBe(true);
  };
  const share = async (visibility: 'link' | 'private') => {
    const { revision } = await read();
    const response = await page.request.patch(`/v1/boards/${id}`, {
      data: { revision, visibility },
    });
    expect(response.ok()).toBe(true);
  };
  await save(board);
  await share('link');

  const context = await browser.newContext();
  try {
    // Keep a sentence playing until the app stops it; no model downloads or audio devices.
    await context.addInitScript(() => {
      const state = { active: 0 };
      Object.assign(window, { __guestAudio: state });
      Object.defineProperty(window, 'Audio', {
        value: class {
          private active = false;
          play() {
            if (!this.active) state.active++;
            this.active = true;
            return Promise.resolve();
          }
          pause() {
            if (this.active) state.active--;
            this.active = false;
          }
        },
      });
    });
    await context.route(/huggingface\.co|cdn\.jsdelivr\.net/, (route) => route.abort());
    const guest = await context.newPage();
    const spoken: { text: string; board?: { id: string; page?: string } }[] = [];
    await guest.route('**/v1/speech/warm', (route) => route.fulfill({ json: { state: 'ready' } }));
    await guest.route('**/v1/speech', (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: { state: 'ready' } });
      spoken.push(route.request().postDataJSON());
      return route.fulfill({ body: Buffer.from('audio fixture'), contentType: 'audio/wav' });
    });
    const readPages: (string | null)[] = [];
    guest.on('response', (response) => {
      const url = new URL(response.url());
      if (url.pathname === `/v1/guest/boards/${id}` && response.status() === 200) {
        readPages.push(url.searchParams.get('page'));
      }
    });
    const activeAudio = () =>
      guest.evaluate(
        () => (window as unknown as { __guestAudio: { active: number } }).__guestAudio.active,
      );
    const play = async () => {
      await guest.getByRole('button', { name: 'Play the process' }).click();
      await guest.getByRole('button', { name: 'Narrator', exact: true }).click();
      await guest.getByRole('button', { name: 'Play', exact: true }).click();
      await expect.poll(activeAudio).toBe(1);
    };
    await guest.goto(`/canvas?board=${id}&page=${hiddenPage}`);
    await expect(guest.getByRole('navigation', { name: 'Pages' })).toContainText('2 / 2');
    await play();
    await expect(guest.locator('.player-caption')).toContainText(originalLine);
    const beforePoll = readPages.length;
    await expect.poll(() => readPages.length, { timeout: 10_000 }).toBeGreaterThan(beforePoll + 1);
    await expect(guest.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    expect(await activeAudio()).toBe(1);

    await save(
      withBoardPage(board, hiddenPage, { ...boardPage(board, hiddenPage), narration: updatedLine }),
    );
    await expect(guest.getByRole('button', { name: 'Play the process' })).toBeVisible();
    await expect.poll(activeAudio).toBe(0);
    await expect(guest.getByRole('navigation', { name: 'Pages' })).toContainText('2 / 2');
    await play();
    await expect(guest.locator('.player-caption')).toContainText(updatedLine);
    await expect.poll(() => spoken.some((line) => line.text === updatedLine)).toBe(true);
    expect(spoken.every((line) => line.board?.id === id && line.board.page === hiddenPage)).toBe(
      true,
    );

    expect(readPages.every((requestedPage) => requestedPage === hiddenPage)).toBe(true);
    await share('private');
    await expect(guest).toHaveURL(/\/login\?/);
    await expect(guest.getByRole('region', { name: 'Shared diagram' })).toHaveCount(0);
    await expect.poll(activeAudio).toBe(0);
  } finally {
    await context.close();
  }
});
