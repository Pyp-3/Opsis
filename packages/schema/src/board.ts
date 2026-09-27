import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export const BOARD_ICONS = [
  'user',
  'mail',
  'send',
  'server',
  'inbox',
  'globe',
  'database',
  'shield',
  'clock',
  'alert',
  'check',
  'code',
  'file',
  'folder',
  'cloud',
  'cpu',
  'network',
  'key',
  'search',
  'lightbulb',
  'book',
  'leaf',
  'heart',
  'layers',
  'repeat',
  'split',
  'box',
  'settings',
  'zap',
  'message',
] as const;
export const BoardAgentSchema = z.enum(['claude', 'codex', 'demo']);
export type BoardAgent = z.infer<typeof BoardAgentSchema>;
export const BoardModelSettingsSchema = z
  .object({
    model: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/),
    effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']),
  })
  .strict();
export type BoardModelSettings = z.infer<typeof BoardModelSettingsSchema>;
export const DEFAULT_BOARD_MODELS: Record<'claude' | 'codex', BoardModelSettings> = {
  claude: { model: 'haiku', effort: 'low' },
  codex: { model: 'gpt-6-luna', effort: 'low' },
};
export const BOARD_MODEL_CHOICES = {
  claude: [
    { id: 'haiku', label: 'Haiku · economical' },
    { id: 'sonnet', label: 'Sonnet · balanced' },
    { id: 'opus', label: 'Opus · powerful' },
  ],
  codex: [
    { id: 'gpt-6-luna', label: 'GPT-6 Luna · economical' },
    { id: 'gpt-6-sol', label: 'GPT-6 Sol · balanced' },
    { id: 'gpt-6-astra', label: 'GPT-6 Astra · powerful' },
  ],
} as const;
const id = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/);
export const BoardNodeSchema = z
  .object({
    id,
    label: z.string().min(1).max(80),
    icon: z.enum(BOARD_ICONS),
    summary: z.string().min(1).max(400),
    explanation: z.string().min(1).max(3000),
    kind: z.enum(['step', 'decision', 'note']),
    confidence: z.enum(['normal', 'simplified', 'uncertain']).optional(),
    caveat: z.string().max(500).optional(),
  })
  .strict();
export const BoardEdgeKindSchema = z.enum(['flow', 'request', 'response', 'feedback', 'retry']);
export const BoardEdgeSchema = z
  .object({
    id,
    source: id,
    target: id,
    label: z.string().max(100),
    kind: BoardEdgeKindSchema.optional(),
  })
  .strict();
export const BoardContentSchema = z
  .object({
    title: z.string().min(1).max(100),
    description: z.string().max(500),
    nodes: z.array(BoardNodeSchema).min(1).max(50),
    edges: z.array(BoardEdgeSchema).max(100),
    suggestions: z.array(z.string().min(1).max(200)).max(3).optional(),
  })
  .strict();

export function validateBoardReferences(
  board: z.infer<typeof BoardContentSchema>,
  context: z.RefinementCtx,
) {
  const ids = new Set(board.nodes.map((node) => node.id));
  if (
    ids.size !== board.nodes.length ||
    new Set(board.edges.map((edge) => edge.id)).size !== board.edges.length
  )
    context.addIssue({ code: 'custom', message: 'Diagram IDs must be unique.' });
  if (board.edges.some((edge) => !ids.has(edge.source) || !ids.has(edge.target)))
    context.addIssue({
      code: 'custom',
      message: 'Every connection must reference an existing node.',
    });
}
export const BoardGraphSchema = BoardContentSchema.superRefine(validateBoardReferences);
export const BoardPortSchema = z.enum(['left', 'right', 'top', 'bottom']);
export type BoardPort = z.infer<typeof BoardPortSchema>;
export const BoardDocumentSchema = BoardContentSchema.extend({
  version: z.literal(2),
  positions: z.record(z.object({ x: z.number().finite(), y: z.number().finite() }).strict()),
  agent: BoardAgentSchema,
  edgePorts: z
    .record(z.object({ source: BoardPortSchema, target: BoardPortSchema }).strict())
    .optional(),
}).superRefine(validateBoardReferences);
export const BoardRequestSchema = z
  .object({
    prompt: z.string().trim().min(1).max(4000),
    agent: BoardAgentSchema,
    settings: BoardModelSettingsSchema.optional(),
    board: BoardDocumentSchema.optional(),
    selectedId: id.optional(),
  })
  .strict();
