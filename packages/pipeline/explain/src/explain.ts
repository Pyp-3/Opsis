import type { Audience, LLMClient } from '@opsis/parse';
import { OSGSchema, type Explanation, type OSG } from '@opsis/schema';
import { buildNodeContext } from './context';
import { fallbackExplanation } from './fallback';
import {
  buildExplainRepairRequest,
  buildExplainRequest,
  type ExplainLevel,
  type ExplainRequestFields,
} from './prompt';
import { validateExplanationReply } from './validate';

/** Where the returned explanation came from. */
export type ExplainSource = 'llm' | 'llm_repaired' | 'fallback';

/** Why the offline fallback was used. */
export type ExplainFallbackReason = 'no_llm_client' | 'llm_error' | 'invalid_llm_output';

/** Stage-5 output: a validated Explanation plus provenance for logs and caching. */
export type ExplainResult = {
  explanation: Explanation;
  source: ExplainSource;
  fallbackReason?: ExplainFallbackReason;
  /** Validation errors, transport errors and silent adjustments met along the way. */
  diagnostics: string[];
  /** Number of LLM calls made (0, 1 or 2). */
  llmCalls: number;
};

/**
 * Stage 5: node + OSG → Explanation (PROMPT.md §5.4, §7.8, §15). Asks the LLM once, repairs once
 * with the validation errors, then falls back to an SG-only explanation with `confidence: "low"`.
 * Throws ExplainError only when the node is not in the diagram.
 */
export async function explainNode(
  nodeId: string,
  osg: OSG,
  level: ExplainLevel,
  audience: Audience,
  llm?: LLMClient | null,
): Promise<ExplainResult> {
  const document = OSGSchema.parse(osg);
  const context = buildNodeContext(document, nodeId);
  const request: ExplainRequestFields = { nodeId, osgId: document.id, level, audience };
  const fallback = (
    reason: ExplainFallbackReason,
    diagnostics: string[],
    llmCalls: number,
  ): ExplainResult => ({
    explanation: fallbackExplanation(context, request),
    source: 'fallback',
    fallbackReason: reason,
    diagnostics,
    llmCalls,
  });
  if (!llm) return fallback('no_llm_client', [], 0);

  const diagnostics: string[] = [];
  let reply: string;
  try {
    reply = await llm.complete(buildExplainRequest(context, request));
  } catch (error) {
    return fallback('llm_error', [`llm call 1 failed: ${(error as Error).message}`], 1);
  }
  const first = validateExplanationReply(reply, context, request);
  if (first.ok) {
    return {
      explanation: first.explanation,
      source: 'llm',
      diagnostics: first.adjustments,
      llmCalls: 1,
    };
  }
  diagnostics.push(...first.errors.map((error) => `attempt 1: ${error}`));

  let repaired: string;
  try {
    repaired = await llm.complete(buildExplainRepairRequest(context, request, reply, first.errors));
  } catch (error) {
    diagnostics.push(`llm call 2 failed: ${(error as Error).message}`);
    return fallback('llm_error', diagnostics, 2);
  }
  const second = validateExplanationReply(repaired, context, request);
  if (second.ok) {
    return {
      explanation: second.explanation,
      source: 'llm_repaired',
      diagnostics: [...diagnostics, ...second.adjustments],
      llmCalls: 2,
    };
  }
  diagnostics.push(...second.errors.map((error) => `attempt 2: ${error}`));
  return fallback('invalid_llm_output', diagnostics, 2);
}

/** `explainNode` without provenance: node + OSG → validated `exp/1` Explanation. */
export async function explain(
  nodeId: string,
  osg: OSG,
  level: ExplainLevel,
  audience: Audience,
  llm?: LLMClient | null,
): Promise<Explanation> {
  return (await explainNode(nodeId, osg, level, audience, llm)).explanation;
}
