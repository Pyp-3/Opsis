import type { PrimitiveId } from '@opsis/schema';
import { PRIMITIVE_CATALOG } from './catalog';
import * as R2 from './render2d';
import { Arrow, Compass, CurvedArrow, Horizon } from './render3d/direction';
import { LabeledCard } from './render3d/fallback';
import { Bar, CounterDots, CycleRing, ScaleBalance, TimelineAxis } from './render3d/flow';
import { BreadSlice, GenericLayer, RoundFruit, Slice } from './render3d/food';
import { Cloud, Earth, Leaf, Moon, Mountain, Raindrop, Sun, Tree, Water } from './render3d/nature';
import { Hand, Person } from './render3d/people';
import { Bowl, Box, Cell, GroupFrame, StackLayer } from './render3d/structure';
import type { PrimitiveDef } from './types';

export { FALLBACK_PRIMITIVE_ID } from './catalog';

/** 3D and 2D renderers per primitive; metadata lives in the React-free catalog. */
const RENDERERS: Partial<Record<PrimitiveId, Pick<PrimitiveDef, 'render3D' | 'render2D'>>> = {
  compass: { render3D: Compass, render2D: R2.Compass2D },
  arrow: { render3D: Arrow, render2D: R2.Arrow2D },
  curved_arrow: { render3D: CurvedArrow, render2D: R2.CurvedArrow2D },
  horizon: { render3D: Horizon, render2D: R2.Horizon2D },
  sun: { render3D: Sun, render2D: R2.Sun2D },
  moon: { render3D: Moon, render2D: R2.Moon2D },
  earth: { render3D: Earth, render2D: R2.Earth2D },
  cloud: { render3D: Cloud, render2D: R2.Cloud2D },
  raindrop: { render3D: Raindrop, render2D: R2.Raindrop2D },
  tree: { render3D: Tree, render2D: R2.Tree2D },
  leaf: { render3D: Leaf, render2D: R2.Leaf2D },
  water: { render3D: Water, render2D: R2.Water2D },
  mountain: { render3D: Mountain, render2D: R2.Mountain2D },
  box: { render3D: Box, render2D: R2.Box2D },
  stack_layer: { render3D: StackLayer, render2D: R2.Layer2D },
  bowl: { render3D: Bowl },
  cell: { render3D: Cell },
  group_frame: { render3D: GroupFrame, render2D: R2.GroupFrame2D },
  bread_slice: { render3D: BreadSlice, render2D: R2.BreadSlice2D },
  generic_layer: { render3D: GenericLayer, render2D: R2.Layer2D },
  round_fruit: { render3D: RoundFruit, render2D: R2.RoundFruit2D },
  slice: { render3D: Slice, render2D: R2.Slice2D },
  person: { render3D: Person, render2D: R2.Person2D },
  hand: { render3D: Hand },
  cycle_ring: { render3D: CycleRing, render2D: R2.CycleRing2D },
  timeline_axis: { render3D: TimelineAxis, render2D: R2.TimelineAxis2D },
  scale_balance: { render3D: ScaleBalance },
  bar: { render3D: Bar, render2D: R2.Bar2D },
  counter_dots: { render3D: CounterDots, render2D: R2.CounterDots2D },
  labeled_card: { render3D: LabeledCard, render2D: R2.LabeledCard2D },
};

/** Every primitive in the library (PROMPT.md §9). Order is the tie-break order for matching. */
export const PRIMITIVES: readonly PrimitiveDef[] = PRIMITIVE_CATALOG.map((meta) => ({
  ...meta,
  ...RENDERERS[meta.id],
}));

/** Registry keyed by primitive id (completeness against the schema enum is unit-tested). */
export const PRIMITIVE_REGISTRY = Object.fromEntries(
  PRIMITIVES.map((def) => [def.id, def]),
) as Record<PrimitiveId, PrimitiveDef>;

/** Looks up a primitive; unknown ids resolve to `labeled_card` so rendering never fails. */
export function getPrimitive(id: string): PrimitiveDef {
  return (
    (PRIMITIVE_REGISTRY as Record<string, PrimitiveDef | undefined>)[id] ??
    PRIMITIVE_REGISTRY.labeled_card
  );
}
