import type { BoardDocument, BoardGraph } from './board';

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
