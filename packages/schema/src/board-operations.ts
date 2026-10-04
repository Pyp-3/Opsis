import {
  BOARD_HISTORY_LIMIT,
  withoutNarration,
  type BoardDocument,
  type BoardSnapshot,
} from './board';
import { withoutBrokenProcesses } from './process';

export type BoardNode = BoardDocument['nodes'][number];

export function createEmptyBoard(
  title = 'Untitled canvas',
  agent: BoardDocument['agent'] = 'claude',
): BoardDocument {
  return { version: 2, title, description: '', nodes: [], edges: [], positions: {}, agent };
}

/** Append a state while retaining the most recent undo/redo entries. */
export function appendBoardHistory(
  history: BoardSnapshot['past'],
  board: BoardDocument | null,
): BoardSnapshot['past'] {
  return [...history.slice(-(BOARD_HISTORY_LIMIT - 1)), board];
}

/** Record an accepted edit. Callers decide whether a no-op counts as an edit. */
export function recordBoardEdit(
  snapshot: BoardSnapshot,
  board: BoardDocument | null,
  before = snapshot.board,
): BoardSnapshot {
  return { board, past: appendBoardHistory(snapshot.past, before), future: [] };
}

/** Removing a concept also removes its incident edges and dependent calculations. */
export function removeBoardNode(board: BoardDocument, id: string): BoardDocument {
  const positions = { ...board.positions };
  delete positions[id];
  return {
    ...board,
    nodes: withoutBrokenProcesses(board.nodes.filter((node) => node.id !== id)),
    edges: board.edges.filter((edge) => edge.source !== id && edge.target !== id),
    positions,
    ...(board.groups
      ? {
          groups: board.groups.map((group) => ({
            ...group,
            nodeIds: group.nodeIds.filter((item) => item !== id),
          })),
        }
      : {}),
    ...(board.pinnedNodeIds
      ? { pinnedNodeIds: board.pinnedNodeIds.filter((item) => item !== id) }
      : {}),
    ...(board.edgePorts
      ? {
          edgePorts: Object.fromEntries(
            Object.entries(board.edgePorts).filter(([edgeId]) =>
              board.edges.some(
                (edge) => edge.id === edgeId && edge.source !== id && edge.target !== id,
              ),
            ),
          ),
        }
      : {}),
  };
}

/** Apply edited content, invalidating generated presentation only when requested. */
export function patchBoardNode(
  node: BoardNode,
  patch: Partial<BoardNode>,
  invalidation: { narration: boolean; drawing: boolean },
): BoardNode {
  const next = { ...node, ...patch };
  if (invalidation.drawing) {
    delete next.customIcon;
    delete next.illustration;
  }
  return invalidation.narration ? withoutNarration(next) : next;
}
