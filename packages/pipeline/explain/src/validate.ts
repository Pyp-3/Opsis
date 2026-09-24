import { stripFences, tryParseJson } from '@opsis/parse';
import { countWords, ExplanationSchema, type Explanation } from '@opsis/schema';
import type { ZodError } from 'zod';
import type { NodeContext } from './context';
import type { ExplainRequestFields } from './prompt';

/** Maximum number of drill-down suggestions kept on an Explanation. */
export const MAX_DRILLDOWN_PARTS = 6;

export type ExplanationValidation =
  { ok: true; explanation: Explanation; adjustments: string[] } | { ok: false; errors: string[] };

/** Hedging words that contradict `confidence: "high"` (PROMPT.md §7.8: no speculation as fact). */
const HEDGES = [
  'probably',
  'perhaps',
  'maybe',
  'i think',
  'i believe',
  'i guess',
  'it seems',
  'presumably',
  'supposedly',
];

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/** True when `text` mentions one of the terms as a whole word (a trailing "s"/"es" is allowed). */
export function mentionsAny(text: string, terms: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return terms.some((term) =>
    new RegExp(`(^|[^\\p{L}])${escapeRegExp(term)}(e?s)?($|[^\\p{L}])`, 'u').test(lower),
  );
}

function hedgeIn(text: string): string | undefined {
  const lower = text.toLowerCase();
  return HEDGES.find((hedge) => new RegExp(`\\b${hedge}\\b`, 'u').test(lower));
}

/**
 * Normalises drill-down suggestions: lower case, no leading article, 1–4 words of letters only,
 * not the node itself, unique, at most MAX_DRILLDOWN_PARTS. Anything else is dropped because it
 * is later spliced into a drill-down utterance.
 */
export function sanitizeParts(parts: readonly string[], selfName: string): string[] {
  const self = selfName.toLowerCase();
  const kept: string[] = [];
  for (const raw of parts) {
    const part = raw
      .toLowerCase()
      .trim()
      .replace(/^(the|a|an)\s+/u, '')
      .replace(/\s+/gu, ' ');
    if (!/^\p{L}[\p{L}' -]*$/u.test(part)) continue;
    if (countWords(part) > 4 || part === self || kept.includes(part)) continue;
    kept.push(part);
    if (kept.length === MAX_DRILLDOWN_PARTS) break;
  }
  return kept;
}

function formatZodError(error: ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
}

/**
 * Strips fences, parses and validates an LLM reply as an Explanation for this request. Identity
 * fields are forced to the request's values; the checks Zod cannot express (sections required at
 * the explanation level, grounding in the utterance, no hedging at high confidence) are errors,
 * while honest-confidence capping and part clean-up are silent adjustments.
 */
export function validateExplanationReply(
  raw: string,
  context: NodeContext,
  request: ExplainRequestFields,
): ExplanationValidation {
  const json = tryParseJson(stripFences(raw));
  if (!json.ok) return { ok: false, errors: [json.error] };
  if (typeof json.value !== 'object' || json.value === null || Array.isArray(json.value)) {
    return { ok: false, errors: ['(root): must be a JSON object'] };
  }
  const candidate: Record<string, unknown> = {
    ...(json.value as Record<string, unknown>),
    schemaVersion: 'exp/1',
    ...request,
  };
  const adjustments: string[] = [];
  if (request.level === 'summary' && candidate['sections'] !== undefined) {
    delete candidate['sections'];
    adjustments.push('dropped sections from a summary-level reply');
  }
  const parsed = ExplanationSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, errors: formatZodError(parsed.error) };
  let explanation = parsed.data;

  const errors: string[] = [];
  const { sections } = explanation;
  if (request.level === 'explanation' && !sections) {
    errors.push('sections: required when level is "explanation"');
  }
  if (sections && !mentionsAny(sections.whyItMattersHere, context.groundingTerms)) {
    errors.push(
      `sections.whyItMattersHere: must refer to the student's sentence "${context.utterance}" by naming "${context.name}" or another thing in it`,
    );
  }
  if (explanation.confidence === 'high') {
    const texts = [explanation.summary, ...Object.values(sections ?? {})].filter(
      (text): text is string => text !== undefined,
    );
    const hedge = texts.map(hedgeIn).find((found) => found !== undefined);
    if (hedge) {
      errors.push(
        `confidence: the text hedges ("${hedge}"), so confidence cannot be "high"; state only sure facts or lower the confidence`,
      );
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  if (context.lowConfidence && explanation.confidence === 'high') {
    explanation = { ...explanation, confidence: 'medium' };
    adjustments.push('capped confidence at "medium": the parser was unsure about this node');
  }
  if (explanation.suggestedDrillDown) {
    const parts = sanitizeParts(explanation.suggestedDrillDown, context.name);
    const { suggestedDrillDown: original, ...rest } = explanation;
    explanation = parts.length > 0 ? { ...rest, suggestedDrillDown: parts } : rest;
    if (parts.length !== original.length) adjustments.push('removed invalid drill-down parts');
  }
  return { ok: true, explanation: ExplanationSchema.parse(explanation), adjustments };
}
