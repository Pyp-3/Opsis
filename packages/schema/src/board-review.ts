import { BoardDocumentSchema, type BoardDocument } from './board';

export type BoardReviewChange = { key: string; label: string };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const metadata = (board: BoardDocument) => ({
  title: board.title,
  description: board.description,
  suggestions: board.suggestions,
  narration: board.narration,
});

/** Changes are selected by stable entity ID, never by presentation text. */
export function boardReviewChanges(
  before: BoardDocument,
  candidate: BoardDocument,
): BoardReviewChange[] {
  const changes: BoardReviewChange[] = [];
  for (const collection of ['nodes', 'edges'] as const) {
    const ids = new Set([...before[collection], ...candidate[collection]].map((item) => item.id));
    for (const id of ids) {
      const old = before[collection].find((item) => item.id === id);
      const next = candidate[collection].find((item) => item.id === id);
      if (!same(old, next))
        changes.push({
          key: collection + ':' + id,
          label: `${!old ? 'Add' : !next ? 'Remove' : 'Update'} ${collection === 'nodes' ? 'concept' : 'connection'}: ${next?.label || old?.label || id}`,
        });
    }
  }
  if (!same(metadata(before), metadata(candidate)))
    changes.push({ key: 'metadata', label: 'Update title, description and suggestions' });
  return changes;
}

/** Invalid combinations fail explicitly. Rejecting a change never silently accepts a dependent removal. */
export function selectBoardChanges(
  before: BoardDocument,
  candidate: BoardDocument,
  selected: readonly string[],
): BoardDocument {
  const keys = new Set(selected);
  function merge<T extends { id: string }>(
    collection: 'nodes' | 'edges',
    old: T[],
    next: T[],
  ): T[] {
    return [
      ...old.flatMap((item) => {
        if (!keys.has(collection + ':' + item.id)) return [item];
        const replacement = next.find((candidate) => candidate.id === item.id);
        return replacement ? [replacement] : [];
      }),
      ...next.filter(
        (item) =>
          !old.some((previous) => previous.id === item.id) && keys.has(collection + ':' + item.id),
      ),
    ];
  }
  const nodes = merge('nodes', before.nodes, candidate.nodes);
  const edges = merge('edges', before.edges, candidate.edges);
  const ids = new Set(nodes.map((node) => node.id));
  if (edges.some((edge) => !ids.has(edge.source) || !ids.has(edge.target)))
    throw new Error(
      'This selection leaves a connection without an endpoint. Keep its concept or also select the matching connection change.',
    );
  return BoardDocumentSchema.parse({
    ...before,
    agent: keys.size ? candidate.agent : before.agent,
    ...(keys.has('metadata') ? metadata(candidate) : {}),
    nodes,
    edges,
    ...(before.groups
      ? {
          groups: before.groups.map((group) => ({
            ...group,
            nodeIds: group.nodeIds.filter((id) => ids.has(id)),
          })),
        }
      : {}),
    positions: Object.fromEntries(
      nodes.map((node) => [
        node.id,
        before.positions[node.id] ?? candidate.positions[node.id] ?? { x: 24, y: 24 },
      ]),
    ),
    edgePorts: Object.fromEntries(
      edges.flatMap((edge) => {
        const ports = keys.has('edges:' + edge.id)
          ? candidate.edgePorts?.[edge.id]
          : before.edgePorts?.[edge.id];
        return ports ? [[edge.id, ports]] : [];
      }),
    ),
    ...(before.pinnedNodeIds
      ? { pinnedNodeIds: before.pinnedNodeIds.filter((id) => ids.has(id)) }
      : {}),
  });
}
