import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  OSGSchema,
  createSgRef,
  type MetaphorId,
  type Relation,
  type SemanticGraph,
  type VisualNode,
  type VisualPlan,
} from '@opsis/schema';
import {
  labelsOverlap,
  layoutLabels,
  layoutVisualPlan,
  nodeBounds,
  nodesOverlap,
  semanticRanks,
  zoomToFit,
} from './index';

const METAPHORS: MetaphorId[] = [
  'compass',
  'stack',
  'container',
  'cycle',
  'timeline',
  'flow',
  'tree',
  'scale',
  'actor_action',
];
const BACKDROPS = new Set([
  'compass',
  'cycle_ring',
  'scale_balance',
  'group_frame',
  'box',
  'bowl',
  'cell',
]);

function graphAndPlan(
  metaphor: MetaphorId,
  count: number,
  explodableMask = -1,
): { sg: SemanticGraph; plan: VisualPlan } {
  const nodeCount = Math.max(2, count);
  const ids = Array.from({ length: nodeCount }, (_, index) => `e_${index}`);
  const utterance = ids.join(' ');
  const entities = ids.map((id, index) => ({
    id,
    surface: id,
    lemma: index === 1 && metaphor === 'compass' ? 'east' : id,
    kind: (metaphor === 'actor_action' && index === 0 ? 'action' : 'object') as 'action' | 'object',
    span: [index * 4, index * 4 + 3] as [number, number],
    summary: `${id} is shown here.`,
  }));
  const type: Relation['type'] =
    metaphor === 'tree'
      ? 'is_a'
      : metaphor === 'cycle'
        ? 'cycle'
        : metaphor === 'stack'
          ? 'contains'
          : metaphor === 'container'
            ? 'has_part'
            : metaphor === 'scale'
              ? 'compares'
              : metaphor === 'compass'
                ? 'direction'
                : metaphor === 'actor_action'
                  ? 'acts_on'
                  : 'precedes';
  const relations: Relation[] = [];
  for (let index = 1; index < nodeCount; index += 1) {
    relations.push({
      id: `r_${index}`,
      type,
      source: metaphor === 'stack' || metaphor === 'container' ? ids[0]! : ids[index - 1]!,
      target: ids[index]!,
      modality: 'certain',
      ...(metaphor === 'stack' ? { order: index } : {}),
    });
  }
  if (metaphor === 'cycle')
    relations.push({
      id: 'r_close',
      type: 'cycle',
      source: ids.at(-1)!,
      target: ids[0]!,
      modality: 'certain',
    });
  if (metaphor === 'actor_action')
    relations.unshift({
      id: 'r_actor',
      type: 'agent_of',
      source: ids[1]!,
      target: ids[0]!,
      modality: 'certain',
    });
  const sg: SemanticGraph = {
    schemaVersion: 'sg/1',
    utterance,
    language: 'en',
    entities,
    relations,
  };
  const primitive: VisualNode['primitive'] =
    metaphor === 'compass'
      ? 'compass'
      : metaphor === 'container'
        ? 'cell'
        : metaphor === 'cycle'
          ? 'cycle_ring'
          : metaphor === 'scale'
            ? 'scale_balance'
            : metaphor === 'timeline'
              ? 'timeline_axis'
              : metaphor === 'actor_action'
                ? 'arrow'
                : metaphor === 'stack'
                  ? 'group_frame'
                  : 'labeled_card';
  const nodes: VisualNode[] = ids.map((id, index) => ({
    id,
    primitive: index === 0 ? primitive : 'labeled_card',
    label: entities[index]!.lemma,
    role:
      index === 0
        ? 'anchor'
        : metaphor === 'actor_action'
          ? index === 1
            ? 'actor'
            : 'object'
          : metaphor === 'compass'
            ? 'context'
            : metaphor === 'scale'
              ? 'object'
              : 'part',
    ...((metaphor === 'stack' || metaphor === 'container') &&
    index > 0 &&
    (explodableMask & (1 << index)) !== 0
      ? { explodable: true }
      : {}),
  }));
  const plan: VisualPlan = {
    schemaVersion: 'vp/1',
    sgRef: createSgRef(sg),
    anchor: ids[0]!,
    scenes: [
      {
        id: 'scene_1',
        metaphor,
        nodes,
        edges: relations.map((relation) => ({
          id: `ve_${relation.id}`,
          from: relation.source,
          to: relation.target,
          kind:
            metaphor === 'cycle' ||
            metaphor === 'timeline' ||
            metaphor === 'flow' ||
            metaphor === 'tree' ||
            metaphor === 'actor_action'
              ? 'arrow'
              : 'line',
        })),
        dimension: 'auto',
      },
    ],
  };
  return { sg, plan };
}

