import type { BoardDocument, BoardGraph } from './board';
import { everyBoardPage, readerBoard } from './board-pages';

/** Discard generated destinations, then restore explicit links by stable concept ID. */
export function preserveBoardLinks(graph: BoardGraph, before?: BoardDocument): BoardGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const next = { ...node };
      delete next.linkedBoardId;
      const destination = before?.nodes.find((old) => old.id === node.id)?.linkedBoardId;
      if (destination) next.linkedBoardId = destination;
      return next;
    }),
  };
}

export type Backlink = {
  id: string;
  title: string;
  conceptId: string;
  label: string;
  pageId?: string;
};
/** A board that may link to another, as the reading account can see it. */
export type LinkingBoard = {
  id: string;
  title: string;
  board: BoardDocument | null;
  /** Owners and editors see every page; anyone else only the pages viewers receive. */
  fullAccess: boolean;
};

/** Concepts, on any page the reader can see, that link to `targetId`; ordered by board title. */
export function boardBacklinks(targetId: string, boards: LinkingBoard[]): Backlink[] {
  return [...boards]
    .sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : a.id < b.id ? -1 : 1))
    .flatMap((entry) =>
      entry.board
        ? everyBoardPage(entry.fullAccess ? entry.board : readerBoard(entry.board)).flatMap(
            ({ page, board }) =>
              board.nodes
                .filter((node) => node.linkedBoardId === targetId)
                .map((node) => ({
                  id: entry.id,
                  title: entry.title,
                  conceptId: node.id,
                  label: node.label,
                  ...(page ? { pageId: page.id } : {}),
                })),
          )
        : [],
    );
}
