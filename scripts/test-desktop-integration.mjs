import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { buildApp } from '../apps/api/src/app.ts';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/mcp/package.json'));
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const directory = mkdtempSync(join(tmpdir(), 'opsis-native-integration-'));
const sourcePath = join(directory, 'original.sqlite');
const target = join(directory, 'desktop');
const binary = resolve(root, process.env.OPSIS_QA_DESKTOP_BINARY ?? 'output/desktop/opsis');
const env = {
  ...process.env,
  OPSIS_DATA_DIR: target,
  OPSIS_DB_PATH: join(target, 'opsis.sqlite'),
  OPSIS_SPEECH: 'off',
  OPSIS_RATE_LIMIT: '10000',
  PORT: '0',
};
const original = buildApp({ databasePath: sourcePath, speech: null, logger: false });
let server;
let mcp;
let serverExited;
try {
  // Create actual legacy application records with Node's existing scrypt/SQLite implementation.
  const email = 'migration@example.test';
  const signup = await original.inject({
    method: 'POST',
    url: '/v1/auth/signup',
    payload: { name: 'Migration', email, password: 'Ａ-test-password' },
  });
  assert.equal(signup.statusCode, 201);
  const cookie = signup.headers['set-cookie'].split(';')[0];
  const old = async (method, url, payload) =>
    original.inject({ method, url, payload, headers: { cookie } });
  const created = await old('POST', '/v1/boards', { title: 'Before migration' });
  assert.equal(created.statusCode, 201);
  const id = created.json().id;
  assert.equal(
    (
      await old('PATCH', `/v1/boards/${id}`, {
        title: 'Preserved history',
        visibility: 'public',
        revision: 1,
      })
    ).statusCode,
    200,
  );
  const template = await old('POST', '/v1/templates', {
    title: 'Existing template',
    boardId: id,
    revision: 2,
  });
  assert.equal(template.statusCode, 201);
  const key = (await old('POST', '/v1/auth/agent-keys', { name: 'Migration integration' })).json();
  const imported = spawn(binary, ['--import-database', sourcePath], {
    env,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  assert.equal((await once(imported, 'exit'))[0], 0);
  // Source remains open throughout import, exercising the real WAL boundary.
  assert.equal((await old('GET', `/v1/boards/${id}`)).json().revision, 2);
  await original.close();

  server = spawn(binary, ['--serve'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  serverExited = once(server, 'exit');
  const address = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Native server startup timed out')), 30000);
    let output = '';
    server.stdout.on('data', (data) => {
      output += data.toString();
      const match = output.match(/Opsis listening on (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    server.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    server.once('exit', () => {
      clearTimeout(timer);
      reject(new Error('Native server exited during startup'));
    });
  });
  const request = async (method, path, body, session = cookie) =>
    fetch(address + path, {
      method,
      headers: { 'content-type': 'application/json', cookie: session },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  assert.equal((await request('GET', '/v1/auth/me')).status, 200, 'imported Node session');
  const login = await request('POST', '/v1/auth/login', { email, password: 'A-test-password' }, '');
  assert.equal(login.status, 200, 'Node password hash and NFKC normalization');
  const board = await (await request('GET', `/v1/boards/${id}`)).json();
  assert.equal(board.revision, 2);
  assert.equal(board.visibility, 'public');
  assert.equal(board.snapshot.board.title, 'Preserved history');
  assert.equal(board.snapshot.past.length, 1);
  assert.equal((await (await request('GET', '/v1/templates')).json()).length, 1);

  // The TypeScript SDK talks to the packaged Go SDK over actual stdio.
  mcp = new Client({ name: 'opsis-migration-test', version: '1' });
  const mcpEnv = { ...env, OPSIS_AGENT_KEY: key.key };
  delete mcpEnv.OPSIS_API_URL; // Exercise profile-based endpoint discovery.
  delete mcpEnv.OPSIS_WEB_URL;
  await mcp.connect(
    new StdioClientTransport({ command: binary, args: ['--mcp'], env: mcpEnv, stderr: 'inherit' }),
  );
  assert.equal((await mcp.listTools()).tools.length, 27);
  const call = async (name, args) => {
    const result = await mcp.callTool({ name, arguments: args });
    assert.ok(!result.isError, `MCP ${name} failed`);
    return JSON.parse(result.content[0].text);
  };
  assert.equal(
    (await call('opsis_get_board', { boardId: id })).open,
    `${address}/canvas?board=${id}`,
  );
  await call('opsis_add_concept', {
    boardId: id,
    label: 'Native MCP',
    summary: 'One undoable edit',
  });
  const edited = await (await request('GET', `/v1/boards/${id}`)).json();
  assert.equal(edited.revision, 3);
  assert.equal(edited.snapshot.past.length, 2);
  assert.equal(edited.snapshot.board.nodes.length, 1);
  // Board previews: the packaged Node service rasterises with its bundled sharp.
  const preview = await mcp.callTool({ name: 'opsis_render_board', arguments: { boardId: id } });
  assert.ok(!preview.isError, 'MCP opsis_render_board failed');
  assert.equal(preview.content[0].type, 'image', 'packaged runtime renders a PNG preview');
  assert.equal(Buffer.from(preview.content[0].data, 'base64').subarray(1, 4).toString(), 'PNG');
  assert.equal((await request('DELETE', `/v1/auth/agent-keys/${key.id}`)).status, 204);
  assert.ok(
    (await mcp.callTool({ name: 'opsis_list_boards', arguments: {} })).isError,
    'revoked imported key rejected',
  );
  console.log(
    'Native integration passed: live database import, accounts, sessions, history, templates, stdio MCP, board previews, endpoint discovery and revocation.',
  );
} finally {
  await mcp?.close();
  await original.close();
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await Promise.race([serverExited, delay(7000)]);
    if (server.exitCode === null && server.signalCode === null) {
      server.kill('SIGKILL');
      await serverExited;
    }
  }
  rmSync(directory, { recursive: true, force: true });
}
