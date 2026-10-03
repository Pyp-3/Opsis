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
    url: url.pathname,
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
  app = buildApp({ databasePath: ':memory:', llm: null });
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
      'opsis_connect',
      'opsis_create_board',
      'opsis_disconnect',
      'opsis_get_board',
      'opsis_list_boards',
      'opsis_list_public_boards',
      'opsis_remove_concept',
      'opsis_update_board',
      'opsis_update_concept',
      'opsis_write_diagram',
    ]);
    const add = tools.find((tool) => tool.name === 'opsis_add_concept')!;
    expect(add.inputSchema.required).toEqual(['boardId', 'label', 'summary']);
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
