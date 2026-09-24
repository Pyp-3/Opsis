import type { PrimitiveId } from '@opsis/schema';
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

/** Render-free part of a primitive definition; safe to import without React. */
export type PrimitiveMeta = {
  id: PrimitiveId;
  category: PrimitiveCategory;
  keywords: string[];
  dimensions: ('2d' | '3d')[];
  /** Default colour token when the node carries no `style.colorToken`. */
  colorToken: ColorToken;
  /** Attach points in the primitive's unit-cube space. */
  anchors: Record<string, Vec3>;
  explodeAxis?: Vec3;
  /** One-sentence description used when a node has no entity summary (e.g. a compass). */
  summary?: string;
  /** Short tags the scene draws at named anchors, e.g. compass letters. */
  anchorLabels?: Record<string, string>;
};
