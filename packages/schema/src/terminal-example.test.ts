import { describe, expect, it } from 'vitest';
import { BoardDocumentSchema, BoardGraphSchema, TerminalStepSchema, boardChanges } from './board';
import { terminalExampleFor, TERMINAL_PIPELINE_EXAMPLE } from './terminal-example';

describe('terminal-flow foundation', () => {
  it('uses one consistent sample file and shows the first ten records without placeholders', () => {
    const read = TERMINAL_PIPELINE_EXAMPLE.nodes[1]!.terminal!;
    const head = TERMINAL_PIPELINE_EXAMPLE.nodes[2]!.terminal!;
    const result = TERMINAL_PIPELINE_EXAMPLE.nodes[3]!.terminal!;
    expect(read.output.split('\n')).toHaveLength(12);
    expect(head.exampleInput).toBe(read.output);
    expect(head.output).toBe(read.output.split('\n').slice(0, 10).join('\n'));
    expect(result.output).toBe(head.output);
    expect(result.output).not.toMatch(/\[line|\.\.\.|…/i);
  });
  it.each([
    'cat users.txt | head -10',
    'cat users.txt | head -n 10',
    'What does `cat users.txt | head -10` do?',
    '`cat users.txt | head -10` what does it do?',
    'Explain cat users.txt | head -10',
  ])('recognises the reference question: %s', (prompt) => {
    expect(terminalExampleFor(prompt)?.nodes).toHaveLength(4);
  });
  it.each([
    'cat secrets.txt | head -10',
    'cat users.txt | head -10; rm users.txt',
    'cat users.txt | head -10 > output.txt',
    'cat $(whoami) | head -10',
    'Tell me about head -10 in general',
  ])('does not pretend to parse an unsupported command: %s', (prompt) => {
    expect(terminalExampleFor(prompt)).toBeNull();
  });
  it('validates and persists the reference data without mutating the shared fixture', () => {
    expect(terminalExampleFor('cat users.txt | head -n 10')!.nodes[2]!.terminal!.command).toBe(
      'head -n 10',
    );
    const graph = BoardGraphSchema.parse(TERMINAL_PIPELINE_EXAMPLE);
    const document = BoardDocumentSchema.parse({
      ...graph,
      version: 2,
      agent: 'claude',
      positions: {},
    });
    expect(
      BoardDocumentSchema.parse(JSON.parse(JSON.stringify(document))).nodes[1]!.terminal?.issues,
    ).toHaveLength(3);
    expect(terminalExampleFor('cat users.txt | head -10', document)).toBeNull();
    expect(terminalExampleFor('cat users.txt | head -10', null, true)).toBeNull();
    const copy = terminalExampleFor('cat users.txt | head -10')!;
    copy.nodes[1]!.terminal!.command = 'changed';
    expect(TERMINAL_PIPELINE_EXAMPLE.nodes[1]!.terminal!.command).toBe('cat users.txt');
  });
  it('requires review for command metadata changes and rejects oversized issue data', () => {
    const candidate = structuredClone(TERMINAL_PIPELINE_EXAMPLE);
    candidate.nodes[1]!.terminal!.command = 'other-command';
    expect(boardChanges(TERMINAL_PIPELINE_EXAMPLE, candidate)).toContain(
      'Change concept: read-file',
    );
    const step = TERMINAL_PIPELINE_EXAMPLE.nodes[1]!.terminal!;
    expect(TerminalStepSchema.safeParse({ ...step, command: 'x'.repeat(241) }).success).toBe(false);
    expect(TerminalStepSchema.safeParse({ ...step, execute: true }).success).toBe(false);
  });
});
