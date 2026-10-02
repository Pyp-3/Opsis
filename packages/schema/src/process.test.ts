import { describe, expect, it } from 'vitest';
import { BoardGraphSchema, boardChanges } from './board';
import {
  ProcessStepSchema,
  processProblems,
  processSources,
  withoutBrokenProcesses,
} from './process';
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
  it('validates the extended operations and follows every input of combining steps', () => {
    const valid = [
      { op: 'sort', from: 's', order: 'asc', numeric: true, ignoreCase: false },
      { op: 'filter', from: 's', text: 'x', ignoreCase: true, invert: true },
      { op: 'unique', from: 's', withCounts: true },
      { op: 'count', from: 's' },
      { op: 'cut', from: 's', fields: [1, 3], delimiter: ',' },
      { op: 'translate', from: 's', set1: 'a-z', set2: 'A-Z' },
      { op: 'concat', from: ['a', 'b'] },
      { op: 'paste', from: ['a', 'b', 'a'], delimiter: ',' },
    ];
    for (const step of valid) expect(ProcessStepSchema.safeParse(step).success).toBe(true);
    const invalid = [
      { op: 'cut', from: 's', fields: [] },
      { op: 'cut', from: 's', fields: [0] },
      { op: 'cut', from: 's', fields: [1], delimiter: ',,' },
      { op: 'paste', from: ['a', 'b'], delimiter: '\n' },
      { op: 'translate', from: 's', set1: 'a\n', set2: 'b' },
      { op: 'concat', from: ['a'] },
      { op: 'concat', from: 'a' },
      { op: 'sort', from: 's', order: 'asc', numeric: 'yes' },
    ];
    for (const step of invalid) expect(ProcessStepSchema.safeParse(step).success).toBe(false);
    expect(processSources({ op: 'paste', from: ['a', 'b'] })).toEqual(['a', 'b']);
    expect(processSources({ op: 'head', from: 'a', count: 1 })).toEqual(['a']);
    expect(processSources({ op: 'source', text: '' })).toEqual([]);

    const nodes = [
      { id: 'a', process: { op: 'source' as const, text: 'x' } },
      { id: 'b', process: { op: 'source' as const, text: 'y' } },
      { id: 'joined', process: { op: 'paste' as const, from: ['a', 'b'] } },
      { id: 'total', process: { op: 'count' as const, from: 'joined' } },
    ];
    expect(processProblems(nodes)).toEqual([]);
    expect(processProblems(nodes.filter((node) => node.id !== 'b'))).toEqual([
      'Process source b must name a node with a process step.',
    ]);
    expect(
      processProblems([
        ...nodes,
        { id: 'loop', process: { op: 'concat' as const, from: ['a', 'loop'] } },
      ]),
    ).toEqual(['Calculated process steps must not form a cycle.']);
    const pruned = withoutBrokenProcesses(nodes.filter((node) => node.id !== 'b'));
    expect(pruned.map((node) => node.id)).toEqual(['a', 'joined', 'total']);
    expect(pruned.find((node) => node.id === 'a')?.process).toBeDefined();
    expect(pruned.find((node) => node.id === 'joined')?.process).toBeUndefined();
    expect(pruned.find((node) => node.id === 'total')?.process).toBeUndefined();
  });
});
