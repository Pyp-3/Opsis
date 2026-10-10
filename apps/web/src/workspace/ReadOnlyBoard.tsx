import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Background,
  ConnectionMode,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import { Play } from 'lucide-react';
import { boardPage, type BoardDocument } from '@opsis/schema';
import { BoardPages } from './BoardPages';
import { IconNode } from './IconNode';
import { RoutedConnection } from './RoutedConnection';
import { useBoardDiagram, type PlaybackFocus } from './useBoardDiagram';
import { useProcessEngine } from './useProcessEngine';
import { DrawingLayer, useCanvasDrawing } from './CanvasDrawing';
import { applyLook, lookOf } from './canvas-theme';
import { NODE_WIDTH } from './model';
import type { Beat } from '@opsis/schema';
import { revealed } from './playback';
import { setNarrationSource } from './narrator';
import '@xyflow/react/dist/style.css';
import './workspace.css';

const ProcessPlayer = lazy(() =>
  import('./ProcessPlayer').then((module) => ({ default: module.ProcessPlayer })),
);
const nodeTypes = { concept: IconNode };
const edgeTypes = { routed: RoutedConnection };
const noEdit = () => undefined;

/** A board's diagram and drawings to explore (pan, zoom) without changing anything. */
export function PublicCanvas({
  board,
  playback = null,
  label = 'Read-only diagram',
  className = '',
  process: shared,
  children,
}: {
  board: BoardDocument;
  /** Calculated sample data, when the caller already runs the process engine for this board. */
  process?: ReturnType<typeof useProcessEngine>;
  /** What the process player has reached, so the diagram reveals step by step. */
  playback?: PlaybackFocus | null;
  label?: string;
  className?: string;
  /** Overlays, such as the page bar and the player. */
  children?: ReactNode;
}) {
  const own = useProcessEngine(shared ? null : board);
  const { nodes, edges } = useBoardDiagram(board, null, null, playback, shared ?? own);
  const boardRef = useMemo(() => ({ current: board }), [board]);
  const drawing = useCanvasDrawing({
    board,
    boardRef,
    editable: false,
    setBoard: noEdit,
    commit: noEdit,
    begin: noEdit,
    end: noEdit,
    onSelect: noEdit,
  });
  const look = lookOf(board);
  useEffect(() => {
    applyLook({ canvas: look.canvas, icon: look.icon });
  }, [look.canvas, look.icon]);
  return (
    <section className={`blueprint ${className}`} aria-label={label}>
      <ReactFlow
        nodes={nodes.map((node) => ({ ...node, draggable: false }))}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        // As on the editable canvas: every port is a source, so arrows may end at any of them.
        connectionMode={ConnectionMode.Loose}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesReconnectable={false}
        elementsSelectable={false}
        deleteKeyCode={null}
        fitView
        minZoom={0.1}
        maxZoom={2}
      >
        <Background />
        {/* Top right, clear of the page bar and the player along the bottom. */}
        <Controls showInteractive={false} position="top-right" />
        <DrawingLayer drawing={drawing} />
      </ReactFlow>
      {children}
    </section>
  );
}

/**
 * A shared board for people who only view it: the interactive canvas of one page, its pages to
 * turn, and the process player with narration. Nothing here can change the board.
 */
export function ReadOnlyBoard(props: {
  /** The board as viewers receive it: hidden pages are already left out. */
  board: BoardDocument;
  boardId: string;
  pageId: string | null;
  onPage: (pageId: string) => void;
  label?: string;
  className?: string;
}) {
  return (
    // A fresh view for every page, framed to fit.
    <ReactFlowProvider key={props.pageId ?? ''}>
      <ReadOnlyPage {...props} />
    </ReactFlowProvider>
  );
}

function ReadOnlyPage({
  board: whole,
  boardId,
  pageId,
  onPage,
  label,
  className,
}: Parameters<typeof ReadOnlyBoard>[0]) {
  const board = boardPage(whole, pageId);
  const flow = useReactFlow();
  const [playerOpen, setPlayerOpen] = useState(false);
  const [playback, setPlayback] = useState<PlaybackFocus | null>(null);
  const process = useProcessEngine(board);
  const still = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  // As on the editable canvas: each step of the film is brought into view.
  const followBeat = useCallback(
    (beats: Beat[], index: number) => {
      const beat = beats[index]!;
      setPlayback(
        beat.nodeId
          ? { ...revealed(beats, index), nodeId: beat.nodeId, edgeId: beat.edgeId }
          : null,
      );
      const point = beat.nodeId ? board.positions[beat.nodeId] : null;
      if (!point) {
        void flow.fitView({ padding: 0.22, duration: still() ? 0 : 500, maxZoom: 1.1 });
        return;
      }
      void flow.setCenter(point.x + NODE_WIDTH / 2, point.y + 130, {
        zoom: Math.max(0.85, flow.getZoom()),
        duration: still() ? 0 : 650,
      });
    },
    [flow, board.positions],
  );
  const close = useCallback(() => {
    setPlayerOpen(false);
    setPlayback(null);
  }, []);
  // The narrator only reads people without a member account this board's own script.
  useEffect(() => {
    setNarrationSource({ id: boardId, ...(pageId ? { page: pageId } : {}) });
    return () => setNarrationSource(null);
  }, [boardId, pageId]);
  return (
    <PublicCanvas
      board={board}
      playback={playback}
      process={process}
      {...(label ? { label } : {})}
      className={`read-only-board ${className ?? ''}`}
    >
      {!playerOpen && board.nodes.length > 0 && (
        <button
          type="button"
          className="play-process read-only-play"
          onClick={() => setPlayerOpen(true)}
        >
          <Play size={13} fill="currentColor" /> Play the process
        </button>
      )}
      {whole.pages && !playerOpen && (
        <BoardPages
          document={whole}
          pageId={pageId}
          boardId={boardId}
          editable={false}
          onOpen={onPage}
          onChange={noEdit}
        />
      )}
      {playerOpen && (
        <div className="composer-wrap">
          <Suspense fallback={<p role="status">Loading player…</p>}>
            <ProcessPlayer
              board={board}
              disabled={false}
              process={process}
              onBeat={followBeat}
              onClose={close}
            />
          </Suspense>
        </div>
      )}
    </PublicCanvas>
  );
}
