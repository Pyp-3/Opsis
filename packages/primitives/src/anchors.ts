import type { Vec3 } from './meta';

/** Generic attach points shared by every primitive (unit-cube space). */
export const BOX_ANCHORS: Record<string, Vec3> = {
  center: [0, 0, 0],
  top: [0, 0.5, 0],
  bottom: [0, -0.5, 0],
  left: [-0.5, 0, 0],
  right: [0.5, 0, 0],
  front: [0, 0, 0.5],
  back: [0, 0, -0.5],
};

/** Compass bearings in clockwise order from north. */
export const COMPASS_POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export type CompassPoint = (typeof COMPASS_POINTS)[number];

/**
 * Compass anchors on the dial rim in the XZ plane: north is −Z, east is +X
 * (three.js convention, so an iso camera shows east to the right).
 */
export const COMPASS_ANCHORS: Record<string, Vec3> = {
  ...BOX_ANCHORS,
  ...Object.fromEntries(
    COMPASS_POINTS.map((point, i) => {
      const angle = (i * Math.PI) / 4;
      const r = 0.5;
      return [point, [round(Math.sin(angle) * r), 0, round(-Math.cos(angle) * r)]];
    }),
  ),
};

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6 || 0;
}

const DIRECTION_WORDS: Record<string, CompassPoint> = {
  north: 'N',
  northeast: 'NE',
  east: 'E',
  southeast: 'SE',
  south: 'S',
  southwest: 'SW',
  west: 'W',
  northwest: 'NW',
};

/** Maps a direction word ("east", "North-East", "ne") to its compass anchor, if any. */
export function compassPointFor(word: string): CompassPoint | undefined {
  const w = word.toLowerCase().replace(/[\s_-]+/g, '');
  const upper = w.toUpperCase();
  if ((COMPASS_POINTS as readonly string[]).includes(upper)) return upper as CompassPoint;
  return DIRECTION_WORDS[w] ?? DIRECTION_WORDS[w.replace(/ern$/, '')];
}

/** Converts a unit-space anchor to world space for a node at `position` with `size`. */
export function anchorToWorld(anchor: Vec3, position: Vec3, size: Vec3): Vec3 {
  return [
    position[0] + anchor[0] * size[0],
    position[1] + anchor[1] * size[1],
    position[2] + anchor[2] * size[2],
  ];
}
