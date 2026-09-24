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
import './canvas.css';

type EditorNodeData = CanvasNodeData & { onRelabel: (id: string, label: string) => void };

function editableNodeId(): string {
  const suffix = globalThis.crypto?.randomUUID?.().replaceAll('-', '') ?? String(Date.now());
  return `user_${suffix}`;
}

/** An editable, fully labelled React Flow node. */
function EditableNode({ id, data, selected }: NodeProps<Node<EditorNodeData>>) {
  return (
    <div
      className={`opsis-flow-node${selected ? ' opsis-flow-node--selected' : ''}${data.optional ? ' opsis-flow-node--optional' : ''}`}
    >
      <Handle type="target" position={Position.Left} />
      <label>
        <span className="opsis-visually-hidden">{t('canvas.nodeLabel')}</span>
        <input
          key={data.label}
          className="nodrag"
          defaultValue={data.label}
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

function FitSignal({ signal }: { signal: number }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    void fitView({ padding: 0.1, duration: 250 });
  }, [fitView, signal]);
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
  const [history] = useState(() => new SnapshotHistory(osg));
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
  const [label, setLabel] = useState(t('canvas.newIdea'));
  const [message, setMessage] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
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
  const nodes: Node<EditorNodeData>[] = flow.nodes.map((node) => ({
    ...node,
    type: 'editable',
    selected: node.id === selectedId,
    data: { ...node.data, onRelabel: relabel },
  }));
  const edges: Edge[] = flow.edges.map((edge) => ({
    ...edge,
    selected: edge.id === selectedId,
  }));

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
  }, [commit, select, store]);

  useEffect(() => {
    if (!active) return;
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
  }, [active, removeSelected, restore]);

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
          <input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={80} />
        </label>
        <button
          type="button"
          onClick={() => {
            const result = addNode(osg, label, editableNodeId());
            if (commit(result) && result.success)
              select(result.osg.scenes[0]?.nodes.at(-1)?.id ?? null);
          }}
        >
          {t('canvas.add')}
        </button>
        <button type="button" onClick={removeSelected} disabled={!selectedId}>
          {t('canvas.deleteSelected')}
        </button>
        <button type="button" onClick={() => restore('undo')} disabled={!historyState.canUndo}>
          {t('canvas.undo')}
        </button>
        <button type="button" onClick={() => restore('redo')} disabled={!historyState.canRedo}>
          {t('canvas.redo')}
        </button>
        <button type="button" onClick={() => void save()} disabled={!dirty}>
          {t('canvas.save')}
        </button>
        <button type="button" onClick={() => void share()}>
          {t('canvas.share')}
        </button>
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
          nodesConnectable
          edgesReconnectable
          onNodeClick={(_event, node) => select(node.id)}
          onEdgeClick={(_event, edge) => select(edge.id)}
          onPaneClick={() => select(null)}
          onNodeDragStop={(_event, node) =>
            commit(moveNode(osg, node.id, node.position.x, node.position.y))
          }
          onConnect={(connection: Connection) => {
            if (connection.source && connection.target)
              commit(connectNodes(osg, connection.source, connection.target, editableNodeId()));
          }}
          onReconnect={(oldEdge, connection) => {
            if (connection.source && connection.target)
              commit(relinkEdge(osg, oldEdge.id, connection.source, connection.target));
          }}
        >
          <Background gap={20} />
          <MiniMap pannable zoomable ariaLabel={t('canvas.minimap')} />
          <Controls showInteractive={false} />
          <FitSignal signal={fitSignal} />
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
