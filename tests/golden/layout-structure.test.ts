import {
  labelsOverlap,
  layoutLabels,
  layoutVisualPlan,
  nodeBounds,
  nodesOverlap,
} from '../../packages/pipeline/layout/src/index';
import type { LabelBox } from '../../packages/pipeline/layout/src/index';
import { selectMetaphor } from '../../packages/pipeline/metaphor/src/index';
import { parseUtterance } from '../../packages/pipeline/parse/src/index';
import {
  OSGSchema,
  type PositionedNode,
  type PositionedScene,
  type SemanticGraph,
  type VisualPlan,
} from '../../packages/schema/src/index';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGoldenCases } from './fixtures';
import type { NamedGoldenCase } from './schema';

const SEED = 7;
const STATES = ['assembled', 'exploded'] as const;
const LEFT_TO_RIGHT = new Set(['flow', 'timeline', 'actor_action']);
const DIRECTIONAL = new Set(['arrow', 'path']);
// Frames and surfaces sit behind their content, matching the layout label contract.
const BACKDROPS = new Set([
  'compass',
  'cycle_ring',
  'scale_balance',
  'group_frame',
  'box',
  'bowl',
  'cell',
]);

type GoldenLayout = { testCase: NamedGoldenCase; sg: SemanticGraph; plan: VisualPlan };

function isBackdrop(node: PositionedNode): boolean {
  return node.role === 'anchor' && BACKDROPS.has(node.primitive);
}

function labelHitsNode(
  label: LabelBox,
  node: PositionedNode,
  state: (typeof STATES)[number],
): boolean {
  const bounds = nodeBounds(node, state);
  return (
    label.position[0] - label.size[0] / 2 < bounds.max[0] &&
    label.position[0] + label.size[0] / 2 > bounds.min[0] &&
    label.position[1] - label.size[1] / 2 < bounds.max[1] &&
    label.position[1] + label.size[1] / 2 > bounds.min[1]
  );
}

function positions(scenes: readonly PositionedScene[]): Record<string, unknown> {
  return Object.fromEntries(
    scenes.flatMap((scene) =>
      scene.nodes.map((node) => [
        `${scene.id}/${node.id}`,
        { position: node.position, explodedPosition: node.explodedPosition },
      ]),
    ),
  );
}

describe('golden layout structure', () => {
  const layouts: GoldenLayout[] = [];

  beforeAll(async () => {
    for (const testCase of await loadGoldenCases()) {
      const parsed = await parseUtterance(testCase.utterance, { llm: null });
      const metaphor = await selectMetaphor(parsed.sg, { llm: null });
      layouts.push({ testCase, sg: parsed.sg, plan: metaphor.plan });
    }
  });

  it('covers every golden case', () => {
    expect(layouts).toHaveLength(15);
  });

  it('is deterministic and schema-valid for a fixed seed', async () => {
    for (const { testCase, sg, plan } of layouts) {
      const first = await layoutVisualPlan(plan, sg, { seed: SEED });
      expect(OSGSchema.safeParse(first).success, testCase.id).toBe(true);
      expect(await layoutVisualPlan(plan, sg, { seed: SEED }), testCase.id).toEqual(first);
    }
  });

  it('keeps node positions when plan node and edge arrays are reversed', async () => {
    for (const { testCase, sg, plan } of layouts) {
      const reversed = structuredClone(plan);
      for (const scene of reversed.scenes) {
        scene.nodes.reverse();
        scene.edges.reverse();
      }
      const original = await layoutVisualPlan(plan, sg, { seed: SEED });
      const edited = await layoutVisualPlan(reversed, sg, { seed: SEED });
      expect(positions(edited.scenes), testCase.id).toEqual(positions(original.scenes));
    }
  });

  it('never overlaps foreground nodes, labels, or scene bounds', async () => {
    for (const { testCase, sg, plan } of layouts) {
      const osg = await layoutVisualPlan(plan, sg, { seed: SEED });
      for (const scene of osg.scenes) {
        const where = `${testCase.id}/${scene.id}`;
        const solids = scene.nodes.filter((node) => !isBackdrop(node));
        for (const state of STATES) {
          for (let left = 0; left < solids.length; left += 1)
            for (let right = left + 1; right < solids.length; right += 1)
              expect(
                nodesOverlap(solids[left]!, solids[right]!, state),
                `${where} ${state}: ${solids[left]!.id} × ${solids[right]!.id}`,
              ).toBe(false);

          const labels = layoutLabels(scene, state);
          for (let left = 0; left < labels.length; left += 1)
            for (let right = left + 1; right < labels.length; right += 1)
              expect(labelsOverlap(labels[left]!, labels[right]!), `${where} ${state}`).toBe(false);
          for (const label of labels) {
            const name = `${where} ${state}: label ${label.nodeId ?? label.edgeId}`;
            for (const node of solids)
              expect(labelHitsNode(label, node, state), `${name} × ${node.id}`).toBe(false);
            expect(label.position[0] - label.size[0] / 2, name).toBeGreaterThanOrEqual(
              scene.bounds.min[0],
            );
            expect(label.position[0] + label.size[0] / 2, name).toBeLessThanOrEqual(
              scene.bounds.max[0],
            );
            expect(label.position[1] - label.size[1] / 2, name).toBeGreaterThanOrEqual(
              scene.bounds.min[1],
            );
            expect(label.position[1] + label.size[1] / 2, name).toBeLessThanOrEqual(
              scene.bounds.max[1],
            );
          }
        }
      }
    }
  });

  it('reads directional flow, timeline, and actor-action edges left to right', async () => {
    const checked = new Set<string>();
    for (const { testCase, sg, plan } of layouts) {
      const osg = await layoutVisualPlan(plan, sg, { seed: SEED });
      for (const scene of osg.scenes) {
        if (!LEFT_TO_RIGHT.has(scene.metaphor)) continue;
        const byId = new Map(scene.nodes.map((node) => [node.id, node]));
        for (const edge of scene.edges) {
          if (!DIRECTIONAL.has(edge.kind)) continue;
          const source = byId.get(edge.from)!;
          const target = byId.get(edge.to)!;
          // Backdrop anchors span their members, so they have no left or right edge to order.
          if (isBackdrop(source) || isBackdrop(target)) continue;
          expect(
            nodeBounds(source).max[0],
            `${testCase.id}/${scene.id}: ${edge.from} → ${edge.to}`,
          ).toBeLessThan(nodeBounds(target).min[0]);
          checked.add(scene.metaphor);
        }
      }
    }
    // Guards against the assertion becoming vacuous if golden metaphors drift.
    expect([...checked].sort()).toEqual([...LEFT_TO_RIGHT].sort());
  });
});
