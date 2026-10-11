import { z } from 'zod';
import {
  FOOTNOTE_TARGETS,
  MAX_FOOTNOTES,
  MAX_FOOTNOTE_TEXT,
  MAX_INFO_TEXT,
  footnoteObjects,
  infoTextImages,
  numberedFootnotes,
  sameFootnoteTarget,
  snapshotImageIds,
  tidyPageInfo,
  type BoardDocument,
  type BoardSnapshot,
  type Footnote,
  type FootnoteTarget,
  type PageInfo,
} from '@opsis/schema';
import { CanvasError, boardOf, withEdit } from './canvas.js';

/**
 * A page's Info for agents: the editor's text about the page and footnotes on its objects, read
 * in the Info tab like a page of a book. Edits follow the same shared rules as the Info tab and
 * are each one undoable step.
 */
export const InfoTextSchema = z
  .string()
  .max(MAX_INFO_TEXT)
  .describe(
    'Plain text; leave a blank line between paragraphs. Write a link as [label](https://…) (only https, http and mailto work). A line holding only ![description](image:<id>) shows a picture already on this board (ids from opsis_get_board); new pictures can only be added in the app.',
  );
export const FootnoteTargetSchema = z
  .object({
    kind: z.enum(FOOTNOTE_TARGETS),
    id: z.string().min(1).max(80),
  })
  .strict()
  .describe(
    'The object the note is on: a concept, connection or group by its id, a drawing by its id, or a drawing group by its groupId.',
  );
export const FootnoteTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_FOOTNOTE_TEXT)
  .describe('A short note; links as [label](https://…).');

/** The page's Info as opsis_get_board returns it; absent when the page has none. */
export function describeInfo(board: BoardDocument) {
  const text = board.info?.text ?? '';
  const notes = numberedFootnotes(board);
  if (!text && !notes.length) return {};
  return {
    info: {
      text,
      pictures: infoTextImages(text),
      footnotes: notes.map(({ number, note, object }) => ({
        id: note.id,
        number,
        on: { ...note.target, label: object?.label ?? null },
        text: note.text,
      })),
    },
  };
}

function withInfo(snapshot: BoardSnapshot, board: BoardDocument, info: PageInfo) {
  const next = { ...board };
  const tidy = tidyPageInfo(info);
  if (tidy) next.info = tidy;
  else delete next.info;
  return withEdit(snapshot, next);
}

/**
 * Replaces the page's text. Pictures may only be ones the board already holds (`allowed`, every
 * picture its pages and history show), since an agent cannot upload one.
 */
export function writeInfoText(
  snapshot: BoardSnapshot,
  text: string | null,
  allowed: ReadonlySet<string>,
) {
  const board = boardOf(snapshot);
  const unknown = infoTextImages(text ?? '').filter((image) => !allowed.has(image));
  if (unknown.length)
    throw new CanvasError(
      `Unknown picture ${unknown.join(', ')}. Only pictures already on this board can be shown: ${
        [...allowed].join(', ') || 'none'
      }.`,
    );
  return withInfo(snapshot, board, { ...board.info, text: text ?? '' });
}

/** Every picture a board (all pages and its undo history) shows, which agents may reuse. */
export const knownPictures = (snapshot: BoardSnapshot) => new Set(snapshotImageIds(snapshot));

function requireTarget(board: BoardDocument, target: FootnoteTarget) {
  const objects = footnoteObjects(board);
  if (!objects.some((object) => sameFootnoteTarget(object.target, target)))
    throw new CanvasError(
      `No ${target.kind} "${target.id}" on this page. Objects: ${
        objects.map((object) => `${object.target.kind} ${object.target.id}`).join(', ') || 'none'
      }.`,
    );
}

function requireNote(board: BoardDocument, id: string): Footnote {
  const note = board.info?.footnotes?.find((item) => item.id === id);
  if (!note)
    throw new CanvasError(
      `No footnote "${id}". Known ids: ${
        (board.info?.footnotes ?? []).map((item) => item.id).join(', ') || 'none'
      }.`,
    );
  return note;
}

export function addFootnote(snapshot: BoardSnapshot, target: FootnoteTarget, text: string) {
  const board = boardOf(snapshot);
  requireTarget(board, target);
  const notes = board.info?.footnotes ?? [];
  if (notes.length >= MAX_FOOTNOTES)
    throw new CanvasError(`A page can hold up to ${MAX_FOOTNOTES} footnotes.`);
  const id = `note-${crypto.randomUUID().slice(0, 8)}`;
  return {
    snapshot: withInfo(snapshot, board, {
      ...board.info,
      footnotes: [...notes, { id, target, text }],
    }),
    id,
  };
}

export function updateFootnote(
  snapshot: BoardSnapshot,
  id: string,
  patch: { text?: string | undefined; on?: FootnoteTarget | undefined },
) {
  const board = boardOf(snapshot);
  const note = requireNote(board, id);
  if (patch.on) requireTarget(board, patch.on);
  const updated = {
    ...note,
    ...(patch.text !== undefined ? { text: patch.text } : {}),
    ...(patch.on ? { target: patch.on } : {}),
  };
  return withInfo(snapshot, board, {
    ...board.info,
    footnotes: board.info!.footnotes!.map((item) => (item.id === id ? updated : item)),
  });
}

export function removeFootnote(snapshot: BoardSnapshot, id: string) {
  const board = boardOf(snapshot);
  requireNote(board, id);
  return withInfo(snapshot, board, {
    ...board.info,
    footnotes: board.info!.footnotes!.filter((item) => item.id !== id),
  });
}
