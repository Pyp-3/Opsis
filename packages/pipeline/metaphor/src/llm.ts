import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { LLMClient, LLMRequest } from '@opsis/parse';
import { renderTemplate, stripFences, tryParseJson } from '@opsis/parse';
import { isPrimitiveId, PRIMITIVE_CATALOG } from '@opsis/primitives/match';
import type { EntityKind, PrimitiveId, SemanticGraph } from '@opsis/schema';

/** Versioned id of `prompts/primitive-choice.v1.md`. Bump when the template changes. */
export const PRIMITIVE_PROMPT_ID = 'metaphor-primitive/v1';

/** One entity the rules could not map on their own. */
export type EntityQuestion = {
  id: string;
  lemma: string;
  kind: EntityKind;
  /** Tied keyword matches; absent when nothing matched (unknown entity). */
  candidates?: PrimitiveId[];
};

/** Everything the LLM is asked in a single call. */
export type LLMQuestion = {
  utterance: string;
  entities: EntityQuestion[];
  anchorCandidates?: string[];
};

/** The validated, accepted part of the LLM's answer. */
export type LLMAnswer = { primitives: Map<string, PrimitiveId>; anchor?: string };

/** Shape the model must return (checked again against the question and registry). */
export const LLMReplySchema = z
  .object({
    primitives: z.record(z.string()).default({}),
    anchor: z.string().optional(),
  })
  .strict();

/** What happened when the LLM was (or was not) consulted. */
export type LLMUsage = {
  consulted: boolean;
  /** Entity ids (or `anchor`) whose LLM answer passed validation and was applied. */
  accepted: string[];
  /** Entity ids (or `anchor`) whose LLM answer was discarded, and why. */
  rejected: { id: string; reason: string }[];
  /** Set when the call failed or the reply was unusable; rule results were kept. */
  error?: string;
};

function readPrompt(name: string): string {
  return readFileSync(new URL(`../prompts/${name}`, import.meta.url), 'utf8');
}

/** Builds the request for one tie-break / unknown-entity question. */
export function buildPrimitiveRequest(question: LLMQuestion): LLMRequest {
  const library = PRIMITIVE_CATALOG.map(
    (m) => `- ${m.id}: ${m.category} — ${m.keywords.join(', ')}`,
  ).join('\n');
  const system = renderTemplate(readPrompt('primitive-choice.v1.md'), {
    JSON_SCHEMA: JSON.stringify(zodToJsonSchema(LLMReplySchema, 'PrimitiveChoice'), null, 2),
    PRIMITIVES: library,
  });
  return {
    promptId: PRIMITIVE_PROMPT_ID,
    system,
    user: JSON.stringify(question),
    responseFormat: 'json',
    temperature: 0,
    maxOutputTokens: 512,
  };
}

/** Collects the questions the rules left open; returns null when there are none. */
export function openQuestions(
  sg: SemanticGraph,
  unknownOrTied: readonly EntityQuestion[],
  anchorTie: readonly string[] | undefined,
): LLMQuestion | null {
  if (unknownOrTied.length === 0 && !anchorTie) return null;
  return {
    utterance: sg.utterance,
    entities: [...unknownOrTied],
    ...(anchorTie ? { anchorCandidates: [...anchorTie] } : {}),
  };
}

/**
 * Asks the LLM and validates every answer against the question and the primitive registry.
 * Invalid entries are dropped one by one; a failed call or unparseable reply keeps every rule
 * result. Never throws.
 */
export async function askLLM(
  llm: LLMClient,
  question: LLMQuestion,
): Promise<{ answer: LLMAnswer; usage: LLMUsage }> {
  const usage: LLMUsage = { consulted: true, accepted: [], rejected: [] };
  const answer: LLMAnswer = { primitives: new Map() };
  let raw: string;
  try {
    raw = await llm.complete(buildPrimitiveRequest(question));
  } catch (error) {
    return { answer, usage: { ...usage, error: `LLM call failed: ${(error as Error).message}` } };
  }
  const parsed = tryParseJson(stripFences(raw));
  if (!parsed.ok) return { answer, usage: { ...usage, error: parsed.error } };
  const reply = LLMReplySchema.safeParse(parsed.value);
  if (!reply.success) {
    return {
      answer,
      usage: { ...usage, error: `Reply failed validation: ${reply.error.message}` },
    };
  }

  const asked = new Map(question.entities.map((e) => [e.id, e]));
  for (const [id, primitive] of Object.entries(reply.data.primitives).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const entity = asked.get(id);
    if (!entity) usage.rejected.push({ id, reason: 'entity was not asked about' });
    else if (!isPrimitiveId(primitive))
      usage.rejected.push({ id, reason: `unknown primitive "${primitive}"` });
    else if (entity.candidates && !entity.candidates.includes(primitive))
      usage.rejected.push({ id, reason: `"${primitive}" is not one of the tied candidates` });
    else {
      answer.primitives.set(id, primitive);
      usage.accepted.push(id);
    }
  }
  const { anchor } = reply.data;
  if (anchor !== undefined) {
    if (question.anchorCandidates?.includes(anchor)) {
      answer.anchor = anchor;
      usage.accepted.push('anchor');
    } else {
      usage.rejected.push({ id: 'anchor', reason: `"${anchor}" is not an anchor candidate` });
    }
  }
  return { answer, usage };
}
