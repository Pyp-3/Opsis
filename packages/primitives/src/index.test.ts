import { PrimitiveIdSchema } from '@opsis/schema';
import { describe, expect, it } from 'vitest';
import {
  COMPASS_ANCHORS,
  PACKAGE_NAME,
  PRIMITIVES,
  PRIMITIVE_REGISTRY,
  anchorToWorld,
  compassPointFor,
  getPrimitive,
} from './index';

describe('@opsis/primitives registry', () => {
  it('exposes its package name', () => {
    expect(PACKAGE_NAME).toBe('@opsis/primitives');
  });

  it('has at least 25 primitives with unique ids', () => {
    expect(PRIMITIVES.length).toBeGreaterThanOrEqual(25);
    expect(new Set(PRIMITIVES.map((p) => p.id)).size).toBe(PRIMITIVES.length);
  });

  it('covers every PrimitiveId in the schema', () => {
    for (const id of PrimitiveIdSchema.options) expect(PRIMITIVE_REGISTRY[id]?.id).toBe(id);
  });

  it.each(PRIMITIVES.map((p) => [p.id, p] as const))('%s is complete', (_, def) => {
    expect(def.keywords.length).toBeGreaterThan(0);
    expect(def.render3D).toBeTypeOf('function');
    expect(def.dimensions).toContain('3d');
    if (def.dimensions.includes('2d')) expect(def.render2D).toBeTypeOf('function');
    expect(def.anchors.center).toEqual([0, 0, 0]);
    for (const anchor of Object.values(def.anchors)) {
      for (const n of anchor) expect(Math.abs(n)).toBeLessThanOrEqual(0.5);
    }
  });

  it('marks stackable layers as explodable along +Y', () => {
    for (const id of ['stack_layer', 'bread_slice', 'generic_layer', 'slice'] as const) {
      expect(PRIMITIVE_REGISTRY[id].explodeAxis).toEqual([0, 1, 0]);
    }
  });

  it('resolves unknown ids to labeled_card', () => {
    expect(getPrimitive('unicorn').id).toBe('labeled_card');
    expect(getPrimitive('sun').id).toBe('sun');
  });
});

describe('compass anchors', () => {
  it('has all eight bearings on the rim, east = +X, north = −Z', () => {
    expect(COMPASS_ANCHORS.E).toEqual([0.5, 0, 0]);
    expect(COMPASS_ANCHORS.N).toEqual([0, 0, -0.5]);
    expect(COMPASS_ANCHORS.W).toEqual([-0.5, 0, 0]);
    expect(COMPASS_ANCHORS.S).toEqual([0, 0, 0.5]);
    const ne = COMPASS_ANCHORS.NE ?? [0, 0, 0];
    expect(ne[0]).toBeCloseTo(0.353553, 5);
    expect(ne[2]).toBeCloseTo(-0.353553, 5);
    for (const p of ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']) {
      const [x, , z] = COMPASS_ANCHORS[p] ?? [0, 0, 0];
      expect(Math.hypot(x, z)).toBeCloseTo(0.5, 5);
    }
  });

  it.each([
    ['east', 'E'],
    ['East', 'E'],
    ['north-east', 'NE'],
    ['South West', 'SW'],
    ['nw', 'NW'],
    ['western', 'W'],
    ['up', undefined],
  ])('maps %s to %s', (word, point) => {
    expect(compassPointFor(word)).toBe(point);
  });

  it('converts anchors to world space', () => {
    expect(anchorToWorld([0.5, 0, 0], [1, 2, 3], [6, 0.3, 6])).toEqual([4, 2, 3]);
  });
});
