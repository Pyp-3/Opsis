import type { PositionedNode, SemanticGraph, VisualPlan } from '@opsis/schema';

export type Vector3 = [number, number, number];
export type Bounds = { min: Vector3; max: Vector3 };
export type LabelBox = { nodeId: string; position: Vector3; size: [number, number] };

export type LayoutOptions = {
  seed?: number;
  title?: string;
  createdAt?: string;
  breadcrumbs?: { id: string; label: string }[];
  parentId?: string;
};

export type AssembleOSGInput = LayoutOptions & { plan: VisualPlan; sg: SemanticGraph };
export type ZoomToFitOptions = {
  width: number;
  height: number;
  padding?: number;
  minScale?: number;
  maxScale?: number;
};
export type ZoomTransform = { center: Vector3; scale: number };
export type LayoutState = 'assembled' | 'exploded';
export type MutablePositionedNode = PositionedNode & { position: Vector3; size: Vector3 };
