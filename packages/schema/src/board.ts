import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { IllustrationSchema } from './illustration';

/** Icon names agents and readers may use; see apps/web icons for labels and search terms. */
export const BOARD_ICONS = [
  'user',
  'users',
  'verified-user',
  'student',
  'worker',
  'doctor',
  'baby',
  'hand',
  'mail',
  'send',
  'inbox',
  'message',
  'chat',
  'phone',
  'bell',
  'megaphone',
  'video',
  'radio',
  'news',
  'language',
  'server',
  'database',
  'cloud',
  'cpu',
  'network',
  'code',
  'terminal',
  'monitor',
  'laptop',
  'phone-device',
  'wifi',
  'router',
  'storage',
  'link',
  'api',
  'bot',
  'binary',
  'merge',
  'blocks',
  'globe',
  'satellite',
  'shield',
  'shield-alert',
  'key',
  'lock',
  'unlock',
  'fingerprint',
  'face-scan',
  'eye',
  'bug',
  'siren',
  'file',
  'folder',
  'book',
  'chart',
  'pie',
  'table',
  'clipboard',
  'archive',
  'filter',
  'calculator',
  'tag',
  'split',
  'repeat',
  'refresh',
  'workflow',
  'exchange',
  'check',
  'cross',
  'alert',
  'help',
  'info',
  'clock',
  'timer',
  'hourglass',
  'calendar',
  'play',
  'stop',
  'flag',
  'target',
  'puzzle',
  'zap',
  'settings',
  'search',
  'lightbulb',
  'layers',
  'box',
  'share',
  'download',
  'upload',
  'atom',
  'flask',
  'microscope',
  'dna',
  'magnet',
  'orbit',
  'earth',
  'telescope',
  'rocket',
  'thermometer',
  'sun',
  'moon',
  'rain',
  'storm',
  'wind',
  'droplet',
  'flame',
  'snowflake',
  'waves',
  'mountain',
  'leaf',
  'tree',
  'sprout',
  'fish',
  'bird',
  'animal',
  'recycle',
  'heart',
  'pulse',
  'activity',
  'brain',
  'pill',
  'syringe',
  'hospital',
  'bone',
  'ear',
  'cart',
  'store',
  'wallet',
  'card',
  'coins',
  'banknote',
  'receipt',
  'bank',
  'scale',
  'gavel',
  'vote',
  'trophy',
  'star',
  'thumbs-up',
  'home',
  'building',
  'factory',
  'warehouse',
  'school',
  'map',
  'pin',
  'route',
  'compass',
  'package',
  'truck',
  'car',
  'train',
  'plane',
  'ship',
  'anchor',
  'bike',
  'container',
  'power',
  'plug',
  'battery',
  'solar',
  'fuel',
  'hammer',
  'wrench',
  'cable',
  'food',
  'coffee',
  'apple',
  'wheat',
  'camera',
  'image',
  'music',
  'game',
  'palette',
  'pen',
  'smile',
  'frown',
] as const;
export type BoardIcon = (typeof BOARD_ICONS)[number];
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
    { id: 'claude-haiku-4-5', label: 'Haiku 4.5', group: 'Versioned models' },
    { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', group: 'Versioned models' },
    { id: 'claude-opus-5-5', label: 'Opus 5.5', group: 'Versioned models' },
    { id: 'claude-fable-5-1', label: 'Fable 5.1', group: 'Versioned models' },
    { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', group: 'Earlier versions' },
    { id: 'claude-opus-4-6', label: 'Opus 4.6', group: 'Earlier versions' },
    { id: 'haiku', label: 'Haiku · CLI alias', group: 'CLI aliases' },
    { id: 'sonnet', label: 'Sonnet · CLI alias', group: 'CLI aliases' },
    { id: 'opus', label: 'Opus · CLI alias', group: 'CLI aliases' },
  ],
  codex: [
    { id: 'gpt-6-luna', label: 'GPT-6 Luna', group: 'GPT-6 models' },
    { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', group: 'GPT-6 models' },
    { id: 'gpt-6-sol', label: 'GPT-6 Sol', group: 'GPT-6 models' },
    { id: 'gpt-6-astra', label: 'GPT-6 Astra', group: 'GPT-6 models' },
  ],
} as const;
const id = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/);
/** Explanatory terminal data only; commands are never executable application actions. */
export const TerminalStepSchema = z
  .object({
    command: z.string().min(1).max(240),
    environment: z.string().min(1).max(200),
    input: z.string().max(500),
    exampleInput: z.string().min(1).max(1000).optional(),
    output: z.string().max(1000),
    success: z.string().min(1).max(700),
    issues: z
      .array(
        z
          .object({
            symptom: z.string().min(1).max(200),
            cause: z.string().min(1).max(500),
            remedy: z.string().min(1).max(700),
          })
          .strict(),
      )
      .max(5),
  })
  .strict();
