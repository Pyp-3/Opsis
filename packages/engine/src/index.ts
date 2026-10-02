import { z } from 'zod';
import { ProcessStepSchema, processProblems, type BoardNodeSchema } from '@opsis/schema';

const id = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/);
export const EngineRequestSchema = z
  .object({
    version: z.literal(1),
    nodes: z.array(z.object({ id, process: ProcessStepSchema }).strict()).max(50),
  })
  .strict()
  .superRefine((request, context) => {
    if (new Set(request.nodes.map((node) => node.id)).size !== request.nodes.length)
      context.addIssue({ code: 'custom', message: 'Process IDs must be unique.' });
    for (const message of processProblems(request.nodes))
      context.addIssue({ code: 'custom', message });
  });
export type EngineRequest = z.infer<typeof EngineRequestSchema>;

export const ProcessResultSchema = z
  .object({
    id,
    input: z.string().max(1000),
    output: z.string().max(1000),
    inputRows: z.number().int().min(0).max(100),
    outputRows: z.number().int().min(0).max(100),
    retained: z.array(z.number().int().min(0).max(99)).max(100),
    drawing: z
      .object({
        height: z.number().int().min(18).max(1008),
        paths: z
          .array(
            z
              .object({
                d: z
                  .string()
                  .max(100)
                  .regex(/^M [0-9 ]+(?:C|L) [0-9 ]+$/),
                kept: z.boolean(),
              })
              .strict(),
          )
          .max(100),
      })
      .strict(),
  })
  .strict();
export type ProcessResult = z.infer<typeof ProcessResultSchema>;
export const EngineResultSchema = z
  .object({ version: z.literal(1), nodes: z.array(ProcessResultSchema).max(50) })
  .strict();
export type EngineResult = z.infer<typeof EngineResultSchema>;
export const EngineResponseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), result: EngineResultSchema }).strict(),
  z.object({ ok: z.literal(false), error: z.string().max(2000) }).strict(),
]);

/** Persist calculated previews alongside their source operations for exports and older readers. */
export function applyProcessResults<T extends { nodes: z.infer<typeof BoardNodeSchema>[] }>(
  board: T,
  result: EngineResult,
): T {
  const values = new Map(result.nodes.map((node) => [node.id, node]));
  return {
    ...board,
    nodes: board.nodes.map((node) => {
      const value = values.get(node.id);
      if (!value || !node.terminal) return node;
      const terminal = {
        ...node.terminal,
        output: value.output,
        input: `${value.inputRows} example line${value.inputRows === 1 ? '' : 's'}`,
      };
      if (value.input) terminal.exampleInput = value.input;
      else delete terminal.exampleInput;
      return { ...node, terminal };
    }),
  };
}
