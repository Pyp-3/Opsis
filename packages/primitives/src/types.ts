import type { FC } from 'react';
import type { EntityKind, PrimitiveId } from '@opsis/schema';
import type { ColorToken } from '@opsis/ui';

/** A 3-vector as used throughout the OSG. */
export type Vec3 = [number, number, number];

/** Broad grouping of primitives (PROMPT.md §9). */
export type PrimitiveCategory =
  | 'direction'
  | 'container'
  | 'nature'
  | 'celestial'
  | 'food'
  | 'people'
  | 'flow'
  | 'shape'
  | 'measure'
  | 'generic';

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

/** A registered primitive (PROMPT.md §9). */
export type PrimitiveDef = {
  id: PrimitiveId;
  category: PrimitiveCategory;
  keywords: string[];
  dimensions: ('2d' | '3d')[];
  /** Default colour token when the node carries no `style.colorToken`. */
  colorToken: ColorToken;
  render3D?: FC<PrimitiveProps>;
  render2D?: FC<PrimitiveProps>;
  /** Attach points in the primitive's unit-cube space. */
  anchors: Record<string, Vec3>;
  explodeAxis?: Vec3;
  /** One-sentence description used when a node has no entity summary (e.g. a compass). */
  summary?: string;
  /** Short tags the scene draws at named anchors, e.g. compass letters. */
  anchorLabels?: Record<string, string>;
};