export type TerminalStep = z.infer<typeof TerminalStepSchema>;

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
    terminal: TerminalStepSchema.optional(),
    /** What the process player's narrator says when it first reaches this object. */
    narration: z.string().max(400).optional(),
    /** An animated drawing the process player evolves the icon into; see illustration.ts. */
    illustration: IllustrationSchema.optional(),
  })
  .strict();
export const BoardEdgeKindSchema = z.enum(['flow', 'request', 'response', 'feedback', 'retry']);
/** Named arrow colours, all legible on the blueprint. Absent means "colour by type". */
export const EDGE_COLORS = ['sky', 'amber', 'violet', 'coral', 'mint', 'rose', 'ice'] as const;
export type EdgeColor = (typeof EDGE_COLORS)[number];
export const BoardEdgeSchema = z
  .object({
    id,
    source: id,
    target: id,
    label: z.string().max(100),
    kind: BoardEdgeKindSchema.optional(),
    color: z.enum(EDGE_COLORS).optional(),
    /** What the narrator says as playback follows this arrow. */
    narration: z.string().max(300).optional(),
  })
  .strict();
export const BoardContentSchema = z
  .object({
    title: z.string().min(1).max(100),
    description: z.string().max(500),
    nodes: z.array(BoardNodeSchema).min(1).max(50),
    edges: z.array(BoardEdgeSchema).max(100),
    suggestions: z.array(z.string().min(1).max(200)).max(3).optional(),
    /** The narrator's opening line before playback walks through the board. */
    narration: z.string().max(600).optional(),
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
  nodes: z.array(BoardNodeSchema).max(50),
  version: z.literal(2),
  positions: z.record(z.object({ x: z.number().finite(), y: z.number().finite() }).strict()),
  agent: BoardAgentSchema,
  edgePorts: z
    .record(z.object({ source: BoardPortSchema, target: BoardPortSchema }).strict())
    .optional(),
}).superRefine(validateBoardReferences);
/** Largest single upload, in bytes; base64 inflates it by a third on the wire. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS = 5;
/** A document the user uploads for the agent to work from, base64-encoded. */
export const BoardAttachmentSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    mediaType: z.string().max(200),
    data: z
      .string()
      .max(Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 4)
      .regex(/^[A-Za-z0-9+/]*={0,2}$/u),
  })
  .strict();
export type BoardAttachment = z.infer<typeof BoardAttachmentSchema>;
export const BoardRequestSchema = z
  .object({
    prompt: z.string().trim().min(1).max(4000),
    agent: BoardAgentSchema,
    settings: BoardModelSettingsSchema.optional(),
    board: BoardDocumentSchema.optional(),
    selectedId: id.optional(),
    attachments: z.array(BoardAttachmentSchema).max(MAX_ATTACHMENTS).optional(),
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
      narration: z.string().min(1).max(600),
      // Colours are a reader's styling choice; agents describe structure only.
      edges: z
        .array(
          BoardEdgeSchema.omit({ color: true }).extend({
            kind: BoardEdgeKindSchema,
            narration: z.string().min(1).max(300),
          }),
        )
        .max(100),
      nodes: z
        .array(
          // Illustrations are drawn on request by the illustrate route, not with the diagram.
          BoardNodeSchema.omit({ illustration: true }).extend({
            confidence: z.enum(['normal', 'simplified', 'uncertain']),
            caveat: z.string().max(500),
            narration: z.string().min(1).max(400),
          }),
        )
        .min(1)
        .max(50),
    }),
    { $refStrategy: 'none' },
  ),
);
export type BoardGraph = z.infer<typeof BoardGraphSchema>;

/** Asks an agent to draw animated illustrations for some or all of a board's objects. */
export const IllustrateRequestSchema = z
  .object({
    agent: BoardAgentSchema,
    settings: BoardModelSettingsSchema.optional(),
    board: BoardDocumentSchema,
    nodeIds: z.array(id).min(1).max(50).optional(),
  })
  .strict();
