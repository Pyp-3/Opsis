import type { PositionedNode, PositionedScene } from '@opsis/schema';
import type {
  Bounds,
  LabelBox,
  LayoutState,
  Vector3,
  ZoomToFitOptions,
  ZoomTransform,
} from './types';

const EPSILON = 1e-9;

function at(node: PositionedNode, state: LayoutState): Vector3 {
  return state === 'exploded' && node.explodedPosition ? node.explodedPosition : node.position;
}

/** Returns the axis-aligned box occupied by a positioned node. */
export function nodeBounds(node: PositionedNode, state: LayoutState = 'assembled'): Bounds {
  const position = at(node, state);
  return {
    min: position.map((value, axis) => value - (node.size[axis] ?? 0) / 2) as Vector3,
    max: position.map((value, axis) => value + (node.size[axis] ?? 0) / 2) as Vector3,
  };
}

/** True when two solid node boxes overlap (touching faces are allowed). */
export function nodesOverlap(
  left: PositionedNode,
  right: PositionedNode,
  state: LayoutState = 'assembled',
): boolean {
  const a = nodeBounds(left, state);
  const b = nodeBounds(right, state);
  return [0, 1, 2].every(
    (axis) =>
      (a.min[axis] ?? 0) < (b.max[axis] ?? 0) - EPSILON &&
      (a.max[axis] ?? 0) > (b.min[axis] ?? 0) + EPSILON,
  );
}

/** True when two 2D label rectangles overlap. */
export function labelsOverlap(left: LabelBox, right: LabelBox): boolean {
  return (
    Math.abs(left.position[0] - right.position[0]) < (left.size[0] + right.size[0]) / 2 - EPSILON &&
    Math.abs(left.position[1] - right.position[1]) < (left.size[1] + right.size[1]) / 2 - EPSILON
  );
}

/** Computes bounds containing complete node volumes and optional labels in both layout states. */
export function computeBounds(
  nodes: readonly PositionedNode[],
  labels: readonly LabelBox[] = [],
  explodedLabels: readonly LabelBox[] = [],
): Bounds {
  const min: Vector3 = [Infinity, Infinity, Infinity];
  const max: Vector3 = [-Infinity, -Infinity, -Infinity];
  const include = (bounds: Bounds) => {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis] ?? Infinity, bounds.min[axis] ?? Infinity);
      max[axis] = Math.max(max[axis] ?? -Infinity, bounds.max[axis] ?? -Infinity);
    }
  };
  for (const node of nodes) {
    include(nodeBounds(node));
    if (node.explodedPosition) include(nodeBounds(node, 'exploded'));
  }
  for (const label of [...labels, ...explodedLabels]) {
    include({
      min: [label.position[0] - label.size[0] / 2, label.position[1] - label.size[1] / 2, 0],
      max: [label.position[0] + label.size[0] / 2, label.position[1] + label.size[1] / 2, 0],
    });
  }
  if (nodes.length === 0 && labels.length === 0 && explodedLabels.length === 0)
    return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min, max };
}

/** Returns a centered viewport transform with 10% padding on every side by default. */
export function zoomToFit(bounds: Bounds, options: ZoomToFitOptions): ZoomTransform {
  const padding = Math.min(0.49, Math.max(0, options.padding ?? 0.1));
  const spanX = Math.max(EPSILON, bounds.max[0] - bounds.min[0]);
  const spanY = Math.max(EPSILON, bounds.max[1] - bounds.min[1]);
  const rawScale = Math.min(
    (options.width * (1 - padding * 2)) / spanX,
    (options.height * (1 - padding * 2)) / spanY,
  );
  return {
    center: [
      (bounds.min[0] + bounds.max[0]) / 2,
      (bounds.min[1] + bounds.max[1]) / 2,
      (bounds.min[2] + bounds.max[2]) / 2,
    ],
    scale: Math.min(options.maxScale ?? Infinity, Math.max(options.minScale ?? 0, rawScale)),
  };
}

/** Convenience overload for renderers that already hold a positioned scene. */
export function zoomSceneToFit(
  scene: Pick<PositionedScene, 'bounds'>,
  options: ZoomToFitOptions,
): ZoomTransform {
  return zoomToFit(scene.bounds, options);
}
