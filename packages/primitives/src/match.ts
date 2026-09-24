import type { EntityKind, PrimitiveId } from '@opsis/schema';
import { FALLBACK_PRIMITIVE_ID, PRIMITIVE_CATALOG } from './catalog';
import type { PrimitiveCategory, PrimitiveMeta } from './meta';

/** Minimum score for a keyword match to beat the `labeled_card` fallback (PROMPT.md §9). */
export const MATCH_THRESHOLD = 0.6;

/** What to match: a bare word/phrase, or an SG entity's lemma/surface/kind. */
export type PrimitiveQuery = string | { lemma: string; surface?: string; kind?: EntityKind };

/** Result of matching one query against the registry. */
export type PrimitiveMatch = {
  id: PrimitiveId;
  /** Score in [0, 1] of the best keyword match (even when it fell back). */
  score: number;
  /** True when no primitive reached the threshold and `labeled_card` was chosen. */
  fallback: boolean;
  /** The keyword that produced the score, if any. */
  keyword?: string;
};

const KIND_CATEGORIES: Partial<Record<EntityKind, PrimitiveCategory[]>> = {
  celestial_body: ['celestial'],
  direction: ['direction'],
  living_thing: ['nature', 'people'],
  person: ['people'],
  substance: ['food', 'nature'],
  quantity: ['measure'],
  time: ['flow'],
  process: ['flow'],
};

/** Lower-cases, strips punctuation and collapses whitespace. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/[\s_-]+/g, ' ')
    .trim();
}

/** Naive English singular form, good enough for keyword matching. */
export function singular(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (/(oes|ches|shes|xes|sses)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us')) return word.slice(0, -1);
  return word;
}

/** Levenshtein edit distance. */
function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min((prev[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = row;
  }
  return prev[b.length] ?? Math.max(a.length, b.length);
}

/**
 * Scores one term against one keyword:
 * exact (after singularising) 1.0; whole-token hit inside a phrase 0.85;
 * close spelling (≥ 0.75 similarity, words ≥ 5 letters) 0.9 × similarity;
 * shared prefix of ≥ 4 letters 0.7 × length ratio; otherwise 0.
 */
function scoreTerm(term: string, keyword: string): number {
  const phrase = term.split(' ').map(singular).join(' ');
  if (phrase === keyword || term === keyword) return 1;
  const tokens = phrase.split(' ');
  if (
    tokens.length > 1 &&
    (tokens.includes(keyword) || (phrase.includes(keyword) && keyword.includes(' ')))
  )
    return 0.85;
  let best = 0;
  for (const token of tokens) {
    if (token.length >= 4 && keyword.length >= 4) {
      // One changed letter in a 4-letter word is usually another word (seat/meat, cake/lake).
      if (Math.min(token.length, keyword.length) >= 5) {
        const similarity =
          1 - editDistance(token, keyword) / Math.max(token.length, keyword.length);
        if (similarity >= 0.75) best = Math.max(best, 0.9 * similarity);
      }
      const shorter = token.length < keyword.length ? token : keyword;
      const longer = shorter === token ? keyword : token;
      if (longer.startsWith(shorter)) best = Math.max(best, 0.7 * (shorter.length / longer.length));
    }
  }
  return best;
}

/** Terms to try for a query, most specific first. */
function termsOf(query: PrimitiveQuery): string[] {
  const raw = typeof query === 'string' ? [query] : [query.lemma, query.surface ?? ''];
  return [...new Set(raw.map(normalize).filter((t) => t.length > 0))];
}

/** Scores a single primitive definition against a query. */
export function scorePrimitive(
  def: PrimitiveMeta,
  query: PrimitiveQuery,
): { score: number; keyword?: string } {
  const terms = termsOf(query);
  const keywords = [def.id.replace(/_/g, ' '), ...def.keywords];
  let best: { score: number; keyword?: string } = { score: 0 };
  for (const term of terms) {
    for (const keyword of keywords) {
      const score = scoreTerm(term, keyword);
      if (score > best.score) best = { score, keyword };
    }
  }
  const kind = typeof query === 'string' ? undefined : query.kind;
  if (best.score > 0 && kind && KIND_CATEGORIES[kind]?.includes(def.category)) {
    best = { ...best, score: Math.min(1, best.score + 0.05) };
  }
  return best;
}

/** All non-fallback primitives with a positive score, best first (ties keep registry order). */
export function rankPrimitives(query: PrimitiveQuery): PrimitiveMatch[] {
  return PRIMITIVE_CATALOG.filter((def) => def.id !== FALLBACK_PRIMITIVE_ID)
    .map((def) => ({ def, ...scorePrimitive(def, query) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ def, score, keyword }) => ({
      id: def.id,
      score,
      fallback: false,
      ...(keyword !== undefined ? { keyword } : {}),
    }));
}

/**
 * Picks the best primitive for an entity. Below `threshold` (default 0.6) it returns
 * `labeled_card` with `fallback: true`, so a diagram never fails for lack of a primitive.
 */
export function matchPrimitive(query: PrimitiveQuery, threshold = MATCH_THRESHOLD): PrimitiveMatch {
  const [top] = rankPrimitives(query);
  if (top && top.score >= threshold) return top;
  return { id: FALLBACK_PRIMITIVE_ID, score: top?.score ?? 0, fallback: true };
}
