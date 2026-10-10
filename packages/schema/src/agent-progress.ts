import { z } from 'zod';
import { BoardNodeSchema } from './board';
import { AgentDrawingSchema } from './board-drawings';
import { ReportedUsageSchema } from './provider-usage';
export const AgentProgressSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('node'), node: BoardNodeSchema }),
  /** A sketch drawing validated as it streams in; provisional until the whole answer passes. */
  z.object({ type: z.literal('drawing'), drawing: AgentDrawingSchema }),
  z.object({ type: z.literal('preview-reset') }),
  z.object({ type: z.literal('usage'), usage: ReportedUsageSchema }),
  z.object({
    type: z.literal('phase'),
    phase: z.enum(['starting', 'thinking', 'writing', 'drafting']),
  }),
  z.object({
    type: z.literal('thinking'),
    tokens: z.number().finite().nonnegative().max(100000000),
  }),
  z.object({ type: z.literal('note'), text: z.string().max(1000), done: z.boolean() }),
  z.object({
    type: z.literal('drafting'),
    items: z.number().int().nonnegative().max(10000),
    links: z.number().int().nonnegative().max(10000),
    latest: z.string().max(1000).nullable(),
  }),
]);
export type AgentProgress = z.infer<typeof AgentProgressSchema>;
