import { expect, it } from 'vitest';
import { addBoardPage, boardPage, updateBoardPage, withBoardPage } from '@opsis/schema';
import { buildApp } from './app';

const COVER = 'cover-page-00001';
const SECRET = 'secret-page-0001';
const concept = (id: string, label: string, linkedBoardId?: string) => ({
  id,
  label,
  icon: 'server' as const,
  summary: `${label} summary`,
  explanation: `${label} explanation`,
  kind: 'step' as const,
  ...(linkedBoardId ? { linkedBoardId } : {}),
});

it('shares a board by link with signed-out guests, never sending hidden pages without their link', async () => {
  const app = buildApp({ databasePath: ':memory:', speech: null });
  const signup = async (email: string) =>
    String(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/auth/signup',
          payload: { name: email, email, password: 'correct horse' },
        })
      ).headers['set-cookie'],
    ).split(';')[0]!;
  try {
    const owner = await signup('owner@example.com');
    const editor = await signup('editor@example.com');
    const viewer = await signup('viewer@example.com');
    const request = (
      cookie: string | null,
      method: 'GET' | 'PUT' | 'PATCH',
      url: string,
      payload?: object,
    ) =>
      app.inject({
        method,
        url,
        ...(cookie ? { headers: { cookie } } : {}),
        ...(payload ? { payload } : {}),
      });
    const linked = (
      await app.inject({
        method: 'POST',
        url: '/v1/boards',
        headers: { cookie: owner },
        payload: { title: 'Linked from the pitch' },
      })
    ).json();
    const created = (
      await app.inject({
        method: 'POST',
        url: '/v1/boards',
        headers: { cookie: owner },
        payload: { title: 'Pitch' },
      })
    ).json();
    const path = `/v1/boards/${created.id}`;
    const guestPath = `/v1/guest/boards/${created.id}`;

    // A pitch: a visible cover and a hidden pricing page that links to another board.
    let board = {
      ...created.snapshot.board,
      nodes: [concept('idea', 'Idea')],
      positions: { idea: { x: 0, y: 0 } },
    };
    board = addBoardPage(
      board,
      { id: SECRET, title: 'Pricing' },
      { firstPage: { id: COVER, title: 'Cover' } },
    );
    board = withBoardPage(board, SECRET, {
      ...boardPage(board, SECRET),
      nodes: [concept('price', 'Secret price', linked.id)],
      positions: { price: { x: 0, y: 0 } },
    });
    board = updateBoardPage(board, SECRET, { hidden: true });
    const snapshot = { board, past: [created.snapshot.board], future: [] };
    expect((await request(owner, 'PUT', path, { revision: 1, snapshot })).statusCode).toBe(200);
    await request(owner, 'PUT', `${path}/editors`, {
      revision: 2,
      email: 'editor@example.com',
      enabled: true,
    });

    // Private: no guest, viewer or guessed page link gets in.
    expect((await request(null, 'GET', guestPath)).statusCode).toBe(404);
    expect((await request(null, 'GET', `${guestPath}?page=${SECRET}`)).statusCode).toBe(404);
    expect((await request(viewer, 'GET', path)).statusCode).toBe(404);

    // Anyone with the link: readable without an account, not listed, and still not writable.
    const shared = await request(owner, 'PATCH', path, { revision: 2, visibility: 'link' });
    expect(shared.json()).toMatchObject({ visibility: 'link', revision: 2 });
    const guest = await request(null, 'GET', guestPath);
    expect(guest.statusCode).toBe(200);
    expect(guest.json()).toMatchObject({
      access: 'viewer',
      visibility: 'link',
      owner: { name: 'owner@example.com' },
      snapshot: { past: [], future: [] },
    });
    // Neither the page nor its ID reaches a guest, and the editors' undo history stays private.
    for (const body of [guest.body, (await request(viewer, 'GET', path)).body]) {
      expect(body).not.toContain('Secret price');
      expect(body).not.toContain(SECRET);
    }
    expect(guest.json().snapshot.board.pages).toEqual([{ id: COVER, title: 'Cover' }]);
    expect((await request(viewer, 'GET', path)).json().access).toBe('viewer');
    expect((await request(viewer, 'GET', '/v1/boards/public')).json()).toEqual([]);
    expect(
      (await request(viewer, 'PUT', path, { revision: 2, snapshot: guest.json().snapshot }))
        .statusCode,
    ).toBe(403);

    // The hidden page's own link shows it, to guests and signed-in viewers alike.
    for (const cookie of [null, viewer]) {
      const opened = await request(cookie, 'GET', `${cookie ? path : guestPath}?page=${SECRET}`);
      expect(opened.body).toContain('Secret price');
      expect(opened.json().snapshot.board.pages.map((page: { id: string }) => page.id)).toEqual([
        COVER,
        SECRET,
      ]);
    }
    expect((await request(null, 'GET', `${guestPath}?page=not-a-page-id`)).body).not.toContain(
      'Secret price',
    );

    // Owners and editors always receive every page and the history.
    for (const cookie of [owner, editor]) {
      const full = (await request(cookie, 'GET', path)).json();
      expect(full.snapshot).toEqual(snapshot);
    }

    // Backlinks from a hidden page are the editors' too.
    const backlinks = `/v1/boards/${linked.id}/backlinks`;
    await request(owner, 'PATCH', `/v1/boards/${linked.id}`, { revision: 1, visibility: 'public' });
    await request(owner, 'PATCH', path, { revision: 2, visibility: 'public' });
    expect((await request(owner, 'GET', backlinks)).json()).toEqual([
      { id: created.id, title: 'Pitch', conceptId: 'price', label: 'Secret price', pageId: SECRET },
    ]);
    expect((await request(viewer, 'GET', backlinks)).json()).toEqual([]);

    // Archiving and making it private close the link again.
    await request(owner, 'PATCH', path, { revision: 2, visibility: 'private' });
    expect((await request(null, 'GET', guestPath)).statusCode).toBe(404);
    expect((await request(viewer, 'GET', path)).statusCode).toBe(404);
    expect((await request(null, 'GET', '/v1/guest/boards/not-a-uuid')).statusCode).toBe(400);
  } finally {
    await app.close();
  }
});