function expectGeometry(osg: Awaited<ReturnType<typeof layoutVisualPlan>>): void {
  expect(OSGSchema.safeParse(osg).success).toBe(true);
  expect(JSON.stringify(osg)).not.toMatch(/NaN|Infinity/);
  for (const scene of osg.scenes) {
    for (let left = 0; left < scene.nodes.length; left += 1) {
      for (let right = left + 1; right < scene.nodes.length; right += 1) {
        expect(nodesOverlap(scene.nodes[left]!, scene.nodes[right]!)).toBe(false);
        expect(nodesOverlap(scene.nodes[left]!, scene.nodes[right]!, 'exploded')).toBe(false);
      }
    }
    for (const state of ['assembled', 'exploded'] as const) {
      const labels = layoutLabels(scene, state);
      for (let left = 0; left < labels.length; left += 1) {
        for (let right = left + 1; right < labels.length; right += 1)
          expect(labelsOverlap(labels[left]!, labels[right]!)).toBe(false);
      }
      for (const label of labels) {
        for (const node of scene.nodes) {
          if (node.role === 'anchor' && BACKDROPS.has(node.primitive)) continue;
          const bounds = nodeBounds(node, state);
          const overlaps =
            label.position[0] - label.size[0] / 2 < bounds.max[0] &&
            label.position[0] + label.size[0] / 2 > bounds.min[0] &&
            label.position[1] - label.size[1] / 2 < bounds.max[1] &&
            label.position[1] + label.size[1] / 2 > bounds.min[1];
          expect(overlaps).toBe(false);
        }
      }
    }
    for (const node of scene.nodes) {
      for (const state of ['assembled', 'exploded'] as const) {
        const bounds = nodeBounds(node, state);
        for (let axis = 0; axis < 3; axis += 1) {
          expect(scene.bounds.min[axis]).toBeLessThanOrEqual(bounds.min[axis]!);
          expect(scene.bounds.max[axis]).toBeGreaterThanOrEqual(bounds.max[axis]!);
        }
      }
      if (node.explodable) expect(node.explodedPosition).toBeDefined();
    }
  }
}

