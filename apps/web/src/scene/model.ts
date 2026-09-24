import type { OSG, PositionedNode, PositionedScene } from '@opsis/schema';
import { compassPointFor, getPrimitive, type Vec3 } from '@opsis/primitives';

/** How a node's label sits relative to the node's centre. */
export type LabelPlacement = {
  /** Offset from the node centre, in world units. */
  offset: Vec3;
  /** CSS alignment of the label box around its point. */
  align: 'left' | 'right' | 'center';
  /** Leader line start (node-local) when the label is detached from the node. */
  leaderFrom?: Vec3;
};

const LABEL_GAP = 0.35;

/**
 * Places a node's label. Stack parts line up in a column right of the scene with leader
 * lines (PROMPT.md §10.2); a compass labels its south rim; a horizon labels its west end;
 * a whole-of-parts frame labels its top-left corner; everything else sits to the right.
 */
export function labelPlacement(node: PositionedNode, scene: PositionedScene): LabelPlacement {
  const [w, h, d] = node.size;
  if (scene.metaphor === 'stack' && node.role === 'part') {
    const column = scene.bounds.max[0] + 0.6 - node.position[0];
    return { offset: [column, 0, 0], align: 'left', leaderFrom: [w / 2, 0, 0] };
  }
  switch (node.primitive) {
    case 'compass':
      return { offset: [0, 0, d / 2 + 0.6], align: 'center' };
    case 'horizon':
      return { offset: [-w / 2 + 0.2, h / 2 + LABEL_GAP, 0], align: 'left' };
    case 'group_frame':
      return { offset: [-w / 2 - LABEL_GAP, h / 2, 0], align: 'right' };
    default:
      return { offset: [w / 2 + LABEL_GAP * 0.5, 0, 0], align: 'left' };
  }
}

/** Compass bearings to emphasise: every node in the scene whose label names a direction. */
export function compassHighlights(scene: PositionedScene): string[] {
  const points = scene.nodes
    .filter((n) => n.primitive !== 'compass')
    .map((n) => compassPointFor(n.label))
    .filter((p): p is NonNullable<typeof p> => p !== undefined);
  return [...new Set(points)];
}

/** Where a node sits for the given explode state. */
export function nodeTarget(node: PositionedNode, exploded: boolean): Vec3 {
  return exploded && node.explodable && node.explodedPosition
    ? node.explodedPosition
    : node.position;
}

/** True if any node in the scene can explode. */
export function isExplodable(scene: PositionedScene): boolean {
  return scene.nodes.some((n) => n.explodable === true && n.explodedPosition !== undefined);
}

/**
 * Start point for an edge: when the source is a compass and the target names a bearing,
 * start at that bearing's rim anchor instead of the dial centre.
 */
export function edgeStart(from: PositionedNode, to: PositionedNode): Vec3 {
  const point = from.primitive === 'compass' ? compassPointFor(to.label) : undefined;
  const anchor = point ? getPrimitive('compass').anchors[point] : undefined;
  if (!anchor) return from.position;
  return [
    from.position[0] + anchor[0] * from.size[0],
    from.position[1] + from.size[1] / 2,
    from.position[2] + anchor[2] * from.size[2],
  ];
}

/**
 * Points the camera must keep in view: every node's box corners at its current target
 * (so exploded parts stay visible) plus a point past the end of each label.
 */
export function fitPoints(scene: PositionedScene, exploded: boolean): Vec3[] {
  const points: Vec3[] = [];
  for (const node of scene.nodes) {
    const [px, py, pz] = nodeTarget(node, exploded);
    const [hx, hy, hz] = node.size.map((s) => s / 2) as Vec3;
    for (const sx of [-1, 1])
      for (const sy of [-1, 1])
        for (const sz of [-1, 1]) points.push([px + sx * hx, py + sy * hy, pz + sz * hz]);
    const { offset, align } = labelPlacement(node, scene);
    const textWidth = align === 'left' ? 1.6 : align === 'right' ? -1.6 : 0;
    points.push([px + offset[0] + textWidth, py + offset[1], pz + offset[2]]);
  }
  return points;
}

/** What the summary panel shows for a node, sourced only from the OSG. */
export type NodeInfo = {
  id: string;
  label: string;
  summary: string;
  optional: boolean;
  notes: { kind: string; text: string }[];
};

/** Builds the summary panel content for a node (entity summary, pedagogy notes, modality). */
export function nodeInfo(osg: OSG, node: PositionedNode): NodeInfo {
  const entity =
    osg.sg.entities.find((e) => e.id === node.id) ??
    osg.sg.entities.find((e) => e.lemma.toLowerCase() === node.label.toLowerCase());
  const summary =
    entity?.summary ??
    getPrimitive(node.primitive).summary ??
    `${node.label} is part of this diagram.`;
  const notes = (osg.sg.notes ?? [])
    .filter((n) => n.targetId === node.id || (entity && n.targetId === entity.id))
    .map(({ kind, text }) => ({ kind, text }));
  return { id: node.id, label: node.label, summary, optional: node.optional === true, notes };
}

/**
 * Camera distance from `center`, along unit `direction` (centre → camera), at which every
 * point fits a perspective frustum with vertical FOV `fovDeg` and `aspect`, leaving
 * `margin` (1.1 = 10 %) of padding. Tighter than drei's bounding-sphere fit.
 */
export function fitDistance(
  points: readonly Vec3[],
  center: Vec3,
  direction: Vec3,
  fovDeg: number,
  aspect: number,
  margin: number,
): number {
  const [fx, fy, fz] = direction;
  // Camera basis: forward f (towards camera), right r = up × f, true up u = f × r.
  const rl = Math.hypot(fz, fx);
  const [rx, ry, rz] = rl < 1e-6 ? [1, 0, 0] : [fz / rl, 0, -fx / rl];
  const [ux, uy, uz] = [fy * rz - fz * ry, fz * rx - fx * rz, fx * ry - fy * rx];
  const tanV = Math.tan((fovDeg * Math.PI) / 360) / margin;
  const tanH = tanV * aspect;
  let distance = 0;
  for (const [x, y, z] of points) {
    const [dx, dy, dz] = [x - center[0], y - center[1], z - center[2]];
    const along = dx * fx + dy * fy + dz * fz;
    const right = Math.abs(dx * rx + dy * ry + dz * rz);
    const up = Math.abs(dx * ux + dy * uy + dz * uz);
    distance = Math.max(distance, along + right / tanH, along + up / tanV);
  }
  return distance;
}

/** Centre of the axis-aligned box around `points`. */
export function centerOf(points: readonly Vec3[]): Vec3 {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of points)
    for (const i of [0, 1, 2] as const) {
      min[i] = Math.min(min[i], p[i]);
      max[i] = Math.max(max[i], p[i]);
    }
  return points.length === 0
    ? [0, 0, 0]
    : [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
}
