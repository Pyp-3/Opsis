import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  ErrorResponseSchema,
  ExplanationSchema,
  OSGSchema,
  SemanticGraphSchema,
  VisualPlanSchema,
} from './contracts';

export const promptSchemas = {
  semanticGraph: SemanticGraphSchema,
  visualPlan: VisualPlanSchema,
  osg: OSGSchema,
  explanation: ExplanationSchema,
  error: ErrorResponseSchema,
} as const satisfies Record<string, ZodTypeAny>;

export type PromptSchemaName = keyof typeof promptSchemas;

/** Generates draft-07 JSON Schema for prompt templates from the canonical Zod contract. */
export function generateJsonSchema(name: PromptSchemaName) {
  return zodToJsonSchema(promptSchemas[name], {
    name,
    target: 'jsonSchema7',
    $refStrategy: 'none',
  });
}

/** Generates all prompt-facing schemas keyed by their stable contract names. */
export function generatePromptJsonSchemas() {
  return Object.fromEntries(
    (Object.keys(promptSchemas) as PromptSchemaName[]).map((name) => [
      name,
      generateJsonSchema(name),
    ]),
  ) as { [Name in PromptSchemaName]: ReturnType<typeof generateJsonSchema> };
}
