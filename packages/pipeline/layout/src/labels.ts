import type { PositionedNode, PositionedScene } from '@opsis/schema';
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
  scene: Pick<PositionedScene, 'metaphor' | 'nodes'>,
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
  return placed;
}
