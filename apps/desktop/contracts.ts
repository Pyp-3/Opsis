import {
  BoardCollaboratorRequestSchema,
  BoardCollectionAssignmentSchema,
  BoardCollectionRequestSchema,
  MAX_BOARD_COLLECTIONS,
  AccountSettingSchema,
  UsageRecordSchema,
  MAX_USAGE_RECORDS,
  BoardIdSchema,
  BoardCreateRequestSchema,
  BoardUpdateRequestSchema,
  BoardDeleteRequestSchema,
  BoardSaveRequestSchema,
  BoardDuplicateRequestSchema,
  BoardRevisionQuerySchema,
  TemplateCreateRequestSchema,
  BoardSnapshotSchema,
  BoardDocumentSchema,
  createEmptyBoard,
  recordBoardEdit,
  copyBoardSnapshot,
} from '../../packages/schema/src/index';
import { SignUpSchema, LogInSchema, AgentKeyNameSchema } from '../api/src/auth-contract';
import { z } from 'zod';
import { PERSISTENCE_MIGRATIONS } from '../api/src/persistence/migrations';

const parsers = {
  editor: BoardCollaboratorRequestSchema,
  collection: BoardCollectionRequestSchema,
  collectionAssignment: BoardCollectionAssignmentSchema,
  accountSetting: AccountSettingSchema,
  usageRecord: UsageRecordSchema,
  id: BoardIdSchema,
  create: BoardCreateRequestSchema,
  update: BoardUpdateRequestSchema,
  delete: BoardDeleteRequestSchema,
  save: BoardSaveRequestSchema,
  duplicate: BoardDuplicateRequestSchema,
  revisionQuery: BoardRevisionQuerySchema,
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
    if (operation === 'migrations') {
      value = PERSISTENCE_MIGRATIONS;
    } else if (operation === 'collectionLimit') {
      value = MAX_BOARD_COLLECTIONS;
    } else if (operation === 'usageLimit') {
      value = MAX_USAGE_RECORDS;
    } else if (operation === 'empty') {
      value = BoardSnapshotSchema.parse({
        board: createEmptyBoard(z.string().parse(input)),
        past: [],
        future: [],
      });
    } else if (operation === 'copy') {
      const { board, title } = z
        .object({ board: BoardDocumentSchema.nullable(), title: z.string().optional() })
        .parse(input);
      value = copyBoardSnapshot(board, title);
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
