import {
  createSgRef,
  type Entity,
  type PrimitiveId,
  type Relation,
  type SceneIntent,
  type SemanticGraph,
  type VisualEdge,
  type VisualNode,
  type VisualPlan,
} from '@opsis/schema';
import { labelFor } from './label';
import type { PrimitiveChoice } from './primitives';
import type { Role, SceneDraft, Selection } from './rules';

/** Kinds whose nodes have nothing to drill into (a verb, a bare number). */
const NOT_DRILLABLE: ReadonlySet<Entity['kind']> = new Set(['action', 'quantity']);

const EDGE_STYLE: Record<
  Relation['type'],
  { kind: VisualEdge['kind']; label?: string; animated?: boolean }
> = {
  has_part: { kind: 'containment' },
  contains: { kind: 'containment' },
  is_a: { kind: 'arrow', label: 'is a' },
  located_at: { kind: 'line', label: 'located at' },
  direction: { kind: 'arrow' },
  moves: { kind: 'path', animated: true },
  causes: { kind: 'arrow', label: 'leads to' },
  precedes: { kind: 'arrow', label: 'then' },
  cycle: { kind: 'arrow', animated: true },
  compares: { kind: 'line' },
  quantity: { kind: 'leader' },
  transforms_into: { kind: 'arrow', label: 'becomes' },
  property_of: { kind: 'leader' },
  agent_of: { kind: 'arrow' },
  acts_on: { kind: 'arrow' },
};

function edgeLabel(relation: Relation, subject: Entity | undefined): string | undefined {
  const base =
    relation.type === 'compares'
      ? String(subject?.attributes?.comparative ?? 'compared to')
      : EDGE_STYLE[relation.type].label;
  const composition = relation.type === 'has_part' || relation.type === 'contains';
  switch (relation.modality) {
    case 'negated':
      return labelFor(base ? `not ${base}` : 'not').toLowerCase();
    case 'possible':
      return composition ? 'optional' : labelFor(base ? `can ${base}` : 'can').toLowerCase();
    case 'typical':
      return labelFor(base ? `usually ${base}` : 'usually').toLowerCase();
    default:
      return base === undefined ? undefined : labelFor(base).toLowerCase();
  }
}

/** Default role for an entity the rule did not place. */
function defaultRole(sg: SemanticGraph, entity: Entity, metaphor: SceneIntent['metaphor']): Role {
  if (entity.kind === 'direction') return 'context';
  const as = (type: Relation['type'], end: 'source' | 'target') =>
    sg.relations.some((r) => r.type === type && r[end] === entity.id);
  if (as('agent_of', 'source')) return 'actor';
  if (as('acts_on', 'target')) return 'object';
  if (as('property_of', 'source') || as('quantity', 'source')) return 'modifier';
  return metaphor === 'flow' ? 'part' : 'context';
}

function buildScene(
  sg: SemanticGraph,
  draft: SceneDraft,
  index: number,
  choices: ReadonlyMap<string, PrimitiveChoice>,
): SceneIntent {
  const entities = new Map(sg.entities.map((e) => [e.id, e]));
  const possible = new Set(
    sg.relations.filter((r) => r.modality === 'possible').map((r) => r.target),
  );
  const anchorId = 'entity' in draft.anchor ? draft.anchor.entity : draft.anchor.synthetic.id;
  const memberIds = draft.members ?? sg.entities.map((e) => e.id);
  const core = new Map(draft.core.map((c) => [c.id, c]));
  const ordered = [
    ...draft.core.map((c) => c.id),
    ...memberIds.filter((id) => !core.has(id)),
  ].filter((id, i, all) => id !== anchorId && all.indexOf(id) === i && entities.has(id));

  const entityNode = (entity: Entity, role: Role, highlight = false): VisualNode => {
    const choice = choices.get(entity.id);
    let primitive: PrimitiveId = choice?.primitive ?? 'labeled_card';
    if (role === 'anchor' && choice?.source === 'fallback' && draft.anchorFallback) {
      primitive = draft.anchorFallback;
    }
    const isPart = role === 'part' && draft.explodeParts === true;
    return {
      id: entity.id,
      primitive,
      label: labelFor(entity.lemma),
      role,
      ...(possible.has(entity.id) ? { optional: true } : {}),
      ...(highlight ? { style: { emphasis: 'highlight' as const } } : {}),
      ...(isPart ? { explodable: true } : {}),
      ...(NOT_DRILLABLE.has(entity.kind) ? {} : { drillable: true }),
    };
  };

  const nodes: VisualNode[] = [];
  if ('synthetic' in draft.anchor) {
    const { id, primitive, label } = draft.anchor.synthetic;
    nodes.push({ id, primitive, label, role: 'anchor' });
  } else {
    const anchor = entities.get(anchorId);
    if (anchor) nodes.push(entityNode(anchor, 'anchor'));
  }
  for (const id of ordered) {
    const entity = entities.get(id);
    if (!entity) continue;
    const fixed = core.get(id);
    nodes.push(
      entityNode(
        entity,
        fixed?.role ?? defaultRole(sg, entity, draft.metaphor),
        fixed?.highlight ?? false,
      ),
    );
  }

  const present = new Set(nodes.map((n) => n.id));
  const edgeIds = new Set<string>();
  const edgeId = (base: string) => {
    let id = base;
    for (let n = 2; edgeIds.has(id); n++) id = `${base}_${n}`;
    edgeIds.add(id);
    return id;
  };
  const edges: VisualEdge[] = [];
  for (const to of draft.anchorEdges ?? []) {
    if (!present.has(to.to)) continue;
    edges.push({ id: edgeId(`ve_${anchorId}_${to.to}`), from: anchorId, to: to.to, kind: to.kind });
  }
  for (const relation of sg.relations) {
    if (!present.has(relation.source) || !present.has(relation.target)) continue;
    const style = EDGE_STYLE[relation.type];
    const label = edgeLabel(relation, entities.get(relation.source));
    edges.push({
      id: edgeId(`ve_${relation.id}`),
      from: relation.source,
      to: relation.target,
      kind: style.kind,
      ...(label ? { label } : {}),
      ...(style.animated ? { animated: true } : {}),
    });
  }

  return {
    id: `scene_${index + 1}`,
    metaphor: draft.metaphor,
    nodes,
    edges,
    camera: draft.camera,
    // Placeholder; the curator (curate.ts) decides every scene's dimension.
    dimension: '2d',
  };
}

/** Assembles the VisualPlan for a rule selection and the resolved primitives. */
export function buildPlan(
  sg: SemanticGraph,
  selection: Selection,
  choices: ReadonlyMap<string, PrimitiveChoice>,
): VisualPlan {
  const scenes = selection.scenes.map((draft, i) => buildScene(sg, draft, i, choices));
  const first = scenes[0]?.nodes.find((n) => n.role === 'anchor');
  return {
    schemaVersion: 'vp/1',
    sgRef: createSgRef(sg),
    anchor: first?.id ?? '',
    scenes,
  };
}
