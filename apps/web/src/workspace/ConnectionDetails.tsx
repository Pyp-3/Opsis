import { ArrowRight, X, Trash2 } from 'lucide-react';
import {
  BoardEdgeKindSchema,
  EDGE_COLORS,
  withoutNarration,
  type BoardDocument,
} from '@opsis/schema';
import { EDGE_COLOR_VALUES, connectionStyle } from './connections';

type ConnectionDetailsProps = {
  board: BoardDocument;
  activeEdge: BoardDocument['edges'][number];
  busy: boolean;
  commit: (board: BoardDocument) => void;
  onClose: () => void;
};

export function ConnectionDetails({
  board,
  activeEdge,
  busy,
  commit,
  onClose,
}: ConnectionDetailsProps) {
  return (
    <aside className="detail-panel" aria-label="Connection details">
      <div className="detail-top">
        <span className="eyebrow">
          <ArrowRight size={13} /> Connection
        </span>
        <button aria-label="Close details" onClick={() => onClose()}>
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
            onClose();
          }}
        >
          <Trash2 size={14} /> Remove connection
        </button>
      </div>
    </aside>
  );
}
