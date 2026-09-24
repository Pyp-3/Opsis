import { describe, expect, it } from 'vitest';
import { loadFixture } from './fixtures';
import {
  compassHighlights,
  edgeStart,
  centerOf,
  fitDistance,
  fitPoints,
  isExplodable,
  labelPlacement,
  nodeInfo,
  nodeTarget,
} from './model';

const sun = loadFixture('sun-east');
const sandwich = loadFixture('sandwich');
const sunScene = sun.scenes[0]!;
const sandwichScene = sandwich.scenes[0]!;
const node = (scene: typeof sunScene, id: string) => scene.nodes.find((n) => n.id === id)!;

describe('North Star fixtures', () => {
  it('sun/east uses compass, sun, curved arrow, horizon and an East card', () => {
    expect(Object.fromEntries(sunScene.nodes.map((n) => [n.label, n.primitive]))).toEqual({
      Compass: 'compass',
      Sun: 'sun',
      East: 'labeled_card',
      Rises: 'curved_arrow',
      Horizon: 'horizon',
    });
  });

  it('highlights east on the compass', () => {
    expect(compassHighlights(sunScene)).toEqual(['E']);
  });

  it('starts the compass→East edge at the east rim', () => {
    expect(edgeStart(node(sunScene, 'v_compass'), node(sunScene, 'e_east'))).toEqual([3, 0.15, 0]);
    expect(edgeStart(node(sunScene, 'e_sun'), node(sunScene, 'e_rises'))).toEqual([3.5, 1, 0]);
  });

  it('sandwich is an explodable stack of optional parts', () => {
    expect(isExplodable(sandwichScene)).toBe(true);
    expect(isExplodable(sunScene)).toBe(false);
    const parts = sandwichScene.nodes.filter((n) => n.role === 'part');
    expect(parts.map((p) => p.primitive)).toEqual([
      'bread_slice',
      'generic_layer',
      'slice',
      'bread_slice',
    ]);
    expect(parts.every((p) => p.optional)).toBe(true);
  });
});

describe('explode targets', () => {
  it('moves explodable parts to explodedPosition and keeps the anchor still', () => {
    const top = node(sandwichScene, 'e_bread_top');
    const frame = node(sandwichScene, 'e_sandwich');
    expect(nodeTarget(top, false)).toEqual([0, 3, 0]);
    expect(nodeTarget(top, true)).toEqual([0, 6, 0]);
    expect(nodeTarget(frame, true)).toEqual(frame.position);
  });

  it('keeps exploded parts and the label column in the fit', () => {
    const ys = fitPoints(sandwichScene, true).map((p) => p[1]);
    expect(Math.max(...ys)).toBeCloseTo(6.4);
    expect(Math.min(...ys)).toBeCloseTo(-1.9);
    const xs = fitPoints(sandwichScene, false).map((p) => p[0]);
    expect(Math.max(...xs)).toBeCloseTo(sandwichScene.bounds.max[0] + 0.6 + 1.6);
  });
});

describe('labels', () => {
  it('puts stack part labels in a right-hand column with leader lines', () => {
    const tomato = labelPlacement(node(sandwichScene, 'e_tomato'), sandwichScene);
    const ham = labelPlacement(node(sandwichScene, 'e_ham'), sandwichScene);
    expect(tomato.offset[0]).toBe(ham.offset[0]);
    expect(tomato.leaderFrom).toEqual([1.75, 0, 0]);
    expect(tomato.align).toBe('left');
  });

  it('labels the compass at its south rim without a leader', () => {
    const compass = labelPlacement(node(sunScene, 'v_compass'), sunScene);
    expect(compass).toEqual({ offset: [0, 0, 3.6], align: 'center' });
  });
});

describe('nodeInfo', () => {
  it.each([
    ['e_sun', 'The Sun is the star at the centre of our solar system.'],
    ['e_east', 'East is the direction where the Sun appears to rise.'],
  ])('summarises %s from the fixture', (id, summary) => {
    expect(nodeInfo(sun, node(sunScene, id)).summary).toBe(summary);
  });

  it('surfaces the pedagogy note on "rises"', () => {
    expect(nodeInfo(sun, node(sunScene, 'e_rises')).notes).toEqual([
      {
        kind: 'misconception',
        text: 'The Sun only appears to rise because Earth rotates from west to east.',
      },
    ]);
  });

  it('falls back to the primitive summary for structural nodes', () => {
    expect(nodeInfo(sun, node(sunScene, 'v_compass')).summary).toMatch(/compass shows/);
  });

  it('marks optional sandwich parts', () => {
    expect(nodeInfo(sandwich, node(sandwichScene, 'e_tomato'))).toMatchObject({
      label: 'Tomato',
      optional: true,
      summary: 'Tomato adds a juicy vegetable layer to the sandwich.',
    });
  });

  it('uses a generic sentence when nothing else is known', () => {
    const orphan = { ...node(sunScene, 'e_east'), id: 'x', label: 'Mystery' };
    expect(nodeInfo(sun, orphan).summary).toBe('Mystery is part of this diagram.');
  });
});

describe('fitDistance', () => {
  const cube = fitPoints(
    {
      ...sunScene,
      nodes: [{ ...sunScene.nodes[0]!, primitive: 'box', position: [0, 0, 0], size: [2, 2, 2] }],
    },
    false,
  ).slice(0, 8);

  it('fits a cube face-on exactly at the frustum edge', () => {
    // Front face at z = 1; half-height 1 must span tan(45°) × (d − 1).
    expect(fitDistance(cube, [0, 0, 0], [0, 0, 1], 90, 1, 1)).toBeCloseTo(2, 6);
    expect(fitDistance(cube, [0, 0, 0], [0, 1, 0], 90, 1, 1)).toBeCloseTo(2, 6);
  });

  it('adds padding with the margin and grows for narrow viewports', () => {
    const d = (aspect: number, margin: number) =>
      fitDistance(cube, [0, 0, 0], [0, 0, 1], 40, aspect, margin);
    expect(d(1.5, 1.1)).toBeGreaterThan(d(1.5, 1));
    expect(d(0.5, 1)).toBeGreaterThan(d(2, 1));
  });

  it('centres on the points', () => {
    expect(centerOf(cube)).toEqual([0, 0, 0]);
    expect(centerOf([])).toEqual([0, 0, 0]);
  });
});
