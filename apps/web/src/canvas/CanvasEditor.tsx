import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { OSG } from '@opsis/schema';
import { t } from '@opsis/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession, useSessionStore } from '../state/context';
import { saveOsg, shareOsg } from '../state/api';
import { LAST_OSG_STORAGE_KEY } from '../state/session';
import { SnapshotHistory } from './history';
import {
  addNode,
  connectNodes,
  deleteEdge,
  deleteNode,
  moveNode,
  osgToFlow,
  relabelNode,
  relinkEdge,
  type CanvasNodeData,
  type OsgEditResult,
} from './model';
import { PresentationControls } from './PresentationControls';
import { clampPresentationStep, createPresentationPlan } from './presentation';
import { useCanvasReducedMotion } from './useCanvasReducedMotion';
import './canvas.css';

type EditorNodeData = CanvasNodeData & {
  onRelabel: (id: string, label: string) => void;
  presentationActive: boolean;
  presentationHidden: boolean;
};

function editableNodeId(): string {
  const suffix = globalThis.crypto?.randomUUID?.().replaceAll('-', '') ?? String(Date.now());
  return `user_${suffix}`;
}

/** An editable, fully labelled React Flow node. */
function EditableNode({ id, data, selected }: NodeProps<Node<EditorNodeData>>) {
  return (
    <div
      className={`opsis-flow-node${selected ? ' opsis-flow-node--selected' : ''}${data.optional ? ' opsis-flow-node--optional' : ''}${data.presentationHidden ? ' opsis-flow-node--presentation-hidden' : ''}`}
      aria-hidden={data.presentationHidden || undefined}
    >
      <Handle type="target" position={Position.Left} />
      <label>
        <span className="opsis-visually-hidden">{t('canvas.nodeLabel')}</span>
        <input
          key={data.label}
          className="nodrag"
          defaultValue={data.label}
          disabled={data.presentationActive}
          tabIndex={data.presentationHidden ? -1 : undefined}
          onBlur={(event) => {
            if (event.currentTarget.value !== data.label)
              data.onRelabel(id, event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            }
          }}
          aria-label={t('canvas.labelFor', { label: data.label })}
        />
      </label>
      <small>
        {data.anchor ? t('canvas.main') : data.optional ? t('canvas.optional') : data.primitive}
      </small>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { editable: EditableNode };

function FitSignal({
  signal,
  focusNodeIds,
  reduceMotion,
}: {
  signal: number;
  focusNodeIds?: readonly string[];
  reduceMotion: boolean;
}) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    void fitView({
      padding: focusNodeIds ? 0.3 : 0.1,
      duration: reduceMotion ? 0 : 450,
      ...(focusNodeIds ? { nodes: focusNodeIds.map((id) => ({ id })) } : {}),
    });
  }, [fitView, focusNodeIds, reduceMotion, signal]);
  return null;
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

