import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  BoardEdgeKindSchema,
  CANVAS_BACKGROUNDS,
  CANVAS_ICON_TINTS,
  EDGE_COLORS,
} from '@opsis/schema';
import {
  CanvasError,
  ConceptFieldsSchema,
  ConceptIdSchema,
  addConcept,
  connect,
  describeBoard,
  disconnect,
  removeConcept,
  updateConcept,
  updateDetails,
  writeDiagram,
} from './canvas.js';
import type { OpsisClient } from './client.js';

export const INSTRUCTIONS = `Opsis turns explanations into diagrams on a canvas: concepts (an icon, a label, a summary and a longer explanation) joined by labelled arrows, which the reader can explore and play as a walkthrough.

Every edit here is saved like an edit made in the app: a canvas the reader has open updates within a couple of seconds, and each tool call is one step they can undo with Ctrl/⌘ Z.

Agents act as the account whose agent key they hold: they edit that account's boards and can read boards others have made public.

Work like this: list, search (opsis_search_boards) or create a board, read it with opsis_get_board, then make small edits (add, update, connect) or rewrite it in one step with opsis_write_diagram. Keep labels short (2–4 words), summaries to one or two sentences, and order concepts in reading order. Share the returned "open" link so the reader can jump to the canvas.`;

const boardId = z
  .string()
  .uuid()
  .describe('Board id from opsis_list_boards or opsis_create_board.');

function reply(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}
function guarded<A>(run: (args: A) => Promise<unknown>) {
  return async (args: A): Promise<CallToolResult> => {
    try {
      return reply(await run(args));
    } catch (error) {
      if (error instanceof CanvasError)
        return { isError: true, content: [{ type: 'text', text: error.message }] };
      throw error;
    }
  };
}

