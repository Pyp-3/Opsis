import { SketchEditsSchema } from './sketch-edits';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { CustomIconSchema, IllustrationSchema } from './illustration';
import {
  AgentDrawingSchema,
  BoardDrawingSchema,
  MAX_AGENT_DRAWINGS,
  DrawingLayerSchema,
  DrawingScaleSchema,
  MAX_BOARD_DRAWINGS,
  MAX_DRAWING_LAYERS,
  drawingProblems,
} from './board-drawings';
import { ProcessStepSchema, processProblems } from './process';
import { boardPage, MAX_BOARD_PAGES, pageListProblems } from './board-pages';

import { BOARD_ICONS } from './board-icons';
import { BoardAgentSchema, BoardModelSettingsSchema } from './model-settings';
import { CHAT_CONVERSATION_WINDOW, ConversationMessageSchema, MAX_CHAT_MEMORY } from './board-chat';
import { CHAT_PRIORITIES, ChatFocusSchema, FocusEditsSchema } from './chat-focus';
export * from './board-icons';
export * from './model-settings';
export { EMAIL_DEMO } from './email-demo';

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

export const ConceptReferenceSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    url: z
      .string()
      .max(2000)
      // Go's pure contract VM has no browser URL constructor. Keep this bounded
      // syntax check identical in the browser, Node and native host.
      .regex(
        /^https?:\/\/(?:\[[0-9a-f:.]+\]|[^\s/?#:@\\]+)(?::\d{1,5})?(?:[/?#][^\s\\]*)?$/i,
        'Use an HTTP or HTTPS source link without credentials or whitespace.',
      )
      .optional(),
    excerpt: z.string().max(3000).optional(),
  })
  .strict();
export const BoardGroupSchema = z
  .object({
    id,
    label: z.string().trim().min(1).max(80),
    nodeIds: z.array(id).max(50),
    parentId: id.optional(),
    collapsed: z.boolean(),
    boundary: z.boolean(),
  })
  .strict();

