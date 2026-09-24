import { layoutVisualPlan, uuidFromSeed } from '@opsis/layout';
import { selectMetaphor, type LLMUsage } from '@opsis/metaphor';
import { parseUtterance, type Audience, type LLMClient, type ParseSource } from '@opsis/parse';
import { OSGSchema, type OSG } from '@opsis/schema';
import { buildNodeContext, type NodeContext } from './context';
import { ExplainError } from './errors';
import { explainNode } from './explain';
import { offlineParts } from './fallback';
import { sanitizeParts } from './validate';

/** Loads a stored OSG by id (the API's store); resolves undefined when it does not exist. */
export type OSGLoader = (osgId: string) => OSG | undefined | Promise<OSG | undefined>;

export type DrilldownOptions = {
  loadOsg: OSGLoader;
  /** Used for parsing, metaphor tie-breaks and, if needed, suggesting parts. Omit to stay offline. */
  llm?: LLMClient | null;
  audience?: Audience;
  /** Parts to open, e.g. a cached Explanation's `suggestedDrillDown`. Takes precedence. */
  parts?: readonly string[];
  /** ISO timestamp for the child; defaults to the deterministic seed-based time. */
  createdAt?: string;
};

/** Where the drill-down parts came from. */
export type PartsSource = 'provided' | 'graph' | 'known_parts' | 'llm';

/** The context-enriched sentence a drill-down renders, and how it was chosen. */
export type DrilldownPlan = {
  nodeId: string;
  /** Breadcrumb label for the child, at most 4 words. */
  label: string;
  parts: string[];
  partsSource: PartsSource;
  utterance: string;
};

export type DrilldownResult = {
  osg: OSG;
  plan: DrilldownPlan;
  parseSource: ParseSource;
  partsSource: PartsSource;
  /** Metaphor-stage provenance used by API cache identity selection. */
  metaphorLLM: LLMUsage;
  /** True when the child SG came from the rule-based fallback parser. */
  flagged: boolean;
};

/** Nouns read without "a"/"an" ("Bread has crust and crumb."). */
const MASS_NOUNS = new Set([
  'air',
  'blood',
  'bread',
  'food',
  'milk',
  'oxygen',
  'rain',
  'sand',
  'soil',
  'sugar',
  'sunlight',
  'water',
]);

function subject(name: string): string {
  if (MASS_NOUNS.has(name)) return name.charAt(0).toUpperCase() + name.slice(1);
  if (name === 'sun' || name === 'earth') return `The ${name}`;
  return `${/^[aeiou]/u.test(name) ? 'An' : 'A'} ${name}`;
}

function list(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** "A tomato has skin, flesh and seeds." — the child sentence for a node and its parts. */
export function enrichedUtterance(name: string, parts: readonly string[]): string {
  return `${subject(name)} has ${list(parts)}.`;
}

function breadcrumbLabel(label: string): string {
  const words = label.trim().split(/\s+/u).slice(0, 4).join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

async function resolveParts(
  parent: OSG,
  context: NodeContext,
  options: DrilldownOptions,
): Promise<{ parts: string[]; source: PartsSource }> {
  if (options.parts) {
    const provided = sanitizeParts(options.parts, context.name);
    if (provided.length > 0) return { parts: provided, source: 'provided' };
  }
  if (context.parts.length > 0) {
    return { parts: sanitizeParts(context.parts, context.name), source: 'graph' };
  }
  const known = offlineParts(context);
  if (known.length > 0) return { parts: known, source: 'known_parts' };
  if (options.llm) {
    const { explanation, source } = await explainNode(
      context.nodeId,
      parent,
      'explanation',
      options.audience ?? 'teen',
      options.llm,
    );
    const suggested = sanitizeParts(explanation.suggestedDrillDown ?? [], context.name);
    if (source !== 'fallback' && explanation.confidence !== 'low' && suggested.length > 0) {
      return { parts: suggested, source: 'llm' };
    }
  }
  throw new ExplainError(
    'no_parts',
    `Opsis doesn't know what is inside "${context.label}" yet. Try describing its parts in a new sentence.`,
    'drilldown',
  );
}

/** Chooses the parts and the context-enriched utterance for drilling into one node. */
export async function planDrilldown(
  parent: OSG,
  nodeId: string,
  options: DrilldownOptions,
): Promise<DrilldownPlan> {
  const context = buildNodeContext(parent, nodeId, 'drilldown');
  if (context.relation) {
    throw new ExplainError(
      'not_drillable',
      'Only things in the diagram can be opened, not the links between them.',
      'drilldown',
    );
  }
  const { parts, source } = await resolveParts(parent, context, options);
  return {
    nodeId,
    label: breadcrumbLabel(context.label),
    parts,
    partsSource: source,
    utterance: enrichedUtterance(context.name, parts),
  };
}

/**
 * Drill-down (PROMPT.md §7.8, §11): runs parse → metaphor → layout on a context-enriched
 * sentence such as "A tomato has skin, flesh and seeds." and links the child to its parent via
 * `parentId` and an extended breadcrumb trail.
 */
export async function drilldownDetailed(
  osgId: string,
  nodeId: string,
  options: DrilldownOptions,
): Promise<DrilldownResult> {
  const stored = await options.loadOsg(osgId);
  if (!stored) {
    throw new ExplainError(
      'osg_not_found',
      'That diagram could not be found. Try drawing it again.',
      'drilldown',
    );
  }
  const parent = OSGSchema.parse(stored);
  const plan = await planDrilldown(parent, nodeId, options);
  const parsed = await parseUtterance(plan.utterance, {
    llm: options.llm ?? null,
    ...(options.audience ? { audience: options.audience } : {}),
  });
  const selected = await selectMetaphor(parsed.sg, { llm: options.llm ?? null });
  const visualPlan = selected.plan;
  const laidOut = await layoutVisualPlan(visualPlan, parsed.sg, {
    seed: parent.seed,
    ...(options.createdAt ? { createdAt: options.createdAt } : {}),
    parentId: parent.id,
  });
  // The layout id depends only on the child sentence; salt it with the parent so the same part
  // opened from two diagrams gets two documents.
  const id = uuidFromSeed(parent.seed, `${parent.id}>${nodeId}>${plan.utterance}`);
  const trail =
    parent.breadcrumbs.length > 0
      ? parent.breadcrumbs
      : [{ id: parent.id, label: breadcrumbLabel(parent.title) }];
  const osg = OSGSchema.parse({
    ...laidOut,
    id,
    parentId: parent.id,
    breadcrumbs: [...trail, { id, label: plan.label }],
  });
  return {
    osg,
    plan,
    parseSource: parsed.source,
    partsSource: plan.partsSource,
    metaphorLLM: selected.llm,
    flagged: parsed.flagged,
  };
}

/** `drilldownDetailed` without provenance: parent OSG id + node → child OSG. */
export async function drilldown(
  osgId: string,
  nodeId: string,
  options: DrilldownOptions,
): Promise<OSG> {
  return (await drilldownDetailed(osgId, nodeId, options)).osg;
}
