import { PRIMITIVE_CATALOG } from '@opsis/primitives/match';
import type {
  EntityKind,
  MetaphorId,
  PrimitiveId,
  Relation,
  SemanticGraph,
  VisualEdge,
  VisualNode,
} from '@opsis/schema';
import {
  assertedRelations,
  degreeRanking,
  entityOrder,
  findCycles,
  longestPath,
  relationComponents,
  treeRoot,
} from './graph';
import { labelFor } from './label';
import type { PrimitiveChoice } from './primitives';

/** The PROMPT.md §10.1 rules, in evaluation order. */
export const RULE_IDS = [
  'direction',
  'composition',
  'cycle',
  'sequence',
  'classification',
  'comparison',
  'actor_action',
  'default',
] as const;
export type RuleId = (typeof RULE_IDS)[number];

export type Role = VisualNode['role'];

/** A node the metaphor draws itself (compass dial, cycle ring…), not an SG entity. */
export type SyntheticAnchor = { id: string; primitive: PrimitiveId; label: string };

/** What a rule decided for one scene; `build.ts` turns it into a SceneIntent. */
export type SceneDraft = {
  metaphor: MetaphorId;
  anchor: { entity: string } | { synthetic: SyntheticAnchor };
  /** Entities whose role the rule fixes, in the order the layout should use. */
  core: { id: string; role: Role; highlight?: boolean }[];
  /** Entities shown in this scene; every entity when omitted. */
  members?: string[];
  /** Edges from the anchor to entities (e.g. compass → bearing, balance → pans). */
  anchorEdges?: { to: string; kind: VisualEdge['kind'] }[];
  /** Core `part` nodes are explodable (stack, container). */
  explodeParts?: boolean;
  /** Primitive for an entity anchor when the keyword matcher found none. */
  anchorFallback?: PrimitiveId;
  /** Equal-top-degree entities when the anchor was picked by centrality (LLM may break the tie). */
  anchorTie?: string[];
  camera: 'top' | 'front' | 'iso' | 'free';
};

export type Selection = { rule: RuleId; scenes: SceneDraft[] };

/** Inputs every rule may read. */
export type RuleContext = {
  sg: SemanticGraph;
  choices: ReadonlyMap<string, PrimitiveChoice>;
};

/** At most this many scenes per utterance (PROMPT.md §10.1). */
export const MAX_SCENES = 3;

const COMPOSITION: Relation['type'][] = ['has_part', 'contains'];
const SEQUENCE_KINDS: ReadonlySet<EntityKind> = new Set(['action', 'event', 'time']);
/** Parts that read as layers even without a food primitive (strata, atmosphere, earth). */
const LAYER_WORDS = new Set([
  'layer',
  'stratum',
  'strata',
  'crust',
  'mantle',
  'core',
  'inner core',
  'outer core',
  'troposphere',
  'stratosphere',
  'mesosphere',
  'thermosphere',
  'exosphere',
  'ionosphere',
  'topsoil',
  'subsoil',
  'bedrock',
  'sediment',
  'filling',
  'frosting',
  'icing',
  'sponge',
  'patty',
  'cheese',
  'lettuce',
]);
const LAYER_PRIMITIVES: ReadonlySet<PrimitiveId> = new Set([
  'stack_layer',
  'generic_layer',
  'bread_slice',
  'slice',
]);

const categoryOf = new Map(PRIMITIVE_CATALOG.map((m) => [m.id, m.category]));

