// @vitest-environment jsdom
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { PALETTES, type ColorToken } from '@opsis/ui';
import { describe, expect, it } from 'vitest';
import { PRIMITIVES } from './registry';
import type { PrimitiveDef, PrimitiveProps } from './types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const props = (def: PrimitiveDef): PrimitiveProps => ({
  color: PALETTES.default[def.colorToken],
  tone: (t: ColorToken) => PALETTES.default[t],
  size: [2, 0.5, 1],
  label: def.id,
  kind: 'direction',
  highlightAnchors: ['E'],
  emphasis: true,
});

describe('primitive renderers', () => {
  it.each(PRIMITIVES.map((p) => [p.id, p] as const))('%s renders 3D geometry', async (_, def) => {
    const Render = def.render3D;
    if (!Render) throw new Error('missing render3D');
    const renderer = await ReactThreeTestRenderer.create(<Render {...props(def)} />);
    const drawn = renderer.scene.findAll((n) => n.type === 'Mesh' || n.type === 'LineSegments');
    expect(drawn.length).toBeGreaterThan(0);
    await renderer.unmount();
  });

  it.each(PRIMITIVES.filter((p) => p.render2D).map((p) => [p.id, p] as const))(
    '%s renders a labelled SVG',
    (_, def) => {
      const Render = def.render2D;
      if (!Render) throw new Error('missing render2D');
      const html = renderToStaticMarkup(<Render {...props(def)} />);
      expect(html).toMatch(/^<svg/);
      expect(html).toContain(`aria-label="${def.id}"`);
    },
  );
});
