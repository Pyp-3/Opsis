import { readFileSync } from 'node:fs';
import { renderTemplate, type Audience, type LLMRequest } from '@opsis/parse';
import { generateJsonSchema, type Explanation } from '@opsis/schema';
import { renderAudienceGuidance } from './audience';
import type { NodeContext } from './context';

/** Versioned ids of the templates in `prompts/`. Bump the version when a template changes. */
export const EXPLAIN_PROMPT_ID = 'explain/v1';
export const EXPLAIN_REPAIR_PROMPT_ID = 'explain-repair/v1';

export type ExplainLevel = Explanation['level'];

/** The identity fields every reply must echo. */
export type ExplainRequestFields = {
  nodeId: string;
  osgId: string;
  level: ExplainLevel;
  audience: Audience;
};

/** The compact, data-only view of a node that the model sees. */
export type PromptContext = {
  utterance: string;
  node: { id: string; label: string; kind?: string; role?: string; summary?: string };
  facts: string[];
  notes: { kind: string; text: string }[];
  partsInDiagram: string[];
  path: string[];
};

/** A worked example embedded in the system prompt. */
export type ExplainExample = {
  request: ExplainRequestFields;
  context: PromptContext;
  output: Explanation;
};

function readPromptFile(name: string): string {
  return readFileSync(new URL(`../prompts/${name}`, import.meta.url), 'utf8');
}

/** Loads the golden worked examples bundled with the explain prompt. */
export function loadExplainExamples(): ExplainExample[] {
  return JSON.parse(readPromptFile('examples.v1.json')) as ExplainExample[];
}

/** Projects a NodeContext onto the fields the model is allowed to see. */
export function toPromptContext(context: NodeContext): PromptContext {
  const kind = context.entity?.kind ?? (context.relation ? 'relation' : undefined);
  return {
    utterance: context.utterance,
    node: {
      id: context.nodeId,
      label: context.label,
      ...(kind ? { kind } : {}),
      ...(context.visual ? { role: context.visual.role } : {}),
      ...(context.entity ? { summary: context.entity.summary } : {}),
    },
    facts: context.facts,
    notes: context.notes.map(({ kind: noteKind, text }) => ({ kind: noteKind, text })),
    partsInDiagram: context.parts,
    path: context.path,
  };
}

function renderExamples(examples: readonly ExplainExample[]): string {
  return examples
    .map(
      (example, index) =>
        `## Example ${index + 1}\n\nRequest: ${JSON.stringify(example.request)}\n\nContext: ${JSON.stringify(
          example.context,
        )}\n\nOutput:\n${JSON.stringify(example.output)}`,
    )
    .join('\n\n');
}

const BASE_REQUEST = {
  responseFormat: 'json',
  temperature: 0,
  maxOutputTokens: 1200,
} as const satisfies Partial<LLMRequest>;

/** Builds the explainer system prompt with the JSON Schema, audience rules and examples. */
export function buildExplainSystemPrompt(audience: Audience): string {
  return renderTemplate(readPromptFile('explain.v1.md'), {
    JSON_SCHEMA: JSON.stringify(generateJsonSchema('explanation')),
    AUDIENCE: audience,
    AUDIENCE_GUIDANCE: renderAudienceGuidance(audience),
    EXAMPLES: renderExamples(loadExplainExamples()),
  });
}

/** Builds the first-attempt explain request for one node. */
export function buildExplainRequest(
  context: NodeContext,
  request: ExplainRequestFields,
): LLMRequest {
  return {
    ...BASE_REQUEST,
    promptId: EXPLAIN_PROMPT_ID,
    system: buildExplainSystemPrompt(request.audience),
    user: renderTemplate(readPromptFile('explain-user.v1.md'), {
      REQUEST: JSON.stringify(request),
      CONTEXT: JSON.stringify(toPromptContext(context)),
    }).trim(),
  };
}

/** Builds the single repair request carrying the previous output and its validation errors. */
export function buildExplainRepairRequest(
  context: NodeContext,
  request: ExplainRequestFields,
  previousOutput: string,
  errors: readonly string[],
): LLMRequest {
  return {
    ...BASE_REQUEST,
    promptId: EXPLAIN_REPAIR_PROMPT_ID,
    system: buildExplainSystemPrompt(request.audience),
    user: renderTemplate(readPromptFile('explain-repair.v1.md'), {
      REQUEST: JSON.stringify(request),
      CONTEXT: JSON.stringify(toPromptContext(context)),
      PREVIOUS_OUTPUT: previousOutput.slice(0, 8000),
      ERRORS: errors.map((error) => `- ${error}`).join('\n'),
    }).trim(),
  };
}