function synthetic(sg: SemanticGraph, base: string, primitive: PrimitiveId, label: string) {
  const taken = new Set(sg.entities.map((e) => e.id));
  let id = `v_${base}`;
  for (let n = 2; taken.has(id); n++) id = `v_${base}_${n}`;
  return { synthetic: { id, primitive, label } };
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

/** Rule 1: any `direction` relation or entity ⇒ compass; bearings hang off the dial. */
function direction({ sg }: RuleContext): Selection | null {
  const relations = sg.relations.filter((r) => r.type === 'direction');
  const bearings = sg.entities.filter((e) => e.kind === 'direction').map((e) => e.id);
  if (relations.length === 0 && bearings.length === 0) return null;
  const kinds = new Map(sg.entities.map((e) => [e.id, e.kind]));
  const movers = unique(
    sg.relations
      .filter((r) => r.type === 'direction' || r.type === 'moves')
      .map((r) => r.source)
      .filter((id) => !bearings.includes(id)),
  );
  return {
    rule: 'direction',
    scenes: [
      {
        metaphor: 'compass',
        anchor: synthetic(sg, 'compass', 'compass', 'Compass'),
        core: [
          ...movers.map((id) => ({
            id,
            role: (kinds.get(id) === 'action' ? 'modifier' : 'actor') as Role,
          })),
          ...bearings.map((id) => ({ id, role: 'context' as Role, highlight: true })),
        ],
        anchorEdges: bearings.map((to) => ({ to, kind: 'line' as const })),
        camera: 'iso',
      },
    ],
  };
}

/** Rule 2: a whole with ≥ 2 has_part/contains targets ⇒ stack (layered parts) or container. */
function composition({ sg, choices }: RuleContext): Selection | null {
  const relations = assertedRelations(sg, COMPOSITION);
  const partsOf = new Map<string, Relation[]>();
  for (const r of relations) partsOf.set(r.source, [...(partsOf.get(r.source) ?? []), r]);
  const { ranked } = degreeRanking(sg);
  const wholes = [...partsOf.entries()]
    .map(([whole, rs]) => ({ whole, parts: unique(rs.map((r) => r.target)), rs }))
    .filter((w) => w.parts.length >= 2)
    .sort(
      (a, b) =>
        b.parts.length - a.parts.length || ranked.indexOf(a.whole) - ranked.indexOf(b.whole),
    );
  const top = wholes[0];
  if (!top) return null;
  const index = new Map(sg.relations.map((r, i) => [r.id, i]));
  const ordered = [...top.rs]
    .sort(
      (a, b) =>
        (a.order ?? Infinity) - (b.order ?? Infinity) ||
        (index.get(a.id) ?? 0) - (index.get(b.id) ?? 0),
    )
    .map((r) => r.target);
  const parts = unique(ordered).filter((id) => id !== top.whole);
  const lemmas = new Map(sg.entities.map((e) => [e.id, e.lemma.toLowerCase()]));
  const isLayer = (id: string) => {
    const primitive = choices.get(id)?.primitive;
    return (
      LAYER_WORDS.has(lemmas.get(id) ?? '') ||
      (primitive !== undefined &&
        (LAYER_PRIMITIVES.has(primitive) || categoryOf.get(primitive) === 'food'))
    );
  };
  const wholePrimitive = choices.get(top.whole)?.primitive;
  const wholeIsVessel =
    wholePrimitive !== undefined && categoryOf.get(wholePrimitive) === 'container';
  const layered = !wholeIsVessel && parts.filter(isLayer).length * 2 >= parts.length;
  return {
    rule: 'composition',
    scenes: [
      {
        metaphor: layered ? 'stack' : 'container',
        anchor: { entity: top.whole },
        core: parts.map((id) => ({ id, role: 'part' as Role })),
        explodeParts: true,
        anchorFallback: 'group_frame',
        camera: 'iso',
      },
    ],
  };
}

/** Rule 3: a `cycle` relation or a graph cycle over precedes/transforms_into ⇒ cycle. */
function cycle({ sg }: RuleContext): Selection | null {
  const explicit = assertedRelations(sg, ['cycle']);
  const [loop] = findCycles(sg, assertedRelations(sg, ['precedes', 'transforms_into', 'cycle']));
  const members = loop ?? unique(explicit.flatMap((r) => [r.source, r.target]));
  if (members.length === 0) return null;
  return {
    rule: 'cycle',
    scenes: [
      {
        metaphor: 'cycle',
        anchor: synthetic(sg, 'cycle', 'cycle_ring', 'Cycle'),
        core: members.map((id) => ({ id, role: 'part' as Role })),
        camera: 'front',
      },
    ],
  };
}

/**
 * Rule 4: a `precedes` path of ≥ 3 steps ⇒ timeline (actions/events/times) or flow (process).
 * See D-003: "≥ 3 precedes relations forming a path" is read as ≥ 3 steps on the path.
 */
function sequence({ sg }: RuleContext): Selection | null {
  const path = longestPath(sg, assertedRelations(sg, ['precedes']));
  if (path.length < 3) return null;
  const kinds = new Map(sg.entities.map((e) => [e.id, e.kind]));
  const timed = path.filter((id) => SEQUENCE_KINDS.has(kinds.get(id) ?? 'object')).length;
  const core = path.map((id) => ({ id, role: 'part' as Role }));
  if (timed * 2 >= path.length) {
    return {
      rule: 'sequence',
      scenes: [
        {
          metaphor: 'timeline',
          anchor: synthetic(sg, 'timeline', 'timeline_axis', 'Timeline'),
          core,
          camera: 'front',
        },
      ],
    };
  }
  const { ranked } = degreeRanking(sg);
  const [hub = ''] = [...path].sort((a, b) => ranked.indexOf(a) - ranked.indexOf(b));
  return {
    rule: 'sequence',
    scenes: [
      {
        metaphor: 'flow',
        anchor: { entity: hub },
        core: core.filter((c) => c.id !== hub),
        camera: 'front',
      },
    ],
  };
}

/** Rule 5: `is_a` relations forming a tree ⇒ tree, rooted at the most general class. */
function classification({ sg }: RuleContext): Selection | null {
  const relations = assertedRelations(sg, ['is_a']);
  const root = treeRoot(sg, relations);
  if (root === undefined) return null;
  const order = entityOrder(sg);
  const members = unique(relations.flatMap((r) => [r.source, r.target]))
    .filter((id) => id !== root)
    .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  return {
    rule: 'classification',
    scenes: [
      {
        metaphor: 'tree',
        anchor: { entity: root },
        core: members.map((id) => ({ id, role: 'part' as Role })),
        camera: 'front',
      },
    ],
  };
}

/** Rule 6: `compares` ⇒ scale; disjoint comparisons become side-by-side scenes (max 3). */
function comparison({ sg }: RuleContext): Selection | null {
  const compares = sg.relations.filter((r) => r.type === 'compares');
  if (compares.length === 0) return null;
  const groups = relationComponents(sg, compares).slice(0, MAX_SCENES);
  const scenes = groups.map((group, i): SceneDraft => {
    const neighbours =
      groups.length === 1
        ? undefined
        : unique([
            ...group,
            ...sg.relations
              .filter((r) => group.includes(r.source) || group.includes(r.target))
              .flatMap((r) => [r.source, r.target]),
          ]);
    return {
      metaphor: 'scale',
      anchor: synthetic(sg, i === 0 ? 'scale' : `scale_${i + 1}`, 'scale_balance', 'Balance'),
      core: group.map((id) => ({ id, role: 'object' as Role })),
      ...(neighbours ? { members: neighbours } : {}),
      anchorEdges: group.map((to) => ({ to, kind: 'line' as const })),
      camera: 'front',
    };
  });
  return { rule: 'comparison', scenes };
}

/** Rule 7: `agent_of` + `acts_on` ⇒ actor → action → object, anchored on the action. */
function actorAction({ sg }: RuleContext): Selection | null {
  const agentOf = sg.relations.filter((r) => r.type === 'agent_of');
  const actsOn = sg.relations.filter((r) => r.type === 'acts_on');
  if (agentOf.length === 0 || actsOn.length === 0) return null;
  const action =
    agentOf.find((a) => actsOn.some((o) => o.source === a.target))?.target ??
    agentOf[0]?.target ??
    '';
  const actors = unique(agentOf.filter((r) => r.target === action).map((r) => r.source));
  const objects = unique(actsOn.filter((r) => r.source === action).map((r) => r.target));
  return {
    rule: 'actor_action',
    scenes: [
      {
        metaphor: 'actor_action',
        anchor: { entity: action },
        core: [
          ...actors.map((id) => ({ id, role: 'actor' as Role })),
          ...objects
            .filter((id) => !actors.includes(id))
            .map((id) => ({ id, role: 'object' as Role })),
        ],
        anchorFallback: 'arrow',
        camera: 'front',
      },
    ],
  };
}

/** Rule 8: otherwise ⇒ flow anchored on the highest degree-centrality entity. */
function fallbackFlow({ sg }: RuleContext): Selection {
  const { ranked, tied } = degreeRanking(sg);
  const [top] = ranked;
  return {
    rule: 'default',
    scenes: [
      {
        metaphor: 'flow',
        anchor:
          top === undefined
            ? synthetic(sg, 'statement', 'labeled_card', labelFor(sg.utterance))
            : { entity: top },
        core: [],
        ...(tied.length > 1 ? { anchorTie: tied } : {}),
        camera: 'front',
      },
    ],
  };
}

const RULES: Record<Exclude<RuleId, 'default'>, (ctx: RuleContext) => Selection | null> = {
  direction,
  composition,
  cycle,
  sequence,
  classification,
  comparison,
  actor_action: actorAction,
};

/** Applies the §10.1 rules in order; the first that matches wins. */
export function applyRules(ctx: RuleContext): Selection {
  for (const id of RULE_IDS) {
    if (id === 'default') break;
    const selection = RULES[id](ctx);
    if (selection) return selection;
  }
  return fallbackFlow(ctx);
}
