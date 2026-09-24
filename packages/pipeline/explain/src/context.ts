import type {
  Entity,
  OSG,
  PedagogyNote,
  PositionedNode,
  Relation,
  RelationType,
  SemanticGraph,
} from '@opsis/schema';
import { ExplainError } from './errors';

/** Everything the explainer knows about one clicked node, drawn only from the OSG. */
export type NodeContext = {
  nodeId: string;
  osgId: string;
  utterance: string;
  /** Display label, e.g. "Tomato". */
  label: string;
  /** Lower-case name used in prose, e.g. "tomato". */
  name: string;
  entity?: Entity;
  relation?: Relation;
  visual?: PositionedNode;
  /** SG relations that involve this node (or the relation itself), in graph order. */
  relations: Relation[];
  /** Plain-language form of `relations`, e.g. "sandwich can contain tomato". */
  facts: string[];
  /** Pedagogy notes on the node or on relations that touch it. */
  notes: PedagogyNote[];
  /** Parts of this node named in the SG (has_part/contains targets), de-duplicated by lemma. */
  parts: string[];
  /** Names of the other entities this node is related to, in graph order. */
  linkedNames: string[];
  /** The whole this node is a part of (has_part/contains source), if any. */
  wholeName?: string;
  /** The parent diagram path, oldest first. */
  path: string[];
  /** True when the parser marked the entity `attributes.confidence = "low"`. */
  lowConfidence: boolean;
  /** Words from the utterance a grounded `whyItMattersHere` must mention at least one of. */
  groundingTerms: string[];
};

type Phrase = { third: string; base: string };

const VERBS: Record<RelationType, Phrase> = {
  has_part: { third: 'has', base: 'have' },
  contains: { third: 'contains', base: 'contain' },
  is_a: { third: 'is a kind of', base: 'be a kind of' },
  located_at: { third: 'is at', base: 'be at' },
  direction: { third: 'is towards', base: 'be towards' },
  moves: { third: 'moves by', base: 'move by' },
  causes: { third: 'causes', base: 'cause' },
  precedes: { third: 'comes before', base: 'come before' },
  cycle: { third: 'cycles into', base: 'cycle into' },
  compares: { third: 'is compared with', base: 'be compared with' },
  quantity: { third: 'has the amount', base: 'have the amount' },
  transforms_into: { third: 'turns into', base: 'turn into' },
  property_of: { third: 'describes', base: 'describe' },
  agent_of: { third: 'does', base: 'do' },
  acts_on: { third: 'acts on', base: 'act on' },
};

function verbFor(relation: Relation): string {
  const { third, base } = VERBS[relation.type];
  const copular = third.startsWith('is ');
  switch (relation.modality) {
    case 'possible':
      return `can ${base}`;
    case 'typical':
      return copular ? `is usually ${third.slice(3)}` : `usually ${third}`;
    case 'negated':
      return copular ? `is not ${third.slice(3)}` : `does not ${base}`;
    default:
      return third;
  }
}

/** "sandwich can contain tomato" — a neutral statement of one SG relation. */
export function describeRelation(relation: Relation, nameOf: (id: string) => string): string {
  return `${nameOf(relation.source)} ${verbFor(relation)} ${nameOf(relation.target)}`;
}

const PART_RELATIONS: ReadonlySet<RelationType> = new Set(['has_part', 'contains']);

function entityName(entity: Entity): string {
  return entity.lemma.toLowerCase();
}

/** Parts of `entityId` named in the graph, in written order, one per lemma. */
export function partsInGraph(sg: SemanticGraph, entityId: string): string[] {
  const byId = new Map(sg.entities.map((entity) => [entity.id, entity]));
  const parts = sg.relations
    .filter(
      (relation) =>
        relation.source === entityId &&
        PART_RELATIONS.has(relation.type) &&
        relation.modality !== 'negated',
    )
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((relation) => byId.get(relation.target))
    .filter((entity): entity is Entity => entity !== undefined)
    .map(entityName);
  return [...new Set(parts)];
}

function findVisual(osg: OSG, nodeId: string): PositionedNode | undefined {
  for (const scene of osg.scenes) {
    const node = scene.nodes.find((candidate) => candidate.id === nodeId);
    if (node) return node;
  }
  return undefined;
}

function groundingTermsOf(sg: SemanticGraph, label: string): string[] {
  const terms = new Set<string>();
  for (const entity of sg.entities) {
    terms.add(entity.lemma.toLowerCase());
    terms.add(entity.surface.toLowerCase());
  }
  terms.add(label.toLowerCase());
  return [...terms].filter((term) => term.length >= 2);
}

/**
 * Collects the context for one node of an OSG. Accepts scene node ids, SG entity ids and SG
 * relation ids; throws `node_not_found` for anything else.
 */
export function buildNodeContext(
  osg: OSG,
  nodeId: string,
  stage: 'explain' | 'drilldown' = 'explain',
): NodeContext {
  const { sg } = osg;
  const entities = new Map(sg.entities.map((entity) => [entity.id, entity]));
  const visual = findVisual(osg, nodeId);
  const entity = entities.get(nodeId);
  const relation = sg.relations.find((candidate) => candidate.id === nodeId);
  if (!visual && !entity && !relation) {
    throw new ExplainError(
      'node_not_found',
      'That part is not in this diagram any more. Try clicking it again.',
      stage,
    );
  }
  const nameOf = (id: string) => {
    const target = entities.get(id);
    return target ? entityName(target) : id;
  };

  const label =
    visual?.label ??
    (entity ? entity.surface : relation ? describeRelation(relation, nameOf) : nodeId);
  const name = entity ? entityName(entity) : label.toLowerCase();
  const touching = sg.relations.filter((candidate) =>
    relation
      ? candidate.id === relation.id
      : candidate.source === nodeId || candidate.target === nodeId,
  );
  const linkedNames = [
    ...new Set(
      touching
        .map((candidate) => (candidate.source === nodeId ? candidate.target : candidate.source))
        .filter((id) => id !== nodeId)
        .map(nameOf),
    ),
  ];
  const whole = sg.relations.find(
    (candidate) => candidate.target === nodeId && PART_RELATIONS.has(candidate.type),
  );
  const relatedIds = new Set([nodeId, ...touching.map((candidate) => candidate.id)]);

  return {
    nodeId,
    osgId: osg.id,
    utterance: osg.utterance,
    label,
    name,
    ...(entity ? { entity } : {}),
    ...(relation ? { relation } : {}),
    ...(visual ? { visual } : {}),
    relations: touching,
    facts: touching.map((candidate) => describeRelation(candidate, nameOf)),
    notes: (sg.notes ?? []).filter((note) => relatedIds.has(note.targetId)),
    parts: entity ? partsInGraph(sg, entity.id) : [],
    linkedNames,
    ...(whole ? { wholeName: nameOf(whole.source) } : {}),
    path: osg.breadcrumbs.map((crumb) => crumb.label),
    lowConfidence: entity?.attributes?.['confidence'] === 'low',
    groundingTerms: groundingTermsOf(sg, label),
  };
}
