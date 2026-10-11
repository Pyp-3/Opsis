import type { BoardDocument, BoardPage, BoardPageContent, BoardSnapshot } from './board';

export const MAX_BOARD_PAGES = 30;

/**
 * Pages: a board can hold several canvases, read in order like a book.
 *
 * The first page's content is the board's own top-level fields, and `pages` lists every page
 * in order with the later pages' content. A board without `pages` is a one-page board, so
 * everything that reads a board's concepts and drawings keeps working on its first page, and
 * the canvas edits any page through the same single-page document (`boardPage`), written back
 * with `withBoardPage`.
 *
 * A hidden page is the editors' own: people who only view the board never receive it
 * (`readerBoard`), unless they open that page's link, which names its random ID.
 */
export const PAGE_CONTENT_KEYS = [
  'nodes',
  'edges',
  'positions',
  'edgePorts',
  'pinnedNodeIds',
  'groups',
  'drawings',
  'drawingLayers',
  'suggestions',
  'narration',
] as const satisfies readonly (keyof BoardPageContent)[];

export type PageSummary = { id: string; title: string; hidden: boolean };
type PageWithContent = { id: string; title: string; hidden?: true; content: BoardPageContent };
type BoardMetadata = Omit<BoardDocument, (typeof PAGE_CONTENT_KEYS)[number] | 'pages'>;

/** The page-level fields of a single-page document. */
export function pageContentOf(board: BoardDocument): BoardPageContent {
  const content: Record<string, unknown> = {};
  for (const key of PAGE_CONTENT_KEYS) if (board[key] !== undefined) content[key] = board[key];
  return content as BoardPageContent;
}

function boardMetadataOf(board: BoardDocument): BoardMetadata {
  const base: Record<string, unknown> = { ...board };
  for (const key of [...PAGE_CONTENT_KEYS, 'pages']) delete base[key];
  return base as BoardMetadata;
}

function pagesWithContent(board: BoardDocument): PageWithContent[] {
  return (board.pages ?? []).map((page, index) => ({
    id: page.id,
    title: page.title,
    ...(page.hidden ? { hidden: true as const } : {}),
    content: index === 0 ? pageContentOf(board) : (page.content ?? emptyPageContent()),
  }));
}

/** A board from its board-level fields and pages; the first page's content moves to the top. */
function assembleBoardPages(base: BoardMetadata, pages: PageWithContent[]): BoardDocument {
  const [first, ...rest] = pages;
  if (!first) throw new Error('A board needs at least one page.');
  return {
    ...base,
    ...first.content,
    pages: [
      { id: first.id, title: first.title, ...(first.hidden ? { hidden: true as const } : {}) },
      ...rest.map((page) => ({
        id: page.id,
        title: page.title,
        ...(page.hidden ? { hidden: true as const } : {}),
        content: page.content,
      })),
    ],
  };
}

export function emptyPageContent(): BoardPageContent {
  return { nodes: [], edges: [], positions: {} };
}

/** Explicit pages in reading order; single-page boards without a page list return none. */
export function boardPages(board: BoardDocument | null): PageSummary[] {
  return (board?.pages ?? []).map((page) => ({
    id: page.id,
    title: page.title,
    hidden: !!page.hidden,
  }));
}

/** The page shown for `pageId`: that page if the board has it, otherwise the first. */
export function resolvePageId(board: BoardDocument | null, pageId: string | null | undefined) {
  const pages = board?.pages;
  if (!pages) return null;
  return pages.some((page) => page.id === pageId) ? pageId! : pages[0]!.id;
}

const pageViewCache = new WeakMap<BoardDocument, Map<string, BoardDocument>>();
/**
 * One page as an ordinary single-page document, without `pages`. The same input returns the
 * same object, so callers can compare documents by identity.
 */
export function boardPage(board: BoardDocument, pageId?: string | null): BoardDocument {
  const id = resolvePageId(board, pageId);
  if (!id) return board;
  let cache = pageViewCache.get(board);
  if (!cache) pageViewCache.set(board, (cache = new Map()));
  const cached = cache.get(id);
  if (cached) return cached;
  const page = pagesWithContent(board).find((page) => page.id === id)!;
  const view = { ...boardMetadataOf(board), ...page.content } as BoardDocument;
  cache.set(id, view);
  return view;
}

/** Writes a page's single-page document back; its board-level fields apply to the board. */
export function withBoardPage(
  board: BoardDocument,
  pageId: string | null | undefined,
  view: BoardDocument,
): BoardDocument {
  const id = resolvePageId(board, pageId);
  if (!id) return view;
  if (boardPage(board, id) === view) return board;
  return assembleBoardPages(
    boardMetadataOf(view),
    pagesWithContent(board).map((page) =>
      page.id === id ? { ...page, content: pageContentOf(view) } : page,
    ),
  );
}

export function addBoardPage(
  board: BoardDocument,
  page: { id: string; title: string },
  options: { after?: string | null; firstPage?: { id: string; title: string } } = {},
): BoardDocument {
  const pages: PageWithContent[] = board.pages
    ? pagesWithContent(board)
    : [
        {
          id: options.firstPage?.id ?? page.id,
          title: options.firstPage?.title ?? 'Page 1',
          content: pageContentOf(board),
        },
      ];
  if (pages.length >= MAX_BOARD_PAGES)
    throw new Error(`A board holds at most ${MAX_BOARD_PAGES} pages.`);
  if (pages.some((existing) => existing.id === page.id))
    throw new Error('Page IDs must be unique.');
  const at = options.after ? pages.findIndex((existing) => existing.id === options.after) : -1;
  const index = at === -1 ? pages.length : at + 1;
  pages.splice(index, 0, { id: page.id, title: page.title, content: emptyPageContent() });
  return assembleBoardPages(boardMetadataOf(board), pages);
}

