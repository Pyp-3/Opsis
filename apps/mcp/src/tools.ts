import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  boardPreviewSvg,
  BoardEdgeKindSchema,
  CANVAS_BACKGROUNDS,
  DRAWING_SYMBOLS,
  DrawingScaleSchema,
  CANVAS_ICON_TINTS,
  EDGE_COLORS,
} from '@opsis/schema';
import {
  CanvasError,
  ConceptFieldsSchema,
  ConceptIdSchema,
  addConcept,
  boardOf,
  connect,
  describeBoard,
  disconnect,
  removeConcept,
  updateConcept,
  updateDetails,
  writeDiagram,
} from './canvas.js';
import type { OpsisClient } from './client.js';
import {
  DrawingInputSchema,
  DrawingPatchSchema,
  SymbolPlacementSchema,
  TransformSchema,
  addDrawings,
  describeDrawings,
  groupBoardDrawings,
  placeSymbols,
  removeDrawings,
  repeatBoardDrawings,
  transformDrawings,
  updateDrawing,
} from './drawings.js';

export const INSTRUCTIONS = `Opsis turns explanations into diagrams on a canvas: concepts (an icon, a label, a summary and a longer explanation) joined by labelled arrows, which the reader can explore and play as a walkthrough.

Every edit here is saved like an edit made in the app: a canvas the reader has open updates within a couple of seconds, and each tool call is one step they can undo with Ctrl/⌘ Z.

Agents act as the account whose agent key they hold: they edit that account's boards and can read boards others have made public.

Work like this: list, search (opsis_search_boards) or create a board, read it with opsis_get_board, then make small edits (add, update, connect) or rewrite it in one step with opsis_write_diagram. Keep labels short (2–4 words), summaries to one or two sentences, and order concepts in reading order. Share the returned "open" link so the reader can jump to the canvas.

Boards can also hold drawings beside the diagram, so any 2D subject can be shown: floor plans, site layouts, circuits, piping and process diagrams, mechanisms, charts and plots, maps and illustrations. Use opsis_add_drawings, opsis_update_drawing and opsis_remove_drawings with canvas coordinates (one grid square is 24 units; opsis_get_board gives each concept's position). Shapes: stroke, line, arrow, rect, ellipse, text, dimension, polygon, arc (through three points) and path (any SVG path data, for curves and plots), with fill inks, opacity, hatching, line ends (arrow, dot, bar) and text alignment. Place ready-made symbols (doors, windows, resistors, valves, pumps, people, databases and more) with opsis_place_symbols; each becomes a group. Move, scale, mirror, rotate, align and space drawings or groups with opsis_transform_drawings, copy them in rows with opsis_repeat_drawings, and group them with opsis_group_drawings. Check your work with opsis_render_board, which returns a picture of the board with rulers, then fix what looks wrong. Set the board's scale with opsis_update_board so dimension lines read in real units. Drawings the reader has locked cannot be changed.

The account's own boards can be filed into private collections (folders): opsis_list_collections, opsis_create_collection and opsis_file_board, or pass collectionId to opsis_create_board. Filing is organization, not an edit, so it adds no undo step.`;

const boardId = z
  .string()
  .uuid()
  .describe('Board id from opsis_list_boards or opsis_create_board.');
