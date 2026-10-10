import { describe, expect, it } from 'vitest';
import { MAX_AGENT_DRAWINGS, type AgentDrawing } from './board-drawings';
import { boardOutputSchemaFor } from './board';
import { applySketchEdits } from './sketch-edits';

const note = (id: string, text = id): AgentDrawing => ({
  id,
  shape: 'text',
  x: 0,
  y: 0,
  text,
  ink: 'ink',
  line: 'solid',
  strokeWidth: 2,
});

describe('sketch edits', () => {
  it('replaces in place, removes, and adds new drawings last', () => {
    const result = applySketchEdits([note('a'), note('b'), note('c')], {
      put: [note('d'), note('b', 'B')],
      remove: ['a'],
    });
    expect(result.drawings).toEqual([note('b', 'B'), note('c'), note('d')]);
    expect(applySketchEdits([note('a')], { put: [], remove: [] }).drawings).toEqual([note('a')]);
  });

  it('refuses edits that do not fit the sketch', () => {
    const problems = (put: AgentDrawing[], remove: string[]) =>
      applySketchEdits([note('a')], { put, remove }).problems.join(' ');
    expect(problems([], ['z'])).toMatch(/z is not in it/);
    expect(problems([note('a')], ['a'])).toMatch(/both put and remove a/);
    expect(problems([note('b'), note('b')], [])).toMatch(/names b twice/);
    const many = Array.from({ length: MAX_AGENT_DRAWINGS }, (_, i) => note(`n${i}`));
    expect(problems(many, [])).toMatch(/at most 120 drawings/);
  });

  it('offers sketch edits only in the schema of a request that can use them', () => {
    const plain = JSON.parse(boardOutputSchemaFor({}));
    const both = JSON.parse(boardOutputSchemaFor({ focus: true, sketch: true }));
    expect(plain.properties.sketchEdits).toBeUndefined();
    expect(plain.properties.drawings.maxItems).toBe(MAX_AGENT_DRAWINGS);
    expect(both.properties.sketchEdits.properties.remove.type).toBe('array');
    expect(both.properties.focusEdits).toBeDefined();
    expect(boardOutputSchemaFor({ sketch: true })).toBe(boardOutputSchemaFor({ sketch: true }));
  });
});
