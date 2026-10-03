import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  OSGSchema,
  SemanticGraphSchema,
  PositionedSceneSchema,
  countWords,
  type OSG,
} from './legacy-osg';
const fixture = (name: string): OSG =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../fixtures/osg', name), 'utf8'));
const sunOsg = fixture('sun-east.osg.json');
const sandwichOsg = fixture('sandwich.osg.json');
const sunSg = sunOsg.sg;
function clone<T>(value: T): T {
  return structuredClone(value);
}
describe('SemanticGraph validation rules', () => {
  it('rejects duplicate entity ids', () => {
    const graph = clone(sunSg);
    graph.entities[1]!.id = graph.entities[0]!.id;
    const result = SemanticGraphSchema.safeParse(graph);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(
        result.error.issues.some((issue) => issue.message === 'entity ids must be unique'),
      ).toBe(true);
  });

  it.each(['source', 'target'] as const)('rejects a missing relation %s', (endpoint) => {
    const graph = clone(sunSg);
    graph.relations[0]![endpoint] = 'e_missing';
    const result = SemanticGraphSchema.safeParse(graph);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toContain(`relation ${endpoint}`);
  });

  it('rejects summaries over 25 words and accepts exactly 25', () => {
    const graph = clone(sunSg);
    graph.entities[0]!.summary = Array.from({ length: 25 }, () => 'word').join(' ');
    expect(SemanticGraphSchema.safeParse(graph).success).toBe(true);
    graph.entities[0]!.summary += ' extra';
    const result = SemanticGraphSchema.safeParse(graph);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0]?.message).toBe('summary must contain at most 25 words');
  });

  it('counts empty and whitespace-delimited text', () => {
    expect(countWords('   ')).toBe(0);
    expect(countWords('one\ttwo\nthree')).toBe(3);
  });
});

describe('scene cross-field validation rules', () => {
  it('rejects duplicate ids, missing endpoints, and multiple anchors', () => {
    const scene = clone(sunOsg.scenes[0]!);
    scene.nodes[1]!.id = scene.nodes[0]!.id;
    scene.nodes[1]!.role = 'anchor';
    scene.edges[0]!.from = 'missing_from';
    scene.edges[0]!.to = 'missing_to';
    const result = PositionedSceneSchema.safeParse(scene);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages).toContain('node ids must be unique within a scene');
      expect(messages).toContain('scene must contain exactly one anchor');
      expect(messages).toContain('edge from must reference an existing node');
      expect(messages).toContain('edge to must reference an existing node');
    }
  });

  it('rejects a scene with no anchor', () => {
    const scene = clone(sunOsg.scenes[0]!);
    scene.nodes[0]!.role = 'context';
    const result = PositionedSceneSchema.safeParse(scene);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0]?.message).toBe('scene must contain exactly one anchor');
  });

  it('rejects labels over four words', () => {
    const scene = clone(sunOsg.scenes[0]!);
    scene.nodes[0]!.label = 'one two three four five';
    const result = PositionedSceneSchema.safeParse(scene);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0]?.message).toBe('label must contain at most 4 words');
  });

  it.each([Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects non-finite position %s',
    (coordinate) => {
      const scene = clone(sunOsg.scenes[0]!);
      scene.nodes[0]!.position[0] = coordinate;
      const result = PositionedSceneSchema.safeParse(scene);
      expect(result.success).toBe(false);
      if (!result.success)
        expect(
          result.error.issues.some(
            (issue) => issue.message === 'positions must contain only finite numbers',
          ),
        ).toBe(true);
    },
  );

  it('rejects NaN positions at the numeric boundary', () => {
    const scene = clone(sunOsg.scenes[0]!);
    scene.nodes[0]!.position[0] = Number.NaN;
    expect(PositionedSceneSchema.safeParse(scene).success).toBe(false);
  });

  it('rejects inverted bounds and positions outside them', () => {
    const scene = clone(sunOsg.scenes[0]!);
    scene.bounds.min = [1, 1, 1];
    scene.bounds.max = [-1, -1, -1];
    const result = PositionedSceneSchema.safeParse(scene);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages).toContain('bounds minimum must not exceed maximum');
      expect(messages).toContain('bounds must contain all nodes');
    }
  });

  it('rejects positions beyond otherwise ordered bounds', () => {
    const scene = clone(sunOsg.scenes[0]!);
    scene.nodes[0]!.position = [100, -100, 100];
    const result = PositionedSceneSchema.safeParse(scene);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(
        result.error.issues.filter((issue) => issue.message === 'bounds must contain all nodes'),
      ).toHaveLength(3);
  });
});

describe('legacy import contract', () => {
  it.each([sunOsg, sandwichOsg])('accepts existing OSG documents', (osg) => {
    expect(OSGSchema.safeParse(osg).success).toBe(true);
  });
  it('rejects optional nodes without possible relations', () => {
    const osg = clone(sandwichOsg);
    osg.sg.relations[0]!.modality = 'certain';
    expect(OSGSchema.safeParse(osg).success).toBe(false);
  });
  it('rejects unknown fields instead of silently discarding them', () => {
    expect(OSGSchema.safeParse({ ...sunOsg, unexpected: true }).success).toBe(false);
  });
});
