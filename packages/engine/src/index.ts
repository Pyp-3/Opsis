import { z } from 'zod';
import { ProcessStepSchema, processProblems, type BoardNodeSchema } from '@opsis/schema';

const id = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/);
export const EngineRequestSchema = z
  .object({
    version: z.literal(3),
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
    status: z.literal('ok'),
    id,
    input: z.string().max(1000),
    output: z.string().max(1000),
    inputRows: z.number().int().min(0).max(100),
    outputRows: z.number().int().min(0).max(100),
    origins: z.array(z.array(z.number().int().min(0).max(99)).max(100)).max(100),
    inputs: z.array(z.object({ id, rows: z.number().int().min(0).max(100) }).strict()).max(10),
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

const error = (codes: [string, ...string[]]) =>
  z.object({ code: z.enum(codes), message: z.string().max(2000), source: id.optional() }).strict();
export const ProcessFailureSchema = z
  .object({
    status: z.literal('failed'),
    id,
    error: error([
      'missing_source',
      'cycle',
      'sample_too_long',
      'input_too_long',
      'too_many_lines',
      'count_out_of_range',
      'filter_too_long',
      'invalid_argument',
      'output_too_long',
      'upstream_failed',
    ]),
  })
  .strict();
export type ProcessFailure = z.infer<typeof ProcessFailureSchema>;
export const ProcessOutcomeSchema = z.discriminatedUnion('status', [
  ProcessResultSchema,
  ProcessFailureSchema,
]);
export type ProcessOutcome = z.infer<typeof ProcessOutcomeSchema>;
export const EngineResultSchema = z
  .object({ version: z.literal(3), nodes: z.array(ProcessOutcomeSchema).max(50) })
  .strict();
export type EngineResult = z.infer<typeof EngineResultSchema>;
export const EngineResponseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), result: EngineResultSchema }).strict(),
  z
    .object({
      ok: z.literal(false),
      error: error([
        'request_too_large',
        'invalid_request',
        'unsupported_version',
        'too_many_nodes',
        'invalid_id',
        'duplicate_id',
      ]),
    })
    .strict(),
]);

/** Persist calculated previews alongside their source operations for exports and older readers.
 * Failed steps keep their existing preview; the live view reports their failure instead. */
export function applyProcessResults<T extends { nodes: z.infer<typeof BoardNodeSchema>[] }>(
  board: T,
  result: EngineResult,
): T {
  const values = new Map(
    result.nodes.flatMap((node) => (node.status === 'ok' ? [[node.id, node] as const] : [])),
  );
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
