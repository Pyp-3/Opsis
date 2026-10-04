import type { BoardDocument } from './board';

export function groupMembers(board: BoardDocument, id: string): string[] {
  const groups = board.groups ?? [];
  const group = groups.find((item) => item.id === id);
  if (!group) return [];
  return [
    ...group.nodeIds,
    ...groups
      .filter((item) => item.parentId === id)
      .flatMap((item) => groupMembers(board, item.id)),
  ];
}

/** Collapse presentation only; saved concepts, calculations and positions remain intact. */
export function visibleBoard(board: BoardDocument): BoardDocument {
  const representatives = new Map<string, string>();
  const labels = new Map<string, string>();
  for (const group of board.groups ?? []) {
    if (!group.collapsed) continue;
    let parent = group.parentId;
    let hidden = false;
    while (parent) {
      const ancestor = board.groups?.find((item) => item.id === parent);
      if (ancestor?.collapsed) hidden = true;
      parent = ancestor?.parentId;
    }
    if (hidden) continue;
    const members = groupMembers(board, group.id);
    const representative = members[0];
    if (!representative) continue;
    for (const id of members) representatives.set(id, representative);
    labels.set(representative, `${group.label} (${members.length})`.slice(0, 80));
  }
  const nodes = board.nodes
    .filter((node) => !representatives.has(node.id) || representatives.get(node.id) === node.id)
    .map((node) => (labels.has(node.id) ? { ...node, label: labels.get(node.id)! } : node));
  const edges = board.edges
    .map((edge) => ({
      ...edge,
      source: representatives.get(edge.source) ?? edge.source,
      target: representatives.get(edge.target) ?? edge.target,
    }))
    .filter(
      (edge) =>
        edge.source !== edge.target ||
        board.edges.find((original) => original.id === edge.id)?.source ===
          board.edges.find((original) => original.id === edge.id)?.target,
    );
  return { ...board, nodes, edges };
}
