import { readFileSync } from 'node:fs';
import { generateJsonSchema, type SemanticGraph } from '@opsis/schema';
import type { LLMRequest } from './llm-client';

/** Reader levels a prompt can target (PROMPT.md §5.4 `audience`). */
export type Audience = 'child' | 'teen' | 'adult';

/** Versioned ids of the templates in `prompts/`. Bump the version when a template changes. */
export const PARSE_PROMPT_ID = 'parse/v1';
export const REPAIR_PROMPT_ID = 'parse-repair/v1';

const AUDIENCE_GUIDANCE: Record<Audience, string> = {
  child: 'about 8 to 11 years old. Use short sentences and everyday words; avoid jargon.',
  teen: 'about 12 to 16 years old. Use clear sentences and give a brief definition for any key term.',
  adult: 'a curious adult. Be precise and concise; standard terminology is fine.',
};

/** A worked example embedded in the system prompt. */
export type PromptExample = { utterance: string; output: SemanticGraph };

function readPromptFile(name: string): string {
  return readFileSync(new URL(`../prompts/${name}`, import.meta.url), 'utf8');
}

/** Loads the golden worked examples bundled with the parse prompt. */
export function loadPromptExamples(): PromptExample[] {
  return JSON.parse(readPromptFile('examples.v1.json')) as PromptExample[];
}

/** Replaces every `{{KEY}}` placeholder; throws if the template references an unknown key. */
export function renderTemplate(template: string, values: Record<string, string>): string {
  const withoutHeader = template.replace(/^<!--[\s\S]*?-->\s*/u, '');
  return withoutHeader.replace(/\{\{([A-Z_]+)\}\}/gu, (_match, key: string) => {
    const value = values[key];
    if (value === undefined) throw new Error(`Missing prompt value for {{${key}}}`);
    return value;
  });
}

function renderExamples(examples: readonly PromptExample[]): string {
  return examples
    .map(
      (example, index) =>
        `## Example ${index + 1}\n\nUtterance: ${example.utterance}\n\nOutput:\n${JSON.stringify(example.output)}`,
    )
    .join('\n\n');
}

const BASE_REQUEST = {
  responseFormat: 'json',
  temperature: 0,
  maxOutputTokens: 2000,
} as const satisfies Partial<LLMRequest>;

/** Builds the system prompt for the semantic parser, embedding the JSON Schema and examples. */
export function buildSystemPrompt(audience: Audience): string {
  return renderTemplate(readPromptFile('semantic-parse.v1.md'), {
    JSON_SCHEMA: JSON.stringify(generateJsonSchema('semanticGraph')),
    AUDIENCE: audience,
    AUDIENCE_GUIDANCE: AUDIENCE_GUIDANCE[audience],
    EXAMPLES: renderExamples(loadPromptExamples()),
  });
}

/** Builds the first-attempt parse request for an utterance. */
export function buildParseRequest(utterance: string, audience: Audience): LLMRequest {
  return {
    ...BASE_REQUEST,
    promptId: PARSE_PROMPT_ID,
    system: buildSystemPrompt(audience),
    user: renderTemplate(readPromptFile('semantic-parse-user.v1.md'), {
      UTTERANCE: utterance,
    }).trim(),
  };
}

/** Builds the single repair request that carries the previous output and its validation errors. */
export function buildRepairRequest(
  utterance: string,
  audience: Audience,
  previousOutput: string,
  errors: readonly string[],
): LLMRequest {
  return {
    ...BASE_REQUEST,
    promptId: REPAIR_PROMPT_ID,
    system: buildSystemPrompt(audience),
    user: renderTemplate(readPromptFile('repair.v1.md'), {
      UTTERANCE: utterance,
      PREVIOUS_OUTPUT: previousOutput.slice(0, 8000),
      ERRORS: errors.map((error) => `- ${error}`).join('\n'),
    }).trim(),
  };
}
