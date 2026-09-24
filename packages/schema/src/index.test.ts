import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DrilldownRequestSchema,
  EntityKindSchema,
  ErrorResponseSchema,
  ExplainRequestSchema,
  ExplanationSchema,
  MetaphorIdSchema,
  OSGSchema,
  PACKAGE_NAME,
  PositionedSceneSchema,
  PrimitiveIdSchema,
  RelationTypeSchema,
  SaveOSGRequestSchema,
  SemanticGraphSchema,
  VisualizeProgressSchema,
  VisualizeRequestSchema,
  VisualNodeSchema,
  VisualPlanSchema,
  createCacheKey,
  createSgRef,
  countWords,
  generateJsonSchema,
  generatePromptJsonSchemas,
  stableHash,
  stableStringify,
  visualPlanSchemaFor,
} from './index';
import type { OSG, SemanticGraph, VisualPlan } from './index';

const fixtureRoot = resolve(import.meta.dirname, '../../../fixtures');
const schemaFixtureRoot = resolve(import.meta.dirname, '../fixtures');

function fixture<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolve(fixtureRoot, relativePath), 'utf8')) as T;
}

const sunSg = fixture<SemanticGraph>('sg/sun-east.sg.json');
const sandwichSg = fixture<SemanticGraph>('sg/sandwich.sg.json');
const sunOsg = fixture<OSG>('osg/sun-east.osg.json');
const sandwichOsg = fixture<OSG>('osg/sandwich.osg.json');

function clone<T>(value: T): T {
  return structuredClone(value);
}

describe('public contracts and North Star fixtures', () => {
  it('exports the package and complete enum sets', () => {
    expect(PACKAGE_NAME).toBe('@opsis/schema');
    expect(EntityKindSchema.options).toHaveLength(13);
    expect(RelationTypeSchema.options).toHaveLength(15);
    expect(MetaphorIdSchema.options).toHaveLength(10);
    expect(PrimitiveIdSchema.options).toHaveLength(30);
    expect(PrimitiveIdSchema.parse('labeled_card')).toBe('labeled_card');
  });

  it.each([
    ['sun SG', SemanticGraphSchema, sunSg],
    ['sandwich SG', SemanticGraphSchema, sandwichSg],
    ['sun OSG', OSGSchema, sunOsg],
    ['sandwich OSG', OSGSchema, sandwichOsg],
  ])('parses the valid %s fixture', (_name, schema, value) => {
    expect(schema.safeParse(value).success).toBe(true);
  });

  it('includes exploded positions and possible optional parts in the sandwich fixture', () => {
    const parts = sandwichOsg.scenes[0]?.nodes.filter((node) => node.role === 'part') ?? [];
    expect(parts).toHaveLength(4);
    expect(parts.every((node) => node.optional && node.explodable && node.explodedPosition)).toBe(
      true,
    );
  });

  it('parses every valid package fixture', () => {
    const valid = JSON.parse(
      readFileSync(resolve(schemaFixtureRoot, 'valid.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(visualPlanSchemaFor(sandwichSg).safeParse(valid.visualPlan).success).toBe(true);
    expect(VisualPlanSchema.safeParse(valid.visualPlan).success).toBe(true);
    expect(ExplanationSchema.safeParse(valid.explanation).success).toBe(true);
    expect(VisualizeRequestSchema.safeParse(valid.visualizeRequest).success).toBe(true);
    expect(ExplainRequestSchema.safeParse(valid.explainRequest).success).toBe(true);
    expect(DrilldownRequestSchema.safeParse(valid.drilldownRequest).success).toBe(true);
    expect(ErrorResponseSchema.safeParse(valid.error).success).toBe(true);
  });

  it('fails every invalid package fixture with its expected rule', () => {
    const invalid = JSON.parse(
      readFileSync(resolve(schemaFixtureRoot, 'invalid.json'), 'utf8'),
    ) as { schema: string; expectedRule: string; value: Record<string, unknown> }[];
    const schemas = {
      visualizeRequest: VisualizeRequestSchema,
      explanation: ExplanationSchema,
      error: ErrorResponseSchema,
    } as const;
    invalid[0]!.value.utterance = 'x'.repeat(501);
    for (const example of invalid) {
      const schema = schemas[example.schema as keyof typeof schemas];
      const result = schema.safeParse(example.value);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.message === example.expectedRule)).toBe(
          true,
        );
      }
    }
  });
});

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