export const BoardNodeSchema = z
  .object({
    id,
    label: z.string().min(1).max(80),
    icon: z.enum(BOARD_ICONS),
    /** Drawn by the agent when no library icon fits; `icon` stays as the fallback. */
    customIcon: CustomIconSchema.optional(),
    summary: z.string().min(1).max(400),
    explanation: z.string().min(1).max(3000),
    kind: z.enum(['step', 'decision', 'note']),
    confidence: z.enum(['normal', 'simplified', 'uncertain']).optional(),
    caveat: z.string().max(500).optional(),
    notes: z.string().max(5000).optional(),
    references: z.array(ConceptReferenceSchema).max(10).optional(),
    /** Explicit navigation metadata; diagram generation must never create or change it. */
    linkedBoardId: z.string().uuid().optional(),
    terminal: TerminalStepSchema.optional(),
    /** The engine calculates sample data from these operations, independently of narration. */
    process: ProcessStepSchema.optional(),
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
    condition: z.string().max(100).optional(),
    description: z.string().max(1000).optional(),
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
    /** A chat agent's sketch beside the diagram; see `withAgentSketch` in board-drawings.ts. */
    drawings: z.array(AgentDrawingSchema).max(MAX_AGENT_DRAWINGS).optional(),
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
  for (const message of processProblems(board.nodes)) context.addIssue({ code: 'custom', message });
}
export const BoardGraphSchema = BoardContentSchema.superRefine((graph, context) => {
  validateBoardReferences(graph, context);
  for (const message of drawingProblems(
    graph.drawings ?? [],
    new Set(graph.nodes.map((node) => node.id)),
  ))
    context.addIssue({ code: 'custom', message });
});
export const BoardPortSchema = z.enum(['left', 'right', 'top', 'bottom']);
export type BoardPort = z.infer<typeof BoardPortSchema>;
/** Canvas palettes and icon tints the web app paints; agents choose from these by id. */
export const CANVAS_BACKGROUNDS = [
  'blueprint',
  'midnight',
  'graphite',
  'forest',
  'ocean',
  'plum',
  'ember',
] as const;
export const CANVAS_ICON_TINTS = [
  'gold',
  'ivory',
  'sky',
  'mint',
  'amber',
  'coral',
  'rose',
  'lilac',
] as const;
/**
 * How this canvas is painted. Ids name palettes the web app defines; an id it does not know
 * falls back to the default, so the schema only bounds their shape.
 */
export const BoardLookSchema = z
  .object({
    canvas: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
    icon: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
  })
  .strict();
export type BoardLook = z.infer<typeof BoardLookSchema>;
const BoardDocumentObject = BoardContentSchema.extend({
  nodes: z.array(BoardNodeSchema).max(50),
  version: z.literal(2),
  positions: z.record(z.object({ x: z.number().finite(), y: z.number().finite() }).strict()),
  agent: BoardAgentSchema,
  edgePorts: z
    .record(z.object({ source: BoardPortSchema, target: BoardPortSchema }).strict())
    .optional(),
  pinnedNodeIds: z
    .array(id)
    .max(50)
    .refine((ids) => new Set(ids).size === ids.length, 'Pinned concepts must be unique.')
    .optional(),
  groups: z.array(BoardGroupSchema).max(20).optional(),
  look: BoardLookSchema.optional(),
  /** The reader's own sketches on the canvas; see board-drawings.ts. */
  drawings: z.array(BoardDrawingSchema).max(MAX_BOARD_DRAWINGS).optional(),
  /** Named drawing layers, painted in order above the base layer. */
  drawingLayers: z.array(DrawingLayerSchema).max(MAX_DRAWING_LAYERS).optional(),
  /** What one grid square measures, for dimension lines. */
  drawingScale: DrawingScaleSchema.optional(),
});
/**
 * What one page holds. The first page's content is the board's own fields (so a board without
 * pages is simply a one-page board); every later page carries its own; see board-pages.ts.
 */
export const BoardPageContentSchema = BoardDocumentObject.pick({
  nodes: true,
  edges: true,
  positions: true,
  edgePorts: true,
  pinnedNodeIds: true,
  groups: true,
  drawings: true,
  drawingLayers: true,
  suggestions: true,
  narration: true,
}).strict();
export type BoardPageContent = z.infer<typeof BoardPageContentSchema>;
/** Page IDs are random and unguessable: a hidden page's link is its ID. */
export const BoardPageIdSchema = z.string().regex(/^[A-Za-z0-9_-]{12,40}$/u);
export const BoardPageSchema = z
  .object({
    id: BoardPageIdSchema,
    title: z.string().trim().min(1).max(60),
    /** Kept from people who only view the board, unless they open this page's own link. */
    hidden: z.literal(true).optional(),
    /** Absent only on the first page, whose content is the board's own fields. */
    content: BoardPageContentSchema.optional(),
  })
  .strict();
export type BoardPage = z.infer<typeof BoardPageSchema>;

type DocumentShape = z.infer<typeof BoardDocumentObject>;
function documentProblems(board: DocumentShape, context: z.RefinementCtx) {
  validateBoardReferences(board, context);
  for (const message of drawingProblems(
    board.drawings ?? [],
    new Set(board.nodes.map((node) => node.id)),
    board.drawingLayers,
  ))
    context.addIssue({ code: 'custom', message });
  const groups = board.groups ?? [];
  const members = groups.flatMap((group) => group.nodeIds);
  if (
    new Set(groups.map((group) => group.id)).size !== groups.length ||
    new Set(members).size !== members.length ||
    members.some((id) => !board.nodes.some((node) => node.id === id))
  )
    context.addIssue({
      code: 'custom',
      message: 'Groups need unique IDs and each existing concept can belong to one group.',
    });
  for (const group of groups) {
    const seen = new Set([group.id]);
    let parent = group.parentId;
    while (parent) {
      if (seen.has(parent) || !groups.some((item) => item.id === parent)) {
        context.addIssue({
          code: 'custom',
          message: 'Group parents must exist and cannot form a cycle.',
        });
        break;
      }
      seen.add(parent);
      parent = groups.find((item) => item.id === parent)?.parentId;
    }
  }
  if (board.pinnedNodeIds?.some((id) => !board.nodes.some((node) => node.id === id)))
    context.addIssue({
      code: 'custom',
      message: 'Pinned positions must reference existing concepts.',
    });
}
export const BoardDocumentSchema = BoardDocumentObject.extend({
  pages: z.array(BoardPageSchema).min(1).max(MAX_BOARD_PAGES).optional(),
}).superRefine((board, context) => {
  documentProblems(board, context);
  if (!board.pages) return;
  for (const message of pageListProblems(board.pages))
    context.addIssue({ code: 'custom', message });
  for (const page of board.pages.slice(1))
    if (page.content) documentProblems(boardPage(board, page.id), context);
});
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
    conversation: z.array(ConversationMessageSchema).max(CHAT_CONVERSATION_WINDOW).optional(),
    /** The chat thread's running notes, written by the agent on earlier turns. */
    memory: z.string().max(MAX_CHAT_MEMORY).optional(),
    /** The chat thread, so a CLI agent can resume its own session for it. */
    thread: z.string().uuid().optional(),
    agent: BoardAgentSchema,
    settings: BoardModelSettingsSchema.optional(),
    board: BoardDocumentSchema.optional(),
    selectedId: id.optional(),
    /** The drawings this request is about; see chat-focus.ts. */
    focus: ChatFocusSchema.optional(),
    /** Whether the agent should work drawing-first. */
    priority: z.enum(CHAT_PRIORITIES).optional(),
    attachments: z.array(BoardAttachmentSchema).max(MAX_ATTACHMENTS).optional(),
    /**
     * The answer goes on new pages after the open one: the agent writes a fresh diagram for the
     * first and may add up to `MAX_ANSWER_PAGES` more in `morePages`, for a deck in one answer.
     */
    newPages: z.literal(true).optional(),
  })
  .strict();