export type IllustrateRequest = z.infer<typeof IllustrateRequestSchema>;
export const IllustrateResponseSchema = z
  .object({
    illustrations: z.record(id, IllustrationSchema),
    /** Objects the agent drew something invalid for; they keep their icons. */
    skipped: z.array(id),
  })
  .strict();
export type IllustrateResponse = z.infer<typeof IllustrateResponseSchema>;
/** What the agent returns: a list, because JSON schemas describe keyed maps poorly. */
export const illustrateOutputSchema = JSON.stringify(
  zodToJsonSchema(
    z.object({
      illustrations: z
        .array(z.object({ id, illustration: IllustrationSchema }).strict())
        .min(1)
        .max(50),
    }),
    { $refStrategy: 'none' },
  ),
);
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

/**
 * A hand edit to what an object or arrow says makes the agent's spoken line stale, so it is
 * dropped; playback then words that step from the edited label and summary instead.
 */
export function withoutNarration<T extends { narration?: string | undefined }>(item: T): T {
  const copy = { ...item };
  delete copy.narration;
  return copy;
}

/**
 * Narration and illustrations are presentation; agents may re-word or redraw them so the story
 * flows, without review.
 */
const content = (item: { narration?: string | undefined; illustration?: unknown }) =>
  JSON.stringify({ ...item, narration: undefined, illustration: undefined });

/** Every changed or removed existing item requires explicit review, including selected nodes. */
export function boardChanges(before: BoardGraph, after: BoardGraph): string[] {
  const changes: string[] = [];
  for (const key of ['nodes', 'edges'] as const) {
    for (const item of before[key]) {
      const next = after[key].find((candidate) => candidate.id === item.id);
      if (!next) changes.push(`Remove ${key === 'nodes' ? 'concept' : 'connection'}: ${item.id}`);
      else if (content(item) !== content(next))
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
  narration:
    'Let’s follow an email from the moment you write it to the moment it lands in someone else’s inbox.',
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
      narration: 'It begins with you, writing a message and choosing who it’s for.',
    },
    {
      id: 'app',
      label: 'Email app',
      icon: 'mail',
      kind: 'step',
      summary: 'Your app submits the message.',
      explanation:
        'When you press Send, your app submits the message to your mail provider. Mail clients typically use authenticated SMTP; a webmail interface may use HTTPS to its provider.',
      narration: 'It can wait there as a draft for as long as you like.',
    },
    {
      id: 'outgoing',
      label: 'Sending server',
      icon: 'server',
      kind: 'step',
      summary: 'Your provider finds the destination.',
      explanation:
        'The sending server looks up the recipient domain’s MX records in DNS, then attempts to transfer the message to a receiving server using SMTP. Temporary failures can lead to queued retries.',
      narration: 'Your provider’s sending server looks up where the recipient’s mail should go.',
    },
    {
      id: 'incoming',
      label: 'Receiving server',
      icon: 'shield',
      kind: 'step',
      summary: 'The destination checks and accepts it.',
      explanation:
        'The receiving provider checks the address and applies authentication and spam checks. Accepted mail is routed to the appropriate mailbox, sometimes into a spam folder.',
      narration:
        'The receiving server checks the address, screens for spam and accepts the message.',
    },
    {
      id: 'recipient',
      label: 'Their inbox',
      icon: 'inbox',
      kind: 'step',
      summary: 'The recipient can read your message.',
      explanation:
        'The recipient’s app retrieves or synchronizes the mailbox through IMAP, a provider API or webmail. Delivery does not mean the message has been read.',
      narration: 'It’s now waiting in their inbox, ready for them to read.',
    },
  ],
  edges: [
    {
      id: 'compose',
      source: 'sender',
      target: 'app',
      label: 'Compose',
      narration: 'Once it’s written, the message sits in your email app.',
    },
    {
      id: 'submit',
      source: 'app',
      target: 'outgoing',
      label: 'Submit',
      narration: 'When you press send, the app submits it to your mail provider.',
    },
    {
      id: 'transfer',
      source: 'outgoing',
      target: 'incoming',
      label: 'SMTP',
      narration: 'The sending server then hands the message over to the recipient’s server.',
    },
    {
      id: 'deliver',
      source: 'incoming',
      target: 'recipient',
      label: 'Deliver',
      narration: 'Finally, the message is delivered to their mailbox.',
    },
  ],
};
