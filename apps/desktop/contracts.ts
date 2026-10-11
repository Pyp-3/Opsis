import {
  BoardChatWriteSchema,
  CollectionBundleSchema,
  CollectionSharingSchema,
  prepareCollectionImport,
  BoardCollaboratorRequestSchema,
  BoardCollectionAssignmentSchema,
  BoardCollectionRequestSchema,
  MAX_BOARD_COLLECTIONS,
  AccountSettingSchema,
  UsageRecordSchema,
  MAX_USAGE_RECORDS,
  BoardTagsRequestSchema,
  SmartCollectionRequestSchema,
  MAX_SMART_COLLECTIONS,
  SearchQuerySchema,
  searchBoards,
  rankSearchHits,
  type SearchableBoard,
  type SearchHit,
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
  readerSnapshot,
  narrationLines,
  boardBacklinks,
  BoardPageIdSchema,
  type LinkingBoard,
  imageFileInfo,
  snapshotImageIds,
  LOCAL_INSTANCE,
  IMAGE_HEADER_BYTES,
  MAX_BOARD_IMAGES,
  MAX_IMAGE_BYTES,
} from '../../packages/schema/src/index';
import { SignUpSchema, LogInSchema, AgentKeyNameSchema } from '../api/src/auth-contract';
import { z } from 'zod';
import { PERSISTENCE_MIGRATIONS } from '../api/src/persistence/migrations';

const parsers = {
  chatWrite: BoardChatWriteSchema,
  collectionBundle: CollectionBundleSchema,
  collectionSharing: CollectionSharingSchema,
  editor: BoardCollaboratorRequestSchema,
  collection: BoardCollectionRequestSchema,
  collectionAssignment: BoardCollectionAssignmentSchema,
  accountSetting: AccountSettingSchema,
  usageRecord: UsageRecordSchema,
  tags: BoardTagsRequestSchema,
  smartCollection: SmartCollectionRequestSchema,
  searchQuery: SearchQuerySchema,
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

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** The VM has no atob; Go's standard base64 is decoded here. */
function base64Bytes(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '');
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let at = 0;
  for (const char of clean) {
    const digit = BASE64.indexOf(char);
    if (digit < 0) throw new Error('Invalid base64.');
    value = (value << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[at++] = (value >> bits) & 0xff;
    }
  }
  return bytes;
}

/** Fixed pure operations only. Go supplies JSON data, never executable source.
 * This keeps defaults, validation, and history rules owned by their original TS modules. */
export function apply(operation: string, json: string): string {
  try {
    const input: unknown = JSON.parse(json);
    let value: unknown;
    if (operation === 'migrations') {
      value = PERSISTENCE_MIGRATIONS;
    } else if (operation === 'prepareCollectionImport') {
      const { bundle, ids } = input as { bundle: unknown; ids: string[] };
      value = prepareCollectionImport(bundle, ids);
    } else if (operation === 'collectionLimit') {
      value = MAX_BOARD_COLLECTIONS;
    } else if (operation === 'usageLimit') {
      value = MAX_USAGE_RECORDS;
    } else if (operation === 'smartCollectionLimit') {
      value = MAX_SMART_COLLECTIONS;
    } else if (operation === 'search') {
      // Go reads rows and batches them; documents are validated before they are searched.
      const { query, boards } = input as { query: string; boards: SearchableBoard[] };
      value = searchBoards(
        boards.map((board) => ({
          ...board,
          board: BoardSnapshotSchema.shape.board.parse(board.board),
        })),
        z.string().parse(query),
      );
    } else if (operation === 'localInstance') {
      value = LOCAL_INSTANCE;
    } else if (operation === 'imageLimits') {
      value = { bytes: MAX_IMAGE_BYTES, headerBytes: IMAGE_HEADER_BYTES, board: MAX_BOARD_IMAGES };
    } else if (operation === 'imageInfo') {
      // Go sends an upload's leading bytes (base64) and its full size; the rule stays here.
      const { header, size } = z
        .object({
          header: z.string().max(Math.ceil((IMAGE_HEADER_BYTES * 4) / 3) + 4),
          size: z.number().int(),
        })
        .parse(input);
      value = imageFileInfo(base64Bytes(header), size);
    } else if (operation === 'snapshotImages') {
      value = snapshotImageIds(BoardSnapshotSchema.parse(input));
    } else if (operation === 'readerSnapshot') {
      // What a viewer receives: no hidden pages except the linked one, and no undo history.
      const { snapshot, page } = z
        .object({ snapshot: BoardSnapshotSchema, page: z.string() })
        .parse(input);
      value = readerSnapshot(snapshot, BoardPageIdSchema.safeParse(page).success ? page : null);
    } else if (operation === 'narrationAllowed') {
      // Whether a line belongs to the script of a board someone without an account may hear.
      const { board, page, text } = z
        .object({
          board: BoardDocumentSchema,
          page: BoardPageIdSchema.optional(),
          text: z.string().trim().min(1).max(600),
        })
        .parse(input);
      value = narrationLines(board, page).has(text);
    } else if (operation === 'backlinks') {
      const { targetId, boards } = input as { targetId: string; boards: LinkingBoard[] };
      value = boardBacklinks(
        z.string().uuid().parse(targetId),
        boards.map((board) => ({
          ...board,
          board: BoardSnapshotSchema.shape.board.parse(board.board),
        })),
      );
    } else if (operation === 'searchRank') {
      value = rankSearchHits((input as { hits: SearchHit[] }).hits);
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