export function registerTools(
  server: Pick<McpServer, 'registerTool'>,
  client: OpsisClient,
  webUrl: string,
) {
  const open = (id: string, concept?: string) =>
    new URL(
      `/canvas?board=${id}${concept ? `&concept=${encodeURIComponent(concept)}` : ''}`,
      webUrl,
    ).toString();
  const saved = (id: string, revision: number, extra: Record<string, unknown> = {}) => ({
    id,
    revision,
    ...extra,
    open: open(id),
  });

  server.registerTool(
    'opsis_list_boards',
    {
      title: 'List boards',
      description: 'Lists saved Opsis boards, most recently updated first.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    guarded(async () =>
      (await client.list())
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((entry) => ({ ...entry, open: open(entry.id) })),
    ),
  );

  server.registerTool(
    'opsis_search_boards',
    {
      title: 'Search boards',
      description:
        'Finds concepts and boards by words in their titles, labels, summaries, explanations, notes, sources and connection labels, across boards this account owns or edits. Every word must appear in the same concept. Results are best first, with the concept id to read or edit.',
      inputSchema: { query: z.string().trim().min(2).max(200).describe('Words to find.') },
      annotations: { readOnlyHint: true },
    },
    guarded(async ({ query }: { query: string }) =>
      (await client.search(query)).map((hit) => ({
        ...hit,
        open: open(hit.boardId, hit.conceptId),
      })),
    ),
  );

  server.registerTool(
    'opsis_list_public_boards',
    {
      title: 'List public boards',
      description:
        'Lists boards other people have made public. They can be read with opsis_get_board but not edited.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    guarded(async () =>
      (await client.listPublic()).map((entry) => ({ ...entry, open: open(entry.id) })),
    ),
  );

  server.registerTool(
    'opsis_get_board',
    {
      title: 'Read a board',
      description:
        'Returns a board’s title, summary, colours, concepts (with ids) and connections. Read before editing.',
      inputSchema: { boardId },
      annotations: { readOnlyHint: true },
    },
    guarded(async ({ boardId: id }) => {
      const entry = await client.get(id);
      return {
        ...describeBoard(entry.id, entry.revision, entry.snapshot.board),
        // Someone else's public board: readable here, but edits will be refused.
        ...(entry.access === 'viewer' ? { readOnly: true, owner: entry.owner?.name } : {}),
        open: open(id),
      };
    }),
  );

  server.registerTool(
    'opsis_create_board',
    {
      title: 'Create a board',
      description: 'Creates a new, empty board and returns its id.',
      inputSchema: {
        title: z.string().trim().min(1).max(100),
        description: z.string().max(500).optional().describe('The big-picture summary.'),
      },
    },
    guarded(async ({ title, description }) => {
      const entry = await client.create(title);
      if (!description) return saved(entry.id, entry.revision);
      const { revision } = await client.edit(entry.id, (snapshot) => ({
        snapshot: updateDetails(snapshot, { description }),
        result: null,
      }));
      return saved(entry.id, revision);
    }),
  );

  server.registerTool(
    'opsis_update_board',
    {
      title: 'Update board details',
      description: 'Changes a board’s title, big-picture summary or colours.',
      inputSchema: {
        boardId,
        title: z.string().trim().min(1).max(100).optional(),
        description: z.string().max(500).optional(),
        background: z.enum(CANVAS_BACKGROUNDS).optional().describe('Canvas palette.'),
        iconColor: z.enum(CANVAS_ICON_TINTS).optional().describe('Icon tint.'),
      },
    },
    guarded(async (args) => {
      const { revision } = await client.edit(args.boardId, (snapshot) => {
        const look = snapshot.board?.look ?? { canvas: 'blueprint', icon: 'gold' };
        return {
          snapshot: updateDetails(snapshot, {
            title: args.title,
            description: args.description,
            look:
              args.background || args.iconColor
                ? {
                    canvas: args.background ?? look.canvas,
                    icon: args.iconColor ?? look.icon,
                  }
                : undefined,
          }),
          result: null,
        };
      });
      return saved(args.boardId, revision);
    }),
  );

  server.registerTool(
    'opsis_add_concept',
    {
      title: 'Add a concept',
      description:
        'Adds a concept to the canvas. Pass `after` to place it below an existing concept and draw an arrow from it.',
      inputSchema: {
        boardId,
        label: ConceptFieldsSchema.label,
        summary: ConceptFieldsSchema.summary,
        explanation: ConceptFieldsSchema.explanation.optional(),
        icon: ConceptFieldsSchema.icon.optional(),
        kind: ConceptFieldsSchema.kind.optional(),
        after: ConceptIdSchema.optional().describe('Concept id this one follows from.'),
        connectionLabel: z
          .string()
          .max(100)
          .optional()
          .describe('Verb on the arrow from `after`, e.g. "sends".'),
        id: ConceptIdSchema.optional().describe('Optional id; derived from the label otherwise.'),
      },
    },
    guarded(async ({ boardId: id, ...input }) => {
      const { revision, result } = await client.edit(id, (snapshot) => {
        const added = addConcept(snapshot, input);
        return { snapshot: added.snapshot, result: added.id };
      });
      return saved(id, revision, { conceptId: result });
    }),
  );

  server.registerTool(
    'opsis_update_concept',
    {
      title: 'Update a concept',
      description: 'Changes a concept’s label, summary, explanation, icon or kind.',
      inputSchema: {
        boardId,
        conceptId: ConceptIdSchema,
        label: ConceptFieldsSchema.label.optional(),
        summary: ConceptFieldsSchema.summary.optional(),
        explanation: ConceptFieldsSchema.explanation.optional(),
        icon: ConceptFieldsSchema.icon.optional(),
        kind: ConceptFieldsSchema.kind.optional(),
      },
    },
    guarded(async ({ boardId: id, conceptId, ...patch }) => {
      const { revision } = await client.edit(id, (snapshot) => ({
        snapshot: updateConcept(snapshot, conceptId, patch),
        result: null,
      }));
      return saved(id, revision);
    }),
  );

  server.registerTool(
    'opsis_remove_concept',
    {
      title: 'Remove a concept',
      description: 'Removes a concept and its connections. The reader can undo it.',
      inputSchema: { boardId, conceptId: ConceptIdSchema },
      annotations: { destructiveHint: true },
    },
    guarded(async ({ boardId: id, conceptId }) => {
      const { revision } = await client.edit(id, (snapshot) => ({
        snapshot: removeConcept(snapshot, conceptId),
        result: null,
      }));
      return saved(id, revision);
    }),
  );

  const connectionFields = {
    label: z.string().max(100).optional().describe('Verb on the arrow, e.g. "sends", "becomes".'),
    kind: BoardEdgeKindSchema.optional().describe(
      'flow (default), request, response, feedback or retry.',
    ),
    color: z.enum(EDGE_COLORS).optional(),
  };
  server.registerTool(
    'opsis_connect',
    {
      title: 'Connect two concepts',
      description: 'Draws an arrow from one concept to another.',
      inputSchema: { boardId, from: ConceptIdSchema, to: ConceptIdSchema, ...connectionFields },
    },
    guarded(async ({ boardId: id, ...input }) => {
      const { revision, result } = await client.edit(id, (snapshot) => {
        const made = connect(snapshot, input);
        return { snapshot: made.snapshot, result: made.id };
      });
      return saved(id, revision, { connectionId: result });
    }),
  );

  server.registerTool(
    'opsis_disconnect',
    {
      title: 'Remove a connection',
      description: 'Removes one arrow by its id.',
      inputSchema: { boardId, connectionId: z.string().min(1).max(80) },
      annotations: { destructiveHint: true },
    },
    guarded(async ({ boardId: id, connectionId }) => {
      const { revision } = await client.edit(id, (snapshot) => ({
        snapshot: disconnect(snapshot, connectionId),
        result: null,
      }));
      return saved(id, revision);
    }),
  );

  server.registerTool(
    'opsis_write_diagram',
    {
      title: 'Write a whole diagram',
      description:
        'Replaces a board’s diagram in one undoable step, or creates a new board when boardId is omitted. Concepts that keep their id keep their place on the canvas.',
      inputSchema: {
        boardId: boardId.optional(),
        title: z.string().trim().min(1).max(100),
        description: z.string().max(500).describe('The big-picture summary.'),
        concepts: z
          .array(
            z.object({
              id: ConceptIdSchema,
              label: ConceptFieldsSchema.label,
              summary: ConceptFieldsSchema.summary,
              explanation: ConceptFieldsSchema.explanation.optional(),
              icon: ConceptFieldsSchema.icon.optional(),
              kind: ConceptFieldsSchema.kind.optional(),
            }),
          )
          .min(1)
          .max(50)
          .describe('In reading order.'),
        connections: z
          .array(z.object({ from: ConceptIdSchema, to: ConceptIdSchema, ...connectionFields }))
          .max(100),
      },
      annotations: { destructiveHint: true },
    },
    guarded(async ({ boardId: given, ...diagram }) => {
      const id = given ?? (await client.create(diagram.title)).id;
      const { revision } = await client.edit(id, (snapshot) => ({
        snapshot: writeDiagram(snapshot, diagram),
        result: null,
      }));
      return saved(id, revision, { created: !given });
    }),
  );

  return server;
}
