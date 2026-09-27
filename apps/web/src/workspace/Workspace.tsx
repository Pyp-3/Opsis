import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Node,
  type NodeProps,
  type NodeChange,
} from '@xyflow/react';
import {
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Download,
  Expand,
  FileJson,
  GitBranch,
  Grid2X2,
  ImageIcon,
  LoaderCircle,
  Mail,
  PanelLeft,
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
} from 'lucide-react';
import {
  BOARD_ICONS,
  BOARD_MODEL_CHOICES,
  BoardAgentsSchema,
  BoardDocumentSchema,
  BoardGraphSchema,
  BoardModelSettingsSchema,
  EMAIL_DEMO,
  type BoardAgent,
  type BoardDocument,
} from '@opsis/schema';
import { boardIcons } from './icons';
import {
  layoutBoard,
  NODE_HEIGHT,
  NODE_WIDTH,
  removeNode,
  restoreBoard,
  STORAGE_KEY,
} from './model';
import { boardSvg, download } from './export';
import { ModelControls } from './ModelControls';
import { connectBoard, edgePorts } from './connections';
import { MODEL_SETTINGS_KEY, readModelPreferences } from './model-settings';
import '@xyflow/react/dist/style.css';
import './workspace.css';

type DiagramNode = Node<{
  label: string;
  icon: keyof typeof boardIcons;
  kind: string;
  number: number;
  outgoing: number;
}>;

function IconNode({ data, selected }: NodeProps<DiagramNode>) {
  const Icon = boardIcons[data.icon] ?? boardIcons.box;
  return (
    <div
      className={`blueprint-node ${selected ? 'is-selected' : ''} ${data.kind === 'decision' ? 'is-decision' : ''}`}
    >
      <div className="node-symbol">
        <Icon size={48} strokeWidth={1.35} />
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
          />
        ))}
        {data.outgoing > 1 && (
          <span className="branch-count" title={`${data.outgoing} outgoing connections`}>
            <GitBranch size={10} />
            {data.outgoing}
          </span>
        )}
      </div>
      <strong>{data.label}</strong>
      <span className="node-hint">
        {selected ? 'Drag a dot to connect' : 'Explore'} <ChevronRight size={11} />
      </span>
    </div>
  );
}
const nodeTypes = { concept: IconNode };

function initialState() {
  try {
    return { board: restoreBoard(), error: '' };
  } catch {
    return {
      board: null,
      error: 'Your saved board could not be opened. Import a backup or start a new board.',
    };
  }
}

