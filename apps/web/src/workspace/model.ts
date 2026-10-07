import { arrangeGraph } from './layout-engine';
import {
  BoardDocumentSchema,
  detachDrawings,
  type BoardDocument,
  type BoardGraph,
  type BoardAgent,
} from '@opsis/schema';
import { populateProcess } from './process-engine';

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
  preservePositions: 'all' | 'pinned' = 'all',
): Promise<BoardDocument> {
  graph = await populateProcess(graph);
  const result = await arrangeGraph({
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
      // Sit each row under the objects that feed it (barycentre of placed parents), so
      // arrows drop straight down instead of zig-zagging to a centred row.
      const step = NODE_WIDTH + COLUMN_GAP;
      const target = (id: string) => {
        const parents = graph.edges
          .filter((edge) => edge.target === id && !isReturnEdge(edge) && automatic[edge.source])
          .map((edge) => automatic[edge.source]!.x);
        return parents.length ? parents.reduce((a, b) => a + b, 0) / parents.length : null;
      };
      const wanted = chunk.map((node) => target(node.id));
      let start = (usedColumns - chunk.length) / 2;
      if (wanted.some((x) => x !== null)) {
        let bestCost = Infinity;
        for (let s = 0; s <= usedColumns - chunk.length + 1e-9; s += 0.5) {
          const cost = wanted.reduce<number>(
            (sum, x, i) => sum + (x === null ? 0 : Math.abs(24 + (s + i) * step - x)),
            Math.abs(s - (usedColumns - chunk.length) / 2) * 0.01,
          );
          if (cost < bestCost) [bestCost, start] = [cost, s];
        }
      }
      chunk.forEach((node, index) => {
        automatic[node.id] = { x: 24 + (start + index) * step, y: nextY };
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
    if (prior && (preservePositions === 'all' || previous?.pinnedNodeIds?.includes(node.id)))
      positions[node.id] = prior;
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
  // Agents never return colours; keep the reader's choices on edges that survive an update.
  const edges = graph.edges.map((edge) => {
    const color = previous?.edges.find((item) => item.id === edge.id)?.color;
    return color && !edge.color ? { ...edge, color } : edge;
  });
  // Nor do they return drawings; an object keeps its illustration while it keeps its icon,
  // and a custom icon an agent left out while keeping the same fallback.
  const nodes = graph.nodes.map((node) => {
    const before = previous?.nodes.find((item) => item.id === node.id);
    if (!before) return node;
    const kept = {
      ...node,
      ...(before.linkedBoardId ? { linkedBoardId: before.linkedBoardId } : {}),
      ...(before.notes !== undefined && node.notes === undefined ? { notes: before.notes } : {}),
      ...(before.references && !node.references ? { references: before.references } : {}),
    };
    if (before.icon !== node.icon) return kept;
    if (before.customIcon && !node.customIcon) kept.customIcon = before.customIcon;
    if (before.illustration && !node.illustration) kept.illustration = before.illustration;
    return kept;
  });
  return BoardDocumentSchema.parse({
    ...graph,
    nodes,
    edges,
    version: 2,
    agent,
    positions,
    edgePorts,
    ...(previous?.groups
      ? {
          groups: previous.groups.map((group) => ({
            ...group,
            nodeIds: group.nodeIds.filter((id) => nodes.some((node) => node.id === id)),
          })),
        }
      : {}),
    ...(previous?.pinnedNodeIds
      ? {
          pinnedNodeIds: previous.pinnedNodeIds.filter((id) =>
            nodes.some((node) => node.id === id),
          ),
        }
      : {}),
    // Agents never see the canvas colours; a follow-up keeps the ones the reader chose.
    ...(previous?.look ? { look: previous.look } : {}),
    // Nor the reader's canvas drawings; a sketch on a dropped concept stays where it was drawn.
    ...(previous?.drawings
      ? {
          drawings: detachDrawings(
            previous.drawings,
            new Set(nodes.map((node) => node.id)),
            previous.positions,
          ),
        }
      : {}),
    ...(previous?.drawingLayers ? { drawingLayers: previous.drawingLayers } : {}),
    ...(previous?.drawingScale ? { drawingScale: previous.drawingScale } : {}),
  });
}

/**
 * Drawings are large and only matter to playback, and colours and canvas sketches only to the
 * reader, so agents are sent the board without them; `layoutBoard` restores them afterwards.
 */
export function withoutIllustrations(board: BoardDocument): BoardDocument {
  const rest = { ...board };
  delete rest.look;
  delete rest.drawings;
  delete rest.drawingLayers;
  delete rest.drawingScale;
  return {
    ...rest,
    nodes: board.nodes.map((node) => {
      const copy = { ...node };
      delete copy.illustration;
      return copy;
    }),
  };
}

export function restoreBoard(): BoardDocument | null {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return null;
  return BoardDocumentSchema.parse(JSON.parse(stored));
}

export { removeBoardNode as removeNode } from '@opsis/schema';
