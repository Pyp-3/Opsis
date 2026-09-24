import {
  FALLBACK_PRIMITIVE_ID,
  MATCH_THRESHOLD,
  matchPrimitive,
  rankPrimitives,
} from '@opsis/primitives/match';
import type { Entity, PrimitiveId } from '@opsis/schema';

/** How an entity's primitive was decided. */
/**
 * `reserved`: the entity matched a primitive the metaphor draws itself (a bearing word matches the
 * compass), so it is shown as a card; the matcher settled it, so the LLM is not asked.
 */
export type PrimitiveSource = 'keyword' | 'reserved' | 'fallback' | 'llm';

/** The primitive chosen for one SG entity. */
export type PrimitiveChoice = {
  primitive: PrimitiveId;
  source: PrimitiveSource;
  /** Keyword score of the best match (0 when nothing matched). */
  score: number;
  /** When ≥ 2 primitives share the top keyword score, all of them (registry order). */
  tied?: PrimitiveId[];
};

/**
 * Primitives drawn by the metaphor itself, never by an entity: a direction word such as "east"
 * keyword-matches `compass`, but the compass is the scene's anchor and the direction entity is a
 * card at its bearing (PROMPT.md §10.1 rule 1).
 */
const RESERVED: ReadonlySet<PrimitiveId> = new Set(['compass']);

/**
 * Verbs only take a primitive on a (near-)exact keyword: fuzzy spelling would draw "drain" as a
 * raindrop or "boil" as a bowl, which teaches the wrong thing. Unmatched verbs go to the LLM.
 */
const ACTION_THRESHOLD = 0.9;

/** Maps an entity to a primitive with the registry keyword matcher (PROMPT.md §9). */
export function matchEntity(entity: Entity): PrimitiveChoice {
  const query = { lemma: entity.lemma, surface: entity.surface, kind: entity.kind };
  const threshold = entity.kind === 'action' ? ACTION_THRESHOLD : MATCH_THRESHOLD;
  const match = matchPrimitive(query, threshold);
  if (match.fallback || RESERVED.has(match.id)) {
    const source = match.fallback ? 'fallback' : 'reserved';
    return { primitive: FALLBACK_PRIMITIVE_ID, source, score: match.score };
  }
  const tied = rankPrimitives(query)
    .filter((m) => m.score === match.score)
    .map((m) => m.id);
  return {
    primitive: match.id,
    source: 'keyword',
    score: match.score,
    ...(tied.length > 1 ? { tied } : {}),
  };
}

/** Keyword choices for every entity, keyed by entity id. */
export function matchEntities(entities: readonly Entity[]): Map<string, PrimitiveChoice> {
  return new Map(entities.map((e) => [e.id, matchEntity(e)]));
}
