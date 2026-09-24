import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MockLLMClient, ruleBasedParse } from '@opsis/parse';
import {
  SemanticGraphSchema,
  visualPlanSchemaFor,
  type Entity,
  type MetaphorId,
  type PrimitiveId,
  type SceneIntent,
  type SemanticGraph,
} from '@opsis/schema';
import {
  COMPASS_3D_CAPABILITY,
  curateScene,
  MAX_3D_NODES,
  RENDERER_CAPABILITIES,
  type CurateContext,
} from './curate';
import type { PrimitiveChoice } from './primitives';
import { selectMetaphor, selectMetaphorOffline } from './select';

const FIXTURES = new URL('../fixtures/', import.meta.url);
const GOLDEN = new URL('../../../../fixtures/golden/', import.meta.url);

function loadSg(name: string): SemanticGraph {
  return SemanticGraphSchema.parse(
    JSON.parse(readFileSync(new URL(`${name}.sg.json`, FIXTURES), 'utf8')),
  );
}

const CERTIFIED = { [COMPASS_3D_CAPABILITY]: true };

type NodeSpec = { id: string; primitive: PrimitiveId; kind?: Entity['kind']; low?: boolean };

/** A one-scene context: first node is the entity anchor, the rest are parts. */
function sceneOf(
  metaphor: MetaphorId,
  specs: NodeSpec[],
  source: PrimitiveChoice['source'] = 'keyword',
): { scene: SceneIntent; ctx: CurateContext } {
  const sg: SemanticGraph = {
    schemaVersion: 'sg/1',
    utterance: specs.map((s) => s.id).join(' '),
    language: 'en',
    entities: specs.map((s, i) => ({
      id: s.id,
      surface: s.id,
      lemma: s.id,
      kind: s.kind ?? 'object',
      span: [i, i + 1],
      summary: s.id,
      ...(s.low ? { attributes: { confidence: 'low' } } : {}),
    })),
    relations: [],
  };
  const scene: SceneIntent = {
    id: 'scene_1',
    metaphor,
    nodes: specs.map((s, i) => ({
      id: s.id,
      primitive: s.primitive,
      label: s.id,
      role: i === 0 ? 'anchor' : 'part',
    })),
    edges: [],
    camera: 'iso',
    dimension: '2d',
  };
  const choices = new Map(
    specs.map((s): [string, PrimitiveChoice] => [
      s.id,
      { primitive: s.primitive, source, score: 1 },
    ]),
  );
  return { scene, ctx: { sg, choices } };
}

const SANDWICH: NodeSpec[] = [
  { id: 'e_sandwich', primitive: 'group_frame' },
  { id: 'e_bread', primitive: 'bread_slice' },
  { id: 'e_ham', primitive: 'generic_layer' },
];

