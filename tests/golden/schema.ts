import {
  MetaphorIdSchema,
  PrimitiveIdSchema,
  RelationTypeSchema,
} from '../../packages/schema/src/index';
import { z } from 'zod';

export const GoldenExpectationSchema = z
  .object({
    expectedMetaphors: z.array(MetaphorIdSchema).min(1),
    requiredEntityLemmas: z.array(z.string().min(1)),
    requiredRelations: z.array(
      z
        .object({
          type: RelationTypeSchema,
          modality: z.enum(['certain', 'possible', 'typical', 'negated']),
          minimumCount: z.number().int().positive().optional(),
        })
        .strict(),
    ),
    explodableParts: z.array(z.string().min(1)),
    requiredPedagogyNoteKinds: z.array(z.enum(['misconception', 'nuance', 'safety', 'ambiguity'])),
    requiredPrimitives: z.array(PrimitiveIdSchema).optional(),
  })
  .strict();

export const GoldenCaseSchema = z
  .object({
    utterance: z.string().min(1),
    expectations: GoldenExpectationSchema,
  })
  .strict();

export type GoldenCase = z.infer<typeof GoldenCaseSchema>;

export type NamedGoldenCase = GoldenCase & { id: string };
