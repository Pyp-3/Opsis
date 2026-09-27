import {
  BoardDocumentSchema,
  type BoardDocument,
  type BoardGraph,
  type BoardAgent,
} from '@opsis/schema';

export const STORAGE_KEY = 'opsis:board:v2';
import { NODE_WIDTH, COLUMN_GAP, ROW_GAP, nodeHeight, wrapLabel } from './geometry';
import { isReturnEdge, connectionLabel } from './connections';
export { NODE_WIDTH, NODE_HEIGHT } from './geometry';

/** Retain hand-placed nodes and place additions in unoccupied space. */
export async function layoutBoard(
  graph: BoardGraph,
  agent: BoardAgent,
  previous?: BoardDocument,
  availableWidth = 900,
): Promise<BoardDocument> {
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
  const elk = new ELK();
  const result = await elk.layout({
    id: 'board',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.spacing.nodeNode': '70',
      'elk.layered.spacing.nodeNodeBetweenLayers': '100',
    },
    children: graph.nodes.map((node) => ({
      id: node.id,
      width: NODE_WIDTH,
      height: nodeHeight(node),
    })),
    edges: graph.edges
      .filter((edge) => !isReturnEdge(edge))
      .map((edge) => ({
        id: edge.id,
        sources: [edge.source],
        targets: [edge.target],
      })),
  });
  // Keep a bounded number of parallel lanes. Overflow branches continue on subsequent
  // rows rather than widening the graph or shrinking the entire canvas to fit it.
  const columns = Math.max(
    1,
    Math.min(3, Math.floor((availableWidth - 280 + COLUMN_GAP) / (NODE_WIDTH + COLUMN_GAP))),
  );
  const ordered = [...(result.children ?? [])].sort(
    (a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0),
  );
  const layers: (typeof ordered)[] = [];
  for (const node of ordered) {
    const last = layers[layers.length - 1];
    if (last && Math.abs((last[0]?.y ?? 0) - (node.y ?? 0)) < 2) last.push(node);
    else layers.push([node]);
  }
  const usedColumns = Math.min(columns, Math.max(1, ...layers.map((layer) => layer.length)));
  const automatic: BoardDocument['positions'] = {};
  let nextY = 24;
  for (const layer of layers) {
    for (let offset = 0; offset < layer.length; offset += columns) {
      const chunk = layer.slice(offset, offset + columns);
      chunk.forEach((node, index) => {
        automatic[node.id] = {
          x: 24 + ((usedColumns - chunk.length) / 2 + index) * (NODE_WIDTH + COLUMN_GAP),
          y: nextY,
        };
      });
      const incident = graph.edges.filter((edge) =>
        chunk.some((node) => node.id === edge.source || node.id === edge.target),
      );
      const labelClearance = Math.max(
        ROW_GAP,
        ...incident.map((edge) => wrapLabel(connectionLabel(edge), 24).length * 16 + 36),
      );
      const laneClearance = Math.min(48, Math.max(0, incident.length - 2) * 8);
      nextY +=
        Math.max(...chunk.map((node) => node.height ?? 124)) + labelClearance + laneClearance;
    }
  }
  const positions: BoardDocument['positions'] = {};
  for (const node of graph.nodes) {
    const prior = previous?.positions[node.id];
    if (prior) positions[node.id] = prior;
  }
  for (const node of result.children ?? []) {
    if (positions[node.id]) continue;
    let { x, y } = automatic[node.id] ?? { x: 24, y: 24 };
    const parent = graph.edges.find((edge) => edge.target === node.id && !isReturnEdge(edge));
    const parentPosition = parent && positions[parent.source];
    if (previous && parentPosition) {
      x = parentPosition.x;
      y =
        parentPosition.y +
        nodeHeight(graph.nodes.find((item) => item.id === parent!.source)!) +
        ROW_GAP;
    }
    while (
      Object.entries(positions).some(
        ([id, p]) =>
          Math.abs(p.x - x) < NODE_WIDTH + 32 &&
          y < p.y + nodeHeight(graph.nodes.find((item) => item.id === id)!) + 32 &&
          y + (node.height ?? 124) + 32 > p.y,
      )
    )
      y += (node.height ?? 124) + ROW_GAP;
    positions[node.id] = { x, y };
  }
  const edgePorts = Object.fromEntries(
    Object.entries(previous?.edgePorts ?? {}).filter(([id]) => {
      const before = previous?.edges.find((edge) => edge.id === id);
      return graph.edges.some(
        (edge) => edge.id === id && edge.source === before?.source && edge.target === before.target,
      );
    }),
  );
  return BoardDocumentSchema.parse({ ...graph, version: 2, agent, positions, edgePorts });
}

export function restoreBoard(): BoardDocument | null {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return null;
  return BoardDocumentSchema.parse(JSON.parse(stored));
}

export function removeNode(board: BoardDocument, id: string): BoardDocument {
  const positions = { ...board.positions };
  delete positions[id];
  return {
    ...board,
    nodes: board.nodes.filter((node) => node.id !== id),
    edges: board.edges.filter((edge) => edge.source !== id && edge.target !== id),
    positions,
  };
}
