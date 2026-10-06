import { useMemo } from 'react';
import { MarkerType } from '@xyflow/react';
import { visibleBoard, type BoardDocument } from '@opsis/schema';
import type { DiagramNode } from './IconNode';
import type { ProcessState } from './useProcessEngine';
import { NODE_WIDTH, nodeHeight } from './geometry';
import { edgePorts, connectionStyle } from './connections';
import { routeBoard } from './routing';

export type PlaybackFocus = {
  nodes: Set<string>;
  edges: Set<string>;
  nodeId: string | null;
  edgeId: string | null;
};

/** Translate board data into the diagram library's presentation model. */
export function useBoardDiagram(
  source: BoardDocument | null,
  selected: string | null,
  selectedEdge: string | null,
  playback: PlaybackFocus | null,
  process: ProcessState,
) {
  const board = useMemo(() => (source ? visibleBoard(source) : null), [source]);
  const nodes: DiagramNode[] = useMemo(
    () =>
      board?.nodes.map((node, index) => ({
        id: node.id,
        type: 'concept',
        draggable: !board.pinnedNodeIds?.includes(node.id),
        position: board.positions[node.id] ?? { x: 0, y: index * 200 },
        selected: selected === node.id,
        ...(playback
          ? {
              className:
                playback.nodeId === node.id
                  ? 'is-current'
                  : playback.nodes.has(node.id)
                    ? ''
                    : 'is-dimmed',
            }
          : {}),
        width: NODE_WIDTH,
        height: nodeHeight(node),
        // Supplying the known footprint keeps React Flow from treating every dragged
        // position update as an unmeasured node, which unmounted all edges for a frame.
        measured: { width: NODE_WIDTH, height: nodeHeight(node) },
        ariaLabel: `${node.label}. ${node.summary}`,
        data: {
          label: node.label,
          icon: node.icon,
          customIcon: node.customIcon,
          linkedBoardId: node.linkedBoardId,
          kind: node.kind,
          number: index + 1,
          outgoing: board.edges.filter((edge) => edge.source === node.id).length,
          confidence: node.confidence,
          illustration: node.illustration,
          command: node.terminal?.command,
          sample: process.results.has(node.id)
            ? {
                input: process.results.get(node.id)!.inputRows,
                output: process.results.get(node.id)!.outputRows,
              }
            : undefined,
          stage:
            playback?.nodeId === node.id
              ? 'current'
              : playback?.nodes.has(node.id)
                ? 'revealed'
                : null,
        },
      })) ?? [],
    [board, selected, playback, process.results],
  );
  const routes = useMemo(() => (board ? routeBoard(board) : {}), [board]);
  const edges = useMemo(
    () =>
      board?.edges.map((edge) => ({
        ...edge,
        type: 'routed',
        data: { route: routes[edge.id]!, current: playback?.edgeId === edge.id },
        sourceHandle: edgePorts(board, edge).source,
        targetHandle: edgePorts(board, edge).target,
        interactionWidth: 24,
        selected: selectedEdge === edge.id,
        ...(playback
          ? {
              className:
                playback.edgeId === edge.id
                  ? 'is-current'
                  : playback.edges.has(edge.id)
                    ? ''
                    : 'is-dimmed',
            }
          : {}),
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: connectionStyle(edge).color,
          width: 22,
          height: 22,
        },
        style: {
          stroke: selectedEdge === edge.id ? '#ffffff' : connectionStyle(edge).color,
          strokeWidth: 2,
          strokeLinecap: 'round' as const,
          strokeLinejoin: 'round' as const,
          strokeDasharray: connectionStyle(edge).dash,
        },
        labelStyle: { fill: 'var(--bp-ink)', fontSize: 10, fontFamily: 'monospace' },
        labelBgStyle: { fill: 'var(--bp-deep)', fillOpacity: 0.95 },
        labelBgPadding: [7, 5] as [number, number],
      })) ?? [],
    [board, selectedEdge, routes, playback],
  );
  return { nodes, edges };
}
