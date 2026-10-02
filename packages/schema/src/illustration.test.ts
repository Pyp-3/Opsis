import { describe, expect, it } from 'vitest';
import {
  BoardDocumentSchema,
  EMAIL_DEMO,
  EMAIL_DEMO_ILLUSTRATIONS,
  IllustrationSchema,
  CustomIconSchema,
  boardChanges,
  illustrateOutputSchema,
  boardOutputSchema,
  type Illustration,
} from './index';

const wind: Illustration = {
  layers: [
    {
      shape: 'path',
      d: 'M10 40 C30 30 50 50 80 40',
      stroke: 'sky',
      fill: 'none',
      motions: [
        { type: 'draw', duration: 0.8, repeat: 'once' },
        {
          type: 'move',
          duration: 2,
          repeat: 'loop',
          values: [
            [0, 0],
            [8, 0],
            [0, 0],
          ],
        },
      ],
    },
  ],
};

describe('illustrations', () => {
  it('accepts the demo drawings and a simple animated one', () => {
    for (const drawing of Object.values(EMAIL_DEMO_ILLUSTRATIONS))
      expect(IllustrationSchema.safeParse(drawing).success).toBe(true);
    expect(IllustrationSchema.parse(wind)).toEqual(wind);
  });
  it('rejects markup smuggled into path data', () => {
    const layer = { ...wind.layers[0]!, d: 'M0 0"/><script>alert(1)</script>' };
    expect(IllustrationSchema.safeParse({ layers: [layer] }).success).toBe(false);
  });
  it('requires each shape’s geometry and each motion’s values', () => {
    expect(
      IllustrationSchema.safeParse({
        layers: [{ shape: 'circle', cx: 50, cy: 50, stroke: 'gold', fill: 'none' }],
      }).success,
    ).toBe(false);
    expect(
      IllustrationSchema.safeParse({
        layers: [
          {
            ...wind.layers[0],
            motions: [{ type: 'rotate', duration: 1, repeat: 'loop', values: [0, 90] }],
          },
        ],
      }).success,
    ).toBe(false);
  });
  it('only morphs between paths with the same commands', () => {
    const morph = (shapes: string[]) =>
      IllustrationSchema.safeParse({
        layers: [
          {
            shape: 'path',
            d: 'M20 40 L50 60 L80 40',
            stroke: 'gold',
            fill: 'none',
            motions: [{ type: 'morph', duration: 2, repeat: 'loop', shapes }],
          },
        ],
      }).success;
    expect(morph(['M20 40 L50 60 L80 40', 'M20 40 L50 20 L80 40'])).toBe(true);
    expect(morph(['M20 40 L50 60 L80 40', 'M20 40 Q50 20 80 40'])).toBe(false);
  });
  it('is stored on objects without counting as a content change', () => {
    const before = { ...EMAIL_DEMO, version: 2 as const, agent: 'demo' as const, positions: {} };
    const after = {
      ...before,
      nodes: before.nodes.map((node) =>
        node.id === 'sender' ? { ...node, illustration: EMAIL_DEMO_ILLUSTRATIONS.sender } : node,
      ),
    };
    expect(BoardDocumentSchema.safeParse(after).success).toBe(true);
    expect(boardChanges(before, after)).toEqual([]);
  });
  it('is drawn on request, not with every diagram', () => {
    expect(boardOutputSchema).not.toContain('illustration');
    expect(JSON.parse(illustrateOutputSchema).properties.illustrations.type).toBe('array');
  });
});

describe('custom icons', () => {
  const kidney = {
    name: 'Kidney',
    layers: [
      { shape: 'path', d: 'M9 3C4 3 3 9 4 14s4 7 7 6c2-1 1-4 3-5s2-6-1-9C12 4 11 3 9 3Z' },
      { shape: 'circle', cx: 16, cy: 15, r: 1.5, fill: true },
      { shape: 'rect', x: 15, y: 17, width: 4, height: 5, rx: 1 },
    ],
  } as const;
  it('accepts a simple outline drawing on the 24 × 24 grid', () => {
    expect(CustomIconSchema.parse(kidney)).toEqual(kidney);
  });
  it('rejects markup, missing geometry, off-grid points and an empty name', () => {
    const invalid = [
      { ...kidney, layers: [{ shape: 'path', d: '<script>alert(1)</script>' }] },
      { ...kidney, layers: [{ shape: 'circle', cx: 12, cy: 12 }] },
      { ...kidney, layers: [{ shape: 'line', x1: 0, y1: 0, x2: 90, y2: 12 }] },
      { ...kidney, layers: [{ ...kidney.layers[1], stroke: 'gold' }] },
      { ...kidney, name: ' ' },
    ];
    for (const icon of invalid) expect(CustomIconSchema.safeParse(icon).success).toBe(false);
  });
  it('is offered with every diagram and redrawn without review', () => {
    expect(
      JSON.parse(boardOutputSchema).properties.nodes.items.properties.customIcon,
    ).toBeDefined();
    const before = { ...EMAIL_DEMO, version: 2 as const, agent: 'demo' as const, positions: {} };
    const after = {
      ...before,
      nodes: before.nodes.map((node) =>
        node.id === 'sender' ? { ...node, customIcon: kidney } : node,
      ),
    };
    expect(BoardDocumentSchema.safeParse(after).success).toBe(true);
    expect(boardChanges(before, after)).toEqual([]);
  });
});
