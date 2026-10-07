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

import { BOARD_ICONS } from './board-icons';
import { BoardAgentSchema, BoardModelSettingsSchema } from './model-settings';
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
export const BoardDocumentSchema = BoardContentSchema.extend({
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
}).superRefine((board, context) => {
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
    conversation: z
      .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(4000) }).strict())
      .max(12)
      .optional(),
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
