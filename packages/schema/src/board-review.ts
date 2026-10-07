import { BoardDocumentSchema, type BoardDocument } from './board';
import {
  AGENT_SKETCH_LAYER,
  agentSketchOf,
  detachDrawings,
  type BoardDrawing,
} from './board-drawings';

export type BoardReviewChange = { key: string; label: string };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Key order differs between edited and validated objects; it never makes drawings differ. */
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([, item]) => item !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([key, item]) => [key, canonical(item)]),
        )
      : value;
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
  const [oldSketch, newSketch] = [agentSketchOf(before), agentSketchOf(candidate)];
  if (!same(canonical(oldSketch), canonical(newSketch)))
    changes.push({
      key: 'drawings',
      label: !newSketch.length
        ? 'Remove agent sketch'
        : `${oldSketch.length ? 'Update' : 'Add'} agent sketch: ${newSketch.length} drawing${newSketch.length === 1 ? '' : 's'}`,
    });
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
    ...reviewedDrawings(before, candidate, keys.has('drawings'), ids),
  });
}

/**
 * The reader's drawings always stay; the agent's sketch is the proposed one only when its change
 * is accepted. A drawing attached to a concept that is not kept stays where it was drawn.
 */
function reviewedDrawings(
  before: BoardDocument,
  candidate: BoardDocument,
  acceptSketch: boolean,
  ids: ReadonlySet<string>,
): Pick<BoardDocument, 'drawings' | 'drawingLayers'> {
  if (!acceptSketch)
    return before.drawings
      ? { drawings: detachDrawings(before.drawings, ids, before.positions) }
      : {};
  const others = (before.drawings ?? []).filter(
    (drawing) => drawing.layerId !== AGENT_SKETCH_LAYER.id,
  );
  const drawings: BoardDrawing[] = [
    ...(detachDrawings(others, ids, before.positions) ?? []),
    ...(detachDrawings(agentSketchOf(candidate), ids, candidate.positions) ?? []),
  ];
  const layers = before.drawingLayers ?? [];
  const drawingLayers =
    drawings.some((drawing) => drawing.layerId === AGENT_SKETCH_LAYER.id) &&
    !layers.some((layer) => layer.id === AGENT_SKETCH_LAYER.id)
      ? [...layers, AGENT_SKETCH_LAYER]
      : layers;
  // Set even when empty, so an accepted removal replaces what the board had.
  return {
    drawings: drawings.length ? drawings : undefined,
    drawingLayers: drawingLayers.length ? drawingLayers : undefined,
  };
}