/** Extra pages one answer may add beside its main diagram, so it holds at most nine pages. */
export const MAX_ANSWER_PAGES = 8;
/** One extra page of an answer: a complete diagram of its own, titled for the page. */
export const AnswerPageSchema = z
  .object({ description: z.string().max(500).default('') })
  .passthrough()
  .transform((page, context) => {
    const parsed = BoardGraphSchema.safeParse(page);
    if (parsed.success) return parsed.data;
    for (const issue of parsed.error.issues) context.addIssue(issue);
    return z.NEVER;
  });
export const AnswerPagesSchema = z.array(AnswerPageSchema).max(MAX_ANSWER_PAGES);
/** The chat parts of an agent's answer, returned beside the diagram as `turn`. */
export const BoardTurnSchema = z
  .object({
    /** A short conversational answer for the chat thread. */
    reply: z.string().trim().min(1).max(1200).optional(),
    /** The updated running notes for the thread. */
    memory: z.string().max(MAX_CHAT_MEMORY).optional(),
    /** Proposed changes to the focused drawings. */
    focusEdits: FocusEditsSchema.optional(),
  })
  .strict();
export type BoardTurn = z.infer<typeof BoardTurnSchema>;
export const BoardAgentsSchema = z.array(
  z.object({
    id: BoardAgentSchema,
    available: z.boolean(),
    detail: z.string(),
  }),
);
const BoardOutputSchema = BoardContentSchema.extend({
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
      BoardNodeSchema.omit({ illustration: true, linkedBoardId: true }).extend({
        confidence: z.enum(['normal', 'simplified', 'uncertain']),
        caveat: z.string().max(500),
        narration: z.string().min(1).max(400),
      }),
    )
    .min(1)
    .max(50),
  drawings: z
    .array(AgentDrawingSchema)
    .max(MAX_AGENT_DRAWINGS)
    .optional()
    .describe(
      'Optional sketch beside the diagram for spatial subjects; see the Drawings instructions.',
    ),
  reply: z
    .string()
    .min(1)
    .max(1200)
    .describe('One to three short sentences for the reader: what you did and why.'),
  memory: z
    .string()
    .max(MAX_CHAT_MEMORY)
    .describe(
      'Terse notes for your next turn: goals, decisions, preferences; empty when there are none.',
    ),
});
/**
 * The JSON schema of an agent's answer. Optional parts are added only when a request can use
 * them, so other requests stay small (Grok's CLI takes the whole request as one bounded
 * argument): edits to focused drawings when the reader puts drawings in focus, and edits to the
 * agent's own sketch when the board already has one.
 */
