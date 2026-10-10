import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { BoardSnapshot } from '@opsis/schema';
import { buildApp } from '../../api/src/app.js';
import { opsisClient } from './client.js';
import { createServer } from './server.js';

let app: ReturnType<typeof buildApp>;
let client: Client;
let adaKey: string;

/** The real API, reached through `app.inject` instead of a socket. */
const injectFetch: typeof fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  const response = await app.inject({
    method: (init?.method ?? 'GET') as 'GET',
    url: url.pathname + url.search,
    headers: init?.headers as Record<string, string>,
    ...(init?.body ? { payload: init.body as string } : {}),
  });
  return new Response(response.body || null, {
    status: response.statusCode,
    headers: { 'content-type': 'application/json' },
  });
};

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text: string }[])[0]!.text;
  return { isError: !!result.isError, text, json: () => JSON.parse(text) };
}

/** A person signs up and creates an agent key, as they would under Account → Agent keys. */
async function account(name: string) {
  const signUp = await app.inject({
    method: 'POST',
    url: '/v1/auth/signup',
    payload: { name, email: `${name.toLowerCase()}@example.com`, password: 'correct horse' },
  });
  const cookie = String(signUp.headers['set-cookie']).split(';')[0]!;
  const key = await app.inject({
    method: 'POST',
    url: '/v1/auth/agent-keys',
    headers: { cookie },
    payload: { name: 'Test agent' },
  });
  return { cookie, key: (key.json() as { key: string }).key };
}

beforeEach(async () => {
  app = buildApp({ databasePath: ':memory:' });
  const { key } = await account('Ada');
  adaKey = key;
  const server = createServer(
    opsisClient('http://opsis.test', key, injectFetch),
    'http://localhost:3000',
  );
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test', version: '1.0.0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
});
afterEach(async () => {
  await client.close();
  await app.close();
});