function BoardWorkspace() {
  const [initial] = useState(initialState);
  const [board, setBoard] = useState<BoardDocument | null>(initial.board);
  const boardRef = useRef(board);
  useEffect(() => {
    boardRef.current = board;
  }, [board]);
  const [agent, setAgent] = useState<BoardAgent>(initial.board?.agent ?? 'claude');
  const [modelPreferences, setModelPreferences] = useState(readModelPreferences);
  const [agents, setAgents] = useState<ReturnType<typeof BoardAgentsSchema.parse>>([]);
  const [connectionError, setConnectionError] = useState('');
  const [prompt, setPrompt] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [error, setError] = useState(initial.error);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState('');
  const [history, setHistory] = useState<{
    past: (BoardDocument | null)[];
    future: (BoardDocument | null)[];
  }>({ past: [], future: [] });
  const [iconSearch, setIconSearch] = useState('');
  const [showIcons, setShowIcons] = useState(false);
  const [railOpen, setRailOpen] = useState(() => window.innerWidth > 760);
  const [nodeSearch, setNodeSearch] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const exportMenu = useRef<HTMLDetailsElement>(null);
  const request = useRef<AbortController | null>(null);
  const dragStart = useRef<BoardDocument | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const promptInput = useRef<HTMLTextAreaElement>(null);
  const flow = useReactFlow();
  const inspectorOpen = selected !== null || selectedEdge !== null;

  const commit = useCallback((next: BoardDocument | null, before = boardRef.current) => {
    setHistory((state) => ({ past: [...state.past.slice(-39), before], future: [] }));
    boardRef.current = next;
    setBoard(next);
  }, []);

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
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        if (board) localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
        else if (!initial.error) localStorage.removeItem(STORAGE_KEY);
        setSaved(board ? 'Saved on this device' : '');
      } catch {
        setSaved('Could not save · export a backup');
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [board, initial.error]);

  const fit = useCallback(() => {
    void flow.fitView({ padding: 0.22, duration: 300, maxZoom: 1.1 });
  }, [flow]);
  useEffect(() => {
    const timer = setTimeout(fit, 100);
    return () => clearTimeout(timer);
  }, [board?.nodes.length, fit, inspectorOpen, railOpen]);

  const undo = useCallback(
    (redo = false) => {
      if (busy) return;
      const stack = redo ? history.future : history.past;
      if (!stack.length) return;
      const next = stack[stack.length - 1] ?? null;
      setHistory(
        redo
          ? { past: [...history.past, board], future: history.future.slice(0, -1) }
          : { past: history.past.slice(0, -1), future: [...history.future, board] },
      );
      boardRef.current = next;
      setBoard(next);
      setSelected(null);
      setSelectedEdge(null);
    },
    [board, busy, history],
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
      (!BoardModelSettingsSchema.safeParse(modelPreferences[agent]).success ||
        modelPreferences[agent].model === 'default')
    ) {
      setError('Choose a valid, explicit model before generating.');
      setSettingsOpen(true);
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    const previous = boardRef.current;
    try {
      const response = await fetch('/v1/boards/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          prompt: text,
          agent,
          ...(agent !== 'demo' ? { settings: modelPreferences[agent] } : {}),
          ...(previous ? { board: previous } : {}),
          ...(selected ? { selectedId: selected } : {}),
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok)
        throw new Error(
          typeof (payload as { message?: unknown })?.message === 'string'
            ? (payload as { message: string }).message
            : 'The agent could not complete this request.',
        );
      const graph = BoardGraphSchema.parse(payload);
      const next = await layoutBoard(graph, agent, previous ?? undefined);
      if (controller.signal.aborted) return;
      commit(next);
      setPrompt('');
      if (selected && !next.nodes.some((node) => node.id === selected)) setSelected(null);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Could not connect to the agent.');
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }

  async function demo() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      commit(await layoutBoard(EMAIL_DEMO, 'demo'));
      setAgent('demo');
      setSelected(null);
      setSelectedEdge(null);
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
    setIconSearch('');
  };
  const activeNode = board?.nodes.find((node) => node.id === selected);
  const activeEdge = board?.edges.find((edge) => edge.id === selectedEdge);
  const status = agents.find((entry) => entry.id === agent);
  const modelLabel =
    agent === 'demo'
      ? ''
      : (BOARD_MODEL_CHOICES[agent].find((choice) => choice.id === modelPreferences[agent].model)
          ?.label ??
        (modelPreferences[agent].model || 'Choose a model'));
  const visibleNodes =
    board?.nodes.filter((node) => node.label.toLowerCase().includes(nodeSearch.toLowerCase())) ??
    [];
  const nodes: DiagramNode[] = useMemo(
    () =>
      board?.nodes.map((node, index) => ({
        id: node.id,
        type: 'concept',
        position: board.positions[node.id] ?? { x: 0, y: index * 200 },
        selected: selected === node.id,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        ariaLabel: `${node.label}. ${node.summary}`,
        data: {
          label: node.label,
          icon: node.icon,
          kind: node.kind,
          number: index + 1,
          outgoing: board.edges.filter((edge) => edge.source === node.id).length,
        },
      })) ?? [],
    [board, selected],
  );
  const edges = useMemo(
    () =>
      board?.edges.map((edge) => ({
        ...edge,
        type: 'default',
        sourceHandle: edgePorts(board, edge).source,
        targetHandle: edgePorts(board, edge).target,
        interactionWidth: 24,
        selected: selectedEdge === edge.id,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#b9d1ef', width: 18, height: 18 },
        style: { stroke: selectedEdge === edge.id ? '#f0cf95' : '#b9d1ef', strokeWidth: 1.5 },
        labelStyle: { fill: '#e4edfa', fontSize: 10, fontFamily: 'monospace' },
        labelBgStyle: { fill: '#153b65', fillOpacity: 0.95 },
        labelBgPadding: [7, 5] as [number, number],
      })) ?? [],
    [board, selectedEdge],
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
          node.id === activeNode.id ? { ...node, ...patch } : node,
        ),
      });
  };

  return (
    <div className={`workspace ${railOpen ? 'rail-open' : 'rail-closed'}`}>
      <aside className="workspace-rail" aria-label="Workspace">
        <div className="rail-head">
          <a href="/" className="brand" aria-label="Opsis home">
            <span className="brand-symbol">
              <Grid2X2 size={17} />
            </span>
            <span>
              opsis<span className="brand-dot">.</span>
            </span>
          </a>
        </div>
        <button
          className="new-board"
          disabled={busy || !board}
          onClick={() => {
            commit(null);
            setSelected(null);
            setSelectedEdge(null);
            setPrompt('');
            setError('');
          }}
        >
          <Plus size={16} /> New canvas
        </button>
        <div className="rail-scroll">
          <section className="rail-section">
            <h2 className="rail-section-title">Canvas</h2>
            <div className="current-board">
              <span className="current-board-icon">
                <Grid2X2 size={15} />
              </span>
              <span className="current-board-text">
                <strong>{board?.title ?? 'Untitled canvas'}</strong>
                <small>
                  {board
                    ? `${board.nodes.length} concepts · ${board.edges.length} connections`
                    : 'Nothing drawn yet'}
                </small>
              </span>
            </div>
          </section>
          {board ? (
            <section className="rail-section rail-concepts">
              <h2 className="rail-section-title">
                Concepts <span>{board.nodes.length}</span>
              </h2>
              <label className="concept-search">
                <Search size={14} />
                <input
                  aria-label="Find a concept"
                  placeholder="Find a concept…"
                  value={nodeSearch}
                  onChange={(event) => setNodeSearch(event.target.value)}
                />
              </label>
              <nav className="node-list" aria-label="Diagram steps">
                {visibleNodes.map((node) => {
                  const Icon = boardIcons[node.icon];
                  return (
                    <button
                      key={node.id}
                      className={selected === node.id ? 'active' : ''}
                      aria-current={selected === node.id ? 'true' : undefined}
                      onClick={() => selectNode(node.id)}
                    >
                      <span className="list-number">
                        {String(board.nodes.indexOf(node) + 1).padStart(2, '0')}
                      </span>
                      <Icon size={15} />
                      <span className="list-label">{node.label}</span>
                      {board.edges.filter((edge) => edge.source === node.id).length > 1 && (
                        <GitBranch className="list-branch" size={13} aria-label="Branches" />
                      )}
                    </button>
                  );
                })}
                {!visibleNodes.length && (
                  <p className="rail-empty">No concepts match “{nodeSearch}”.</p>
                )}
              </nav>
            </section>
          ) : (
            <div className="rail-intro">
              <span className="eyebrow">Made for curious minds</span>
              <h2>Follow the idea. See the connections.</h2>
              <p>Turn a question into something you can explore, one step at a time.</p>
            </div>
          )}
        </div>
        <div className="rail-bottom">
          <button className="sample-card" disabled={busy} onClick={() => void demo()}>
            <span className="sample-icon">
              <Mail size={16} />
            </span>
            <span>
              <strong>An email’s journey</strong>
              <small>Open the example canvas</small>
            </span>
            <ArrowRight size={15} />
          </button>
          <div className="connection-guide">
            <GitBranch size={15} />
            <p>
              <strong>Ideas can branch.</strong> Drag from any connection dot to another icon.
            </p>
          </div>
          <p className="rail-footnote">
            <span className="active-dot" /> Private workspace · saved locally
          </p>
        </div>
      </aside>

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
              const next = BoardDocumentSchema.parse(JSON.parse(await file.text()));
              commit(next);
              setAgent(next.agent);
              setSelected(null);
              setSelectedEdge(null);
              setError('');
            } catch {
              setError(
                'This file is not a valid Opsis v2 board. Your current canvas is unchanged.',
              );
            }
          }}
        />
        <div className="canvas-and-detail">
          <section className="blueprint" aria-label="Interactive diagram canvas">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
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
                dragStart.current = boardRef.current;
              }}
              onNodeDragStop={(_, node) => {
                const current = boardRef.current;
                if (current)
                  commit(
                    { ...current, positions: { ...current.positions, [node.id]: node.position } },
                    dragStart.current,
                  );
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
              fitView
              fitViewOptions={{ padding: 0.22, maxZoom: 1.1 }}
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
            <div className="canvas-heading">
              <span className="canvas-kicker">
                <span />
                {board ? 'THE BIG PICTURE' : 'ROOM TO THINK'}
              </span>
              <h2>{board?.title ?? 'Every idea has a shape.'}</h2>
              <p>{board?.description ?? 'Let’s find yours.'}</p>
            </div>
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
              <span />
              <button
                aria-label="Add a concept"
                title="Add a concept"
                disabled={busy || !board || board.nodes.length >= 50}
                onClick={() => {
                  if (!board) return;
                  const id = crypto.randomUUID();
                  const x = Math.max(...Object.values(board.positions).map((p) => p.x), 0) + 288;
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
                    positions: { ...board.positions, [id]: { x, y: 0 } },
                  });
                  selectNode(id);
                }}
              >
                <Plus size={17} />
              </button>
            </div>
            {!board && (
              <div className="canvas-welcome">
                <div className="welcome-symbols">
                  <span>
                    <Mail size={28} />
                  </span>
                  <i />
                  <span>
                    <boardIcons.server size={28} />
                  </span>
                  <i />
                  <span>
                    <boardIcons.inbox size={28} />
                  </span>
                </div>
                <h3>Understand it by seeing it.</h3>
                <p>
                  Ask a question. Your agent connects the dots.
                  <br />
                  Click any concept to look a little closer.
                </p>
                <button onClick={() => void demo()} disabled={busy}>
                  Explore the email example <ArrowRight size={15} />
                </button>
                <small>INTERACTIVE DEMO · NO AGENT REQUIRED</small>
              </div>
            )}
            <span className="canvas-coordinate">
              OPSIS / VISUAL FIELD{' '}
              {board ? `— ${String(board.nodes.length).padStart(2, '0')} CONCEPTS` : '— 01'}
            </span>
            <div className="composer-wrap">
              {error && (
                <div className="workspace-error" role="alert">
                  <CircleAlert size={16} aria-hidden />
                  <span>{error}</span>
                  <button aria-label="Dismiss error" onClick={() => setError('')}>
                    <X size={15} />
                  </button>
                </div>
              )}
              {board && !busy && (
                <div className="followup-chips">
                  <button
                    onClick={() => {
                      setPrompt('Show what happens if delivery fails');
                      promptInput.current?.focus();
                    }}
                  >
                    <GitBranch size={12} /> Add a failure path
                  </button>
                  <button
                    onClick={() => {
                      setPrompt(
                        selected
                          ? 'Explain this selected step in more detail and add its substeps'
                          : 'Simplify this diagram',
                      );
                      promptInput.current?.focus();
                    }}
                  >
                    {selected ? 'Expand this step' : 'Make it simpler'} <Plus size={12} />
                  </button>
                </div>
              )}
              <form
                className={`composer ${busy ? 'is-busy' : ''}`}
                onSubmit={(event) => void generate(event)}
              >
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
                  {busy ? (
                    <button
                      className="send-prompt"
                      type="button"
                      aria-label="Cancel generation"
                      onClick={() => {
                        request.current?.abort();
                        request.current = null;
                        setBusy(false);
                      }}
                    >
                      <Square size={14} fill="currentColor" />
                    </button>
                  ) : (
                    <button
                      className="send-prompt"
                      type="submit"
                      aria-label="Generate diagram"
                      disabled={!prompt.trim() || (agent !== 'demo' && status?.available === false)}
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
                    <span
                      className={`agent-indicator ${status?.available === false ? 'offline' : ''}`}
                    />
                    <span className="sr-only">Agent</span>
                    <select
                      aria-label="Agent"
                      value={agent}
                      disabled={busy}
                      onChange={(event) => setAgent(event.target.value as BoardAgent)}
                    >
                      <option value="claude">Claude</option>
                      <option value="codex">Codex</option>
                      <option value="demo">Demo · email example</option>
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
                      {modelLabel}
                      <ChevronDown className="chevron" size={13} />
                    </button>
                  )}
                  <span className="agent-status" role="status">
                    {busy ? (
                      <>
                        <LoaderCircle className="spin" size={13} /> Building your visual
                        explanation…
                      </>
                    ) : agent === 'demo' ? (
                      'Sample content · no agent calls'
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
              <p className="composer-hint">
                {busy ? (
                  'You can cancel at any time. Your current canvas stays here.'
                ) : (
                  <>
                    <kbd>Enter</kbd> to draw · <kbd>Shift</kbd> + <kbd>Enter</kbd> for a new line ·
                    Drag to arrange
                  </>
                )}
              </p>
            </div>
          </section>
          {activeNode && board && (
            <aside className="detail-panel" aria-label={`Details for ${activeNode.label}`}>
              <div className="detail-top">
                <span className="eyebrow">
                  <SlidersHorizontal size={13} /> Concept details
                </span>
                <button aria-label="Close details" onClick={() => setSelected(null)}>
                  <X size={17} />
                </button>
              </div>
              <div className="detail-body">
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
                <p className="detail-summary">{activeNode.summary}</p>
                <section className="detail-section">
                  <h3>How it works</h3>
                  <p className="detail-explanation">{activeNode.explanation}</p>
                </section>
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
                        disabled={board.nodes.length <= 1}
                        onClick={() => {
                          commit(removeNode(board, activeNode.id));
                          setSelected(null);
                        }}
                      >
                        <Trash2 size={14} /> Delete
                      </button>
                    </div>
                    {showIcons && (
                      <div className="icon-picker">
                        <input
                          aria-label="Search icons"
                          placeholder="Search icons…"
                          value={iconSearch}
                          onChange={(event) => setIconSearch(event.target.value)}
                        />
                        <div>
                          {BOARD_ICONS.filter((name) =>
                            name.includes(iconSearch.toLowerCase()),
                          ).map((name) => {
                            const Icon = boardIcons[name];
                            return (
                              <button
                                type="button"
                                key={name}
                                aria-label={`Use ${name} icon`}
                                aria-pressed={activeNode.icon === name}
                                title={name}
                                onClick={() => {
                                  editNode({ icon: name });
                                  setShowIcons(false);
                                }}
                              >
                                <Icon size={18} />
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </fieldset>
                </details>
                <p className="detail-note">
                  {board.agent === 'demo'
                    ? 'Curated example.'
                    : `Generated with ${board.agent === 'claude' ? 'Claude' : 'Codex'}.`}{' '}
                  A simplified explanation — ask your agent to check anything uncertain.
                </p>
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
                                ? { ...edge, label: event.target.value }
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