describe('curated 3D eligibility (D-004)', () => {
  it('lets a stack of solid, confident parts open in 3D', () => {
    const { scene, ctx } = sceneOf('stack', SANDWICH);
    expect(curateScene(scene, ctx)).toEqual({
      sceneId: 'scene_1',
      dimension: '3d',
      reasons: ['eligible'],
      rationale: '3d: stack of solid parts passes dimension-curator/v1',
    });
  });

  it.each<MetaphorId>(['flow', 'timeline', 'cycle', 'tree', 'scale', 'map', 'actor_action'])(
    'keeps %s flat whatever its primitives (condition 1)',
    (metaphor) => {
      const { scene, ctx } = sceneOf(metaphor, SANDWICH);
      const decision = curateScene(scene, { ...ctx, capabilities: CERTIFIED });
      expect(decision.dimension).toBe('2d');
      expect(decision.reasons).toEqual(['metaphor_not_spatial']);
    },
  );

  it.each<PrimitiveId>(['labeled_card', 'cycle_ring', 'bar'])(
    'keeps a container with a %s part flat (condition 2)',
    (primitive) => {
      const { scene, ctx } = sceneOf('container', [...SANDWICH, { id: 'e_x', primitive }]);
      const decision = curateScene(scene, ctx);
      expect(decision).toMatchObject({ dimension: '2d', reasons: ['flat_primitive'] });
      expect(decision.rationale).toBe('2d: no solid primitive for e_x');
    },
  );

  it('treats an unknown entity (labeled_card fallback) as flat, so it stays renderable in 2D', () => {
    const { scene, ctx } = sceneOf('stack', [
      ...SANDWICH,
      { id: 'e_glorp', primitive: 'labeled_card' },
    ]);
    expect(curateScene(scene, ctx).reasons).toEqual(['flat_primitive']);
  });

  it('keeps low-confidence and abstract scenes flat (condition 3)', () => {
    const low = sceneOf('stack', [...SANDWICH.slice(0, 2), { ...SANDWICH[2]!, low: true }]);
    expect(curateScene(low.scene, low.ctx)).toMatchObject({
      dimension: '2d',
      reasons: ['low_confidence'],
      rationale: '2d: low confidence in e_ham',
    });
    const abstract = sceneOf('stack', [
      ...SANDWICH,
      { id: 'e_love', primitive: 'bread_slice', kind: 'abstract_concept' },
    ]);
    expect(curateScene(abstract.scene, abstract.ctx).reasons).toEqual(['abstract_placeholder']);
  });

  it(`opens at most ${MAX_3D_NODES} nodes in 3D (condition 4)`, () => {
    const parts = (n: number): NodeSpec[] =>
      Array.from({ length: n }, (_, i) => ({ id: `e_p${i}`, primitive: 'bread_slice' as const }));
    const fits = sceneOf('stack', parts(MAX_3D_NODES));
    expect(curateScene(fits.scene, fits.ctx).dimension).toBe('3d');
    const over = sceneOf('stack', parts(MAX_3D_NODES + 1));
    expect(curateScene(over.scene, over.ctx).reasons).toEqual(['too_many_nodes']);
  });

  it('keeps the compass flat until compass-3d/v1 is certified (condition 5)', () => {
    const sg = loadSg('01-sun-east');
    const offline = selectMetaphorOffline(sg);
    expect(RENDERER_CAPABILITIES[COMPASS_3D_CAPABILITY]).toBe(false);
    expect(offline.dimensions).toEqual([
      {
        sceneId: 'scene_1',
        dimension: '2d',
        reasons: ['capability_uncertified'],
        rationale: '2d: compass-3d/v1 is not certified',
      },
    ]);
    for (const capabilities of [
      {},
      { 'compass-3d/v0': true },
      { [COMPASS_3D_CAPABILITY]: false },
    ]) {
      expect(selectMetaphorOffline(sg, { capabilities }).plan.scenes[0]?.dimension).toBe('2d');
    }
    const certified = selectMetaphorOffline(sg, { capabilities: CERTIFIED });
    expect(certified.plan.scenes[0]?.dimension).toBe('3d');
    // The reserved bearing card (east) and the synthetic dial do not count as flat primitives.
    expect(certified.dimensions[0]?.reasons).toEqual(['eligible']);
  });

  it('never lets the certification flag lift a non-compass metaphor', () => {
    const cat = selectMetaphorOffline(loadSg('04-cat-classification'), { capabilities: CERTIFIED });
    expect(cat.plan.scenes.every((s) => s.dimension === '2d')).toBe(true);
  });

  it('lists every failing condition, in a fixed order', () => {
    const { scene, ctx } = sceneOf('flow', [
      { id: 'e_idea', primitive: 'labeled_card', kind: 'abstract_concept', low: true },
    ]);
    expect(curateScene(scene, ctx)).toMatchObject({
      reasons: ['metaphor_not_spatial', 'flat_primitive', 'low_confidence', 'abstract_placeholder'],
      rationale:
        '2d: flow reads best flat; no solid primitive for e_idea; low confidence in e_idea; abstract e_idea',
    });
  });
});

