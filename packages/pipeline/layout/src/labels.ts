import type { PositionedNode, PositionedScene, VisualEdge } from '@opsis/schema';
import { labelsOverlap, nodeBounds } from './geometry';
import type { LabelBox, LayoutState, Vector3 } from './types';

const LABEL_HEIGHT = 0.42;
const CHARACTER_WIDTH = 0.23;
const GAP = 0.22;
const BACKDROPS = new Set([
  'compass',
  'cycle_ring',
  'scale_balance',
  'group_frame',
  'box',
  'bowl',
  'cell',
]);

function intersectsNode(label: LabelBox, node: PositionedNode, state: LayoutState): boolean {
  // These primitives are frames/surfaces behind their content, not solid foreground glyphs.
  if (node.role === 'anchor' && BACKDROPS.has(node.primitive)) return false;
  const bounds = nodeBounds(node, state);
  return (
    label.position[0] - label.size[0] / 2 < bounds.max[0] &&
    label.position[0] + label.size[0] / 2 > bounds.min[0] &&
    label.position[1] - label.size[1] / 2 < bounds.max[1] &&
    label.position[1] + label.size[1] / 2 > bounds.min[1]
  );
}

function positionOf(node: PositionedNode, state: LayoutState): Vector3 {
  return state === 'exploded' && node.explodedPosition ? node.explodedPosition : node.position;
}

/** Places label rectangles without label-label or label-node collisions. */
export function layoutLabels(
  scene: Pick<PositionedScene, 'metaphor' | 'nodes'> & { edges?: readonly VisualEdge[] },
  state: LayoutState = 'assembled',
): LabelBox[] {
  const placed: LabelBox[] = [];
  const nodes = scene.nodes;
  for (const node of nodes) {
    const position = positionOf(node, state);
    const width = Math.max(0.8, node.label.length * CHARACTER_WIDTH + 0.36);
    const sideFirst = scene.metaphor === 'stack' && state === 'exploded';
    const candidates: Vector3[] = [];
    for (let step = 0; step < Math.max(8, nodes.length * 2); step += 1) {
      const lane = Math.ceil(step / 2) * (LABEL_HEIGHT + GAP);
      const signedLane = step === 0 ? 0 : step % 2 === 0 ? -lane : lane;
      if (sideFirst)
        candidates.push([
          position[0] + node.size[0] / 2 + GAP + width / 2,
          position[1] + signedLane,
          position[2],
        ]);
      else {
        candidates.push([
          position[0] + signedLane,
          position[1] + node.size[1] / 2 + GAP + LABEL_HEIGHT / 2,
          position[2],
        ]);
        candidates.push([
          position[0] + node.size[0] / 2 + GAP + width / 2,
          position[1] + signedLane,
          position[2],
        ]);
      }
    }
    const pick = candidates.find((candidate) => {
      const box: LabelBox = { nodeId: node.id, position: candidate, size: [width, LABEL_HEIGHT] };
      return (
        !placed.some((other) => labelsOverlap(box, other)) &&
        !nodes.some((other) => intersectsNode(box, other, state))
      );
    }) ?? [
      position[0],
      position[1] + node.size[1] / 2 + 2 + placed.length * LABEL_HEIGHT,
      position[2],
    ];
    placed.push({ nodeId: node.id, position: pick, size: [width, LABEL_HEIGHT] });
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const edge of scene.edges ?? []) {
    if (!edge.label) continue;
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) continue;
    const start = positionOf(from, state);
    const end = positionOf(to, state);
    const width = Math.max(0.8, edge.label.length * CHARACTER_WIDTH + 0.36);
    const midpoint: Vector3 = [
      (start[0] + end[0]) / 2,
      (start[1] + end[1]) / 2,
      (start[2] + end[2]) / 2,
    ];
    const horizontal = Math.abs(end[0] - start[0]) >= Math.abs(end[1] - start[1]);
    let pick: Vector3 | undefined;
    // Search perpendicular lanes so the text never masks a node, another label, or the arrow line.
    for (let lane = 1; lane <= Math.max(16, nodes.length * 3) && !pick; lane += 1) {
      for (const sign of [-1, 1] as const) {
        const offset = sign * lane * (LABEL_HEIGHT + GAP);
        const candidate: Vector3 = horizontal
          ? [midpoint[0], midpoint[1] + offset, midpoint[2]]
          : [midpoint[0] + offset + (sign * width) / 2, midpoint[1], midpoint[2]];
        const box: LabelBox = { edgeId: edge.id, position: candidate, size: [width, LABEL_HEIGHT] };
        if (
          !placed.some((other) => labelsOverlap(box, other)) &&
          !nodes.some((node) => intersectsNode(box, node, state))
        ) {
          pick = candidate;
          break;
        }
      }
    }
    // The search is deliberately wider than the supported 50-node bound; this is only a guard.
    pick ??= [midpoint[0], midpoint[1] + nodes.length * (LABEL_HEIGHT + GAP) + 1, midpoint[2]];
    placed.push({ edgeId: edge.id, position: pick, size: [width, LABEL_HEIGHT] });
  }
  return placed;
}
