import type { LLMClient } from '@opsis/parse';
import {
  SemanticGraphSchema,
  visualPlanSchemaFor,
  type SemanticGraph,
  type VisualPlan,
} from '@opsis/schema';
import { buildPlan } from './build';
import { askLLM, openQuestions, type EntityQuestion, type LLMUsage } from './llm';
import { matchEntities, type PrimitiveChoice } from './primitives';
import { applyRules, MAX_SCENES, type RuleId, type Selection } from './rules';

/** Output of the metaphor stage. */
export type MetaphorResult = {
  plan: VisualPlan;
  /** The §10.1 rule that decided the metaphor. */
  rule: RuleId;
  /** How each entity's primitive was chosen, keyed by entity id. */
  primitives: Record<string, PrimitiveChoice>;
  llm: LLMUsage;
};

export type SelectOptions = {
  /** Consulted only for anchor ties and unknown/tied entities. Omit to stay fully offline. */
  llm?: LLMClient | null;
};

/** Thrown when the stage would emit a plan that fails its own contract (a bug, never passed on). */
export class MetaphorPlanError extends Error {
  constructor(readonly issues: string[]) {
    super(`Visual plan failed validation: ${issues.join('; ')}`);
    this.name = 'MetaphorPlanError';
  }
}

type Draft = { sg: SemanticGraph; selection: Selection; choices: Map<string, PrimitiveChoice> };

function draft(input: SemanticGraph): Draft {
  const sg = SemanticGraphSchema.parse(input);
  const choices = matchEntities(sg.entities);
  const selection = applyRules({ sg, choices });
  return {
    sg,
    selection: { ...selection, scenes: selection.scenes.slice(0, MAX_SCENES) },
    choices,
  };
}

function questionsFor({ sg, selection, choices }: Draft) {
  const entities: EntityQuestion[] = sg.entities.flatMap((e) => {
    const choice = choices.get(e.id);
    if (choice?.source === 'fallback') return [{ id: e.id, lemma: e.lemma, kind: e.kind }];
    if (choice?.tied) return [{ id: e.id, lemma: e.lemma, kind: e.kind, candidates: choice.tied }];
    return [];
  });
  return openQuestions(sg, entities, selection.scenes[0]?.anchorTie);
}

function finish({ sg, selection, choices }: Draft, llm: LLMUsage): MetaphorResult {
  const plan = buildPlan(sg, selection, choices);
  const checked = visualPlanSchemaFor(sg).safeParse(plan);
  if (!checked.success) {
    throw new MetaphorPlanError(
      checked.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  }
  return {
    plan: checked.data,
    rule: selection.rule,
    primitives: Object.fromEntries(choices),
    llm,
  };
}

/**
 * SG → VP using only the deterministic rules: same SG, same plan. Unknown entities render as
 * `labeled_card`; anchor ties go to the earliest entity.
 */
export function selectMetaphorOffline(sg: SemanticGraph): MetaphorResult {
  return finish(draft(sg), { consulted: false, accepted: [], rejected: [] });
}

/**
 * SG → VP (PROMPT.md §7.4, §10.1). Rules decide first; the LLM is asked only when the rules left
 * an anchor tie or an entity with no (or a tied) primitive match, and each answer is validated
 * against the primitive registry before it is applied.
 */
export async function selectMetaphor(
  sg: SemanticGraph,
  options: SelectOptions = {},
): Promise<MetaphorResult> {
  const base = draft(sg);
  const question = options.llm ? questionsFor(base) : null;
  if (!options.llm || !question) {
    return finish(base, { consulted: false, accepted: [], rejected: [] });
  }
  const { answer, usage } = await askLLM(options.llm, question);
  const choices = new Map(base.choices);
  for (const [id, primitive] of answer.primitives) {
    const previous = choices.get(id);
    choices.set(id, { primitive, source: 'llm', score: previous?.score ?? 0 });
  }
  const scenes = base.selection.scenes.map((scene, i) =>
    i === 0 && answer.anchor !== undefined && 'entity' in scene.anchor
      ? {
          ...scene,
          anchor: { entity: answer.anchor },
          core: scene.core.filter((c) => c.id !== answer.anchor),
        }
      : scene,
  );
  return finish({ ...base, selection: { ...base.selection, scenes }, choices }, usage);
}
