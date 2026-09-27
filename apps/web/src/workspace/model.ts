import {
  BoardDocumentSchema,
  type BoardDocument,
  type BoardGraph,
  type BoardAgent,
} from '@opsis/schema';

export const STORAGE_KEY = 'opsis:board:v2';
export const NODE_WIDTH = 178;
export const NODE_HEIGHT = 132;

/** Retain hand-placed nodes and place additions in unoccupied space. */
export async function layoutBoard(
  graph: BoardGraph,
  agent: BoardAgent,
  previous?: BoardDocument,
): Promise<BoardDocument> {
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
  const elk = new ELK();
  const result = await elk.layout({
    id: 'board',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': '70',
      'elk.layered.spacing.nodeNodeBetweenLayers': '100',
    },
    children: graph.nodes.map((node) => ({ id: node.id, width: NODE_WIDTH, height: NODE_HEIGHT })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  });
  const positions: BoardDocument['positions'] = {};
  for (const node of graph.nodes) {
    const prior = previous?.positions[node.id];
    if (prior) positions[node.id] = prior;
  }
  for (const node of result.children ?? []) {
    if (positions[node.id]) continue;
    let x = Math.round((node.x ?? 0) / 24) * 24;
    let y = Math.round((node.y ?? 0) / 24) * 24;
    const parent = graph.edges.find((edge) => edge.target === node.id);
    const parentPosition = parent && positions[parent.source];
    if (previous && parentPosition) {
      x = parentPosition.x + 288;
      y = parentPosition.y + 216;
    }
    while (
      Object.values(positions).some(
        (p) => Math.abs(p.x - x) < NODE_WIDTH + 48 && Math.abs(p.y - y) < NODE_HEIGHT + 48,
      )
    )
      y += 216;
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
