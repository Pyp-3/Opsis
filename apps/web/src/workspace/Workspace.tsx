import { LegacyBatchReview } from './LegacyBatchReview';
import { PROVIDER_LABELS } from '@opsis/schema';
import { BoardSharing } from './BoardSharing';
import { BoardGroups, GroupBoundaries, GroupsSummary } from './BoardGroups';
import { useRememberedOpen } from './useRememberedOpen';
import { readingViewport, NODE_HEIGHT } from './geometry';
import { BoardHeader } from './BoardHeader';
import { BoardLinks } from './BoardLinks';
import { useBoardDiagram, type PlaybackFocus } from './useBoardDiagram';
import { BoardChat } from './BoardChat';
import { useBoardChat } from './useBoardChat';
import { BoardComposer } from './BoardComposer';
import { IconNode, type DiagramNode } from './IconNode';
import { ConceptDetails } from './ConceptDetails';
import { ConnectionDetails } from './ConnectionDetails';
import { DrawingControls, DrawingLayer, useCanvasDrawing } from './CanvasDrawing';
import {
  lazy,
  Suspense,
  useMemo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  PanOnScrollMode,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeChange,
} from '@xyflow/react';
import {
  ArrowUpRight,
  ChevronUp,
  ChevronsRight,
  MessageSquarePlus,
  Copy,
  Eye,
  CircleAlert,
  Expand,
  Palette,
  PanelLeft,
  Play,
  Plus,
  Redo2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
  ListTree,
  ArrowDownToLine,
  Wrench,
} from 'lucide-react';
import {
  LegacyBundleSchema,
  boardFromText,
  type BoardDocument,
  BOARD_MODEL_CHOICES,
  BoardAgentsSchema,
  BoardModelSettingsSchema,
  patchBoardNode,
  EMAIL_DEMO,
  type BoardGraph,
  type BoardAgent,
  type BoardAttachment,
  terminalExampleFor,
} from '@opsis/schema';
import { useProcessEngine } from './useProcessEngine';
import { useIllustrator } from './useIllustrator';
import { AgentActivity } from './AgentActivityView';
import { layoutBoard, NODE_WIDTH, removeNode } from './model';
import { connectBoard } from './connections';
import { readModelPreferences } from './model-settings';
import { useBoardHistory } from './useBoardHistory';
import { restoreLibrary, useBoardLibrary } from './useBoardLibrary';
import { useBoardGeneration } from './useBoardGeneration';
import { GenerationReview } from './GenerationReview';
import { importBoard } from './migration';
const ProcessPlayer = lazy(() =>
  import('./ProcessPlayer').then((module) => ({ default: module.ProcessPlayer })),
);
import { applyLook, lookOf } from './canvas-theme';
import { NextSteps, RETURN_PATHS } from './NextSteps';
import { BrandMark } from './BrandMark';
import { BoardsPage } from './BoardsPage';
import { SearchPage } from './SearchPage';
import { HomePage } from './HomePage';
const AccountPage = lazy(() =>
  import('./AccountPage').then((module) => ({ default: module.AccountPage })),
);
import type { User } from '../auth/session';
import { CanvasSettingsPage } from './CanvasSettingsPage';
const SettingsPage = lazy(() =>
  import('./SettingsPage').then((module) => ({ default: module.SettingsPage })),
);
import { navigate, usePath } from '../router';
import { revealed, type Beat } from './playback';
import { AppSidebar, applySavedRailWidth, CLOSE_RAIL, type SidebarMode } from './AppSidebar';
import { RoutedConnection } from './RoutedConnection';
import { ROW_GAP, nodeHeight } from './geometry';
import '@xyflow/react/dist/style.css';
import './workspace.css';

import { useProviderUsage, type ProviderAgent } from './provider-usage';

const EXPLAIN_KEY = 'opsis:explain';
const nodeTypes = { concept: IconNode };
const edgeTypes = { routed: RoutedConnection };

type WorkspaceProps = {
  user?: User;
  onSignOut?: () => void;
  /** Why this account's settings could not load; defaults apply meanwhile. */
  settingsError?: string;
};