describe('@opsis/layout', () => {
  it('is byte-for-byte deterministic for a seed, including id and timestamp', async () => {
    const { sg, plan } = graphAndPlan('container', 7);
    expect(await layoutVisualPlan(plan, sg, { seed: 42 })).toEqual(
      await layoutVisualPlan(plan, sg, { seed: 42 }),
    );
  });

  it('lays stack parts touching, explodes by a 1.5x-height gap, and adds leaders', async () => {
    const { sg, plan } = graphAndPlan('stack', 5);
    const scene = (await layoutVisualPlan(plan, sg, { seed: 5 })).scenes[0]!;
    const parts = scene.nodes.filter((node) => node.explodable);
    for (let index = 1; index < parts.length; index += 1) {
      const above = parts[index - 1]!;
      const below = parts[index]!;
      expect(above.position[1] - below.position[1]).toBeCloseTo(
        (above.size[1] + below.size[1]) / 2,
      );
      expect(
        above.explodedPosition![1] -
          below.explodedPosition![1] -
          (above.size[1] + below.size[1]) / 2,
      ).toBeCloseTo(above.size[1] * 1.5);
    }
    expect(scene.edges.filter((edge) => edge.kind === 'leader')).toHaveLength(parts.length);
    for (const label of layoutLabels(scene, 'exploded').filter((item) =>
      parts.some((node) => node.id === item.nodeId),
    )) {
      const node = parts.find((part) => part.id === label.nodeId)!;
      expect(label.position[0]).toBeGreaterThan(node.explodedPosition![0] + node.size[0] / 2);
    }
  });

  it('uses bearing anchors and clockwise cycle order', async () => {
    const compassCase = graphAndPlan('compass', 4);
    compassCase.sg.relations.push({
      id: 'r_mover_east',
      type: 'direction',
      source: 'e_2',
      target: 'e_1',
      modality: 'certain',
    });
    compassCase.plan.sgRef = createSgRef(compassCase.sg);
    compassCase.plan.scenes[0]!.edges.push({
      id: 've_r_mover_east',
      from: 'e_2',
      to: 'e_1',
      kind: 'arrow',
    });
    const compass = (await layoutVisualPlan(compassCase.plan, compassCase.sg, { seed: 9 }))
      .scenes[0]!;
    expect(compass.nodes.find((node) => node.id === 'e_1')!.position[0]).toBeGreaterThan(0);
    expect(compass.nodes.find((node) => node.id === 'e_2')!.position[0]).toBeGreaterThan(0);
    expect(compass.nodes.find((node) => node.id === 'e_2')!.position[1]).toBeCloseTo(0);
    const cycleCase = graphAndPlan('cycle', 5);
    const cycle = (await layoutVisualPlan(cycleCase.plan, cycleCase.sg, { seed: 9 })).scenes[0]!;
    const members = cycle.nodes.filter((node) => node.role !== 'anchor');
    const angles = members.map((node) => Math.atan2(node.position[1], node.position[0]));
    expect((angles[0]! - angles[1]! + Math.PI * 2) % (Math.PI * 2)).toBeGreaterThan(0);
  });

  it('orients ELK flow left-to-right and trees top-to-bottom', async () => {
    for (const metaphor of ['timeline', 'flow'] as const) {
      const example = graphAndPlan(metaphor, 5);
      const scene = (await layoutVisualPlan(example.plan, example.sg, { seed: 3 })).scenes[0]!;
      for (const relation of example.sg.relations) {
        const source = scene.nodes.find((node) => node.id === relation.source)!;
        const target = scene.nodes.find((node) => node.id === relation.target)!;
        expect(source.position[0]).toBeLessThan(target.position[0]);
        expect(nodeBounds(source).max[0]).toBeLessThan(nodeBounds(target).min[0]);
      }
    }
    const tree = graphAndPlan('tree', 5);
    const scene = (await layoutVisualPlan(tree.plan, tree.sg, { seed: 3 })).scenes[0]!;
    for (const relation of tree.sg.relations) {
      expect(scene.nodes.find((node) => node.id === relation.source)!.position[1]).toBeLessThan(
        scene.nodes.find((node) => node.id === relation.target)!.position[1],
      );
    }
  });

  it('keeps semantic ranks and positions stable when an edited flow arrives in a new array order', async () => {
    const example = graphAndPlan('flow', 7);
    example.sg.relations[2]!.type = 'transforms_into';
    example.plan.sgRef = createSgRef(example.sg);
    const original = (await layoutVisualPlan(example.plan, example.sg, { seed: 17 })).scenes[0]!;
    const edited = structuredClone(example.plan);
    edited.scenes[0]!.nodes.reverse();
    edited.scenes[0]!.edges.reverse();
    const reordered = (await layoutVisualPlan(edited, example.sg, { seed: 17 })).scenes[0]!;
    const positions = (scene: typeof original) =>
      Object.fromEntries(scene.nodes.map((node) => [node.id, node.position]));
    expect(positions(reordered)).toEqual(positions(original));
    const ranks = semanticRanks(edited.scenes[0]!, example.sg);
    for (const relation of example.sg.relations)
      expect(ranks.get(relation.target)).toBeGreaterThan(ranks.get(relation.source)!);
  });

  it('places labelled directional edges without node or label collisions', async () => {
    const example = graphAndPlan('timeline', 8);
    example.plan.scenes[0]!.edges.forEach((edge, index) => {
      edge.label = index % 2 === 0 ? 'then' : 'becomes';
    });
    const scene = (await layoutVisualPlan(example.plan, example.sg, { seed: 4 })).scenes[0]!;
    const labels = layoutLabels(scene);
    expect(labels.filter((label) => label.edgeId)).toHaveLength(scene.edges.length);
    for (let left = 0; left < labels.length; left += 1)
      for (let right = left + 1; right < labels.length; right += 1)
        expect(labelsOverlap(labels[left]!, labels[right]!)).toBe(false);
    for (const label of labels)
      for (const node of scene.nodes) {
        if (node.role === 'anchor' && BACKDROPS.has(node.primitive)) continue;
        const bounds = nodeBounds(node);
        expect(
          label.position[0] - label.size[0] / 2 < bounds.max[0] &&
            label.position[0] + label.size[0] / 2 > bounds.min[0] &&
            label.position[1] - label.size[1] / 2 < bounds.max[1] &&
            label.position[1] + label.size[1] / 2 > bounds.min[1],
        ).toBe(false);
      }
    for (const label of labels) {
      expect(label.position[0] - label.size[0] / 2).toBeGreaterThanOrEqual(scene.bounds.min[0]);
      expect(label.position[0] + label.size[0] / 2).toBeLessThanOrEqual(scene.bounds.max[0]);
      expect(label.position[1] - label.size[1] / 2).toBeGreaterThanOrEqual(scene.bounds.min[1]);
      expect(label.position[1] + label.size[1] / 2).toBeLessThanOrEqual(scene.bounds.max[1]);
    }
  });

  it('produces valid deterministic OSGs for edge-empty, cyclic, disconnected, and 50-node flows', async () => {
    const edgeEmpty = graphAndPlan('flow', 2);
    edgeEmpty.sg.relations = [];
    edgeEmpty.plan.sgRef = createSgRef(edgeEmpty.sg);
    edgeEmpty.plan.scenes[0]!.edges = [];

    const cyclic = graphAndPlan('flow', 6);
    cyclic.sg.relations.push({
      id: 'r_cycle',
      type: 'precedes',
      source: 'e_5',
      target: 'e_0',
      modality: 'certain',
    });
    cyclic.plan.sgRef = createSgRef(cyclic.sg);
    cyclic.plan.scenes[0]!.edges.push({
      id: 've_r_cycle',
      from: 'e_5',
      to: 'e_0',
      kind: 'arrow',
    });

    const disconnected = graphAndPlan('flow', 9);
    disconnected.sg.relations = disconnected.sg.relations.filter((_, index) => index % 3 === 0);
    disconnected.plan.sgRef = createSgRef(disconnected.sg);
    const retained = new Set(disconnected.sg.relations.map((relation) => `ve_${relation.id}`));
    disconnected.plan.scenes[0]!.edges = disconnected.plan.scenes[0]!.edges.filter((edge) =>
      retained.has(edge.id),
    );

    const fifty = graphAndPlan('flow', 50);
    for (const input of [edgeEmpty, cyclic, disconnected, fifty]) {
      const first = await layoutVisualPlan(input.plan, input.sg, { seed: 123 });
      expectGeometry(first);
      expect(await layoutVisualPlan(input.plan, input.sg, { seed: 123 })).toEqual(first);
    }
  }, 30_000);

  it('places actor → action → object and scales balance tilt to numeric difference', async () => {
    const action = graphAndPlan('actor_action', 3);
    const actionScene = (await layoutVisualPlan(action.plan, action.sg, { seed: 1 })).scenes[0]!;
    expect(actionScene.nodes.find((node) => node.id === 'e_1')!.position[0]).toBeLessThan(
      actionScene.nodes.find((node) => node.id === 'e_0')!.position[0],
    );
    expect(actionScene.nodes.find((node) => node.id === 'e_0')!.position[0]).toBeLessThan(
      actionScene.nodes.find((node) => node.id === 'e_2')!.position[0],
    );
    const slight = graphAndPlan('scale', 3);
    slight.sg.entities[0]!.attributes = { weight: 11, comparative: 'heavier' };
    slight.sg.entities[1]!.attributes = { weight: 10 };
    const large = graphAndPlan('scale', 3);
    large.sg.entities[0]!.attributes = { weight: 20, comparative: 'heavier' };
    large.sg.entities[1]!.attributes = { weight: 10 };
    const slightTilt = (await layoutVisualPlan(slight.plan, slight.sg)).scenes[0]!.nodes[0]!
      .rotation![2];
    const largeTilt = (await layoutVisualPlan(large.plan, large.sg)).scenes[0]!.nodes[0]!
      .rotation![2];
    expect(largeTilt).toBeGreaterThan(slightTilt);
  });

  it('fits bounds with ten percent padding', () => {
    expect(zoomToFit({ min: [0, 0, 0], max: [80, 40, 0] }, { width: 100, height: 100 })).toEqual({
      center: [40, 20, 0],
      scale: 1,
    });
  });

  it('passes 225 randomized layouts across every metaphor', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...METAPHORS),
        fc.integer({ min: 2, max: 10 }),
        fc.integer(),
        fc.integer({ min: 0, max: 2047 }),
        async (metaphor, count, seed, explodableMask) => {
          const { sg, plan } = graphAndPlan(metaphor, count, explodableMask);
          const first = await layoutVisualPlan(plan, sg, { seed });
          expect(await layoutVisualPlan(plan, sg, { seed })).toEqual(first);
          expectGeometry(first);
        },
      ),
      { numRuns: 225 },
    );
  }, 30_000);

  it('keeps mixed explodable and fixed stack parts apart when exploded', async () => {
    const { sg, plan } = graphAndPlan('stack', 12, 0b10101010100);
    expectGeometry(await layoutVisualPlan(plan, sg, { seed: 3 }));
  });

  it.each(['sun-east', 'sandwich'])('lays out the %s North Star SG validly', async (fixture) => {
    const sg = JSON.parse(
      readFileSync(new URL(`../../../../fixtures/sg/${fixture}.sg.json`, import.meta.url), 'utf8'),
    ) as SemanticGraph;
    const metaphor: MetaphorId = fixture === 'sun-east' ? 'compass' : 'stack';
    const { plan } = graphAndPlan(metaphor, Math.max(2, sg.entities.length));
    plan.sgRef = createSgRef(sg);
    plan.anchor = sg.entities[0]!.id;
    plan.scenes[0]!.nodes = sg.entities.map((entity, index) => ({
      id: entity.id,
      primitive:
        index === 0 ? (metaphor === 'compass' ? 'compass' : 'group_frame') : 'labeled_card',
      label: entity.lemma,
      role: index === 0 ? 'anchor' : metaphor === 'stack' ? 'part' : 'context',
      ...(metaphor === 'stack' && index > 0 ? { explodable: true } : {}),
    }));
    plan.scenes[0]!.edges = sg.relations.map((relation) => ({
      id: `ve_${relation.id}`,
      from: relation.source,
      to: relation.target,
      kind: 'line',
    }));
    expectGeometry(await layoutVisualPlan(plan, sg, { seed: 101 }));
  });
});
