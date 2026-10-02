import { describe, expect, it } from 'vitest';
import { BoardGraphSchema, boardChanges } from './board';
import { ProcessStepSchema, processProblems, withoutBrokenProcesses } from './process';
import { TERMINAL_PIPELINE_EXAMPLE } from './terminal-example';

describe('calculated process contracts', () => {
  it('validates and round-trips operations while preserving older diagrams', () => {
    const board = BoardGraphSchema.parse(TERMINAL_PIPELINE_EXAMPLE);
    expect(BoardGraphSchema.parse(JSON.parse(JSON.stringify(board)))).toEqual(board);
    const older = {
      ...board,
      nodes: board.nodes.map((node) => {
        const copy = { ...node };
        delete copy.process;
        return copy;
      }),
    };
    expect(BoardGraphSchema.safeParse(older).success).toBe(true);
  });
  it('rejects missing calculated sources, cycles, oversized data and executable instructions', () => {
    const missing = structuredClone(TERMINAL_PIPELINE_EXAMPLE);
    missing.nodes[2]!.process = { op: 'head', from: 'missing', count: 10 };
    expect(BoardGraphSchema.safeParse(missing).success).toBe(false);
    const cycle = structuredClone(TERMINAL_PIPELINE_EXAMPLE);
    cycle.nodes[0]!.process = { op: 'pass', from: 'terminal-output' };
    expect(BoardGraphSchema.safeParse(cycle).success).toBe(false);
    expect(ProcessStepSchema.safeParse({ op: 'head', from: 'file', count: -1 }).success).toBe(
      false,
    );
    expect(ProcessStepSchema.safeParse({ op: 'head', from: 'file', count: 101 }).success).toBe(
      false,
    );
    expect(ProcessStepSchema.safeParse({ op: 'source', text: 'x'.repeat(1001) }).success).toBe(
      false,
    );
    expect(ProcessStepSchema.safeParse({ op: 'exec', command: 'cat users.txt' }).success).toBe(
      false,
    );
    expect(
      ProcessStepSchema.safeParse({ op: 'source', text: 'sample', path: 'users.txt' }).success,
    ).toBe(false);
    expect(
      processProblems([{ id: 'source', process: { op: 'source', text: 'x\n'.repeat(100) } }]),
    ).toEqual([]);
    expect(
      processProblems([{ id: 'source', process: { op: 'source', text: 'x\n'.repeat(101) } }]),
    ).not.toEqual([]);
  });
  it('requires review for operation changes and removes broken calculations transitively', () => {
    const changed = structuredClone(TERMINAL_PIPELINE_EXAMPLE);
    changed.nodes[2]!.process = { op: 'head', from: 'read-file', count: 2 };
    expect(boardChanges(TERMINAL_PIPELINE_EXAMPLE, changed)).toContain(
      'Change concept: first-lines',
    );
    const nodes = withoutBrokenProcesses(
      TERMINAL_PIPELINE_EXAMPLE.nodes.filter((node) => node.id !== 'read-file'),
    );
    expect(nodes.find((node) => node.id === 'users-file')?.process?.op).toBe('source');
    expect(nodes.find((node) => node.id === 'first-lines')?.process).toBeUndefined();
    expect(nodes.find((node) => node.id === 'terminal-output')?.process).toBeUndefined();
    expect(TERMINAL_PIPELINE_EXAMPLE.nodes[2]!.process?.op).toBe('head');
  });
});