function BoardWorkspace({ user, onSignOut, settingsError }: WorkspaceProps) {
  const [initial] = useState(restoreLibrary);
  const { board, boardRef, setBoard, commit, history, snapshot, replace, travel, begin, end } =
    useBoardHistory(initial.snapshot);
  // Usage is recorded against the board open when a generation starts.
  const usageBoardRef = useRef<string | undefined>(undefined);
  const generation = useBoardGeneration(commit, usageBoardRef);
  const provider = useProviderUsage();
  const process = useProcessEngine(board);
  const [arranging, setArranging] = useState(false);
  const [chatSending, setChatSending] = useState(false);
  const [playerOpen, setPlayerOpen] = useState(false);
  const illustrator = useIllustrator(boardRef, setBoard, usageBoardRef);
  const library = useBoardLibrary(
    initial,
    snapshot,
    replace,
    board !== snapshot.board ||
      generation.busy ||
      chatSending ||
      !!generation.review ||
      illustrator.busy ||
      arranging ||
      playerOpen,
  );
  useEffect(() => {
    usageBoardRef.current = library.activeId;
  }, [library.activeId]);
  const { error, setError, setBusy } = generation;
  useEffect(() => {
    if (settingsError) setError(`${settingsError} Default model settings apply for now.`);
  }, [settingsError, setError]);
  const { cancel: cancelIllustration } = illustrator;
  // `working`: something is in flight. `busy` also covers viewing someone else's public board,
  // which can be explored and played but not changed.
  const working =
    generation.busy || chatSending || library.switching || !!generation.review || arranging;
  const readOnly = library.access === 'viewer';
  const busy = working || readOnly;
  const saved = library.status;
  const [agent, setAgent] = useState<BoardAgent>(initial.snapshot.board?.agent ?? 'claude');
  const [modelPreferences, setModelPreferences] = useState(readModelPreferences);
  const [agents, setAgents] = useState<ReturnType<typeof BoardAgentsSchema.parse>>([]);
  const [connectionError, setConnectionError] = useState('');
  const [prompt, setPrompt] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [viewGroups, setViewGroups] = useState<Record<string, boolean>>({});
  const presentation = useMemo(
    () =>
      board && readOnly
        ? {
            ...board,
            groups: board.groups?.map((group) => ({
              ...group,
              collapsed: viewGroups[group.id] ?? group.collapsed,
            })),
          }
        : board,
    [board, readOnly, viewGroups],
  );
  const path = usePath();
  const page: SidebarMode =
    path === '/boards'
      ? 'boards'
      : path === '/search'
        ? 'search'
        : path === '/account'
          ? 'account'
          : path === '/settings'
            ? 'appearance'
            : path === '/canvas/settings' && board && !readOnly
              ? 'settings'
              : path.startsWith('/canvas')
                ? 'canvas'
                : 'home';
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [boardTrail, setBoardTrail] = useState<{ id: string; concept?: string | undefined }[]>([]);
  const [canvasTab, setCanvasTab] = useState<'canvas' | 'chat'>('canvas');
  const chat = useBoardChat(library.activeId);
  const clearDiagramSelection = useCallback(() => {
    setSelected(null);
    setSelectedEdge(null);
  }, []);
  const drawing = useCanvasDrawing({
    board,
    boardRef,
    setBoard,
    commit,
    begin,
    end,
    editable: !busy && !playerOpen && page === 'canvas' && canvasTab === 'canvas',
    onSelect: clearDiagramSelection,
  });
  // A board with only drawings is a sketch in progress, not an empty canvas.
  const showWelcome =
    (!board || (board.nodes.length === 0 && !board.drawings?.length)) && !drawing.active;
  const [showIcons, setShowIcons] = useState(false);
  const [railOpen, setRailOpen] = useState(() => window.innerWidth > 760);
  // Whether clicking a concept icon opens its explanation. Off = drawing only.
  const [explain, setExplainState] = useState(() => {
    try {
      return localStorage.getItem(EXPLAIN_KEY) !== 'false';
    } catch {
      return true;
    }
  });
  const setExplain = useCallback((next: boolean) => {
    setExplainState(next);
    try {
      localStorage.setItem(EXPLAIN_KEY, String(next));
    } catch {
      // Remembering the choice is a convenience only.
    }
  }, []);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [attachments, setAttachments] = useState<BoardAttachment[]>([]);
  const [playback, setPlayback] = useState<PlaybackFocus | null>(null);
  const [legacyBundle, setLegacyBundle] = useState<{
    id: string;
    data: ReturnType<typeof LegacyBundleSchema.parse>;
  } | null>(null);
  const [importPreview, setImportPreview] = useState<BoardDocument | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const promptInput = useRef<HTMLTextAreaElement>(null);
  // The composer and canvas tools can be tucked away to give the canvas more room.
  const [composerPreference, setComposerPreference] = useRememberedOpen(
    'opsis:composer-open',
    true,
  );
  const [toolsOpen, setToolsOpen] = useRememberedOpen('opsis:canvas-tools-open', true);
  const focusAfterOpen = useRef(false);
  useEffect(() => {
    if (!composerPreference || !focusAfterOpen.current) return;
    focusAfterOpen.current = false;
    promptInput.current?.focus();
  }, [composerPreference, canvasTab]);
  const flow = useReactFlow();
  useEffect(() => {
    applySavedRailWidth();
    const close = () => setRailOpen(false);
    window.addEventListener(CLOSE_RAIL, close);
    return () => window.removeEventListener(CLOSE_RAIL, close);
  }, []);
  // Delete the selected concept or connection with the Delete/Backspace key. Routed through
  // commit() so it is one undoable action and the board document stays in sync (ReactFlow's
  // own deletion is disabled via deleteKeyCode). Ignored while typing in a field.
  useEffect(() => {
    if (readOnly) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
          target.closest('[contenteditable="true"]'))
      )
        return;
      const current = boardRef.current;
      if (!current || busy) return;
      if (selected) {
        event.preventDefault();
        commit(removeNode(current, selected));
        setSelected(null);
      } else if (selectedEdge) {
        event.preventDefault();
        commit({ ...current, edges: current.edges.filter((edge) => edge.id !== selectedEdge) });
        setSelectedEdge(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [readOnly, busy, selected, selectedEdge, boardRef, commit]);
  const readingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The big picture opens with each canvas, tucks itself away once the reader starts working
  // on the canvas, and stays the way the reader last set it until another canvas opens.
  const [headingState, setHeadingState] = useState<{
    boardId: string;
    mode: 'auto' | 'open' | 'closed';
  }>({ boardId: library.activeId, mode: 'auto' });
  const headingMode = headingState.boardId === library.activeId ? headingState.mode : 'auto';
  const headingOpen = headingMode !== 'closed';
  const retractHeading = useCallback(() => {
    if (headingMode === 'auto' && boardRef.current?.nodes.length)
      setHeadingState({ boardId: library.activeId, mode: 'closed' });
  }, [headingMode, boardRef, library.activeId]);
  const { canvas: lookCanvas, icon: lookIcon } = lookOf(board);
  useEffect(() => {
    applyLook({ canvas: lookCanvas, icon: lookIcon });
  }, [lookCanvas, lookIcon]);

  useEffect(() => {
    // The library can switch externally through board-manager creation/deletion.
    setAgent(boardRef.current?.agent ?? 'claude');
    setViewGroups({});
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
    const canvas = document.querySelector('.blueprint');
    const height = canvas?.clientHeight ?? 700;
    const heading = canvas?.querySelector<HTMLElement>('.canvas-heading')?.offsetHeight ?? 0;
    const composer = canvas?.querySelector<HTMLElement>('.composer-wrap')?.offsetHeight ?? 0;
    void flow.fitView({
      padding: {
        top: `${Math.min(height * 0.3, heading + 32)}px`,
        bottom: `${Math.min(height * 0.4, composer + 36)}px`,
        x: '48px',
      },
      duration: 300,
      maxZoom: 1.1,
    });
  }, [flow]);
  const readingView = useCallback(() => {
    const current = boardRef.current;
    if (!current) return;
    const positions = current.nodes.map((node) => current.positions[node.id]).filter((p) => !!p);
    if (!positions.length) return;
    const canvas = document.querySelector('.blueprint');
    void flow.setViewport(
      readingViewport(positions, canvas?.clientWidth ?? 900, canvas?.clientHeight ?? 700),
      { duration: 250 },
    );
  }, [flow, boardRef]);
  const hasBoard = !!board;
  const onCanvas = page === 'canvas';
  useEffect(() => {
    if (!onCanvas) return;
    const timer = setTimeout(readingView, 100);
    readingTimer.current = timer;
    return () => clearTimeout(timer);
  }, [hasBoard, library.activeId, readingView, onCanvas]);
  async function arrangeDownward() {
    if (!board || busy || arranging) return;
    setArranging(true);
    try {
      const width = document.querySelector('.blueprint')?.clientWidth ?? 900;
      // Explicit arrangement is undoable; normal follow-ups still preserve hand-placed nodes.
      commit(await layoutBoard(board, board.agent, board, width, 'pinned'));
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
  const editing = page === 'canvas' || page === 'settings';
  useEffect(() => {
    if (!editing) return;
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
  }, [undo, editing]);

  async function generate(event?: FormEvent, text = prompt, freshCanvas = false) {
    event?.preventDefault();
    if (!text.trim() || busy) return;
    const callsAgent =
      agent !== 'demo' &&
      !terminalExampleFor(text, boardRef.current, !freshCanvas && attachments.length > 0);
    if (
      callsAgent &&
      (!BoardModelSettingsSchema.safeParse(modelPreferences[agent]).success ||
        modelPreferences[agent].model === 'default')
    ) {
      setError('Choose a valid, explicit model before generating.');
      setSettingsOpen(true);
      return;
    }
    // Provider mode: stop before a call the agent has no remaining window for.
    if (callsAgent && providerStatus?.blocked) {
      setError(
        `${PROVIDER_LABELS[agent]} has reached its ${providerStatus.reason.toLowerCase()}. It will be available again when the window resets.`,
      );
      return;
    }
    setChatSending(true);
    try {
      const chatBoardId = await library.ensureSaved();
      const thread = await chat.begin(
        agent,
        agent === 'demo' ? 'built-in' : modelPreferences[agent].model,
        text,
        chatBoardId,
      );
      const success = await generation.generate(
        text,
        agent,
        modelPreferences,
        boardRef.current,
        freshCanvas ? null : selected,
        agent === 'demo' || freshCanvas ? [] : attachments,
        thread.messages.slice(0, -1).slice(-12),
      );
      if (success && callsAgent) provider.record(agent as ProviderAgent);
      await chat.finish(
        thread,
        success
          ? generation.responseText.current || 'A diagram is ready on Canvas.'
          : 'Generation stopped or failed. No generated proposal was applied.',
        chatBoardId,
      );
      if (success) {
        setPrompt('');
        setAttachments([]);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save this conversation.');
    } finally {
      setChatSending(false);
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
      setCanvasTab('canvas');
      setSelected(null);
      setSelectedEdge(null);
      navigate('/canvas');
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
  // Links an agent shares through the MCP server open that board: /canvas?board=<id>.
  const { open: openLibraryBoard, activeId: startingId } = library;
  const linkHandled = useRef(false);
  /** A concept to select and centre once its board is on the canvas (search, links). */
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const linked = params.get('board');
    if (!linked || linkHandled.current) return;
    linkHandled.current = true;
    pendingFocus.current = params.get('concept');
    window.history.replaceState(null, '', location.pathname);
    if (linked !== startingId) void openLibraryBoard(linked);
  }, [openLibraryBoard, startingId]);
  const openBoard = async (id: string, conceptId?: string) => {
    if (id !== library.activeId && !(await library.open(id))) return false;
    setCanvasTab('canvas');
    setSelected(null);
    setSelectedEdge(null);
    setAgent(boardRef.current?.agent ?? agent);
    pendingFocus.current = conceptId ?? null;
    return true;
  };
  const followBoardLink = async (id: string, conceptId?: string) => {
    const previous = { id: library.activeId, concept: selected ?? undefined };
    if (await openBoard(id, conceptId)) {
      setBoardTrail((trail) => [...trail, previous].slice(-40));
      navigate('/canvas');
    }
  };
  const backToBoard = async () => {
    const previous = boardTrail.at(-1);
    if (previous && (await openBoard(previous.id, previous.concept)))
      setBoardTrail((trail) => trail.slice(0, -1));
  };
  useEffect(() => {
    const target = pendingFocus.current;
    if (page !== 'canvas' || !target || !board?.nodes.some((node) => node.id === target)) return;
    pendingFocus.current = null;
    selectNode(target);
  });
  // Ctrl/⌘ K opens search from anywhere in the workspace.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || !(event.ctrlKey || event.metaKey) || event.altKey)
        return;
      event.preventDefault();
      navigate('/search');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  const closePlayer = useCallback(() => {
    setPlayerOpen(false);
    setPlayback(null);
  }, []);
  const activeNode = board?.nodes.find((node) => node.id === selected);
  const activeEdge = board?.edges.find((edge) => edge.id === selectedEdge);
  const status = agents.find((entry) => entry.id === agent);
  const providerStatus = agent === 'demo' ? null : provider.statusOf(agent);
  const localTerminalExample = !!terminalExampleFor(prompt, board, attachments.length > 0);
  const modelLabel =
    agent === 'demo'
      ? ''
      : (BOARD_MODEL_CHOICES[agent].find((choice) => choice.id === modelPreferences[agent].model)
          ?.label ??
        (modelPreferences[agent].model || 'Choose a model'));
  const { nodes, edges } = useBoardDiagram(presentation, selected, selectedEdge, playback, process);
  const changePositions = (changes: NodeChange<DiagramNode>[]) => {
    if (busy) return;
    setBoard((current) => {
      if (!current) return current;
      const positions = { ...current.positions };
      let changed = false;
      for (const change of changes)
        if (
          change.type === 'position' &&
          change.position &&
          !current.pinnedNodeIds?.includes(change.id)
        ) {
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
            : patchBoardNode(node, patch, {
                narration: 'label' in patch || 'summary' in patch,
                drawing: 'icon' in patch && (patch.icon !== node.icon || !!node.customIcon),
              }),
        ),
      });
  };

  const newCanvas = async () => {
    if (!(await library.open())) return false;
    setSelected(null);
    setSelectedEdge(null);
    setPrompt('');
    setError('');
    setAttachments([]);
    setCanvasTab('canvas');
    return true;
  };
  const sidebar = (
    <AppSidebar
      mode={page}
      board={board}
      busy={working}
      readOnly={readOnly}
      user={user}
      onSignOut={onSignOut}
      library={library}
      commit={commit}
      selected={selected}
      selectNode={selectNode}
      explain={explain}
      setExplain={setExplain}
      onNew={async () => {
        if (!(await newCanvas())) return;
        navigate('/canvas');
        if (window.innerWidth <= 760) setRailOpen(false);
      }}
    />
  );
  // An empty canvas or a running generation keeps the composer open: it is the way to begin,
  // and the only place to cancel.
  const composerOpen = composerPreference || generation.busy || !board || board.nodes.length === 0;
  const focusPrompt = () => {
    setCanvasTab('chat');
    focusAfterOpen.current = true;
    if (canvasTab === 'chat' && promptInput.current) promptInput.current.focus();
    else {
      focusAfterOpen.current = true;
      setComposerPreference(true);
    }
  };
  const chatComposer = (
    <>
      {board && !busy && (
        <NextSteps
          suggestions={[
            ...(agent !== 'demo' ? [RETURN_PATHS] : []),
            ...(board.suggestions ?? []).map((text) => ({ label: text, prompt: text })),
          ]}
          onPick={(suggestion) => {
            setPrompt(suggestion.prompt);
            focusPrompt();
          }}
        />
      )}
      <BoardComposer
        board={board}
        agent={agent}
        busy={busy}
        attachments={attachments}
        prompt={prompt}
        promptInput={promptInput}
        selected={selected}
        settingsOpen={settingsOpen}
        modelPreferences={modelPreferences}
        modelLabel={modelLabel}
        localTerminalExample={localTerminalExample}
        connectionError={connectionError}
        status={status}
        provider={{
          enabled: provider.settings.enabled,
          status: providerStatus,
          caps: agent === 'demo' ? { fiveHour: 0, weekly: 0 } : provider.settings.caps[agent],
          setEnabled: provider.setEnabled,
          setCaps: (caps) => {
            if (agent !== 'demo') provider.setCaps(agent, caps);
          },
        }}
        generation={generation}
        generate={generate}
        setAttachments={setAttachments}
        setPrompt={setPrompt}
        setError={setError}
        setModelPreferences={setModelPreferences}
        setAgent={setAgent}
        setSettingsOpen={setSettingsOpen}
        setSelected={setSelected}
      />
      {!busy && (
        <p className="composer-hint">
          <kbd>Enter</kbd> to send · <kbd>Shift</kbd> + <kbd>Enter</kbd> for a new line
        </p>
      )}
    </>
  );
  const railToggle = (
    <button
      className="rail-toggle"
      aria-label={railOpen ? 'Hide sidebar' : 'Show sidebar'}
      aria-expanded={railOpen}
      onClick={() => setRailOpen(!railOpen)}
    >
      <PanelLeft size={18} />
    </button>
  );

  if (page !== 'canvas')
    return (
      <div className={`workspace is-page ${railOpen ? 'rail-open' : 'rail-closed'}`}>
        {sidebar}
        <div className="page-scroll">
          <div className="page-toolbar">{railToggle}</div>
          {page === 'appearance' ? (
            <Suspense fallback={<p role="status">Loading settings…</p>}>
              <SettingsPage preferences={modelPreferences} onChange={setModelPreferences} />
            </Suspense>
          ) : page === 'account' && user ? (
            <Suspense fallback={<p role="status">Loading account…</p>}>
              <AccountPage user={user} onSignOut={onSignOut} />
            </Suspense>
          ) : page === 'search' ? (
            <SearchPage
              onOpen={async (id, conceptId) => {
                if (await openBoard(id, conceptId)) navigate('/canvas');
              }}
            />
          ) : page === 'boards' ? (
            <BoardsPage
              library={library}
              onCreated={() => navigate('/canvas')}
              onOpen={async (id) => {
                if (await openBoard(id)) navigate('/canvas');
              }}
            />
          ) : page === 'settings' && board ? (
            <CanvasSettingsPage
              board={board}
              busy={busy}
              commit={commit}
              visibility={
                library.entries.find((entry) => entry.id === library.activeId)?.visibility ??
                'private'
              }
              boardId={library.activeId}
              onVisibility={async (visibility) => {
                // Save first: a canvas that was never saved has no server record to share yet.
                await library.save().catch(() => undefined);
                const entry = (await library.refresh()).find(
                  (item) => item.id === library.activeId,
                );
                return !!entry && library.manage('share', entry, undefined, visibility);
              }}
            />
          ) : (
            <HomePage
              board={board}
              busy={working}
              library={library}
              onStart={async (question) => {
                if (!(await newCanvas())) return;
                navigate('/canvas');
                // Kept in the composer if the agent cannot run yet, so the question is not lost.
                setPrompt(question);
                void generate(undefined, question, true);
              }}
              onOpen={async (id) => {
                if (await openBoard(id)) navigate('/canvas');
              }}
              onExample={(graph) => void demo(graph)}
            />
          )}
        </div>
      </div>
    );
  return (
    <div className={`workspace ${railOpen ? 'rail-open' : 'rail-closed'}`}>
      {sidebar}

      <main className="workspace-main">
        <BoardHeader
          board={board}
          busy={busy}
          working={working}
          saved={saved}
          railToggle={railToggle}
          menus={
            <>
              {board &&
                (library.access !== 'owner' ||
                  library.entries.some((entry) => entry.id === library.activeId)) && (
                  <BoardLinks
                    key={`links:${library.activeId}`}
                    id={library.activeId}
                    onOpen={(id, concept) => void followBoardLink(id, concept)}
                    onBack={boardTrail.length ? () => void backToBoard() : undefined}
                  />
                )}
              {board &&
                library.access !== 'viewer' &&
                (library.access === 'editor' ||
                  library.entries.some((entry) => entry.id === library.activeId)) && (
                  <BoardSharing
                    key={library.activeId}
                    id={library.activeId}
                    owner={library.access === 'owner'}
                  />
                )}
              {board && !readOnly && <BoardGroups board={board} disabled={busy} commit={commit} />}
              {readOnly && !!presentation?.groups?.length && (
                <details className="header-menu board-groups">
                  <GroupsSummary />
                  <div className="header-menu-panel group-controls">
                    <p className="header-menu-title">Explore subgraphs</p>
                    {presentation.groups.map((group) => (
                      <label key={group.id}>
                        <input
                          type="checkbox"
                          checked={group.collapsed}
                          onChange={(event) =>
                            setViewGroups((current) => ({
                              ...current,
                              [group.id]: event.target.checked,
                            }))
                          }
                        />
                        Collapse {group.label}
                      </label>
                    ))}
                  </div>
                </details>
              )}
            </>
          }
          onImport={() => importInput.current?.click()}
          setError={setError}
        />
        <input
          ref={importInput}
          type="file"
          accept=".json,.txt,.md,application/json,text/plain,text/markdown"
          hidden
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            try {
              if (file.size > 20_000_000) throw new Error('This file is too large.');
              const text = await file.text();
              if (/\.json$/i.test(file.name)) {
                const bundle = LegacyBundleSchema.safeParse(JSON.parse(text));
                if (bundle.success) {
                  setLegacyBundle({ id: crypto.randomUUID(), data: bundle.data });
                  setImportPreview(null);
                  setError('');
                  return;
                }
              }
              const next = /\.(txt|md)$/i.test(file.name)
                ? boardFromText(text, file.name)
                : await importBoard(JSON.parse(text));
              setImportPreview(next);
              setLegacyBundle(null);
              setError('');
            } catch {
              setError(
                'Could not import this file. Use a v2/legacy JSON board or plain text/Markdown with up to 50 sections and 100,000 characters. Your canvas is unchanged.',
              );
            }
          }}
        />
        {legacyBundle && (
          <LegacyBatchReview
            key={legacyBundle.id}
            bundle={legacyBundle.data}
            onClose={() => setLegacyBundle(null)}
            onSaved={library.refresh}
          />
        )}
        {importPreview && (
          <section className="import-preview" aria-label="Import review">
            <h2>Review import: {importPreview.title}</h2>
            <p>{importPreview.description}</p>
            <p>
              {importPreview.nodes.length} concepts · {importPreview.edges.length} relationships.
              Original file remains unchanged.
            </p>
            <ul>
              {importPreview.nodes.map((node) => (
                <li key={node.id}>
                  <strong>{node.label}</strong>
                  <p>{node.summary}</p>
                </li>
              ))}
            </ul>
            <button
              disabled={working}
              onClick={async () => {
                if (!(await library.open())) return;
                commit(importPreview);
                setAgent(importPreview.agent);
                setSelected(null);
                setSelectedEdge(null);
                setImportPreview(null);
              }}
            >
              Import as new board
            </button>
            <button onClick={() => setImportPreview(null)}>Discard import</button>
          </section>
        )}
        {generation.busy && generation.activity.nodes.length > 0 && (
          <section className="streamed-preview" aria-label="Draft concepts">
            <h2>Draft concepts · not saved</h2>
            <p>
              Individual concepts validated as they arrive. Connections and the full diagram still
              need validation and review.
            </p>
            <div>
              {generation.activity.nodes.map((node) => (
                <article key={node.id}>
                  <strong>{node.label}</strong>
                  <p>{node.summary}</p>
                </article>
              ))}
            </div>
          </section>
        )}
        <div
          className="workspace-tabs"
          role="tablist"
          aria-label="Board workspace tabs"
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next =
              event.key === 'Home'
                ? 'canvas'
                : event.key === 'End'
                  ? 'chat'
                  : canvasTab === 'canvas'
                    ? 'chat'
                    : 'canvas';
            setCanvasTab(next);
            document.getElementById(`${next}-tab`)?.focus();
          }}
        >
          <button
            id="canvas-tab"
            role="tab"
            aria-selected={canvasTab === 'canvas'}
            tabIndex={canvasTab === 'canvas' ? 0 : -1}
            aria-controls="canvas-panel"
            onClick={() => setCanvasTab('canvas')}
          >
            Canvas{generation.busy ? ' · Generating' : generation.review ? ' · Review ready' : ''}
          </button>
          <button
            id="chat-tab"
            role="tab"
            aria-selected={canvasTab === 'chat'}
            tabIndex={canvasTab === 'chat' ? 0 : -1}
            aria-controls="chat-panel"
            onClick={focusPrompt}
          >
            Chat
          </button>
          <button role="tab" aria-selected={false} disabled title="Reserved for a future feature">
            Coming soon
          </button>
        </div>
        <div
          id="chat-panel"
          role="tabpanel"
          aria-labelledby="chat-tab"
          hidden={canvasTab !== 'chat'}
        >
          {canvasTab === 'chat' && (
            <BoardChat
              chat={chat}
              busy={working}
              onSelect={(nextAgent, model) => {
                setAgent(nextAgent);
                if (nextAgent !== 'demo')
                  setModelPreferences((before) => ({
                    ...before,
                    [nextAgent]: { ...before[nextAgent], model },
                  }));
              }}
            >
              {readOnly ? (
                <p>This board is read-only. Save your own copy to generate changes.</p>
              ) : (
                chatComposer
              )}
            </BoardChat>
          )}
          {generation.busy && (
            <AgentActivity
              activity={generation.activity}
              elapsed={generation.elapsed}
              agent={agent === 'demo' ? 'Demo' : PROVIDER_LABELS[agent]}
            />
          )}
          {generation.review && <p role="status">A proposal is ready for review on Canvas.</p>}
          {generation.error && (
            <div role="alert">
              <p>{generation.error}</p>
              <button aria-label="Dismiss error" onClick={() => setError('')}>
                Dismiss
              </button>
            </div>
          )}
        </div>
        <div
          id="canvas-panel"
          role="tabpanel"
          aria-labelledby="canvas-tab"
          hidden={canvasTab !== 'canvas'}
          className="canvas-and-detail"
        >
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
              onNodeClick={(_, node) => {
                retractHeading();
                // Drawing mode: a click on an icon does nothing until explanation is on.
                if (!explain) return;
                selectNode(node.id);
              }}
              onNodeDoubleClick={(_, node) => {
                if (node.data.linkedBoardId) void followBoardLink(node.data.linkedBoardId);
              }}
              onEdgeClick={(_, edge) => {
                retractHeading();
                setSelectedEdge(edge.id);
                setSelected(null);
              }}
              onPaneClick={() => {
                retractHeading();
                setSelected(null);
                setSelectedEdge(null);
              }}
              // Only the reader's own panning counts; programmatic moves pass no event.
              onMoveStart={(event) => {
                if (event) retractHeading();
              }}
              onNodeDragStart={() => {
                retractHeading();
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
                color="var(--bp-grid)"
                lineWidth={0.6}
              />
              <Background
                id="major"
                variant={BackgroundVariant.Lines}
                gap={120}
                color="var(--bp-grid-major)"
                lineWidth={1}
              />
              <DrawingLayer drawing={drawing} />
              {presentation && <GroupBoundaries board={presentation} />}
            </ReactFlow>
            <DrawingControls drawing={drawing} />
            {board && (
              <div className={`canvas-heading ${headingOpen ? 'is-open' : 'is-collapsed'}`}>
                <button
                  className="canvas-kicker"
                  aria-expanded={headingOpen}
                  aria-controls="big-picture"
                  aria-label={headingOpen ? 'Hide the big picture' : 'Show the big picture'}
                  title={headingOpen ? 'Tuck away' : 'Show the big picture'}
                  onClick={() =>
                    setHeadingState({
                      boardId: library.activeId,
                      mode: headingOpen ? 'closed' : 'open',
                    })
                  }
                >
                  <span className="kicker-dot" />
                  THE BIG PICTURE
                  <span className="kicker-title">{board.title}</span>
                  <ChevronUp className="chevron" size={13} aria-hidden />
                </button>
                <div className="canvas-heading-body" id="big-picture" aria-hidden={!headingOpen}>
                  <div>
                    <h2>{board.title}</h2>
                    <p>{board.description}</p>
                  </div>
                </div>
                {/* In the heading's flow, so it always sits below the text rather than over it. */}
                {!playerOpen && board.nodes.length > 0 && (
                  <button
                    className="play-process"
                    disabled={working}
                    onClick={() => {
                      setSelected(null);
                      setSelectedEdge(null);
                      retractHeading();
                      setPlayerOpen(true);
                    }}
                  >
                    <Play size={13} fill="currentColor" /> Play the process
                  </button>
                )}
              </div>
            )}
            <div
              className={`canvas-tools ${toolsOpen ? '' : 'is-collapsed'}`}
              role="toolbar"
              aria-label="Canvas tools"
            >
              {toolsOpen ? (
                <>
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
                  <button
                    aria-label="Canvas colours"
                    title="Canvas look & details"
                    disabled={!board || readOnly}
                    onClick={() => navigate('/canvas/settings')}
                  >
                    <Palette size={16} />
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
                            explanation:
                              'Describe this concept and how it connects to the diagram.',
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
                  <span />
                  <button
                    aria-label="Hide canvas tools"
                    title="Tuck the tools away"
                    aria-expanded
                    onClick={() => setToolsOpen(false)}
                  >
                    <ChevronsRight size={16} />
                  </button>
                </>
              ) : (
                <button
                  aria-label="Show canvas tools"
                  title="Undo, zoom, fit and more"
                  aria-expanded={false}
                  onClick={() => setToolsOpen(true)}
                >
                  <Wrench size={16} />
                </button>
              )}
            </div>
            {showWelcome && (
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
                          focusPrompt();
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
            <div className={`composer-wrap ${composerOpen ? '' : 'is-minimized'}`}>
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
              {generation.review && canvasTab === 'canvas' && (
                <GenerationReview
                  {...generation.review}
                  apply={(accepted) => {
                    generation.apply(accepted);
                    setSelected(null);
                    setSelectedEdge(null);
                  }}
                  discard={generation.discard}
                />
              )}
              {error && canvasTab === 'canvas' && (
                <div className="workspace-error" role="alert">
                  <CircleAlert size={16} aria-hidden />
                  <span>{error}</span>
                  <button aria-label="Dismiss error" onClick={() => setError('')}>
                    <X size={15} />
                  </button>
                </div>
              )}
              {generation.busy && canvasTab === 'canvas' && (
                <>
                  <AgentActivity
                    activity={generation.activity}
                    elapsed={generation.elapsed}
                    agent={agent === 'demo' ? 'Demo' : PROVIDER_LABELS[agent]}
                  />
                  <button onClick={generation.cancel}>Stop generation</button>
                </>
              )}
              {board && playerOpen ? (
                <Suspense fallback={<p role="status">Loading player…</p>}>
                  <ProcessPlayer
                    key={library.activeId}
                    board={board}
                    disabled={working}
                    process={process}
                    onBeat={followBeat}
                    onClose={closePlayer}
                    // Drawings change the board, so they are for the owner only.
                    {...(readOnly
                      ? {}
                      : {
                          illustration: {
                            busy: illustrator.busy,
                            elapsed: illustrator.elapsed,
                            activity: illustrator.activity,
                            message: illustrator.message,
                            available:
                              agent === 'demo' ||
                              !!modelPreferences[agent].executablePath ||
                              status?.available !== false,
                            redraw: board.nodes.every((node) => node.illustration),
                            onIllustrate: () =>
                              void illustrator.illustrate(agent, modelPreferences),
                          },
                        })}
                  />
                </Suspense>
              ) : readOnly && board ? (
                <div className="viewer-bar" role="status">
                  <span className="viewer-badge">
                    <Eye size={14} /> Viewing
                  </span>
                  <span className="viewer-text">
                    <strong>{library.owner || 'Someone'}’s canvas</strong>
                    <small>Public · you can explore and play it, not change it</small>
                  </span>
                  <button
                    className="viewer-copy"
                    disabled={working}
                    onClick={() => void library.saveCopy()}
                  >
                    <Copy size={14} /> Save a copy
                  </button>
                </div>
              ) : (
                <button className="composer-pill" onClick={focusPrompt}>
                  <MessageSquarePlus size={15} aria-hidden /> Open chat
                </button>
              )}
            </div>
          </section>
          {activeNode && board && (
            <ConceptDetails
              selectEdge={(id) => {
                setSelectedEdge(id);
                setSelected(null);
              }}
              key={activeNode.id}
              board={board}
              boardRef={boardRef}
              activeNode={activeNode}
              linkTargets={library.entries.filter(
                (entry) => entry.id !== library.activeId && !entry.archived,
              )}
              followLink={(id) => void followBoardLink(id)}
              process={process}
              busy={busy}
              showIcons={showIcons}
              focusPrompt={focusPrompt}
              commit={commit}
              editNode={editNode}
              selectNode={selectNode}
              setSelected={setSelected}
              setPrompt={setPrompt}
              setShowIcons={setShowIcons}
              setArranging={setArranging}
            />
          )}
          {activeEdge && board && (
            <ConnectionDetails
              board={board}
              activeEdge={activeEdge}
              busy={busy}
              commit={commit}
              onClose={() => setSelectedEdge(null)}
            />
          )}
        </div>
      </main>
    </div>
  );
}

export function Workspace(props: WorkspaceProps) {
  return (
    <ReactFlowProvider>
      <BoardWorkspace {...props} />
    </ReactFlowProvider>
  );
}
