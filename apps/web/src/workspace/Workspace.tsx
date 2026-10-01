import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Handle,
  MarkerType,
  Position,
  PanOnScrollMode,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Node,
  type NodeProps,
  type NodeChange,
} from '@xyflow/react';
import {
  ArrowRight,
  ArrowUpRight,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Download,
  Expand,
  FileJson,
  GitBranch,
  ImageIcon,
  LoaderCircle,
  PanelLeft,
  Play,
  Pencil,
  SlidersHorizontal,
  Plus,
  Redo2,
  Search,
  Square,
  Trash2,
  Undo2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
  ListTree,
  ArrowDownToLine,
} from 'lucide-react';
import {
  BOARD_MODEL_CHOICES,
  BoardAgentsSchema,
  BoardModelSettingsSchema,
  BoardEdgeKindSchema,
  withoutNarration,
  EDGE_COLORS,
  EMAIL_DEMO,
  DNS_DEMO,
  type BoardGraph,
  type BoardAgent,
  type BoardAttachment,
  type Illustration,
  terminalExampleFor,
} from '@opsis/schema';
import { TerminalDetails } from './TerminalDetails';
import { boardIcons, iconMotion } from './icons';
import { IllustrationView, usePrefersReducedMotion } from './Illustration';
import { useIllustrator } from './useIllustrator';
import { AgentActivity } from './AgentActivityView';
import { BrandMark } from './BrandMark';
import { AgentLogo } from './AgentLogo';
import { layoutBoard, NODE_HEIGHT, NODE_WIDTH, removeNode } from './model';
import { boardSvg, boardMarkdown, downloadPng, download } from './export';
import { ModelControls } from './ModelControls';
import {
  connectBoard,
  edgePorts,
  PORT_OFFSETS,
  connectionStyle,
  EDGE_COLOR_VALUES,
} from './connections';
import { MODEL_SETTINGS_KEY, readModelPreferences } from './model-settings';
import { useBoardHistory } from './useBoardHistory';
import { restoreLibrary, useBoardLibrary } from './useBoardLibrary';
import { useBoardGeneration } from './useBoardGeneration';
import { GenerationReview } from './GenerationReview';
import { importBoard } from './migration';
import { ProcessPlayer } from './ProcessPlayer';
import { NextSteps, RETURN_PATHS } from './NextSteps';
import { IconPicker } from './IconPicker';
import { BoardsPage } from './BoardsPage';
import { navigate, usePath } from '../router';
import { revealed, type Beat } from './playback';
import { WorkspaceSidebar } from './WorkspaceSidebar';
import { routeBoard } from './routing';
import { RoutedConnection } from './RoutedConnection';
import { AttachButton, AttachmentChips } from './Attachments';
import { wrapLabel, ROW_GAP, nodeHeight } from './geometry';
import '@xyflow/react/dist/style.css';
import './workspace.css';

type DiagramNode = Node<{
  label: string;
  icon: keyof typeof boardIcons;
  kind: string;
  number: number;
  outgoing: number;
  confidence: string | undefined;
  illustration: Illustration | undefined;
  command: string | undefined;
  /** Where playback is: on this object, past it, or not playing (or not reached). */
  stage: 'current' | 'revealed' | null;
}>;

function IconNode({ data, selected }: NodeProps<DiagramNode>) {
  const Icon = boardIcons[data.icon] ?? boardIcons.box;
  const still = usePrefersReducedMotion();
  // During playback an illustrated icon evolves into its drawing, which stays once reached.
  const evolved = data.illustration && data.stage;
  return (
    <div
      className={`blueprint-node ${selected ? 'is-selected' : ''} ${data.kind === 'decision' ? 'is-decision' : ''}`}
      // Staggers the entrance so a new board assembles in reading order.
      style={{ ['--enter-index' as string]: Math.min(data.number - 1, 14) }}
    >
      <div
        className={`node-symbol ${evolved ? 'is-evolved' : ''}`}
        data-motion={data.stage === 'current' && !evolved ? iconMotion(data.icon) : undefined}
      >
        <Icon className="node-icon" size={48} strokeWidth={1.35} />
        {evolved && (
          // Remounted on each visit, so the drawing plays from the start every time.
          <IllustrationView
            key={data.stage}
            illustration={data.illustration!}
            animate={data.stage === 'current' && !still}
          />
        )}
        {(['left', 'right', 'top', 'bottom'] as const).map((side) => (
          <Handle
            key={side}
            id={side}
            type="source"
            position={
              {
                left: Position.Left,
                right: Position.Right,
                top: Position.Top,
                bottom: Position.Bottom,
              }[side]
            }
            title={`${data.label}: ${side} connection`}
            style={{
              left: PORT_OFFSETS[side].x - (NODE_WIDTH - 88) / 2,
              top: PORT_OFFSETS[side].y,
              right: 'auto',
              bottom: 'auto',
              transform: 'translate(-50%, -50%)',
            }}
          />
        ))}
        {data.outgoing > 1 && (
          <span className="branch-count" title={`${data.outgoing} outgoing connections`}>
            <GitBranch size={10} />
            {data.outgoing}
          </span>
        )}
      </div>
      <strong title={data.label}>
        {wrapLabel(data.label).map((line, i) => (
          <span key={i}>{line}</span>
        ))}
      </strong>
      {data.command && (
        <code className="node-command" title={data.command}>
          {wrapLabel(data.command, 26).map((line, i) => (
            <span key={i}>{line}</span>
          ))}
        </code>
      )}
      {data.confidence && data.confidence !== 'normal' && (
        <span className="confidence-badge">{data.confidence}</span>
      )}
    </div>
  );
}
const nodeTypes = { concept: IconNode };
const edgeTypes = { routed: RoutedConnection };