/** React Flow editor backed by the same validated OSG object used by the 3D renderer. */
function CanvasEditorInner({ osg, active }: { osg: OSG; active: boolean }) {
  const store = useSessionStore();
  const selectedId = useSession((state) => state.selectedId);
  const fitSignal = useSession((state) => state.fitSignal);
  const select = useSession((state) => state.select);
  const replaceCurrentOsg = useSession((state) => state.replaceCurrentOsg);
  const markPersisted = useSession((state) => state.markPersisted);
  const reduceMotionOverride = useSession((state) => state.reduceMotion);
  const reduceMotion = useCanvasReducedMotion(reduceMotionOverride);
  const [history] = useState(() => new SnapshotHistory(osg));
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
  const [label, setLabel] = useState(t('canvas.newIdea'));
  const [message, setMessage] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [presentationActive, setPresentationActive] = useState(false);
  const [presentationPlaying, setPresentationPlaying] = useState(false);
  const [presentationStep, setPresentationStep] = useState(0);
  const presentation = useMemo(() => createPresentationPlan(osg), [osg]);
  const currentStep = presentation.steps[presentationStep];
  const updateHistoryState = useCallback(
    () => setHistoryState({ canUndo: history.canUndo(), canRedo: history.canRedo() }),
    [history],
  );

  const commit = useCallback(
    (result: OsgEditResult) => {
      if (!result.success) {
        setMessage(result.message);
        return false;
      }
      history.push(result.osg);
      replaceCurrentOsg(result.osg);
      setDirty(true);
      setMessage(null);
      updateHistoryState();
      return true;
    },
    [history, replaceCurrentOsg, updateHistoryState],
  );

  const relabel = useCallback(
    (nodeId: string, nextLabel: string) => commit(relabelNode(osg, nodeId, nextLabel)),
    [commit, osg],
  );
  const flow = useMemo(() => osgToFlow(osg), [osg]);
  const visibleNodeIds = useMemo(
    () => new Set(currentStep?.visibleNodeIds ?? []),
    [currentStep?.visibleNodeIds],
  );
  const visibleEdgeIds = useMemo(
    () => new Set(currentStep?.visibleEdgeIds ?? []),
    [currentStep?.visibleEdgeIds],
  );
  const emphasizedEdgeIds = useMemo(
    () => new Set(currentStep?.emphasizedEdgeIds ?? []),
    [currentStep?.emphasizedEdgeIds],
  );
  const nodes: Node<EditorNodeData>[] = flow.nodes.map((node) => ({
    ...node,
    type: 'editable',
    selected: node.id === selectedId,
    draggable: !presentationActive,
    connectable: !presentationActive,
    focusable: !presentationActive || visibleNodeIds.has(node.id),
    ...(presentationActive
      ? {
          style: {
            opacity: visibleNodeIds.has(node.id) ? 1 : 0,
            pointerEvents: visibleNodeIds.has(node.id) ? 'auto' : 'none',
            ...(reduceMotion ? { transitionDuration: '0ms' } : {}),
          },
        }
      : {}),
    data: {
      ...node.data,
      onRelabel: relabel,
      presentationActive,
      presentationHidden: presentationActive && !visibleNodeIds.has(node.id),
    },
  }));
  const edges: Edge[] = flow.edges.map((edge) => ({
    ...edge,
    selected: edge.id === selectedId,
    focusable: !presentationActive || visibleEdgeIds.has(edge.id),
    ...(presentationActive
      ? {
          animated: emphasizedEdgeIds.has(edge.id) && !reduceMotion,
          ...(emphasizedEdgeIds.has(edge.id) ? { className: 'opsis-flow-edge--emphasized' } : {}),
          style: {
            opacity: visibleEdgeIds.has(edge.id) ? 1 : 0,
            pointerEvents: visibleEdgeIds.has(edge.id) ? 'auto' : 'none',
            ...(reduceMotion ? { transitionDuration: '0ms' } : {}),
          },
        }
      : {}),
  }));

  const goToPresentationStep = useCallback(
    (index: number) => {
      setPresentationPlaying(false);
      setPresentationStep(clampPresentationStep(index, presentation.steps.length));
    },
    [presentation.steps.length],
  );

  useEffect(() => {
    if (!presentationActive) return;
    select(currentStep?.selectedNodeId ?? null);
  }, [currentStep?.selectedNodeId, presentationActive, select]);

  useEffect(() => {
    if (!active || !presentationActive || !presentationPlaying || reduceMotion) return;
    const timer = window.setTimeout(() => {
      if (presentationStep >= presentation.steps.length - 1) {
        setPresentationPlaying(false);
      } else {
        setPresentationStep((index) => index + 1);
      }
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [
    active,
    presentation.steps.length,
    presentationActive,
    presentationPlaying,
    presentationStep,
    reduceMotion,
  ]);

  const restore = useCallback(
    (direction: 'undo' | 'redo') => {
      const snapshot = direction === 'undo' ? history.undo() : history.redo();
      if (!snapshot) return;
      replaceCurrentOsg(snapshot);
      setDirty(true);
      setMessage(t(direction === 'undo' ? 'canvas.undoDone' : 'canvas.redoDone'));
      updateHistoryState();
    },
    [history, replaceCurrentOsg, updateHistoryState],
  );

  const removeSelected = useCallback(() => {
    if (presentationActive) return;
    const current = store.getState();
    const currentOsg = current.trail.at(-1);
    const selectedIsEdge = currentOsg?.scenes[0]?.edges.some(
      (edge) => edge.id === current.selectedId,
    );
    const result =
      current.selectedId && currentOsg
        ? selectedIsEdge
          ? deleteEdge(currentOsg, current.selectedId)
          : deleteNode(currentOsg, current.selectedId)
        : undefined;
    if (result && commit(result)) {
      select(null);
    }
  }, [commit, presentationActive, select, store]);

  useEffect(() => {
    if (!active || presentationActive) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLocaleLowerCase() === 'z') {
        event.preventDefault();
        restore(event.shiftKey ? 'redo' : 'undo');
      } else if (modifier && event.key.toLocaleLowerCase() === 'y') {
        event.preventDefault();
        restore('redo');
      } else if (event.key === 'Delete') {
        event.preventDefault();
        removeSelected();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, presentationActive, removeSelected, restore]);

  const save = async () => {
    try {
      const saved = await saveOsg(store.getState().trail.at(-1) ?? osg);
      replaceCurrentOsg(saved);
      markPersisted(saved);
      window.localStorage.setItem(LAST_OSG_STORAGE_KEY, saved.id);
      setDirty(false);
      setMessage(t('canvas.saved'));
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const share = async () => {
    try {
      const saved = await saveOsg(store.getState().trail.at(-1) ?? osg);
      replaceCurrentOsg(saved);
      markPersisted(saved);
      const result = await shareOsg(saved.id);
      window.localStorage.setItem(LAST_OSG_STORAGE_KEY, saved.id);
      const url = new URL(result.url, window.location.href).href;
      await navigator.clipboard?.writeText(url);
      setDirty(false);
      setMessage(t('canvas.shareCopied', { url }));
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <section className="opsis-editor" aria-label={t('canvas.editRegion', { title: osg.title })}>
      <div className="opsis-editor__toolbar" role="toolbar" aria-label={t('canvas.toolbar')}>
        <label>
          <span>{t('canvas.addNode')}</span>
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            maxLength={80}
            disabled={presentationActive}
          />
        </label>
        <button
          type="button"
          disabled={presentationActive}
          onClick={() => {
            const result = addNode(osg, label, editableNodeId());
            if (commit(result) && result.success)
              select(result.osg.scenes[0]?.nodes.at(-1)?.id ?? null);
          }}
        >
          {t('canvas.add')}
        </button>
        <button type="button" onClick={removeSelected} disabled={!selectedId || presentationActive}>
          {t('canvas.deleteSelected')}
        </button>
        <button
          type="button"
          onClick={() => restore('undo')}
          disabled={!historyState.canUndo || presentationActive}
        >
          {t('canvas.undo')}
        </button>
        <button
          type="button"
          onClick={() => restore('redo')}
          disabled={!historyState.canRedo || presentationActive}
        >
          {t('canvas.redo')}
        </button>
        <button type="button" onClick={() => void save()} disabled={!dirty}>
          {t('canvas.save')}
        </button>
        <button type="button" onClick={() => void share()}>
          {t('canvas.share')}
        </button>
        <PresentationControls
          active={presentationActive}
          playing={presentationPlaying}
          stepIndex={presentationStep}
          steps={presentation.steps}
          onEnter={() => {
            setPresentationStep(0);
            setPresentationPlaying(false);
            setPresentationActive(true);
          }}
          onExit={() => {
            setPresentationPlaying(false);
            setPresentationActive(false);
          }}
          onPlayPause={() => {
            if (presentationPlaying) {
              setPresentationPlaying(false);
            } else if (reduceMotion) {
              setPresentationStep(Math.max(0, presentation.steps.length - 1));
            } else {
              if (presentationStep >= presentation.steps.length - 1) setPresentationStep(0);
              setPresentationPlaying(true);
            }
          }}
          onReplay={() => {
            if (reduceMotion) {
              setPresentationStep(Math.max(0, presentation.steps.length - 1));
              setPresentationPlaying(false);
            } else {
              setPresentationStep(0);
              setPresentationPlaying(true);
            }
          }}
          onStep={goToPresentationStep}
        />
      </div>
      {message ? (
        <p className="opsis-editor__message" role="status" aria-live="polite">
          {message}
        </p>
      ) : null}
      <div className="opsis-editor__flow">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          snapToGrid
          snapGrid={[20, 20]}
          fitView
          fitViewOptions={{ padding: 0.1 }}
          deleteKeyCode={null}
          nodesConnectable={!presentationActive}
          edgesReconnectable={!presentationActive}
          onNodeClick={(_event, node) => select(node.id)}
          onEdgeClick={(_event, edge) => select(edge.id)}
          onPaneClick={() => select(null)}
          onNodeDragStop={(_event, node) => {
            if (!presentationActive)
              commit(moveNode(osg, node.id, node.position.x, node.position.y));
          }}
          onConnect={(connection: Connection) => {
            if (!presentationActive && connection.source && connection.target)
              commit(connectNodes(osg, connection.source, connection.target, editableNodeId()));
          }}
          onReconnect={(oldEdge, connection) => {
            if (!presentationActive && connection.source && connection.target)
              commit(relinkEdge(osg, oldEdge.id, connection.source, connection.target));
          }}
        >
          <Background gap={20} />
          <MiniMap pannable zoomable ariaLabel={t('canvas.minimap')} />
          <Controls showInteractive={false} />
          <FitSignal
            signal={fitSignal + (presentationActive ? presentationStep + 1 : 0)}
            {...(presentationActive && currentStep
              ? { focusNodeIds: currentStep.focusNodeIds }
              : {})}
            reduceMotion={reduceMotion}
          />
        </ReactFlow>
      </div>
    </section>
  );
}

/** Provides React Flow context for the OSG editor. */
export default function CanvasEditor(props: { osg: OSG; active?: boolean }) {
  return (
    <ReactFlowProvider>
      <CanvasEditorInner osg={props.osg} active={props.active ?? true} />
    </ReactFlowProvider>
  );
}
