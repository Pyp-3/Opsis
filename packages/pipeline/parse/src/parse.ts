import { SemanticGraphSchema, type SemanticGraph } from '@opsis/schema';
import type { ZodError } from 'zod';
import { ParseError } from './errors';
import { ruleBasedParse } from './fallback';
import { stripFences, tryParseJson } from './json';
import type { LLMClient } from './llm-client';
import { attachKnownNotes } from './pedagogy';
import { buildParseRequest, buildRepairRequest, type Audience } from './prompt';
import { checkSafety, refusalMessage } from './safety';

/** Maximum utterance length accepted by the parser (PROMPT.md §11). */
export const MAX_UTTERANCE_LENGTH = 500;

/** Where the returned graph came from. */
export type ParseSource = 'llm' | 'llm_repaired' | 'rule_fallback';

/** Why the rule-based fallback was used. */
export type FallbackReason = 'no_llm_client' | 'llm_error' | 'invalid_llm_output';

/** Stage-1 output: a validated SG plus provenance. `flagged` is true whenever the fallback ran. */
export type ParseResult = {
  sg: SemanticGraph;
  source: ParseSource;
  flagged: boolean;
  fallbackReason?: FallbackReason;
  /** Validation or transport errors met along the way, for logs and debugging. */
  diagnostics: string[];
  /** Number of LLM calls made (0, 1 or 2). */
  llmCalls: number;
};

export type ParseOptions = {
  /** LLM client; omit (or pass null) to run fully offline on the rule-based parser. */
  llm?: LLMClient | null;
  audience?: Audience;
};

type Validation = { ok: true; sg: SemanticGraph } | { ok: false; errors: string[] };

function formatZodError(error: ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
}

/** Checks the rules Zod cannot know about: the utterance is echoed exactly and spans fit inside it. */
function checkAgainstUtterance(sg: SemanticGraph, utterance: string): string[] {
  const errors: string[] = [];
  if (sg.utterance !== utterance) errors.push('utterance: must be copied exactly from the input');
  const inBounds = ([start, end]: [number, number]) => start <= end && end <= utterance.length;
  sg.entities.forEach((entity, index) => {
    if (!inBounds(entity.span))
      errors.push(`entities.${index}.span: must lie within the utterance`);
  });
  sg.relations.forEach((relation, index) => {
    if (relation.evidenceSpan && !inBounds(relation.evidenceSpan)) {
      errors.push(`relations.${index}.evidenceSpan: must lie within the utterance`);
    }
  });
  return errors;
}

/** Strips fences, parses JSON and validates an LLM reply as an SG for this utterance. */
export function validateLLMOutput(raw: string, utterance: string): Validation {
  const json = tryParseJson(stripFences(raw));
  if (!json.ok) return { ok: false, errors: [json.error] };
  const parsed = SemanticGraphSchema.safeParse(json.value);
  if (!parsed.success) return { ok: false, errors: formatZodError(parsed.error) };
  const errors = checkAgainstUtterance(parsed.data, utterance);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, sg: parsed.data };
}

/** Trims the utterance and rejects empty, over-long or unsafe input with a friendly ParseError. */
export function prepareUtterance(raw: string): string {
  const utterance = raw.trim();
  if (utterance === '') {
    throw new ParseError('empty_utterance', 'Type a sentence for Opsis to draw.');
  }
  if (utterance.length > MAX_UTTERANCE_LENGTH) {
    throw new ParseError(
      'utterance_too_long',
      `That's a bit long. Please keep it to ${MAX_UTTERANCE_LENGTH} characters or fewer.`,
    );
  }
  const unsafe = checkSafety(utterance);
  if (unsafe) throw new ParseError('unsafe_input', refusalMessage(unsafe));
  return utterance;
}

function fallback(
  utterance: string,
  reason: FallbackReason,
  diagnostics: string[],
  llmCalls: number,
): ParseResult {
  const { sg, unmatched } = ruleBasedParse(utterance);
  // The fallback is deterministic code, but it is validated like any other stage output (§4.1).
  const validated = SemanticGraphSchema.parse(sg);
  return {
    sg: validated,
    source: 'rule_fallback',
    flagged: true,
    fallbackReason: reason,
    diagnostics: [
      ...diagnostics,
      ...unmatched.map((clause) => `rule fallback: no pattern matched "${clause}"`),
    ],
    llmCalls,
  };
}

/**
 * Stage 1: Utterance → Semantic Graph (PROMPT.md §7.3, §15). Asks the LLM once, repairs once with
 * the validation errors, then falls back to the deterministic rule-based parser and flags the
 * result. Throws ParseError only for input the user must change (empty, too long, unsafe).
 */
export async function parseUtterance(
  raw: string,
  options: ParseOptions = {},
): Promise<ParseResult> {
  const utterance = prepareUtterance(raw);
  const audience = options.audience ?? 'teen';
  const llm = options.llm;
  if (!llm) return fallback(utterance, 'no_llm_client', [], 0);

  const diagnostics: string[] = [];
  let reply: string;
  try {
    reply = await llm.complete(buildParseRequest(utterance, audience));
  } catch (error) {
    return fallback(utterance, 'llm_error', [`llm call 1 failed: ${(error as Error).message}`], 1);
  }
  const first = validateLLMOutput(reply, utterance);
  if (first.ok) {
    return {
      sg: attachKnownNotes(first.sg),
      source: 'llm',
      flagged: false,
      diagnostics,
      llmCalls: 1,
    };
  }
  diagnostics.push(...first.errors.map((error) => `attempt 1: ${error}`));

  let repaired: string;
  try {
    repaired = await llm.complete(buildRepairRequest(utterance, audience, reply, first.errors));
  } catch (error) {
    diagnostics.push(`llm call 2 failed: ${(error as Error).message}`);
    return fallback(utterance, 'llm_error', diagnostics, 2);
  }
  const second = validateLLMOutput(repaired, utterance);
  if (second.ok) {
    return {
      sg: attachKnownNotes(second.sg),
      source: 'llm_repaired',
      flagged: false,
      diagnostics,
      llmCalls: 2,
    };
  }
  diagnostics.push(...second.errors.map((error) => `attempt 2: ${error}`));
  return fallback(utterance, 'invalid_llm_output', diagnostics, 2);
}