export function boardOutputSchemaFor(parts: {
  focus?: boolean;
  sketch?: boolean;
  pages?: boolean;
}): string {
  const key = `${parts.focus ? 'focus' : ''}:${parts.sketch ? 'sketch' : ''}:${parts.pages ? 'pages' : ''}`;
  const cached = outputSchemas.get(key);
  if (cached) return cached;
  let schema: z.ZodTypeAny = BoardOutputSchema;
  if (parts.focus)
    schema = (schema as typeof BoardOutputSchema).extend({
      focusEdits: FocusEditsSchema.optional().describe(
        'Changes to the focused drawings; see the Focus instructions.',
      ),
    });
  if (parts.sketch)
    schema = (schema as typeof BoardOutputSchema).extend({
      sketchEdits: SketchEditsSchema.optional().describe(
        'Changes to your existing sketch instead of returning "drawings" whole; see the Drawings instructions.',
      ),
    });
  const generated = zodToJsonSchema(schema, { $refStrategy: 'none' }) as JsonObject;
  const json = JSON.stringify(parts.pages ? withMorePages(generated) : generated);
  outputSchemas.set(key, json);
  return json;
}
const outputSchemas = new Map<string, string>();
type JsonObject = Record<string, unknown> & { properties: Record<string, JsonObject> };
/**
 * Adds `morePages`, extra pages that reuse the diagram's own node, connection and drawing
 * definitions. They move into `$defs` and are referenced from both places, so the schema grows by
 * about a kilobyte rather than doubling (Grok's CLI takes it as one bounded argument).
 */
function withMorePages(schema: JsonObject): JsonObject {
  const { properties } = schema;
  const $defs: Record<string, unknown> = {};
  const shared = (name: string, key: 'nodes' | 'edges' | 'drawings') => {
    const list = properties[key]! as JsonObject & { items: unknown };
    $defs[name] = list.items;
    list.items = { $ref: `#/$defs/${name}` };
    return { ...list };
  };
  const nodes = shared('node', 'nodes');
  const edges = shared('edge', 'edges');
  const drawings = shared('drawing', 'drawings');
  const page = {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'description', 'nodes', 'edges', 'narration'],
    properties: {
      title: { ...properties.title, description: 'This page’s title, shown in the page list.' },
      description: properties.description,
      narration: properties.narration,
      nodes,
      edges,
      drawings,
    },
  };
  return {
    ...schema,
    $defs,
    properties: {
      ...properties,
      morePages: {
        type: 'array',
        maxItems: MAX_ANSWER_PAGES,
        items: page,
        description:
          'Further pages after the first, in reading order, when the request calls for several; see the Pages instructions.',
      } as unknown as JsonObject,
    },
  };
}
export const boardOutputSchema = boardOutputSchemaFor({});
export const boardFocusOutputSchema = boardOutputSchemaFor({ focus: true });
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

export const BOARD_HISTORY_LIMIT = 40;
export const BoardSnapshotSchema = z
  .object({
    board: BoardDocumentSchema.nullable(),
    past: z.array(BoardDocumentSchema.nullable()).max(BOARD_HISTORY_LIMIT),
    future: z.array(BoardDocumentSchema.nullable()).max(BOARD_HISTORY_LIMIT),
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
 * Narration, illustrations and custom icons are presentation; agents may re-word or redraw them
 * so the story flows, without review. The library icon a node falls back to is still reviewed.
 */
const content = (item: {
  narration?: string | undefined;
  illustration?: unknown;
  customIcon?: unknown;
}) =>
  JSON.stringify({ ...item, narration: undefined, illustration: undefined, customIcon: undefined });

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
  // `before` is the board sent with the request, whose drawings are the agent's own sketch.
  if (
    after.drawings !== undefined &&
    JSON.stringify(before.drawings ?? []) !== JSON.stringify(after.drawings)
  )
    changes.push('Change agent sketch');
  if (before.title !== after.title) changes.push('Change title');
  if (before.description !== after.description) changes.push('Change description');
  return changes;
}
