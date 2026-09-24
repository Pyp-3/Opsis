import type { FC } from 'react';
import type { EntityKind } from '@opsis/schema';
import type { ColorToken } from '@opsis/ui';
import type { PrimitiveMeta, Vec3 } from './meta';

export type { PrimitiveCategory, PrimitiveMeta, Vec3 } from './meta';

/**
 * Props every primitive renderer receives. 3D primitives are authored inside a unit cube
 * centred on the origin; the scene scales them to the node's `size`.
 */
export type PrimitiveProps = {
  /** Main colour, already resolved from the node's colour token or the primitive default. */
  color: string;
  /** World-space size the scene will scale the unit cube to; lets details counter-scale. */
  size: Vec3;
  /** Resolves a secondary token against the active palette. */
  tone: (token: ColorToken) => string;
  /** The node's label; used by `labeled_card` and in SVG `<title>`s. */
  label?: string | undefined;
  /** Entity kind; drives the `labeled_card` icon. */
  kind?: EntityKind | undefined;
  /** The node asks to be emphasised (`style.emphasis: "highlight"`). */
  emphasis?: boolean;
  /** Anchor names to emphasise, e.g. `["E"]` on a compass. */
  highlightAnchors?: readonly string[];
};

/** A registered primitive (PROMPT.md §9): catalog metadata plus its renderers. */
export type PrimitiveDef = PrimitiveMeta & {
  render3D?: FC<PrimitiveProps>;
  render2D?: FC<PrimitiveProps>;
};
