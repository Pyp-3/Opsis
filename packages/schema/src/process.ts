import { z } from 'zod';

const reference = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/);
const count = z.number().int().min(0).max(100);
const flag = z.boolean().optional();
/** One character other than a line break, like the argument to `cut -d` or `paste -d`. */
const delimiter = z
  .string()
  .refine((value) => [...value].length === 1 && !/[\r\n]/.test(value), {
    message: 'Use one character other than a line break.',
  })
  .optional();
/** `tr` sets: literal characters and a-z style ranges; line breaks would merge rows. */
const charSet = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => !/[\r\n]/.test(value), { message: 'Sets cannot include line breaks.' });
const inputs = z.array(reference).min(2).max(10);

/** Declarative transformations of synthetic text. Never shell commands or filesystem paths. */
export const ProcessStepSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('source'), text: z.string().max(1000) }).strict(),
  z.object({ op: z.literal('pass'), from: reference }).strict(),
  z.object({ op: z.literal('head'), from: reference, count }).strict(),
  z.object({ op: z.literal('tail'), from: reference, count }).strict(),
  z
    .object({
      op: z.literal('sort'),
      from: reference,
      order: z.enum(['asc', 'desc']),
      numeric: flag,
      ignoreCase: flag,
    })
    .strict(),
  z
    .object({
      op: z.literal('filter'),
      from: reference,
      text: z.string().max(200),
      ignoreCase: flag,
      invert: flag,
    })
    .strict(),
  z.object({ op: z.literal('unique'), from: reference, withCounts: flag }).strict(),
  z.object({ op: z.literal('count'), from: reference }).strict(),
  z
    .object({
      op: z.literal('cut'),
      from: reference,
      fields: z.array(z.number().int().min(1).max(100)).min(1).max(20),
      delimiter,
    })
    .strict(),
  z.object({ op: z.literal('translate'), from: reference, set1: charSet, set2: charSet }).strict(),
  z.object({ op: z.literal('concat'), from: inputs }).strict(),
  z.object({ op: z.literal('paste'), from: inputs, delimiter }).strict(),
]);
export type ProcessStep = z.infer<typeof ProcessStepSchema>;
export type ProcessNode = { id: string; process?: ProcessStep | undefined };

/** The steps whose output `step` reads, in order. Empty only for sources. */
export function processSources(step: ProcessStep): string[] {
  return step.op === 'source' ? [] : typeof step.from === 'string' ? [step.from] : step.from;
}

/** Reject unresolved sources and cycles before requesting any calculation. */
export function processProblems(nodes: ProcessNode[]): string[] {
  const steps = new Map(
    nodes.flatMap((node) => (node.process ? [[node.id, node.process] as const] : [])),
  );
  const problems: string[] = [];
  const complete = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string) => {
    if (complete.has(id)) return;
    if (visiting.has(id)) {
      problems.push('Calculated process steps must not form a cycle.');
      return;
    }
    const step = steps.get(id);
    if (!step) {
      problems.push(`Process source ${id} must name a node with a process step.`);
      return;
    }
    if (
      step.op === 'source' &&
      (step.text ? step.text.split('\n').length - Number(step.text.endsWith('\n')) : 0) > 100
    )
      problems.push('Sample data is limited to 100 lines.');
    visiting.add(id);
    for (const source of processSources(step)) visit(source);
    visiting.delete(id);
    complete.add(id);
  };
  for (const id of steps.keys()) visit(id);
  return [...new Set(problems)];
}

/** Removing a source also removes dependent calculations, while keeping the diagram content. */
export function withoutBrokenProcesses<T extends ProcessNode>(nodes: T[]): T[] {
  const remaining = new Set(nodes.filter((node) => node.process).map((node) => node.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (
        remaining.has(node.id) &&
        node.process &&
        processSources(node.process).some((source) => !remaining.has(source))
      ) {
        remaining.delete(node.id);
        changed = true;
      }
    }
  }
  return nodes.map((node) => {
    if (!node.process || remaining.has(node.id)) return node;
    const copy = { ...node };
    delete copy.process;
    return copy;
  });
}
