import { PRIMITIVE_CATALOG } from '@opsis/primitives/match';
import type {
  MetaphorId,
  PrimitiveId,
  SceneIntent,
  SemanticGraph,
  VisualPlan,
} from '@opsis/schema';
import type { PrimitiveChoice } from './primitives';

/** Versioned id of the D-004 eligibility policy. Bump when a condition changes. */
export const CURATOR_ID = 'dimension-curator/v1';

/** Renderer capability that must be certified before a compass scene may open in 3D (D-004). */
export const COMPASS_3D_CAPABILITY = 'compass-3d/v1';

/**
 * Versioned renderer-capability manifest: capability id → certified by the stage-4 invariant
 * suite. Absent or unknown ids count as uncertified.
 */
export type RendererCapabilities = Readonly<Record<string, boolean>>;

/** Deterministic stage-2 configuration. `compass-3d/v1` stays false until stage 4 certifies it. */
export const RENDERER_CAPABILITIES: RendererCapabilities = Object.freeze({
  [COMPASS_3D_CAPABILITY]: false,
});

/** Largest scene that may open in 3D (reveal-plan budget and the unproven 3D FPS gate). */
export const MAX_3D_NODES = 12;

/** Metaphors whose picture is spatial; every other metaphor is always 2D (D-004 condition 1). */
const SPATIAL_METAPHORS: ReadonlySet<MetaphorId> = new Set(['compass', 'stack', 'container']);

/** Capability each spatial metaphor needs, if any (D-004 condition 5). */
const REQUIRED_CAPABILITY: Partial<Record<MetaphorId, string>> = {
  compass: COMPASS_3D_CAPABILITY,
};

/** Catalog categories that never justify a 3D scene (D-004 condition 2). */
const FLAT_CATEGORIES: ReadonlySet<string> = new Set(['generic', 'flow', 'measure']);

const catalog = new Map(PRIMITIVE_CATALOG.map((m) => [m.id, m]));

function isSolid(primitive: PrimitiveId): boolean {
  const meta = catalog.get(primitive);
  return (
    meta !== undefined && !FLAT_CATEGORIES.has(meta.category) && meta.dimensions.includes('3d')
  );
}

/** Why a scene was kept in 2D; `eligible` alone means it opens in 3D. */
export type DimensionReason =
  | 'eligible'
  | 'metaphor_not_spatial'
  | 'flat_primitive'
  | 'low_confidence'
  | 'abstract_placeholder'
  | 'too_many_nodes'
  | 'capability_uncertified';

/** The curator's decision for one scene, for diagnostics (never part of the VP/OSG). */
export type DimensionDecision = {
  sceneId: string;
  dimension: '2d' | '3d';
  reasons: DimensionReason[];
  /** One short sentence naming the deciding facts; no prompts, model output or credentials. */
  rationale: string;
};

export type CurateContext = {
  sg: SemanticGraph;
  choices: ReadonlyMap<string, PrimitiveChoice>;
  capabilities?: RendererCapabilities;
};

/**
 * D-004 curated 3D eligibility for one scene. A pure function of the scene, SG, primitive
 * choices, catalog and capability manifest; nothing here reads an LLM answer directly.
 */
export function curateScene(scene: SceneIntent, ctx: CurateContext): DimensionDecision {
  const capabilities = ctx.capabilities ?? RENDERER_CAPABILITIES;
  const entities = new Map(ctx.sg.entities.map((e) => [e.id, e]));
  const reasons: DimensionReason[] = [];
  const facts: string[] = [];

  if (!SPATIAL_METAPHORS.has(scene.metaphor)) {
    reasons.push('metaphor_not_spatial');
    facts.push(`${scene.metaphor} reads best flat`);
  }

  // Synthetic anchors (the compass dial) and bearing cards the metaphor places itself are drawn
  // by the scene, not chosen per entity, so they do not count against condition 2.
  const drawn = scene.nodes.filter(
    (n) => entities.has(n.id) && ctx.choices.get(n.id)?.source !== 'reserved',
  );
  const flat = drawn.filter((n) => !isSolid(n.primitive)).map((n) => n.id);
  if (flat.length > 0) {
    reasons.push('flat_primitive');
    facts.push(`no solid primitive for ${flat.join(', ')}`);
  }

  const shown = scene.nodes.flatMap((n) => entities.get(n.id) ?? []);
  const unsure = shown.filter((e) => e.attributes?.confidence === 'low').map((e) => e.id);
  if (unsure.length > 0) {
    reasons.push('low_confidence');
    facts.push(`low confidence in ${unsure.join(', ')}`);
  }
  const abstract = shown.filter((e) => e.kind === 'abstract_concept').map((e) => e.id);
  if (abstract.length > 0) {
    reasons.push('abstract_placeholder');
    facts.push(`abstract ${abstract.join(', ')}`);
  }

  if (scene.nodes.length > MAX_3D_NODES) {
    reasons.push('too_many_nodes');
    facts.push(`${scene.nodes.length} nodes exceed ${MAX_3D_NODES}`);
  }

  const capability = REQUIRED_CAPABILITY[scene.metaphor];
  if (capability !== undefined && capabilities[capability] !== true) {
    reasons.push('capability_uncertified');
    facts.push(`${capability} is not certified`);
  }

  if (reasons.length === 0) {
    return {
      sceneId: scene.id,
      dimension: '3d',
      reasons: ['eligible'],
      rationale: `3d: ${scene.metaphor} of solid parts passes ${CURATOR_ID}`,
    };
  }
  return { sceneId: scene.id, dimension: '2d', reasons, rationale: `2d: ${facts.join('; ')}` };
}

/** Applies {@link curateScene} to every scene; returns the plan with only `dimension` changed. */
export function curatePlan(
  plan: VisualPlan,
  ctx: CurateContext,
): { plan: VisualPlan; dimensions: DimensionDecision[] } {
  const dimensions = plan.scenes.map((scene) => curateScene(scene, ctx));
  return {
    plan: {
      ...plan,
      scenes: plan.scenes.map((scene, i) => ({
        ...scene,
        dimension: dimensions[i]?.dimension ?? '2d',
      })),
    },
    dimensions,
  };
}
