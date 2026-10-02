import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { TERMINAL_PIPELINE_EXAMPLE } from '@opsis/schema';
import { calculateInRust } from './runtime';
import { applyProcessResults, EngineRequestSchema, type EngineRequest } from './index';

const bytes = readFile(new URL('../dist/opsis_engine_bg.wasm', import.meta.url)).then(
  (value) => new Uint8Array(value).buffer,
);
const run = async (request: EngineRequest) => calculateInRust(request, await bytes);
const request = (): EngineRequest => ({
  version: 1,
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
      result.nodes[1]!.output.split('\n').slice(0, 10).join('\n') + '\n',
    );
    expect(result.nodes[2]!.retained).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(result.nodes[2]!.drawing.paths.filter((path) => !path.kept)).toHaveLength(2);
    expect(calculated.nodes[3]!.terminal!.output).toBe(calculated.nodes[2]!.terminal!.output);
    expect(board.nodes[2]!.terminal!.output).toBe('invented result');
  });
  it('recalculates connected previews when the source changes, including empty input', async () => {
    for (const text of ['nairobi\nkisumu\nmombasa', '']) {
      const input = request();
      input.nodes[0]!.process = { op: 'source', text };
      const result = await run(input);
      expect(result.nodes.every((node) => node.output === text)).toBe(true);
      const calculated = applyProcessResults(TERMINAL_PIPELINE_EXAMPLE, result);
      expect(calculated.nodes[2]!.terminal!.exampleInput).toBe(text || undefined);
    }
  });
  it('keeps provenance through sorting, literal filtering, adjacent uniq and tail', async () => {
    const result = await run({
      version: 1,
      nodes: [
        { id: 's', process: { op: 'source', text: 'zuri\nasha\nasha\nboni' } },
        { id: 'u', process: { op: 'unique', from: 's' } },
        { id: 'sorted', process: { op: 'sort', from: 'u', order: 'asc' } },
        { id: 'filter', process: { op: 'filter', from: 'sorted', text: 'a' } },
        { id: 'tail', process: { op: 'tail', from: 'sorted', count: 1 } },
      ],
    });
    expect(result.nodes[1]!.retained).toEqual([0, 1, 3]);
    expect(result.nodes[2]!.output).toBe('asha\nboni\nzuri\n');
    expect(result.nodes[2]!.retained).toEqual([1, 2, 0]);
    expect(result.nodes[3]!.output).toBe('asha\n');
    expect(result.nodes[4]!.output).toBe('zuri\n');
    expect(result.nodes[2]!.drawing.paths[0]!.d).toBe('M 6 9 C 42 9 78 29 114 29');
  });
  it('rejects invalid operations and graph cycles at the public boundary', () => {
    expect(
      EngineRequestSchema.safeParse({
        version: 1,
        nodes: [{ id: 's', process: { op: 'pass', from: 's' } }],
      }).success,
    ).toBe(false);
    expect(
      EngineRequestSchema.safeParse({
        version: 1,
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