describe('VisualPlan and OSG contextual rules', () => {
  const validPlan: VisualPlan = {
    schemaVersion: 'vp/1',
    sgRef: 'sg_fixture',
    anchor: 'e_sandwich',
    scenes: sandwichOsg.scenes.map((scene) => ({
      id: scene.id,
      metaphor: scene.metaphor,
      nodes: scene.nodes.map((node) => VisualNodeSchema.strip().parse(node)),
      edges: scene.edges,
      camera: scene.camera,
      dimension: scene.dimension,
    })),
  };

  it('accepts optional nodes backed by possible relations', () => {
    expect(visualPlanSchemaFor(sandwichSg).safeParse(validPlan).success).toBe(true);
  });

  it('rejects optional nodes without a possible relation', () => {
    const graph = clone(sandwichSg);
    graph.relations[0]!.modality = 'certain';
    const result = visualPlanSchemaFor(graph).safeParse(validPlan);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0]?.message).toBe(
        'optional nodes must be targets of a possible relation',
      );
  });

  it('does not require non-optional nodes to have possible relations', () => {
    const plan = clone(validPlan);
    plan.scenes[0]!.nodes.forEach((node) => {
      node.optional = false;
    });
    const graph = clone(sandwichSg);
    graph.relations.forEach((relation) => {
      relation.modality = 'certain';
    });
    expect(visualPlanSchemaFor(graph).safeParse(plan).success).toBe(true);
  });

  it('rejects a plan anchor absent from all scenes', () => {
    const plan = clone(validPlan);
    plan.anchor = 'missing';
    const result = visualPlanSchemaFor(sandwichSg).safeParse(plan);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0]?.message).toBe('plan anchor must reference a scene node');
  });

  it('enforces optional modality within an OSG', () => {
    const osg = clone(sandwichOsg);
    osg.sg.relations[0]!.modality = 'certain';
    const result = OSGSchema.safeParse(osg);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues.map((issue) => issue.message)).toContain(
        'optional nodes must be targets of a possible relation',
      );
  });
});

describe('Explanation and API schemas', () => {
  const explanation = {
    schemaVersion: 'exp/1',
    nodeId: 'e_sun',
    osgId: sunOsg.id,
    level: 'explanation',
    audience: 'child',
    summary: 'The Sun appears to rise as Earth turns.',
    sections: {
      whatItIs: 'The Sun is our nearest star.',
      whyItMattersHere: 'It appears near the eastern horizon.',
      howItWorks: 'Earth rotates.',
      funFact: 'A day is one full rotation.',
      commonMisconception: 'The Sun does not travel around Earth each day.',
    },
    confidence: 'high',
    suggestedDrillDown: ['Earth rotation'],
  };

  it('parses explanation, request, error, progress, and save bodies', () => {
    expect(ExplanationSchema.safeParse(explanation).success).toBe(true);
    expect(
      VisualizeRequestSchema.safeParse({
        utterance: 'A tree has leaves.',
        audience: 'teen',
        seed: 4,
      }).success,
    ).toBe(true);
    expect(
      ExplainRequestSchema.safeParse({
        osgId: sunOsg.id,
        nodeId: 'e_sun',
        level: 'summary',
        audience: 'adult',
      }).success,
    ).toBe(true);
    expect(DrilldownRequestSchema.safeParse({ osgId: sunOsg.id, nodeId: 'e_sun' }).success).toBe(
      true,
    );
    expect(
      ErrorResponseSchema.safeParse({
        code: 'INVALID',
        message: 'No',
        stage: 'parsing',
        retryable: false,
      }).success,
    ).toBe(true);
    expect(VisualizeProgressSchema.safeParse('done').success).toBe(true);
    expect(SaveOSGRequestSchema.safeParse(sunOsg).success).toBe(true);
  });

  it('rejects overlong input and explanation summaries', () => {
    expect(VisualizeRequestSchema.safeParse({ utterance: 'x'.repeat(501) }).success).toBe(false);
    expect(
      ExplanationSchema.safeParse({
        ...explanation,
        summary: Array.from({ length: 26 }, () => 'word').join(' '),
      }).success,
    ).toBe(false);
  });
});

describe('JSON Schema and stable hashes', () => {
  it('generates named draft-07 prompt schemas individually and together', () => {
    const semanticGraph = generateJsonSchema('semanticGraph');
    expect(semanticGraph.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(semanticGraph.definitions?.semanticGraph).toBeDefined();
    expect(Object.keys(generatePromptJsonSchemas())).toEqual([
      'semanticGraph',
      'visualPlan',
      'osg',
      'explanation',
      'error',
    ]);
  });

  it('canonicalizes nested object keys, arrays, null, and undefined properties', () => {
    const left = { z: null, b: [{ y: 2, x: 1 }], omitted: undefined, a: 'value' };
    const right = { a: 'value', b: [{ x: 1, y: 2 }], z: null };
    expect(stableStringify(left)).toBe(stableStringify(right));
    expect(stableHash(left)).toBe(stableHash(right));
    expect(stableHash(left)).toMatch(/^[0-9a-f]{16}$/u);
  });

  it('creates stable SG references and cache keys sensitive to every input', () => {
    expect(createSgRef(sunSg)).toBe(createSgRef(clone(sunSg)));
    const key = createCacheKey('parse', { text: 'sun' }, { temperature: 0 }, 'model-a');
    expect(key).toBe(createCacheKey('parse', { text: 'sun' }, { temperature: 0 }, 'model-a'));
    expect(key).not.toBe(createCacheKey('layout', { text: 'sun' }, { temperature: 0 }, 'model-a'));
  });
});