export const BoardAgentsSchema = z.array(
  z.object({
    id: BoardAgentSchema,
    available: z.boolean(),
    detail: z.string(),
  }),
);
export const boardOutputSchema = JSON.stringify(
  zodToJsonSchema(
    BoardContentSchema.extend({
      suggestions: z.array(z.string().min(1).max(200)).min(2).max(3),
      edges: z.array(BoardEdgeSchema.extend({ kind: BoardEdgeKindSchema })).max(100),
      nodes: z
        .array(
          BoardNodeSchema.extend({
            confidence: z.enum(['normal', 'simplified', 'uncertain']),
            caveat: z.string().max(500),
          }),
        )
        .min(1)
        .max(50),
    }),
    { $refStrategy: 'none' },
  ),
);
export type BoardGraph = z.infer<typeof BoardGraphSchema>;
export type BoardDocument = z.infer<typeof BoardDocumentSchema>;
export type BoardRequest = z.infer<typeof BoardRequestSchema>;

export const BoardSnapshotSchema = z
  .object({
    board: BoardDocumentSchema.nullable(),
    past: z.array(BoardDocumentSchema.nullable()).max(40),
    future: z.array(BoardDocumentSchema.nullable()).max(40),
  })
  .strict();
export type BoardSnapshot = z.infer<typeof BoardSnapshotSchema>;

/** Every changed or removed existing item requires explicit review, including selected nodes. */
export function boardChanges(before: BoardGraph, after: BoardGraph): string[] {
  const changes: string[] = [];
  for (const key of ['nodes', 'edges'] as const) {
    for (const item of before[key]) {
      const next = after[key].find((candidate) => candidate.id === item.id);
      if (!next) changes.push(`Remove ${key === 'nodes' ? 'concept' : 'connection'}: ${item.id}`);
      else if (JSON.stringify(item) !== JSON.stringify(next))
        changes.push(`Change ${key === 'nodes' ? 'concept' : 'connection'}: ${item.id}`);
    }
  }
  if (before.title !== after.title) changes.push('Change title');
  if (before.description !== after.description) changes.push('Change description');
  return changes;
}

export const EMAIL_DEMO: BoardGraph = {
  title: 'An email’s journey',
  description: 'From a thought in your outbox to a message in someone else’s inbox.',
  suggestions: ['Show what happens if delivery fails'],
  nodes: [
    {
      id: 'sender',
      label: 'You write',
      icon: 'user',
      kind: 'step',
      summary: 'A message starts with you.',
      explanation:
        'You choose a recipient, write a subject and compose the message. The recipient’s address identifies a mailbox and its domain.',
    },
    {
      id: 'app',
      label: 'Email app',
      icon: 'mail',
      kind: 'step',
      summary: 'Your app submits the message.',
      explanation:
        'When you press Send, your app submits the message to your mail provider. Mail clients typically use authenticated SMTP; a webmail interface may use HTTPS to its provider.',
    },
    {
      id: 'outgoing',
      label: 'Sending server',
      icon: 'server',
      kind: 'step',
      summary: 'Your provider finds the destination.',
      explanation:
        'The sending server looks up the recipient domain’s MX records in DNS, then attempts to transfer the message to a receiving server using SMTP. Temporary failures can lead to queued retries.',
    },
    {
      id: 'incoming',
      label: 'Receiving server',
      icon: 'shield',
      kind: 'step',
      summary: 'The destination checks and accepts it.',
      explanation:
        'The receiving provider checks the address and applies authentication and spam checks. Accepted mail is routed to the appropriate mailbox, sometimes into a spam folder.',
    },
    {
      id: 'recipient',
      label: 'Their inbox',
      icon: 'inbox',
      kind: 'step',
      summary: 'The recipient can read your message.',
      explanation:
        'The recipient’s app retrieves or synchronizes the mailbox through IMAP, a provider API or webmail. Delivery does not mean the message has been read.',
    },
  ],
  edges: [
    { id: 'compose', source: 'sender', target: 'app', label: 'Compose' },
    { id: 'submit', source: 'app', target: 'outgoing', label: 'Submit' },
    { id: 'transfer', source: 'outgoing', target: 'incoming', label: 'SMTP' },
    { id: 'deliver', source: 'incoming', target: 'recipient', label: 'Deliver' },
  ],
};
