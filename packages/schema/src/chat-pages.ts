import type { BoardDocument } from './board';
import { boardPage, boardPages, type PageSummary } from './board-pages';

/**
 * Pages in chat. One thread serves the whole board, so an agent is told which pages exist
 * without being sent them all: every request on a board with several pages carries a short
 * index (titles and the first concept labels), the pages the reader names with `@page3` are sent
 * in full, and the agent may ask to read up to `MAX_PAGE_READS` more once per request
 * (`readPages`). The server answers that from the board the request came with, so the reader
 * never has to paste a page in, and pages nobody needs are never sent.
 */

/** Pages an agent may ask to read in one request. */
export const MAX_PAGE_READS = 4;
/** Pages one message may mention with `@page`. */
export const MAX_PAGE_MENTIONS = 6;
const INDEX_LABELS = 10;
const DIGEST_TEXT = 600;
const DIGEST_INFO = 3000;
const DIGEST_DRAWING_LABELS = 40;

/** `@page3`, `@page 3` or `@page-3`, in any case; the number is the page's place in the book. */
const MENTION = /@page[\s-]?(\d{1,2})\b/giu;

/** A page as the index lists it. */
export type ChatPageIndexEntry = {
  page: number;
  title: string;
  /** The page the reader is on, where the answer goes. */
  current?: true;
  /** Kept from people who only view the board. */
  hidden?: true;
  /** The first concept labels, in order, enough to tell what the page is about. */
  concepts: string[];
  /** How many further concepts the page has. */
  more?: number;
  drawings?: number;
  /** The page has Info text. */
  info?: true;
};

/** A page sent to an agent in full, without positions, styling or pictures. */
export type ChatPageDigest = {
  page: number;
  title: string;
  concepts: {
    id: string;
    label: string;
    kind?: string;
    summary: string;
    explanation: string;
  }[];
  connections: { from: string; to: string; label: string; kind?: string }[];
  /** Text written on the page's drawings. */
  drawingText?: string[];
  drawings?: number;
  /** The page's Info text (read-only for the agent). */
  info?: string;
};

const clip = (text: string, length: number) =>
  text.length > length ? `${text.slice(0, length - 1)}…` : text;

/** Pages a message names with `@pageN`, as ids, in the order named, without repeats. */
export function pageMentions(text: string, pages: readonly PageSummary[]): string[] {
  const ids: string[] = [];
  for (const match of text.matchAll(MENTION)) {
    const page = pages[Number(match[1]) - 1];
    if (page && !ids.includes(page.id)) ids.push(page.id);
  }
  return ids.slice(0, MAX_PAGE_MENTIONS);
}

/** The text that names a page in a message. */
export const pageMentionText = (number: number) => `@page${number}`;

/** Every page in reading order, briefly. Single-page boards have no index. */
export function chatPageIndex(board: BoardDocument, currentId: string): ChatPageIndexEntry[] {
  return boardPages(board).map((summary, index) => {
    const page = boardPage(board, summary.id);
    const labels = page.nodes.map((node) => node.label);
    return {
      page: index + 1,
      title: summary.title,
      ...(summary.id === currentId ? { current: true as const } : {}),
      ...(summary.hidden ? { hidden: true as const } : {}),
      concepts: labels.slice(0, INDEX_LABELS),
      ...(labels.length > INDEX_LABELS ? { more: labels.length - INDEX_LABELS } : {}),
      ...(page.drawings?.length ? { drawings: page.drawings.length } : {}),
      ...(page.info?.text?.trim() ? { info: true as const } : {}),
    };
  });
}

/** One page's content for an agent to read: what it says, not how it is laid out. */
export function chatPageDigest(board: BoardDocument, pageId: string): ChatPageDigest | null {
  const index = boardPages(board).findIndex((page) => page.id === pageId);
  if (index < 0) return null;
  const page = boardPage(board, pageId);
  const drawingText = (page.drawings ?? [])
    .map((drawing) => drawing.text?.trim())
    .filter((text): text is string => !!text)
    .slice(0, DIGEST_DRAWING_LABELS)
    .map((text) => clip(text, 120));
  const info = page.info?.text?.trim();
  return {
    page: index + 1,
    title: boardPages(board)[index]!.title,
    concepts: page.nodes.map((node) => ({
      id: node.id,
      label: node.label,
      ...(node.kind && node.kind !== 'step' ? { kind: node.kind } : {}),
      summary: node.summary,
      explanation: clip(node.explanation, DIGEST_TEXT),
    })),
    connections: page.edges.map((edge) => ({
      from: edge.source,
      to: edge.target,
      label: edge.label,
      ...(edge.kind && edge.kind !== 'flow' ? { kind: edge.kind } : {}),
    })),
    ...(drawingText.length ? { drawingText } : {}),
    ...(page.drawings?.length ? { drawings: page.drawings.length } : {}),
    ...(info ? { info: clip(info, DIGEST_INFO) } : {}),
  };
}

/**
 * The pages an agent asked to read, as ids: by number or id, never the page it is on or one it
 * already has, and at most `MAX_PAGE_READS`.
 */
export function pageReadsFor(
  board: BoardDocument,
  requested: unknown,
  already: readonly string[],
): string[] {
  if (!Array.isArray(requested)) return [];
  const pages = boardPages(board);
  const ids: string[] = [];
  for (const item of requested) {
    const page =
      typeof item === 'number'
        ? pages[item - 1]
        : typeof item === 'string'
          ? (pages.find((entry) => entry.id === item) ??
            (/^\d{1,2}$/u.test(item) ? pages[Number(item) - 1] : undefined))
          : undefined;
    if (page && !already.includes(page.id) && !ids.includes(page.id)) ids.push(page.id);
    if (ids.length === MAX_PAGE_READS) break;
  }
  return ids;
}
