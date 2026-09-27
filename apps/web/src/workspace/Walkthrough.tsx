import type { BoardDocument } from '@opsis/schema';

/** Roots first, following outgoing paths; cycle/disconnected fallback visits every node once. */
export function walkthroughOrder(board: BoardDocument): string[] {
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    board.edges.filter((edge) => edge.source === id).forEach((edge) => visit(edge.target));
  };
  board.nodes
    .filter((node) => !board.edges.some((edge) => edge.target === node.id))
    .forEach((node) => visit(node.id));
  board.nodes.forEach((node) => visit(node.id));
  return [...visited];
}