describe('curator and the LLM', () => {
  /** Unknown `e_bowlish` is a stack part; the rules ask the LLM for its primitive. */
  function stackWithUnknown(): SemanticGraph {
    const sg = loadSg('02-sandwich-parts');
    sg.entities = sg.entities.map((e) =>
      e.id === 'e_ham' ? { ...e, id: 'e_glorp', surface: 'glorp', lemma: 'glorp' } : e,
    );
    sg.relations = sg.relations.map((r) =>
      r.target === 'e_ham' ? { ...r, target: 'e_glorp' } : r,
    );
    return SemanticGraphSchema.parse(sg);
  }

  it('rejects a reply that tries to set the dimension', async () => {
    const sg = stackWithUnknown();
    const offline = selectMetaphorOffline(sg);
    const llm = new MockLLMClient([
      JSON.stringify({ primitives: { e_glorp: 'bread_slice' }, dimension: '3d' }),
    ]);
    const result = await selectMetaphor(sg, { llm });
    expect(result.llm.error).toMatch(/Reply failed validation/);
    expect(result.plan).toEqual(offline.plan);
    expect(result.dimensions).toEqual(offline.dimensions);
  });

  it('rejects a 3D-only primitive for an unknown entity and keeps labeled_card', async () => {
    const sg = stackWithUnknown();
    const llm = new MockLLMClient([JSON.stringify({ primitives: { e_glorp: 'bowl' } })]);
    const result = await selectMetaphor(sg, { llm });
    expect(result.llm.rejected).toEqual([{ id: 'e_glorp', reason: '"bowl" has no 2D icon' }]);
    const glorp = result.plan.scenes[0]?.nodes.find((n) => n.id === 'e_glorp');
    expect(glorp?.primitive).toBe('labeled_card');
    expect(result.dimensions[0]?.reasons).toContain('flat_primitive');
  });

  it('re-curates after a validated primitive answer, without the LLM choosing the dimension', async () => {
    const sg = stackWithUnknown();
    expect(selectMetaphorOffline(sg).plan.scenes[0]?.dimension).toBe('2d');
    const llm = new MockLLMClient([JSON.stringify({ primitives: { e_glorp: 'bread_slice' } })]);
    const result = await selectMetaphor(sg, { llm });
    expect(result.llm.accepted).toEqual(['e_glorp']);
    expect(result.plan.scenes[0]?.dimension).toBe('3d');
    expect(result.dimensions[0]?.reasons).toEqual(['eligible']);
  });
});

describe('golden dimension decisions (all 15 cases)', () => {
  const golden = readdirSync(GOLDEN)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({
      name: f.replace(/\.json$/, ''),
      utterance: (JSON.parse(readFileSync(new URL(f, GOLDEN), 'utf8')) as { utterance: string })
        .utterance,
    }));
  const frozen = new Set(
    readdirSync(FIXTURES)
      .filter((f) => f.endsWith('.sg.json'))
      .map((f) => f.replace(/\.sg\.json$/, '')),
  );
  /** Frozen parser SGs where they exist; the offline rule parser for the other cases. */
  const sgFor = (name: string, utterance: string) =>
    frozen.has(name) ? loadSg(name) : ruleBasedParse(utterance).sg;

  it('covers every golden case', () => {
    expect(golden).toHaveLength(15);
  });

  it.each(golden)('$name: offline curation is deterministic and valid', ({ name, utterance }) => {
    const first = selectMetaphorOffline(sgFor(name, utterance));
    const second = selectMetaphorOffline(structuredClone(sgFor(name, utterance)));
    expect(second).toEqual(first);
    expect(visualPlanSchemaFor(sgFor(name, utterance)).safeParse(first.plan).success).toBe(true);
    for (const scene of first.plan.scenes) {
      expect(scene.dimension).not.toBe('auto');
      if (scene.dimension === '3d') expect(['stack', 'container']).toContain(scene.metaphor);
    }
  });

  it.each(golden)(
    '$name: an always-failing LLM gives the offline result',
    async ({ name, utterance }) => {
      const sg = sgFor(name, utterance);
      const failing = new MockLLMClient([
        () => {
          throw new Error('provider down');
        },
      ]);
      const result = await selectMetaphor(sg, { llm: failing });
      const offline = selectMetaphorOffline(sg);
      expect(result.plan).toEqual(offline.plan);
      expect(result.dimensions).toEqual(offline.dimensions);
    },
  );

  it('snapshots every decision', () => {
    const table = Object.fromEntries(
      golden.map(({ name, utterance }) => [
        name,
        (({ plan, dimensions }) =>
          plan.scenes.map((scene, i) => ({ metaphor: scene.metaphor, ...dimensions[i] })))(
          selectMetaphorOffline(sgFor(name, utterance)),
        ),
      ]),
    );
    expect(table).toMatchSnapshot();
    // North Star: sandwich opens in 3D; sun/east stays 2D until the compass is certified.
    expect(table['02-sandwich-parts']?.[0]?.dimension).toBe('3d');
    expect(table['01-sun-east']?.[0]?.dimension).toBe('2d');
  });
});