const collectionId = z.string().uuid().describe('Collection id from opsis_list_collections.');

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
      description:
        'Lists saved Opsis boards, most recently updated first, with the collection each is filed in (collectionId, or null when unfiled).',
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
    'opsis_list_collections',
    {
      title: 'List collections',
      description:
        'Lists this account’s private board collections by name, with how many boards are filed in each. Boards from opsis_list_boards carry their collectionId.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    guarded(async () => {
      const [collections, boards] = await Promise.all([client.listCollections(), client.list()]);
      return collections.map((collection) => ({
        ...collection,
        boards: boards.filter((board) => board.collectionId === collection.id).length,
      }));
    }),
  );

  server.registerTool(
    'opsis_create_collection',
    {
      title: 'Create a collection',
      description:
        'Creates a private collection to file boards in. Names are unique regardless of case.',
      inputSchema: { name: z.string().trim().min(1).max(60) },
    },
    guarded(async ({ name }: { name: string }) => client.createCollection(name)),
  );

  server.registerTool(
    'opsis_file_board',
    {
      title: 'File a board in a collection',
      description:
        'Moves a board this account owns into one collection, or out of every collection with null. A board is in at most one collection. This is organization, not an edit: the board’s content and undo history are unchanged.',
      inputSchema: { boardId, collectionId: collectionId.nullable() },
    },
    guarded(async ({ boardId: id, collectionId: into }) => {
      await client.fileBoard(id, into);
      return { id, collectionId: into, open: open(id) };
    }),
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
        'Returns a board’s title, summary, colours, concepts (with ids and positions), connections, drawings, drawing layers and scale. Read before editing.',
      inputSchema: { boardId },
      annotations: { readOnlyHint: true },
    },
    guarded(async ({ boardId: id }) => {
      const entry = await client.get(id);
      const board = entry.snapshot.board;
      return {
        ...describeBoard(entry.id, entry.revision, board),
        ...(board ? describeDrawings(board) : {}),
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
        collectionId: collectionId.optional().describe('Collection to file the new board in.'),
      },
    },
    guarded(async ({ title, description, collectionId: into }) => {
      const entry = await client.create(title, into);
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
        drawingScale: DrawingScaleSchema.nullable()
          .optional()
          .describe(
            'What one grid square measures, e.g. {"gridValue": 0.5, "unit": "m"}; dimension lines read in it. null returns to grid units.',
          ),
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
            drawingScale: args.drawingScale,
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
      description:
        'Changes a concept’s content or explicit board link. Set linkedBoardId to null to clear the link.',
      inputSchema: {
        boardId,
        conceptId: ConceptIdSchema,
        label: ConceptFieldsSchema.label.optional(),
        linkedBoardId: z.string().uuid().nullable().optional(),
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
    'opsis_add_drawings',
    {
      title: 'Add drawings',
      description:
        'Draws shapes on the canvas beside the diagram in one undoable step: stroke (freehand), line, arrow, rect (box), ellipse, text, dimension lines, polygon (closed), arc (start, through, end) and path (SVG path data). Coordinates are canvas units; one grid square is 24. Returns the new drawing ids.',
      inputSchema: {
        boardId,
        drawings: z.array(DrawingInputSchema).min(1).max(100),
      },
    },
    guarded(async ({ boardId: id, drawings }) => {
      const { revision, result } = await client.edit(id, (snapshot) => {
        const added = addDrawings(snapshot, drawings);
        return { snapshot: added.snapshot, result: added.ids };
      });
      return saved(id, revision, { drawingIds: result });
    }),
  );

  server.registerTool(
    'opsis_update_drawing',
    {
      title: 'Update a drawing',
      description:
        'Moves, reshapes, relabels or restyles one drawing, or changes the concept it moves with or its layer. Locked drawings cannot be changed.',
      inputSchema: { boardId, drawingId: ConceptIdSchema, ...DrawingPatchSchema },
    },
    guarded(async ({ boardId: id, drawingId, ...patch }) => {
      const { revision } = await client.edit(id, (snapshot) => ({
        snapshot: updateDrawing(snapshot, drawingId, patch),
        result: null,
      }));
      return saved(id, revision);
    }),
  );

  server.registerTool(
    'opsis_remove_drawings',
    {
      title: 'Remove drawings',
      description:
        'Removes drawings by id in one undoable step. Nothing is removed if any of them is locked.',
      inputSchema: { boardId, drawingIds: z.array(ConceptIdSchema).min(1).max(200) },
      annotations: { destructiveHint: true },
    },
    guarded(async ({ boardId: id, drawingIds }) => {
      const { revision } = await client.edit(id, (snapshot) => ({
        snapshot: removeDrawings(snapshot, drawingIds),
        result: null,
      }));
      return saved(id, revision);
    }),
  );

  server.registerTool(
    'opsis_list_symbols',
    {
      title: 'List drawing symbols',
      description:
        'Lists the ready-made symbols opsis_place_symbols can draw, with their category, what they show and their natural size in canvas units.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    guarded(async () =>
      DRAWING_SYMBOLS.map(({ name, category, description, width, height }) => ({
        name,
        category,
        description,
        width,
        height,
      })),
    ),
  );

  server.registerTool(
    'opsis_place_symbols',
    {
      title: 'Place symbols',
      description:
        'Draws ready-made symbols (doors, windows, stairs, furniture, resistors, capacitors, switches, valves, pumps, tanks, instruments, people, clouds, databases and more) in one undoable step. Each symbol becomes a group of ordinary drawings that moves and transforms as one; returns each group and its drawing ids.',
      inputSchema: { boardId, symbols: z.array(SymbolPlacementSchema).min(1).max(40) },
    },
    guarded(async ({ boardId: id, symbols }) => {
      const { revision, result } = await client.edit(id, (snapshot) => {
        const placed = placeSymbols(snapshot, symbols);
        return { snapshot: placed.snapshot, result: placed.placed };
      });
      return saved(id, revision, { symbols: result });
    }),
  );

  server.registerTool(
    'opsis_transform_drawings',
    {
      title: 'Transform drawings',
      description:
        'Moves, scales, mirrors, rotates, aligns or evenly spaces several drawings and groups in one undoable step (applied in that order). Locked drawings cannot be changed.',
      inputSchema: { boardId, ...TransformSchema },
    },
    guarded(async ({ boardId: id, ...input }) => {
      const { revision } = await client.edit(id, (snapshot) => ({
        snapshot: transformDrawings(snapshot, input),
        result: null,
      }));
      return saved(id, revision);
    }),
  );

  server.registerTool(
    'opsis_repeat_drawings',
    {
      title: 'Repeat drawings',
      description:
        'Copies drawings and groups count times, each copy step further on (rows of columns, stair treads, fence posts, chart bars), in one undoable step. Returns the new drawing ids.',
      inputSchema: {
        boardId,
        drawingIds: z.array(ConceptIdSchema).max(200).optional(),
        groups: z.array(z.string().min(1).max(80)).max(50).optional(),
        count: z.number().int().min(1).max(50),
        step: z
          .tuple([z.number().finite(), z.number().finite()])
          .describe('[dx, dy] between one copy and the next.'),
      },
    },
    guarded(async ({ boardId: id, drawingIds, groups, count, step }) => {
      const { revision, result } = await client.edit(id, (snapshot) => {
        const repeated = repeatBoardDrawings(snapshot, {
          ...(drawingIds ? { drawingIds } : {}),
          ...(groups ? { groups } : {}),
          count,
          step,
        });
        return { snapshot: repeated.snapshot, result: repeated.drawingIds };
      });
      return saved(id, revision, { drawingIds: result });
    }),
  );

  server.registerTool(
    'opsis_group_drawings',
    {
      title: 'Group drawings',
      description:
        'Puts drawings in a named group, so the reader selects and drags them as one and transforms can target the group; group null takes them out of any group.',
      inputSchema: {
        boardId,
        drawingIds: z.array(ConceptIdSchema).min(1).max(200),
        group: z
          .string()
          .min(1)
          .max(80)
          .regex(/^[a-zA-Z0-9_-]+$/)
          .nullable(),
      },
    },
    guarded(async ({ boardId: id, drawingIds, group }) => {
      const { revision } = await client.edit(id, (snapshot) => ({
        snapshot: groupBoardDrawings(snapshot, drawingIds, group),
        result: null,
      }));
      return saved(id, revision);
    }),
  );

  server.registerTool(
    'opsis_render_board',
    {
      title: 'Render a board preview',
      description:
        'Returns a PNG picture of the board, or of a region of it, to check your work: every visible drawing as the canvas paints it, concepts as labelled circles where their icons sit, connections as straight arrows, and rulers marked in canvas coordinates. Icons and arrow routing are simplified.',
      inputSchema: {
        boardId,
        region: z
          .object({
            x: z.number().finite(),
            y: z.number().finite(),
            width: z.number().finite().min(24).max(100_000),
            height: z.number().finite().min(24).max(100_000),
          })
          .optional()
          .describe('Canvas area to show; the whole board by default.'),
        maxSize: z
          .number()
          .int()
          .min(200)
          .max(2000)
          .optional()
          .describe('Longest side in pixels; default 1400.'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ boardId: id, region, maxSize }): Promise<CallToolResult> => {
      try {
        const entry = await client.get(id);
        const preview = boardPreviewSvg(boardOf(entry.snapshot), {
          ...(region ? { region } : {}),
          ...(maxSize ? { maxSize } : {}),
        });
        const summary = {
          region: preview.region,
          pixels: { width: preview.width, height: preview.height },
          gridSquare: preview.gridSquare,
        };
        const image = await client.render(preview.svg);
        if (!image)
          return reply({
            ...summary,
            note: 'This Opsis host cannot make images, so the preview is SVG markup.',
            svg: preview.svg,
          });
        return {
          content: [
            { type: 'image', data: image.data, mimeType: image.mimeType },
            { type: 'text', text: JSON.stringify(summary) },
          ],
        };
      } catch (error) {
        if (error instanceof CanvasError)
          return { isError: true, content: [{ type: 'text', text: error.message }] };
        throw error;
      }
    },
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