/** Removing the last page is refused; removing the only visible page shows the next one. */
export function removeBoardPage(board: BoardDocument, pageId: string): BoardDocument {
  const pages = pagesWithContent(board).filter((page) => page.id !== pageId);
  if (!board.pages || pages.length === board.pages.length) return board;
  if (!pages.length) throw new Error('A board needs at least one page.');
  if (pages.every((page) => page.hidden)) delete pages[0]!.hidden;
  return assembleBoardPages(boardMetadataOf(board), pages);
}

export function moveBoardPage(board: BoardDocument, pageId: string, to: number): BoardDocument {
  const pages = pagesWithContent(board);
  const from = pages.findIndex((page) => page.id === pageId);
  const target = Math.max(0, Math.min(pages.length - 1, Math.trunc(to)));
  if (from === -1 || from === target) return board;
  const [moved] = pages.splice(from, 1);
  pages.splice(target, 0, moved!);
  return assembleBoardPages(boardMetadataOf(board), pages);
}

export function updateBoardPage(
  board: BoardDocument,
  pageId: string,
  patch: { title?: string; hidden?: boolean; id?: string },
): BoardDocument {
  const pages = pagesWithContent(board);
  const page = pages.find((candidate) => candidate.id === pageId);
  if (!page) return board;
  if (patch.id !== undefined && patch.id !== pageId) {
    if (pages.some((candidate) => candidate.id === patch.id))
      throw new Error('Page IDs must be unique.');
    page.id = patch.id;
  }
  if (patch.title !== undefined) page.title = patch.title;
  if (patch.hidden === true) page.hidden = true;
  if (patch.hidden === false) delete page.hidden;
  if (pages.every((candidate) => candidate.hidden))
    throw new Error('Keep at least one page visible to people viewing the board.');
  return assembleBoardPages(boardMetadataOf(board), pages);
}

/** The first page whose content differs between two versions of a board, if any. */
export function changedBoardPage(
  before: BoardDocument | null,
  after: BoardDocument | null,
): string | null {
  if (!before?.pages || !after?.pages) return null;
  const old = new Map(
    pagesWithContent(before).map((page) => [page.id, JSON.stringify(page.content)]),
  );
  for (const page of pagesWithContent(after))
    if (old.get(page.id) !== JSON.stringify(page.content)) return page.id;
  return null;
}

/** Every page as a single-page document, in reading order, for search and link scans. */
export function everyBoardPage(
  board: BoardDocument,
): { page: PageSummary | null; board: BoardDocument }[] {
  if (!board.pages) return [{ page: null, board }];
  return boardPages(board).map((page) => ({ page, board: boardPage(board, page.id) }));
}

/** Applies a single-page change to every page, such as remapping board links on import. */
export function mapBoardPages(
  board: BoardDocument,
  change: (page: BoardDocument) => BoardDocument,
): BoardDocument {
  if (!board.pages) return change(board);
  const base = boardMetadataOf(board);
  return assembleBoardPages(
    base,
    pagesWithContent(board).map((page) => ({
      ...page,
      content: pageContentOf(change({ ...base, ...page.content } as BoardDocument)),
    })),
  );
}

/**
 * What someone who only views the board receives: without hidden pages, except the one whose
 * link they opened. The first remaining page becomes the board's own fields.
 */
export function readerBoard(board: BoardDocument, revealPageId?: string | null): BoardDocument {
  if (!board.pages?.some((page) => page.hidden)) return board;
  const pages = pagesWithContent(board).filter((page) => !page.hidden || page.id === revealPageId);
  // Validation keeps a page visible; this guards documents saved before that rule.
  if (!pages.length) return { ...boardMetadataOf(board), ...emptyPageContent() };
  return assembleBoardPages(boardMetadataOf(board), pages);
}

/** A viewer's snapshot: readable pages only, and none of the editors' undo history. */
export function readerSnapshot(snapshot: BoardSnapshot, revealPageId?: string | null) {
  return {
    board: snapshot.board ? readerBoard(snapshot.board, revealPageId) : null,
    past: [],
    future: [],
  } satisfies BoardSnapshot;
}

/** Problems with a board's page list, beyond each page's own content. */
export function pageListProblems(pages: BoardPage[]): string[] {
  const problems: string[] = [];
  if (new Set(pages.map((page) => page.id)).size !== pages.length)
    problems.push('Page IDs must be unique.');
  if (pages[0]?.content) problems.push("The first page's content is the board's own fields.");
  if (pages.slice(1).some((page) => !page.content))
    problems.push('Every later page needs content.');
  if (pages.every((page) => page.hidden))
    problems.push('Keep at least one page visible to people viewing the board.');
  return problems;
}

/** A paged board from single-page documents; the first one's board-level fields apply. */
export function boardFromPages(
  pages: { id: string; title: string; hidden?: boolean; board: BoardDocument }[],
): BoardDocument {
  const [first] = pages;
  if (!first) throw new Error('A board needs at least one page.');
  return assembleBoardPages(
    boardMetadataOf(first.board),
    pages.map((page) => ({
      id: page.id,
      title: page.title,
      ...(page.hidden ? { hidden: true as const } : {}),
      content: pageContentOf(page.board),
    })),
  );
}
