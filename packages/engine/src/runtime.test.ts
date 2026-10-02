import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { TERMINAL_PIPELINE_EXAMPLE } from '@opsis/schema';
import { calculateInRust } from './runtime';
import {
  applyProcessResults,
  EngineRequestSchema,
  type EngineRequest,
  type EngineResult,
  type ProcessResult,
} from './index';

const bytes = readFile(new URL('../dist/opsis_engine_bg.wasm', import.meta.url)).then(
  (value) => new Uint8Array(value).buffer,
);
const run = async (request: EngineRequest) => calculateInRust(request, await bytes);
const ok = (result: EngineResult, index: number): ProcessResult => {
  const node = result.nodes[index]!;
  if (node.status !== 'ok') throw new Error(`${node.id} failed: ${node.error.message}`);
  return node;
};
const request = (): EngineRequest => ({
  version: 3,
  nodes: TERMINAL_PIPELINE_EXAMPLE.nodes.map((node) => ({ id: node.id, process: node.process! })),
});

describe('actual Rust WebAssembly engine', () => {
  it('calculates every stage from one source, overwriting incorrect model output without mutating it', async () => {
    const board = structuredClone(TERMINAL_PIPELINE_EXAMPLE);
    board.nodes[2]!.terminal!.output = 'invented result';
    const result = await run(request());
    const calculated = applyProcessResults(board, result);
    expect(calculated.nodes[1]!.terminal!.output.split('\n')).toHaveLength(12);
    expect(calculated.nodes[2]!.terminal!.output).toBe(
      ok(result, 1).output.split('\n').slice(0, 10).join('\n') + '\n',
    );
    expect(ok(result, 2).origins).toEqual([[0], [1], [2], [3], [4], [5], [6], [7], [8], [9]]);
    expect(ok(result, 2).drawing.paths.filter((path) => !path.kept)).toHaveLength(2);
    expect(calculated.nodes[3]!.terminal!.output).toBe(calculated.nodes[2]!.terminal!.output);
    expect(board.nodes[2]!.terminal!.output).toBe('invented result');
  });
  it('recalculates connected previews when the source changes, including empty input', async () => {
    for (const text of ['nairobi\nkisumu\nmombasa', '']) {
      const input = request();
      input.nodes[0]!.process = { op: 'source', text };
      const result = await run(input);
      expect(result.nodes.every((node) => node.status === 'ok' && node.output === text)).toBe(true);
      const calculated = applyProcessResults(TERMINAL_PIPELINE_EXAMPLE, result);
      expect(calculated.nodes[2]!.terminal!.exampleInput).toBe(text || undefined);
    }
  });
  it('keeps provenance through sorting, literal filtering, adjacent uniq and tail', async () => {
    const result = await run({
      version: 3,
      nodes: [
        { id: 's', process: { op: 'source', text: 'zuri\nasha\nasha\nboni' } },
        { id: 'u', process: { op: 'unique', from: 's' } },
        { id: 'sorted', process: { op: 'sort', from: 'u', order: 'asc' } },
        { id: 'filter', process: { op: 'filter', from: 'sorted', text: 'a' } },
        { id: 'tail', process: { op: 'tail', from: 'sorted', count: 1 } },
      ],
    });
    expect(ok(result, 1).origins).toEqual([[0], [1], [3]]);
    expect(ok(result, 2).output).toBe('asha\nboni\nzuri\n');
    expect(ok(result, 2).origins).toEqual([[1], [2], [0]]);
    expect(ok(result, 3).output).toBe('asha\n');
    expect(ok(result, 4).output).toBe('zuri\n');
    expect(ok(result, 2).drawing.paths[0]!.d).toBe('M 6 9 C 42 9 78 29 114 29');
  });
  it('combines inputs and reshapes rows with the extended operations', async () => {
    const result = await run({
      version: 3,
      nodes: [
        { id: 'names', process: { op: 'source', text: 'asha\nzuri\nAsha' } },
        { id: 'ages', process: { op: 'source', text: '31\n9\n27' } },
        { id: 'rows', process: { op: 'paste', from: ['ages', 'names'], delimiter: ',' } },
        { id: 'by-age', process: { op: 'sort', from: 'rows', order: 'asc', numeric: true } },
        { id: 'name', process: { op: 'cut', from: 'by-age', fields: [2], delimiter: ',' } },
        { id: 'upper', process: { op: 'translate', from: 'name', set1: 'a-z', set2: 'A-Z' } },
        { id: 'counted', process: { op: 'unique', from: 'upper', withCounts: true } },
        { id: 'all', process: { op: 'concat', from: ['names', 'ages'] } },
        { id: 'total', process: { op: 'count', from: 'all' } },
      ],
    });
    expect(ok(result, 2).output).toBe('31,asha\n9,zuri\n27,Asha\n');
    expect(ok(result, 2).origins).toEqual([
      [0, 3],
      [1, 4],
      [2, 5],
    ]);
    expect(ok(result, 2).inputs).toEqual([
      { id: 'ages', rows: 3 },
      { id: 'names', rows: 3 },
    ]);
    expect(ok(result, 3).output).toBe('9,zuri\n27,Asha\n31,asha\n');
    expect(ok(result, 5).output).toBe('ZURI\nASHA\nASHA\n');
    expect(ok(result, 6).output).toBe('      1 ZURI\n      2 ASHA\n');
    expect(ok(result, 6).origins).toEqual([[0], [1, 2]]);
    expect(ok(result, 7).output).toBe('asha\nzuri\nAsha31\n9\n27');
    expect(ok(result, 8).output).toBe('4\n');
  });
  it('reports a failing step without discarding unrelated branches', async () => {
    const result = await run({
      version: 3,
      nodes: [
        { id: 's', process: { op: 'source', text: 'y\n'.repeat(99) + 'z'.repeat(802) } },
        { id: 'sorted', process: { op: 'sort', from: 's', order: 'asc' } },
        { id: 'after', process: { op: 'pass', from: 'sorted' } },
        { id: 'head', process: { op: 'head', from: 's', count: 1 } },
      ],
    });
    expect(result.nodes.map((node) => node.status)).toEqual(['ok', 'failed', 'failed', 'ok']);
    expect(result.nodes[1]).toMatchObject({ error: { code: 'output_too_long' } });
    expect(result.nodes[2]).toMatchObject({ error: { code: 'upstream_failed', source: 'sorted' } });
    expect(ok(result, 3).output).toBe('y\n');
    const board = {
      nodes: result.nodes.map((node) => ({
        id: node.id,
        label: node.id,
        terminal: { output: 'model preview' },
      })),
    } as unknown as Parameters<typeof applyProcessResults>[0];
    const calculated = applyProcessResults(board, result);
    expect(calculated.nodes[1]!.terminal!.output).toBe('model preview');
    expect(calculated.nodes[3]!.terminal!.output).toBe('y\n');
  });
  it('rejects invalid operations and graph cycles at the public boundary', () => {
    expect(
      EngineRequestSchema.safeParse({
        version: 3,
        nodes: [{ id: 's', process: { op: 'pass', from: 's' } }],
      }).success,
    ).toBe(false);
    expect(
      EngineRequestSchema.safeParse({
        version: 3,
        nodes: [{ id: 's', process: { op: 'exec', command: 'anything' } }],
      }).success,
    ).toBe(false);
  });
  it('returns stable results across repeated calls and multiple initializations', async () => {
    const results = await Promise.all([run(request()), run(request()), run(request())]);
    expect(results[0]).toEqual(results[1]);
    expect(results[1]).toEqual(results[2]);
  });
});
