import {
  BoardIdSchema,
  BoardCreateRequestSchema,
  BoardUpdateRequestSchema,
  BoardDeleteRequestSchema,
  BoardSaveRequestSchema,
  TemplateCreateRequestSchema,
  BoardSnapshotSchema,
  BoardDocumentSchema,
  createEmptyBoard,
  recordBoardEdit,
} from '../../packages/schema/src/index';
import { SignUpSchema, LogInSchema, AgentKeyNameSchema } from '../api/src/auth-contract';
import { z } from 'zod';

const parsers = {
  id: BoardIdSchema,
  create: BoardCreateRequestSchema,
  update: BoardUpdateRequestSchema,
  delete: BoardDeleteRequestSchema,
  save: BoardSaveRequestSchema,
  template: TemplateCreateRequestSchema,
  snapshot: BoardSnapshotSchema,
  board: BoardDocumentSchema,
  signup: SignUpSchema,
  login: LogInSchema,
  key: AgentKeyNameSchema,
};

/** Fixed pure operations only. Go supplies JSON data, never executable source.
 * This keeps defaults, validation, and history rules owned by their original TS modules. */
export function apply(operation: string, json: string): string {
  try {
    const input: unknown = JSON.parse(json);
    let value: unknown;
    if (operation === 'empty') {
      value = BoardSnapshotSchema.parse({
        board: createEmptyBoard(z.string().parse(input)),
        past: [],
        future: [],
      });
    } else if (operation === 'fromTemplate') {
      const { board, title } = z
        .object({ board: BoardDocumentSchema, title: z.string() })
        .parse(input);
      value = BoardSnapshotSchema.parse({ board: { ...board, title }, past: [], future: [] });
    } else if (operation === 'rename') {
      const { snapshot, title } = z
        .object({ snapshot: BoardSnapshotSchema, title: z.string() })
        .parse(input);
      value = recordBoardEdit(
        snapshot,
        snapshot.board ? { ...snapshot.board, title } : createEmptyBoard(title),
      );
    } else {
      const parser = parsers[operation as keyof typeof parsers];
      if (!parser) throw new Error('Unknown contract operation.');
      value = parser.parse(input);
    }
    return JSON.stringify({ ok: true, value });
  } catch (error) {
    return JSON.stringify({
      ok: false,
      message: error instanceof z.ZodError ? error.issues[0]?.message : 'Invalid data.',
      field: error instanceof z.ZodError ? error.issues[0]?.path[0] : undefined,
    });
  }
}