function BoardWorkspace() {
  const [initial] = useState(restoreLibrary);
  const { board, boardRef, setBoard, commit, history, snapshot, replace, travel, begin, end } =
    useBoardHistory(initial.snapshot);
  const generation = useBoardGeneration(commit);
  const [arranging, setArranging] = useState(false);
  const [playerOpen, setPlayerOpen] = useState(false);
  const illustrator = useIllustrator(boardRef, setBoard);
  const library = useBoardLibrary(
    initial,
    snapshot,
    replace,
    board !== snapshot.board ||
      generation.busy ||
      !!generation.review ||
      illustrator.busy ||
      arranging ||
      playerOpen,
  );
  const { error, setError, setBusy } = generation;
  const { cancel: cancelIllustration } = illustrator;
  const busy = generation.busy || library.switching || !!generation.review || arranging;
  const saved = library.status;
  const [agent, setAgent] = useState<BoardAgent>(initial.snapshot.board?.agent ?? 'claude');
  const [modelPreferences, setModelPreferences] = useState(readModelPreferences);
  const [agents, setAgents] = useState<ReturnType<typeof BoardAgentsSchema.parse>>([]);
  const [connectionError, setConnectionError] = useState('');
  const [prompt, setPrompt] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [showIcons, setShowIcons] = useState(false);
  const [railOpen, setRailOpen] = useState(() => window.innerWidth > 760);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [attachments, setAttachments] = useState<BoardAttachment[]>([]);
  const [playback, setPlayback] = useState<{
    nodes: Set<string>;
    edges: Set<string>;
    nodeId: string | null;
    edgeId: string | null;
  } | null>(null);
  const exportMenu = useRef<HTMLDetailsElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const promptInput = useRef<HTMLTextAreaElement>(null);
  const flow = useReactFlow();
  const path = usePath();
  const readingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // The library can switch externally through board-manager creation/deletion.
    setAgent(boardRef.current?.agent ?? 'claude');
    setSelected(null);
    setSelectedEdge(null);
    setPlayerOpen(false);
    setPlayback(null);
    cancelIllustration();
  }, [library.activeId, boardRef, cancelIllustration]);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/v1/agents', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Agent service is unavailable');
        setAgents(BoardAgentsSchema.parse(await response.json()));
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setConnectionError('Agent service offline. Start the API to connect.');
      });
    return () => controller.abort();
  }, []);

  const fit = useCallback(() => {
    if (readingTimer.current) clearTimeout(readingTimer.current);
    void flow.fitView({ padding: 0.22, duration: 300, maxZoom: 1.1 });
  }, [flow]);
  const readingView = useCallback(() => {
    const current = boardRef.current;
    if (!current) return;
    const positions = current.nodes.map((node) => current.positions[node.id]).filter((p) => !!p);
    if (!positions.length) return;
    const top = Math.min(...positions.map((p) => p.y));
    const firstRow = positions.filter((p) => p.y < top + NODE_HEIGHT);
    const center =
      (Math.min(...firstRow.map((p) => p.x)) + Math.max(...firstRow.map((p) => p.x)) + NODE_WIDTH) /
      2;
    const width = document.querySelector('.blueprint')?.clientWidth ?? 900;
    void flow.setViewport({ x: width / 2 - center, y: 210 - top, zoom: 1 }, { duration: 250 });
  }, [flow, boardRef]);
  const hasBoard = !!board;
  useEffect(() => {
    const timer = setTimeout(readingView, 100);
    readingTimer.current = timer;
    return () => clearTimeout(timer);
  }, [hasBoard, library.activeId, readingView]);
  async function arrangeDownward() {
    if (!board || busy || arranging) return;
    setArranging(true);
    try {
      const width = document.querySelector('.blueprint')?.clientWidth ?? 900;
      // Explicit arrangement is undoable; normal follow-ups still preserve hand-placed nodes.
      commit(await layoutBoard(board, board.agent, undefined, width));
      readingView();
    } catch {
      setError('Could not arrange this board. Your current layout is unchanged.');
    } finally {
      setArranging(false);
    }
  }

  const undo = useCallback(
    (redo = false) => {
      if (busy) return;
      travel(redo);
      setSelected(null);
      setSelectedEdge(null);
    },
    [busy, travel],
  );
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest('input,textarea,select,[contenteditable]')
      )
        return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        undo(event.shiftKey);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        undo(true);
      }
      if (event.key === 'Escape') {
        setSelected(null);
        setSelectedEdge(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo]);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      const menu = exportMenu.current;
      if (menu?.open && !menu.contains(event.target as globalThis.Node)) menu.open = false;
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  const exportAs = (content: string, filename: string, type: string) => {
    download(content, filename, type);
    if (exportMenu.current) exportMenu.current.open = false;
  };

  async function generate(event?: FormEvent, text = prompt) {
    event?.preventDefault();
    if (!text.trim() || busy) return;
    if (
      agent !== 'demo' &&
      !terminalExampleFor(text, boardRef.current, attachments.length > 0) &&
      (!BoardModelSettingsSchema.safeParse(modelPreferences[agent]).success ||
        modelPreferences[agent].model === 'default')
    ) {
      setError('Choose a valid, explicit model before generating.');
      setSettingsOpen(true);
      return;
    }
    if (
      await generation.generate(
        text,
        agent,
        modelPreferences,
        boardRef.current,
        selected,
        agent === 'demo' ? [] : attachments,
      )
    ) {
      setPrompt('');
      setAttachments([]);
    }
  }

  async function demo(graph: BoardGraph = EMAIL_DEMO) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (!(await library.open())) return;
      commit(
        await layoutBoard(
          graph,
          'demo',
          undefined,
          document.querySelector('.blueprint')?.clientWidth ?? 900,
        ),
      );
      setAgent('demo');
      setSelected(null);
      setSelectedEdge(null);
      // On phones the sidebar covers the canvas; get it out of the way of the example.
      if (window.innerWidth <= 760) setRailOpen(false);
    } catch {
      setError('Could not arrange the example. Please retry.');
    } finally {
      setBusy(false);
    }
  }

  const selectNode = (id: string) => {
    setSelected(id);
    setSelectedEdge(null);
    setShowIcons(false);
    const point = boardRef.current?.positions[id];
    if (point) {
      // Sidebar/walkthrough selections can be several screens below the current view.
      requestAnimationFrame(() => {
        void flow.setCenter(point.x + NODE_WIDTH / 2, point.y + NODE_HEIGHT / 2, {
          zoom: Math.max(0.8, flow.getZoom()),
          duration: 250,
        });
      });
    }
  };
  const followBeat = useCallback(
    (beats: Beat[], index: number) => {
      const beat = beats[index]!;
      // The opening overview shows the whole board; later steps reveal it progressively.
      setPlayback(
        beat.nodeId
          ? { ...revealed(beats, index), nodeId: beat.nodeId, edgeId: beat.edgeId }
          : null,
      );
      // An open concept panel follows the film, without opening one for every step.
      if (beat.nodeId) {
        setSelected((current) => (current ? beat.nodeId! : null));
        setShowIcons(false);
      }
      const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const point = beat.nodeId ? boardRef.current?.positions[beat.nodeId] : null;
      if (!point) {
        void flow.fitView({ padding: 0.22, duration: still ? 0 : 500, maxZoom: 1.1 });
        return;
      }
      // Keep the current step above the player bar that covers the bottom of the canvas.
      void flow.setCenter(point.x + NODE_WIDTH / 2, point.y + 130, {
        zoom: Math.max(0.85, flow.getZoom()),
        duration: still ? 0 : 650,
      });
    },
    [flow, boardRef],
  );
  const openBoard = async (id: string) => {
    if (id !== library.activeId && !(await library.open(id))) return false;
    setSelected(null);
    setSelectedEdge(null);
    setAgent(boardRef.current?.agent ?? agent);
    return true;
  };
  const closePlayer = useCallback(() => {
    setPlayerOpen(false);
    setPlayback(null);
  }, []);
  const activeNode = board?.nodes.find((node) => node.id === selected);
  const activeEdge = board?.edges.find((edge) => edge.id === selectedEdge);
  const status = agents.find((entry) => entry.id === agent);
  const localTerminalExample = !!terminalExampleFor(prompt, board, attachments.length > 0);
  const modelLabel =
    agent === 'demo'
      ? ''
      : (BOARD_MODEL_CHOICES[agent].find((choice) => choice.id === modelPreferences[agent].model)
          ?.label ??
        (modelPreferences[agent].model || 'Choose a model'));
  const nodes: DiagramNode[] = useMemo(
    () =>
      board?.nodes.map((node, index) => ({
        id: node.id,
        type: 'concept',
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
          kind: node.kind,
          number: index + 1,
          outgoing: board.edges.filter((edge) => edge.source === node.id).length,
          confidence: node.confidence,
          illustration: node.illustration,
          command: node.terminal?.command,
          stage:
            playback?.nodeId === node.id
              ? 'current'
              : playback?.nodes.has(node.id)
                ? 'revealed'
                : null,
        },
      })) ?? [],
    [board, selected, playback],
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
        labelStyle: { fill: '#e4edfa', fontSize: 10, fontFamily: 'monospace' },
        labelBgStyle: { fill: '#153b65', fillOpacity: 0.95 },
        labelBgPadding: [7, 5] as [number, number],
      })) ?? [],
    [board, selectedEdge, routes, playback],
  );
  const changePositions = (changes: NodeChange<DiagramNode>[]) => {
    if (busy) return;
    setBoard((current) => {
      if (!current) return current;
      const positions = { ...current.positions };
      let changed = false;
      for (const change of changes)
        if (change.type === 'position' && change.position) {
          positions[change.id] = change.position;
          changed = true;
        }
      return changed ? { ...current, positions } : current;
    });
  };
  const editNode = (patch: Partial<NonNullable<typeof activeNode>>) => {
    if (board && activeNode)
      commit({
        ...board,
        nodes: board.nodes.map((node) =>
          node.id !== activeNode.id
            ? node
            : 'label' in patch || 'summary' in patch
              ? withoutNarration({ ...node, ...patch })
              : 'icon' in patch && patch.icon !== node.icon
                ? // A new icon replaces the picture, so the drawing of the old one goes.
                  { ...node, ...patch, illustration: undefined }
                : { ...node, ...patch },
        ),
      });
  };

  if (path === '/boards')
    return (
      <BoardsPage
        library={library}
        onBack={() => navigate('/')}
        onOpen={async (id) => {
          if (await openBoard(id)) navigate('/');
        }}
      />
    );
  return (
    <div className={`workspace ${railOpen ? 'rail-open' : 'rail-closed'}`}>
      <WorkspaceSidebar
        board={board}
        busy={busy}
        library={library}
        commit={commit}
        selected={selected}
        selectNode={selectNode}
        demo={() => void demo()}
        dnsDemo={() => void demo(DNS_DEMO)}
        onNew={async () => {
          if (!(await library.open())) return;
          setSelected(null);
          setSelectedEdge(null);
          setPrompt('');
          setError('');
        }}
        onOpen={openBoard}
        onManage={() => navigate('/boards')}
      />

      <main className="workspace-main">
        <header className="workspace-header">
          <div className="header-breadcrumb">
            <button
              className="rail-toggle"
              aria-label={railOpen ? 'Hide sidebar' : 'Show sidebar'}
              aria-expanded={railOpen}
              onClick={() => setRailOpen(!railOpen)}
            >
              <PanelLeft size={18} />
            </button>
            <span className="crumb-root">Workspace</span>
            <ChevronRight size={14} aria-hidden />
            <h1>{board?.title ?? 'Untitled canvas'}</h1>
          </div>
          <div className="header-actions">
            <span className={`save-status ${saved.startsWith('Could') ? 'is-warning' : ''}`}>
              {saved && !saved.startsWith('Could') && <Check size={13} />}
              {saved}
            </span>
            <button
              className="header-button"
              title="Import a saved board"
              aria-label="Import board"
              disabled={busy}
              onClick={() => importInput.current?.click()}
            >
              <Upload size={15} />
              <span className="button-label">Import</span>
            </button>
            <details className="export-menu" ref={exportMenu}>
              <summary>
                <Download size={15} /> Export <ChevronDown className="chevron" size={14} />
              </summary>
              <div className="export-menu-panel">
                <button
                  disabled={!board}
                  onClick={() =>
                    board && exportAs(boardMarkdown(board), 'opsis-notes.md', 'text/markdown')
                  }
                >
                  Markdown notes
                </button>
                <button
                  disabled={!board}
                  onClick={() => {
                    if (board) void downloadPng(board).catch((e: Error) => setError(e.message));
                    if (exportMenu.current) exportMenu.current.open = false;
                  }}
                >
                  PNG image
                </button>
                <button
                  disabled={!board}
                  onClick={() =>
                    board &&
                    exportAs(JSON.stringify(board, null, 2), 'opsis-board.json', 'application/json')
                  }
                >
                  <FileJson size={16} />
                  <span>
                    <strong>Editable board</strong>
                    <small>.json · import it again later</small>
                  </span>
                </button>
                <button
                  disabled={!board}
                  onClick={() =>
                    board && exportAs(boardSvg(board), 'opsis-diagram.svg', 'image/svg+xml')
                  }
                >
                  <ImageIcon size={16} />
                  <span>
                    <strong>Diagram image</strong>
                    <small>.svg · for slides and documents</small>
                  </span>
                </button>
              </div>
            </details>
          </div>
        </header>
        <input
          ref={importInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            try {
              if (file.size > 1_000_000) throw new Error('This file is too large.');
              const next = await importBoard(JSON.parse(await file.text()));
              if (!(await library.open())) return;
              commit(next);
              setAgent(next.agent);
              setSelected(null);
              setSelectedEdge(null);
              setError('');
            } catch {
              setError(
                'This file could not be imported as a v2 board or legacy OSG. Your current canvas is unchanged.',
              );
            }
          }}
        />
        <div className="canvas-and-detail">
          <section
            className={`blueprint ${playerOpen ? 'is-playing' : ''}`}
            aria-label="Interactive diagram canvas"
          >
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              connectionMode={ConnectionMode.Loose}
              connectionRadius={28}
              reconnectRadius={24}
              edgesReconnectable={!busy}
              onReconnect={(edge, connection) => {
                if (board && !busy) commit(connectBoard(board, connection, edge.id));
              }}
              onNodesChange={changePositions}
              onNodeClick={(_, node) => selectNode(node.id)}
              onEdgeClick={(_, edge) => {
                setSelectedEdge(edge.id);
                setSelected(null);
              }}
              onPaneClick={() => {
                setSelected(null);
                setSelectedEdge(null);
              }}
              onNodeDragStart={() => {
                begin();
              }}
              onNodeDragStop={(_, node) => {
                const current = boardRef.current;
                if (current)
                  end({
                    ...current,
                    positions: { ...current.positions, [node.id]: node.position },
                  });
              }}
              onConnect={(connection) => {
                if (board && !busy) commit(connectBoard(board, connection, crypto.randomUUID()));
              }}
              nodesDraggable={!busy}
              nodesConnectable={!busy}
              deleteKeyCode={null}
              snapToGrid
              snapGrid={[24, 24]}
              minZoom={0.25}
              maxZoom={1.7}
              panOnScroll
              panOnScrollMode={PanOnScrollMode.Vertical}
              zoomOnScroll={false}
              zoomOnPinch
            >
              <Background
                id="fine"
                variant={BackgroundVariant.Lines}
                gap={24}
                color="rgba(189,215,246,.13)"
                lineWidth={0.6}
              />
              <Background
                id="major"
                variant={BackgroundVariant.Lines}
                gap={120}
                color="rgba(189,215,246,.18)"
                lineWidth={1}
              />
            </ReactFlow>
            {board && (
              <div className="canvas-heading">
                <span className="canvas-kicker">
                  <span />
                  THE BIG PICTURE
                </span>
                <h2>{board.title}</h2>
                <p>{board.description}</p>
                {/* In the heading's flow, so it always sits below the text rather than over it. */}
                {!playerOpen && board.nodes.length > 0 && (
                  <button
                    className="play-process"
                    disabled={busy}
                    onClick={() => {
                      setSelected(null);
                      setSelectedEdge(null);
                      setPlayerOpen(true);
                    }}
                  >
                    <Play size={13} fill="currentColor" /> Play the process
                  </button>
                )}
              </div>
            )}
            <div className="canvas-tools" role="toolbar" aria-label="Canvas tools">
              <button
                aria-label="Undo"
                title="Undo (Ctrl / ⌘ Z)"
                disabled={busy || !history.past.length}
                onClick={() => undo()}
              >
                <Undo2 size={16} />
              </button>
              <button
                aria-label="Redo"
                title="Redo"
                disabled={busy || !history.future.length}
                onClick={() => undo(true)}
              >
                <Redo2 size={16} />
              </button>
              <span />
              <button
                aria-label="Zoom out"
                title="Zoom out"
                onClick={() => void flow.zoomOut({ duration: 200 })}
              >
                <ZoomOut size={16} />
              </button>
              <button
                aria-label="Zoom in"
                title="Zoom in"
                onClick={() => void flow.zoomIn({ duration: 200 })}
              >
                <ZoomIn size={16} />
              </button>
              <button aria-label="Fit diagram" title="Fit diagram" onClick={fit}>
                <Expand size={16} />
              </button>
              <button
                aria-label="Read from top"
                title="Read from top at 100%"
                onClick={readingView}
              >
                <ArrowDownToLine size={16} />
              </button>
              <button
                aria-label="Arrange downward"
                title="Arrange downward (undoable)"
                disabled={busy || arranging || !board}
                onClick={() => void arrangeDownward()}
              >
                <ListTree size={16} />
              </button>
              <span />
              <button
                aria-label="Add a concept"
                title="Add a concept"
                disabled={busy || !board || board.nodes.length >= 50}
                onClick={() => {
                  if (!board) return;
                  const id = crypto.randomUUID();
                  const x = Math.min(...Object.values(board.positions).map((p) => p.x), 24);
                  const y = board.nodes.length
                    ? Math.max(
                        ...board.nodes.map(
                          (node) => (board.positions[node.id]?.y ?? 0) + nodeHeight(node),
                        ),
                      ) + ROW_GAP
                    : 24;
                  commit({
                    ...board,
                    nodes: [
                      ...board.nodes,
                      {
                        id,
                        label: 'New concept',
                        icon: 'lightbulb',
                        summary: 'Add a short description.',
                        explanation: 'Describe this concept and how it connects to the diagram.',
                        kind: 'step',
                      },
                    ],
                    positions: { ...board.positions, [id]: { x, y } },
                  });
                  selectNode(id);
                }}
              >
                <Plus size={17} />
              </button>
            </div>
            {(!board || board.nodes.length === 0) && (
              <section className="canvas-welcome" aria-label="Welcome to Opsis">
                <div className="welcome-identity">
                  <span className="welcome-mark">
                    <BrandMark size={64} />
                  </span>
                  <span className="welcome-wordmark">
                    opsis<span>.</span>
                  </span>
                </div>
                <h2>See what you mean.</h2>
                <p className="welcome-description">
                  Turn a question into a diagram you can explore.
                </p>
                <h3>Start with a question</h3>
                <ul aria-label="Suggested questions">
                  {[
                    'How does a vaccine train the immune system?',
                    'What happens when I tap my card to pay?',
                    'How does the water cycle work?',
                  ].map((question) => (
                    <li key={question}>
                      <button
                        disabled={busy}
                        onClick={() => {
                          setPrompt(question);
                          promptInput.current?.focus();
                        }}
                      >
                        <span>{question}</span>
                        <ArrowUpRight size={15} aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <span className="canvas-coordinate">
              OPSIS / VISUAL FIELD{' '}
              {board ? `— ${String(board.nodes.length).padStart(2, '0')} CONCEPTS` : '— 01'}
            </span>
            <div className="composer-wrap">
              {library.error && (
                <div className="workspace-error" role="alert">
                  <span>{library.error}</span>
                  <button onClick={() => void library.save().catch(() => undefined)}>
                    Retry save
                  </button>
                  {board && (
                    <button disabled={busy} onClick={() => void library.saveCopy()}>
                      Save as separate board
                    </button>
                  )}
                </div>
              )}
              {generation.review && (
                <GenerationReview
                  {...generation.review}
                  apply={() => {
                    generation.apply();
                    setSelected(null);
                    setSelectedEdge(null);
                  }}
                  discard={generation.discard}
                />
              )}
              {error && (
                <div className="workspace-error" role="alert">
                  <CircleAlert size={16} aria-hidden />
                  <span>{error}</span>
                  <button aria-label="Dismiss error" onClick={() => setError('')}>
                    <X size={15} />
                  </button>
                </div>
              )}
              {generation.busy && (
                <AgentActivity
                  activity={generation.activity}
                  elapsed={generation.elapsed}
                  agent={agent === 'claude' ? 'Claude' : agent === 'codex' ? 'Codex' : 'Demo'}
                />
              )}
              {board && playerOpen ? (
                <ProcessPlayer
                  key={library.activeId}
                  board={board}
                  disabled={busy}
                  onBeat={followBeat}
                  onClose={closePlayer}
                  illustration={{
                    busy: illustrator.busy,
                    elapsed: illustrator.elapsed,
                    activity: illustrator.activity,
                    message: illustrator.message,
                    available: agent === 'demo' || status?.available !== false,
                    redraw: board.nodes.every((node) => node.illustration),
                    onIllustrate: () => void illustrator.illustrate(agent, modelPreferences),
                  }}
                />
              ) : (
                <>
                  {board && !busy && (
                    <NextSteps
                      suggestions={[
                        ...(agent !== 'demo' ? [RETURN_PATHS] : []),
                        ...(board.suggestions ?? []).map((text) => ({ label: text, prompt: text })),
                      ]}
                      onPick={(suggestion) => {
                        setPrompt(suggestion.prompt);
                        promptInput.current?.focus();
                      }}
                    />
                  )}
                  <form
                    className={`composer ${busy ? 'is-busy' : ''}`}
                    onSubmit={(event) => void generate(event)}
                  >
                    {agent !== 'demo' && (
                      <AttachmentChips
                        attachments={attachments}
                        disabled={busy}
                        onChange={setAttachments}
                      />
                    )}
                    <div className="composer-input">
                      <label className="sr-only" htmlFor="visual-prompt">
                        What would you like to understand?
                      </label>
                      <textarea
                        ref={promptInput}
                        id="visual-prompt"
                        value={prompt}
                        maxLength={4000}
                        rows={2}
                        placeholder={
                          board
                            ? 'Ask a follow-up, or change something on the canvas…'
                            : 'What would you like to understand?'
                        }
                        disabled={busy}
                        onChange={(event) => setPrompt(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault();
                            void generate();
                          }
                        }}
                      />
                      {agent !== 'demo' && (
                        <AttachButton
                          attachments={attachments}
                          disabled={busy}
                          onChange={setAttachments}
                          onError={setError}
                        />
                      )}
                      {generation.busy ? (
                        <button
                          key="cancel-generation"
                          className="send-prompt"
                          type="button"
                          aria-label="Cancel generation"
                          onClick={(event) => {
                            event.preventDefault();
                            generation.cancel();
                          }}
                        >
                          <Square size={14} fill="currentColor" />
                        </button>
                      ) : (
                        <button
                          key="submit-generation"
                          className="send-prompt"
                          type="submit"
                          aria-label="Generate diagram"
                          disabled={
                            busy ||
                            !prompt.trim() ||
                            (!localTerminalExample &&
                              agent !== 'demo' &&
                              status?.available === false)
                          }
                        >
                          <ArrowUp size={19} />
                        </button>
                      )}
                    </div>
                    {agent !== 'demo' && settingsOpen && (
                      <div className="model-settings" id="model-settings">
                        <ModelControls
                          agent={agent}
                          value={modelPreferences[agent]}
                          disabled={busy}
                          onChange={(value) => {
                            const next = { ...modelPreferences, [agent]: value };
                            setModelPreferences(next);
                            try {
                              localStorage.setItem(MODEL_SETTINGS_KEY, JSON.stringify(next));
                            } catch {
                              setError(
                                'Model settings apply to this session, but could not be saved on this device.',
                              );
                            }
                          }}
                        />
                      </div>
                    )}
                    <div className="composer-footer">
                      <label className="agent-picker">
                        <AgentLogo agent={agent} />
                        <span className="sr-only">Agent</span>
                        <select
                          aria-label="Agent"
                          value={agent}
                          disabled={busy}
                          onChange={(event) => setAgent(event.target.value as BoardAgent)}
                        >
                          <option value="claude">Claude</option>
                          <option value="codex">Codex</option>
                          <option value="demo">Demo · built-in examples</option>
                        </select>
                      </label>
                      {agent !== 'demo' && (
                        <button
                          type="button"
                          className="model-toggle"
                          aria-expanded={settingsOpen}
                          aria-controls="model-settings"
                          aria-label={`Model settings: ${modelLabel}`}
                          onClick={() => setSettingsOpen(!settingsOpen)}
                        >
                          <SlidersHorizontal size={13} />
                          <span className="model-toggle-label">Model: {modelLabel}</span>
                          <ChevronDown className="chevron" size={13} />
                        </button>
                      )}
                      <span className="agent-status" role="status">
                        {generation.busy ? (
                          <>
                            <LoaderCircle className="spin" size={13} /> Working
                          </>
                        ) : agent === 'demo' ? (
                          'Sample content · no agent calls'
                        ) : localTerminalExample ? (
                          'Local terminal example · no agent call'
                        ) : (
                          connectionError || status?.detail || 'Checking local agent…'
                        )}
                      </span>
                      {selected && (
                        <button
                          type="button"
                          className="selection-pill"
                          aria-label="Clear selected step"
                          onClick={() => setSelected(null)}
                        >
                          1 step selected <X size={12} />
                        </button>
                      )}
                    </div>
                  </form>
                  {!busy && (
                    <p className="composer-hint">
                      <kbd>Enter</kbd> to send · <kbd>Shift</kbd> + <kbd>Enter</kbd> for a new line
                    </p>
                  )}
                </>
              )}
            </div>
          </section>
          {activeNode && board && (
            <aside
              key={activeNode.id}
              className="detail-panel"
              aria-label={`Details for ${activeNode.label}`}
            >
              <div className="detail-top">
                <span className="eyebrow">
                  <SlidersHorizontal size={13} /> Concept details
                </span>
                <button aria-label="Close details" onClick={() => setSelected(null)}>
                  <X size={17} />
                </button>
              </div>
              <div className="detail-body">
                {activeNode.confidence && activeNode.confidence !== 'normal' && (
                  <p className="node-caveat">
                    <strong>{activeNode.confidence}</strong>:{' '}
                    {activeNode.caveat || 'This concept needs independent verification.'}
                  </p>
                )}
                <div className="detail-hero">
                  <div className="detail-icon">
                    {(() => {
                      const Icon = boardIcons[activeNode.icon];
                      return <Icon size={28} strokeWidth={1.6} />;
                    })()}
                  </div>
                  <div>
                    <span
                      className={`kind-tag ${activeNode.kind === 'decision' ? 'is-decision' : ''}`}
                    >
                      {activeNode.kind === 'decision' ? 'Decision' : 'Concept'}
                      <span>{String(board.nodes.indexOf(activeNode) + 1).padStart(2, '0')}</span>
                    </span>
                    <h2>{activeNode.label}</h2>
                  </div>
                </div>
                {activeNode.terminal ? (
                  <TerminalDetails step={activeNode.terminal} />
                ) : (
                  <>
                    <p className="detail-summary">{activeNode.summary}</p>
                    <section className="detail-section">
                      <h3>How it works</h3>
                      <p className="detail-explanation">{activeNode.explanation}</p>
                    </section>
                  </>
                )}
                <section className="detail-section" aria-label="Connected concepts">
                  {(() => {
                    const links = board.edges.filter(
                      (edge) => edge.source === activeNode.id || edge.target === activeNode.id,
                    );
                    return (
                      <>
                        <h3>
                          Connections{' '}
                          <span>
                            {links.length} {links.length === 1 ? 'path' : 'paths'}
                          </span>
                        </h3>
                        <div className="connection-list">
                          {links.map((edge) => {
                            const outgoing = edge.source === activeNode.id;
                            const neighbor = board.nodes.find(
                              (node) => node.id === (outgoing ? edge.target : edge.source),
                            );
                            if (!neighbor) return null;
                            return (
                              <button key={edge.id} onClick={() => selectNode(neighbor.id)}>
                                <ArrowRight
                                  size={15}
                                  className={outgoing ? '' : 'incoming-arrow'}
                                />
                                <span>
                                  {neighbor.label}
                                  <small>
                                    {outgoing ? 'Leads to' : 'Comes from'}
                                    {edge.label ? ` · ${edge.label}` : ''}
                                  </small>
                                </span>
                                <ChevronRight size={14} />
                              </button>
                            );
                          })}
                        </div>
                        {!links.length && (
                          <p className="detail-note">
                            Drag a dot on this icon to another concept to connect them.
                          </p>
                        )}
                      </>
                    );
                  })()}
                </section>
                <button
                  className="expand-concept"
                  disabled={busy}
                  onClick={() => {
                    setPrompt(
                      `Expand “${activeNode.label}” into its substeps while keeping the rest of the diagram`,
                    );
                    promptInput.current?.focus();
                  }}
                >
                  <GitBranch size={15} /> Explore this step <ArrowRight size={15} />
                </button>
                <details className="edit-concept">
                  <summary>
                    <Pencil size={14} /> Edit this concept <ChevronRight size={14} />
                  </summary>
                  <fieldset disabled={busy}>
                    <label>
                      Label
                      <input
                        key={`${activeNode.id}-label-${activeNode.label}`}
                        defaultValue={activeNode.label}
                        maxLength={80}
                        onBlur={(event) => {
                          const label = event.target.value.trim();
                          if (label && label !== activeNode.label) editNode({ label });
                        }}
                      />
                    </label>
                    <label>
                      Summary
                      <textarea
                        key={`${activeNode.id}-summary-${activeNode.summary}`}
                        defaultValue={activeNode.summary}
                        maxLength={400}
                        onBlur={(event) => {
                          const summary = event.target.value.trim();
                          if (summary && summary !== activeNode.summary) editNode({ summary });
                        }}
                      />
                    </label>
                    <label>
                      Explanation
                      <textarea
                        key={`${activeNode.id}-explanation-${activeNode.explanation}`}
                        defaultValue={activeNode.explanation}
                        maxLength={3000}
                        onBlur={(event) => {
                          const explanation = event.target.value.trim();
                          if (explanation && explanation !== activeNode.explanation)
                            editNode({ explanation });
                        }}
                      />
                    </label>
                    <div className="fieldset-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        aria-expanded={showIcons}
                        onClick={() => setShowIcons(!showIcons)}
                      >
                        <Search size={14} /> Change icon
                      </button>
                      <button
                        type="button"
                        className="delete-concept"
                        disabled={busy}
                        onClick={() => {
                          commit(removeNode(board, activeNode.id));
                          setSelected(null);
                        }}
                      >
                        <Trash2 size={14} /> Delete
                      </button>
                    </div>
                    {showIcons && (
                      <IconPicker
                        value={activeNode.icon}
                        onPick={(icon) => {
                          editNode({ icon });
                          setShowIcons(false);
                        }}
                      />
                    )}
                  </fieldset>
                </details>
                {!activeNode.terminal && (
                  <p className="detail-note">
                    {board.agent === 'demo'
                      ? 'Curated example.'
                      : `Generated with ${board.agent === 'claude' ? 'Claude' : 'Codex'}.`}{' '}
                    A simplified explanation — ask your agent to check anything uncertain.
                  </p>
                )}
              </div>
            </aside>
          )}
          {activeEdge && board && (
            <aside className="detail-panel" aria-label="Connection details">
              <div className="detail-top">
                <span className="eyebrow">
                  <ArrowRight size={13} /> Connection
                </span>
                <button aria-label="Close details" onClick={() => setSelectedEdge(null)}>
                  <X size={17} />
                </button>
              </div>
              <div className="detail-body">
                <h2>{activeEdge.label || 'Connection'}</h2>
                <p className="detail-summary">
                  {board.nodes.find((node) => node.id === activeEdge.source)?.label ?? 'Start'} →{' '}
                  {board.nodes.find((node) => node.id === activeEdge.target)?.label ?? 'End'}
                </p>
                <section className="detail-section">
                  <label>
                    Connection type
                    <select
                      value={activeEdge.kind ?? 'flow'}
                      disabled={busy}
                      onChange={(event) => {
                        const kind = BoardEdgeKindSchema.parse(event.target.value);
                        commit({
                          ...board,
                          edges: board.edges.map((edge) =>
                            edge.id === activeEdge.id ? withoutNarration({ ...edge, kind }) : edge,
                          ),
                        });
                      }}
                    >
                      {BoardEdgeKindSchema.options.map((kind) => (
                        <option key={kind} value={kind}>
                          {kind}
                        </option>
                      ))}
                    </select>
                  </label>
                  <fieldset className="color-picker" disabled={busy}>
                    <legend>Arrow colour</legend>
                    {([undefined, ...EDGE_COLORS] as const).map((color) => (
                      <button
                        type="button"
                        key={color ?? 'auto'}
                        className={color ? '' : 'is-auto'}
                        aria-pressed={activeEdge.color === color}
                        aria-label={color ? `${color} arrow` : 'Automatic colour (by type)'}
                        title={color ?? 'By type'}
                        style={{
                          ['--swatch' as string]: color
                            ? EDGE_COLOR_VALUES[color]
                            : connectionStyle({ ...activeEdge, color: undefined }).color,
                        }}
                        onClick={() =>
                          commit({
                            ...board,
                            edges: board.edges.map((edge) => {
                              if (edge.id !== activeEdge.id) return edge;
                              const next: typeof edge = { ...edge };
                              if (color) next.color = color;
                              else delete next.color;
                              return next;
                            }),
                          })
                        }
                      >
                        {!color && 'Auto'}
                      </button>
                    ))}
                  </fieldset>
                  <label>
                    Relationship
                    <input
                      key={activeEdge.id}
                      defaultValue={activeEdge.label}
                      disabled={busy}
                      maxLength={100}
                      placeholder="e.g. sends, becomes, causes"
                      onBlur={(event) => {
                        if (event.target.value !== activeEdge.label)
                          commit({
                            ...board,
                            edges: board.edges.map((edge) =>
                              edge.id === activeEdge.id
                                ? withoutNarration({ ...edge, label: event.target.value })
                                : edge,
                            ),
                          });
                      }}
                    />
                  </label>
                </section>
                <button
                  className="delete-concept"
                  disabled={busy}
                  onClick={() => {
                    commit({
                      ...board,
                      edges: board.edges.filter((edge) => edge.id !== activeEdge.id),
                    });
                    setSelectedEdge(null);
                  }}
                >
                  <Trash2 size={14} /> Remove connection
                </button>
              </div>
            </aside>
          )}
        </div>
      </main>
    </div>
  );
}

export function Workspace() {
  return (
    <ReactFlowProvider>
      <BoardWorkspace />
    </ReactFlowProvider>
  );
}
