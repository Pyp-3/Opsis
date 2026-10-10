import { afterEach, expect, it } from 'vitest';
import { addBoardPage, boardPage, updateBoardPage, withBoardPage, EMAIL_DEMO } from '@opsis/schema';
import { buildApp } from './app';
import type { SpeechEngine } from './speech';

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

it('reads people without a member account only the script of a board they can open', async () => {
  const spoken: string[] = [];
  const engine: SpeechEngine = {
    status: () => ({ state: 'ready' }),
    warm: () => undefined,
    generate: async (text) => {
      spoken.push(text);
      return Buffer.from('RIFF');
    },
  };
  const app = buildApp({ databasePath: ':memory:', speech: engine, rateLimit: 1000 });
  apps.push(app);
  const signup = await app.inject({
    method: 'POST',
    url: '/v1/auth/signup',
    payload: { name: 'Owner', email: 'owner@example.com', password: 'correct horse' },
  });
  const cookie = String(signup.headers['set-cookie']).split(';')[0]!;
  const created = (
    await app.inject({
      method: 'POST',
      url: '/v1/boards',
      headers: { cookie },
      payload: { title: 'Pitch' },
    })
  ).json();
  // A cover the email journey narrates, and a hidden page with a line of its own.
  let board = {
    ...created.snapshot.board,
    ...EMAIL_DEMO,
    positions: Object.fromEntries(
      EMAIL_DEMO.nodes.map((node, index) => [node.id, { x: 0, y: index * 200 }]),
    ),
  };
  board = addBoardPage(
    board,
    { id: 'secret-page-0001', title: 'Pricing' },
    { firstPage: { id: 'cover-page-00001', title: 'Cover' } },
  );
  board = withBoardPage(board, 'secret-page-0001', {
    ...boardPage(board, 'secret-page-0001'),
    narration: 'Pricing starts at ten pounds a month.',
    nodes: [{ ...EMAIL_DEMO.nodes[0]!, id: 'price', narration: 'This is the price.' }],
    positions: { price: { x: 0, y: 0 } },
  });
  board = updateBoardPage(board, 'secret-page-0001', { hidden: true });
  await app.inject({
    method: 'PUT',
    url: `/v1/boards/${created.id}`,
    headers: { cookie },
    payload: { revision: 1, snapshot: { board, past: [], future: [] } },
  });
  const cover = EMAIL_DEMO.narration!;
  const speak = (text: string, extra: Record<string, unknown> = {}, headers = {}) =>
    app.inject({
      method: 'POST',
      url: '/v1/speech',
      headers,
      payload: { text, voice: 'bf_emma', ...extra },
    });
  const source = { board: { id: created.id } };

  // Private: nobody without an account is read anything, even the board's own lines.
  expect((await speak(cover, source)).statusCode).toBe(403);
  await app.inject({
    method: 'PATCH',
    url: `/v1/boards/${created.id}`,
    headers: { cookie },
    payload: { revision: 2, visibility: 'link' },
  });
  // Shared by link: its script is read; any other text, or no board at all, is refused.
  expect((await speak(cover, source)).statusCode).toBe(200);
  expect((await speak('Say anything I like.', source)).statusCode).toBe(403);
  expect((await speak(cover)).statusCode).toBe(403);
  // A hidden page's lines only with that page's link.
  const secret = 'Pricing starts at ten pounds a month.';
  expect((await speak(secret, source)).statusCode).toBe(403);
  const linked = { board: { id: created.id, page: 'secret-page-0001' } };
  expect((await speak(secret, linked)).statusCode).toBe(200);
  // Members may have any line spoken.
  expect((await speak('Say anything I like.', {}, { cookie })).statusCode).toBe(200);
  expect(spoken).toEqual([cover, secret, 'Say anything I like.']);
});