describe('Opsis MCP server', () => {
  it('describes how to use it and offers the canvas tools', async () => {
    expect(client.getInstructions()).toMatch(/undo/);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'opsis_add_concept',
      'opsis_add_drawings',
      'opsis_add_page',
      'opsis_connect',
      'opsis_create_board',
      'opsis_create_collection',
      'opsis_disconnect',
      'opsis_file_board',
      'opsis_get_board',
      'opsis_group_drawings',
      'opsis_list_boards',
      'opsis_list_collections',
      'opsis_list_public_boards',
      'opsis_list_symbols',
      'opsis_place_symbols',
      'opsis_remove_concept',
      'opsis_remove_drawings',
      'opsis_remove_page',
      'opsis_render_board',
      'opsis_repeat_drawings',
      'opsis_search_boards',
      'opsis_transform_drawings',
      'opsis_update_board',
      'opsis_update_concept',
      'opsis_update_drawing',
      'opsis_update_page',
      'opsis_write_diagram',
    ]);
    const add = tools.find((tool) => tool.name === 'opsis_add_concept')!;
    expect(add.inputSchema.required).toEqual(['boardId', 'label', 'summary']);
  });

  it('places symbols, transforms them and renders a picture of the board', async () => {
    const board = (await call('opsis_create_board', { title: 'Plant room' })).json();
    const symbols = (await call('opsis_list_symbols')).json();
    expect(symbols.map((symbol: { name: string }) => symbol.name)).toContain('pump');
    const placed = (
      await call('opsis_place_symbols', {
        boardId: board.id,
        symbols: [
          { symbol: 'pump', x: 100, y: 100, label: 'P-1' },
          { symbol: 'valve', x: 220, y: 100 },
        ],
      })
    ).json();
    expect(placed.symbols.map((item: { group: string }) => item.group)).toEqual([
      'pump-1',
      'valve-1',
    ]);
    const moved = await call('opsis_transform_drawings', {
      boardId: board.id,
      groups: ['valve-1'],
      rotate: 90,
      about: 'each',
    });
    expect(moved.isError).toBe(false);
    await call('opsis_add_drawings', {
      boardId: board.id,
      drawings: [{ shape: 'path', d: 'M60 100C80 60 180 60 196 100', endMarker: 'arrow' }],
    });
    const result = await client.callTool({
      name: 'opsis_render_board',
      arguments: { boardId: board.id, maxSize: 600 },
    });
    const [image, summary] = result.content as [
      { type: string; data: string; mimeType: string },
      { type: string; text: string },
    ];
    expect(image).toMatchObject({ type: 'image', mimeType: 'image/png' });
    // A real PNG, rasterised by the API host.
    expect(Buffer.from(image.data, 'base64').subarray(1, 4).toString()).toBe('PNG');
    expect(JSON.parse(summary.text)).toMatchObject({ gridSquare: 24, pixels: { width: 600 } });
  });

  it('builds a canvas step by step through the saved-board API', async () => {
    const created = (
      await call('opsis_create_board', { title: 'Tea', description: 'From leaf to cup.' })
    ).json();
    expect(created.open).toBe(`http://localhost:3000/canvas?board=${created.id}`);
    const leaf = (
      await call('opsis_add_concept', {
        boardId: created.id,
        label: 'Leaf',
        summary: 'Picked by hand.',
        icon: 'tree',
      })
    ).json();
    const cup = (
      await call('opsis_add_concept', {
        boardId: created.id,
        label: 'Cup',
        summary: 'Steeped in hot water.',
        icon: 'coffee',
        after: leaf.conceptId,
        connectionLabel: 'becomes',
      })
    ).json();
    await call('opsis_update_board', { boardId: created.id, background: 'forest' });
    const read = (await call('opsis_get_board', { boardId: created.id })).json();
    expect(read).toMatchObject({
      title: 'Tea',
      description: 'From leaf to cup.',
      look: { canvas: 'forest', icon: 'gold' },
      concepts: [{ id: 'leaf', label: 'Leaf' }, { id: cup.conceptId }],
      connections: [{ from: 'leaf', to: 'cup', label: 'becomes' }],
    });
    // Each call is one step on the board's own undo history.
    const stored = (
      await app.inject({
        url: `/v1/boards/${created.id}`,
        headers: { authorization: `Bearer ${adaKey}` },
      })
    ).json() as {
      snapshot: BoardSnapshot;
    };
    expect(stored.snapshot.past.map((past) => past?.nodes.length)).toEqual([0, 0, 1, 2]);
    expect((await call('opsis_list_boards')).json()).toEqual([
      expect.objectContaining({ id: created.id, title: 'Tea', visibility: 'private' }),
    ]);
    expect((await call('opsis_search_boards', { query: 'tea' })).json()).toEqual([
      expect.objectContaining({
        boardId: created.id,
        field: 'title',
        open: `http://localhost:3000/canvas?board=${created.id}`,
      }),
    ]);
  });

  it('adds, fills, hides and removes pages, editing any page in one undoable step', async () => {
    const created = (await call('opsis_create_board', { title: 'Pitch' })).json();
    const id = created.id as string;
    await call('opsis_write_diagram', {
      boardId: id,
      title: 'Pitch',
      description: 'Why it works.',
      concepts: [{ id: 'idea', label: 'Idea', summary: 'The idea.' }],
      connections: [],
    });
    expect((await call('opsis_get_board', { boardId: id, page: 2 })).isError).toBe(true);
    const pricing = (
      await call('opsis_add_page', { boardId: id, title: 'Pricing', hidden: true })
    ).json();
    expect(pricing).toMatchObject({ number: 2 });
    expect(pricing.open).toContain(`&page=${pricing.pageId}`);
    await call('opsis_write_diagram', {
      boardId: id,
      page: 2,
      title: 'Pitch',
      description: 'Why it works.',
      concepts: [
        { id: 'free', label: 'Free tier', summary: 'Try it.' },
        { id: 'pro', label: 'Pro', summary: 'Pay monthly.' },
      ],
      connections: [{ from: 'free', to: 'pro', label: 'upgrades' }],
    });
    await call('opsis_add_concept', {
      boardId: id,
      page: pricing.pageId,
      label: 'Team',
      summary: 'Per seat.',
      after: 'pro',
    });
    const roadmap = (await call('opsis_add_page', { boardId: id, title: 'Roadmap' })).json();
    await call('opsis_add_drawings', {
      boardId: id,
      page: roadmap.pageId,
      drawings: [{ shape: 'text', x: 0, y: 0, text: 'Q3' }],
    });
    await call('opsis_update_page', { boardId: id, page: roadmap.pageId, moveTo: 2 });

    const first = (await call('opsis_get_board', { boardId: id })).json();
    expect(first.concepts.map((c: { id: string }) => c.id)).toEqual(['idea']);
    expect(first.pages).toEqual([
      expect.objectContaining({ number: 1, title: 'Page 1', shownHere: true }),
      expect.objectContaining({ number: 2, title: 'Roadmap' }),
      expect.objectContaining({ number: 3, title: 'Pricing', hiddenFromViewers: true }),
    ]);
    const third = (await call('opsis_get_board', { boardId: id, page: 3 })).json();
    expect(third.concepts.map((c: { id: string }) => c.id)).toEqual(['free', 'pro', 'team']);
    expect(third.connections).toHaveLength(2);
    expect(
      (await call('opsis_get_board', { boardId: id, page: roadmap.pageId })).json().drawings,
    ).toHaveLength(1);
    expect((await call('opsis_search_boards', { query: 'team' })).json()[0]).toMatchObject({
      conceptId: 'team',
      pageId: pricing.pageId,
    });

    // Every tool call is one step on the whole board's undo history.
    const stored = (
      await app.inject({
        url: `/v1/boards/${id}`,
        headers: { authorization: `Bearer ${adaKey}` },
      })
    ).json() as { snapshot: BoardSnapshot };
    expect(stored.snapshot.past).toHaveLength(7);
    expect(stored.snapshot.past.every((board) => !board || board.title === 'Pitch')).toBe(true);

    expect((await call('opsis_remove_page', { boardId: id, page: 3 })).isError).toBe(false);
    expect((await call('opsis_get_board', { boardId: id })).json().pages).toHaveLength(2);
    expect((await call('opsis_remove_page', { boardId: id, page: 9 })).isError).toBe(true);
  });

  it('draws a scaled plan that the saved-board API accepts', async () => {
    const created = (await call('opsis_create_board', { title: 'Plant room' })).json();
    const added = (
      await call('opsis_add_drawings', {
        boardId: created.id,
        drawings: [
          { shape: 'rect', x: 0, y: 0, width: 480, height: 288, layer: 'Walls', line: 'solid' },
          {
            shape: 'dimension',
            points: [
              [0, 312],
              [480, 312],
            ],
          },
        ],
      })
    ).json();
    expect(added.drawingIds).toEqual(['rect-1', 'dimension-1']);
    await call('opsis_update_board', {
      boardId: created.id,
      drawingScale: { gridValue: 0.25, unit: 'm' },
    });
    await call('opsis_update_drawing', {
      boardId: created.id,
      drawingId: 'rect-1',
      ink: 'sky',
      fill: true,
    });
    const read = (await call('opsis_get_board', { boardId: created.id })).json();
    expect(read).toMatchObject({
      gridSquare: 24,
      scale: { gridValue: 0.25, unit: 'm' },
      layers: [{ name: 'Walls' }],
      drawings: [
        { id: 'rect-1', x: 0, y: 0, width: 480, ink: 'sky', fill: true, layer: 'Walls' },
        {
          id: 'dimension-1',
          points: [
            [0, 312],
            [480, 312],
          ],
        },
      ],
    });
    await call('opsis_remove_drawings', { boardId: created.id, drawingIds: ['dimension-1'] });
    const after = (await call('opsis_get_board', { boardId: created.id })).json();
    expect(after.drawings.map((item: { id: string }) => item.id)).toEqual(['rect-1']);
    const bad = await call('opsis_add_drawings', {
      boardId: created.id,
      drawings: [{ shape: 'text', x: 0, y: 0 }],
    });
    expect(bad).toMatchObject({
      isError: true,
      text: expect.stringMatching(/needs x, y and some text/),
    });
  });

  it('writes a whole diagram onto a new board and reports mistakes as tool errors', async () => {
    const written = (
      await call('opsis_write_diagram', {
        title: 'DNS',
        description: 'Names to numbers.',
        concepts: [
          { id: 'browser', label: 'Browser', summary: 'Asks for an address.', icon: 'globe' },
          { id: 'resolver', label: 'Resolver', summary: 'Finds the answer.', icon: 'server' },
        ],
        connections: [{ from: 'browser', to: 'resolver', label: 'asks', kind: 'request' }],
      })
    ).json();
    expect(written.created).toBe(true);
    const board = (await call('opsis_get_board', { boardId: written.id })).json();
    expect(board.concepts).toHaveLength(2);

    const missing = await call('opsis_remove_concept', { boardId: written.id, conceptId: 'cache' });
    expect(missing.isError).toBe(true);
    expect(missing.text).toMatch(/No concept "cache"/);
    const offline = await call('opsis_get_board', { boardId: crypto.randomUUID() });
    expect(offline).toMatchObject({ isError: true, text: expect.stringMatching(/No board/) });
  });

  it('reads a friend’s public board but cannot change it, and cannot see private ones', async () => {
    const bob = await account('Bob');
    const make = async (title: string) =>
      (
        await app.inject({
          method: 'POST',
          url: '/v1/boards',
          headers: { cookie: bob.cookie },
          payload: { title },
        })
      ).json() as { id: string; revision: number };
    const shared = await make('Bob’s rockets');
    const hidden = await make('Bob’s diary');
    await app.inject({
      method: 'PATCH',
      url: `/v1/boards/${shared.id}`,
      headers: { cookie: bob.cookie },
      payload: { visibility: 'public', revision: shared.revision },
    });
    expect((await call('opsis_list_public_boards')).json()).toEqual([
      expect.objectContaining({ id: shared.id, ownerName: 'Bob' }),
    ]);
    expect((await call('opsis_get_board', { boardId: shared.id })).json()).toMatchObject({
      title: 'Bob’s rockets',
      readOnly: true,
      owner: 'Bob',
    });
    const edit = await call('opsis_add_concept', {
      boardId: shared.id,
      label: 'Fin',
      summary: 'Keeps it straight.',
    });
    expect(edit).toMatchObject({ isError: true, text: expect.stringMatching(/someone else/) });
    expect((await call('opsis_get_board', { boardId: hidden.id })).isError).toBe(true);
  });

  it('files boards into collections without touching their revision or undo history', async () => {
    const networking = (await call('opsis_create_collection', { name: 'Networking' })).json();
    expect(networking).toMatchObject({ name: 'Networking' });
    const duplicate = await call('opsis_create_collection', { name: 'networking' });
    expect(duplicate).toMatchObject({ isError: true, text: expect.stringMatching(/already/) });

    const inside = (
      await call('opsis_create_board', { title: 'DNS', collectionId: networking.id })
    ).json();
    const loose = (await call('opsis_create_board', { title: 'Garden' })).json();
    expect((await call('opsis_list_collections')).json()).toEqual([
      { id: networking.id, name: 'Networking', boards: 1 },
    ]);
    expect(
      (await call('opsis_file_board', { boardId: loose.id, collectionId: networking.id })).json(),
    ).toMatchObject({ id: loose.id, collectionId: networking.id });
    const listed = (await call('opsis_list_boards')).json() as {
      id: string;
      collectionId: string | null;
      revision: number;
    }[];
    expect(
      listed.map(({ id, collectionId, revision }) => ({ id, collectionId, revision })),
    ).toEqual(
      expect.arrayContaining([
        { id: inside.id, collectionId: networking.id, revision: 1 },
        { id: loose.id, collectionId: networking.id, revision: 1 },
      ]),
    );
    expect((await call('opsis_list_collections')).json()[0].boards).toBe(2);

    await call('opsis_file_board', { boardId: loose.id, collectionId: null });
    expect((await call('opsis_list_collections')).json()[0].boards).toBe(1);
    const stored = (
      await app.inject({
        url: `/v1/boards/${loose.id}`,
        headers: { authorization: `Bearer ${adaKey}` },
      })
    ).json() as { revision: number; snapshot: BoardSnapshot };
    expect(stored.revision).toBe(1);
    expect(stored.snapshot.past).toEqual([]);

    const unknown = await call('opsis_file_board', {
      boardId: loose.id,
      collectionId: crypto.randomUUID(),
    });
    expect(unknown).toMatchObject({ isError: true, text: expect.stringMatching(/No collection/) });
    // Another account's board cannot be filed, even when it is public.
    const bob = await account('Bob');
    const theirs = (
      await app.inject({
        method: 'POST',
        url: '/v1/boards',
        headers: { cookie: bob.cookie },
        payload: { title: 'Bob’s rockets' },
      })
    ).json() as { id: string };
    const foreign = await call('opsis_file_board', {
      boardId: theirs.id,
      collectionId: networking.id,
    });
    expect(foreign).toMatchObject({ isError: true, text: expect.stringMatching(/only owners/) });
  });

  it('explains what to do without a usable agent key', async () => {
    const keyless = createServer(opsisClient('http://opsis.test', undefined, injectFetch), 'x:');
    const revoked = createServer(
      opsisClient('http://opsis.test', 'opsis_agent_revoked', injectFetch),
      'x:',
    );
    for (const [server, message] of [
      [keyless, /No agent key.*Agent keys/],
      [revoked, /rejected the agent key/],
    ] as const) {
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      const other = new Client({ name: 'other', version: '1.0.0' });
      await Promise.all([server.connect(serverSide), other.connect(clientSide)]);
      const result = await other.callTool({ name: 'opsis_list_boards', arguments: {} });
      expect(result.isError).toBe(true);
      expect((result.content as { text: string }[])[0]!.text).toMatch(message);
      await other.close();
    }
  });
});
