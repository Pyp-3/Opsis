/** Opt-in only: at most three paid CLI completions, including server repair attempts. */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { buildApp } from '../apps/api/src/app';
import { localBoardClient } from '../apps/api/src/boards';
import { BoardGraphSchema } from '../packages/schema/src/board';

if (process.env.OPSIS_LIVE_OPUS !== '1')
  throw new Error('Set OPSIS_LIVE_OPUS=1 to authorize up to three Opus completions.');
let completions = 0;
const started = Date.now();
const app = buildApp({
  databasePath: ':memory:',
  llm: null,
  boardClientFactory: async (agent, settings) => {
    assert.equal(agent, 'claude');
    assert.equal(settings?.model, 'opus');
    const client = await localBoardClient(agent, settings);
    return {
      model: client.model,
      complete: async (request, signal) => {
        if (completions >= 3) throw new Error('Live smoke completion budget exhausted');
        completions++;
        return client.complete(request, signal);
      },
    };
  },
});
const results: unknown[] = [];
try {
  const settings = { model: 'opus', effort: 'medium' };
  const initial = await app.inject({
    method: 'POST',
    url: '/v1/boards/generate',
    payload: {
      agent: 'claude',
      settings,
      prompt:
        'Explain parcel delivery with a sender, carrier, recipient and delivery confirmation returning to the sender. Use 4–6 nodes, explicit requests and responses, concise summaries and explanations under 40 words each. Include two useful follow-up suggestions.',
    },
  });
  assert.equal(initial.statusCode, 200, initial.body);
  const graph = BoardGraphSchema.parse(initial.json());
  assert.ok(graph.edges.some((edge) => edge.kind === 'response'));
  results.push({ operation: 'initial', status: initial.statusCode, graph });
  console.log(
    JSON.stringify({
      operation: 'initial',
      status: initial.statusCode,
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      completions,
    }),
  );
  const followup = await app.inject({
    method: 'POST',
    url: '/v1/boards/generate',
    payload: {
      agent: 'claude',
      settings,
      board: { ...graph, version: 2, agent: 'claude', positions: {} },
      prompt:
        'Add one failed-delivery decision and a retry edge back to the carrier. Preserve every existing node, edge, ID, title and description exactly. Use concise new explanations under 40 words. Update the suggestions.',
    },
  });
  assert.ok([200, 409].includes(followup.statusCode), followup.body);
  const payload = followup.json();
  const next = BoardGraphSchema.parse(followup.statusCode === 409 ? payload.candidate : payload);
  assert.ok(next.edges.some((edge) => edge.kind === 'retry'));
  if (followup.statusCode === 200) {
    for (const node of graph.nodes)
      assert.deepEqual(
        next.nodes.find((item) => item.id === node.id),
        node,
      );
    for (const edge of graph.edges)
      assert.deepEqual(
        next.edges.find((item) => item.id === edge.id),
        edge,
      );
  } else assert.ok(payload.changes.length > 0);
  results.push({
    operation: 'followup',
    status: followup.statusCode,
    changes: payload.changes ?? [],
    graph: next,
  });
  console.log(
    JSON.stringify({
      operation: 'followup',
      status: followup.statusCode,
      nodes: next.nodes.length,
      edges: next.edges.length,
      completions,
    }),
  );
} finally {
  const directory = resolve('output/qa');
  await mkdir(directory, { recursive: true });
  await writeFile(
    resolve(directory, 'opus-smoke.json'),
    JSON.stringify(
      { model: 'opus', effort: 'medium', completions, elapsedMs: Date.now() - started, results },
      null,
      2,
    ),
  );
  await app.close();
}
