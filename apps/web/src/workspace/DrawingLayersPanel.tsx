import { useCallback, useState } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, Lock, LockOpen, Plus, Trash2 } from 'lucide-react';
import {
  removeDrawingLayer,
  MAX_DRAWING_LAYERS,
  type BoardDocument,
  type DrawingLayer,
  type DrawingScale,
} from '@opsis/schema';

/**
 * Drawing layers and the board's drawing scale. Layers, their order, visibility and locks, and
 * the scale are saved board data, so each change is one undoable edit that viewers see too.
 * Which layer new drawings go on is this device's choice for the session.
 */
export function useDrawingLayers(options: {
  board: BoardDocument | null;
  boardRef: { current: BoardDocument | null };
  commit: (board: BoardDocument | null) => void;
  onNotice: (message: string) => void;
}) {
  const { board, boardRef, commit, onNotice } = options;
  const [open, setOpen] = useState(false);
  const [chosenLayer, setDrawOn] = useState<string | null>(null);
  // New drawings go on the base layer when the chosen one has gone, or is hidden or locked.
  const drawOn =
    board?.drawingLayers?.find(
      (layer) => layer.id === chosenLayer && !layer.hidden && !layer.locked,
    )?.id ?? null;

  const update = useCallback(
    (change: (board: BoardDocument) => BoardDocument) => {
      const current = boardRef.current;
      if (current) commit(change(current));
    },
    [boardRef, commit],
  );
  const changeLayers = useCallback(
    (change: (layers: DrawingLayer[]) => DrawingLayer[]) =>
      update((current) => {
        const layers = change([...(current.drawingLayers ?? [])]);
        const next: BoardDocument = { ...current, drawingLayers: layers };
        if (!layers.length) delete next.drawingLayers;
        return next;
      }),
    [update],
  );
  const addLayer = useCallback(() => {
    const current = boardRef.current;
    const count = current?.drawingLayers?.length ?? 0;
    if (count >= MAX_DRAWING_LAYERS) {
      onNotice(`A board holds at most ${MAX_DRAWING_LAYERS} drawing layers.`);
      return;
    }
    const id = `layer-${crypto.randomUUID().slice(0, 8)}`;
    changeLayers((layers) => [...layers, { id, name: `Layer ${count + 1}` }]);
    setDrawOn(id);
  }, [boardRef, changeLayers, onNotice]);
  const patchLayer = useCallback(
    (id: string, patch: { name?: string; hidden?: boolean; locked?: boolean }) =>
      changeLayers((layers) =>
        layers.map((layer) => {
          if (layer.id !== id) return layer;
          const next = { ...layer, ...patch };
          if (!next.hidden) delete next.hidden;
          if (!next.locked) delete next.locked;
          return next;
        }),
      ),
    [changeLayers],
  );
  /** Moves a layer towards the top (+1) or bottom (-1) of the painting order. */
  const moveLayer = useCallback(
    (id: string, direction: 1 | -1) =>
      changeLayers((layers) => {
        const index = layers.findIndex((layer) => layer.id === id);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= layers.length) return layers;
        [layers[index], layers[target]] = [layers[target]!, layers[index]!];
        return layers;
      }),
    [changeLayers],
  );
  const deleteLayer = useCallback(
    (id: string) => update((current) => removeDrawingLayer(current, id)),
    [update],
  );
  const setScale = useCallback(
    (scale: DrawingScale | null) =>
      update((current) => {
        const next = { ...current };
        if (scale) next.drawingScale = scale;
        else delete next.drawingScale;
        return next;
      }),
    [update],
  );
  return {
    open,
    setOpen,
    drawOn,
    setDrawOn,
    addLayer,
    patchLayer,
    moveLayer,
    deleteLayer,
    setScale,
  };
}
export type DrawingLayers = ReturnType<typeof useDrawingLayers>;

export function DrawingLayersPanel({
  board,
  layers,
}: {
  board: BoardDocument;
  layers: DrawingLayers;
}) {
  const list = board.drawingLayers ?? [];
  const counts = new Map<string, number>();
  for (const drawing of board.drawings ?? [])
    counts.set(drawing.layerId ?? '', (counts.get(drawing.layerId ?? '') ?? 0) + 1);
  return (
    <section className="drawing-panel drawing-layers" aria-label="Layers and scale">
      <ScaleForm scale={board.drawingScale} onApply={layers.setScale} />
      <div className="drawing-layer-head">
        <h3>Layers</h3>
        <button
          className="drawing-link"
          onClick={layers.addLayer}
          disabled={list.length >= MAX_DRAWING_LAYERS}
        >
          <Plus size={13} aria-hidden /> New layer
        </button>
      </div>
      {/* Top of the list paints on top, as in drawing applications. */}
      <ul className="drawing-layer-list" aria-label="Drawing layers">
        {[...list].reverse().map((layer, reversed) => {
          const index = list.length - 1 - reversed;
          const name = layer.name;
          return (
            <li key={layer.id} className={layer.hidden ? 'is-hidden' : ''}>
              <input
                type="radio"
                name="draw-on"
                aria-label={`Draw on ${name}`}
                title="New drawings go on this layer"
                checked={layers.drawOn === layer.id}
                disabled={!!layer.hidden || !!layer.locked}
                onChange={() => layers.setDrawOn(layer.id)}
              />
              <input
                className="drawing-layer-name"
                aria-label={`Layer name: ${name}`}
                defaultValue={name}
                key={`${layer.id}:${name}`}
                maxLength={40}
                onBlur={(event) => {
                  const next = event.target.value.trim();
                  if (!next) event.target.value = name;
                  else if (next !== name) layers.patchLayer(layer.id, { name: next });
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
              />
              <span className="drawing-layer-count" title="Drawings on this layer">
                {counts.get(layer.id) ?? 0}
              </span>
              <button
                aria-label={layer.hidden ? `Show ${name}` : `Hide ${name}`}
                title={layer.hidden ? 'Show this layer' : 'Hide this layer'}
                aria-pressed={!!layer.hidden}
                onClick={() => layers.patchLayer(layer.id, { hidden: !layer.hidden })}
              >
                {layer.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
              <button
                aria-label={layer.locked ? `Unlock ${name}` : `Lock ${name}`}
                title={layer.locked ? 'Unlock this layer' : 'Lock this layer'}
                aria-pressed={!!layer.locked}
                onClick={() => layers.patchLayer(layer.id, { locked: !layer.locked })}
              >
                {layer.locked ? <Lock size={14} /> : <LockOpen size={14} />}
              </button>
              <button
                aria-label={`Move ${name} up`}
                title="Paint above the next layer"
                disabled={index === list.length - 1}
                onClick={() => layers.moveLayer(layer.id, 1)}
              >
                <ArrowUp size={14} />
              </button>
              <button
                aria-label={`Move ${name} down`}
                title="Paint below the previous layer"
                disabled={index === 0}
                onClick={() => layers.moveLayer(layer.id, -1)}
              >
                <ArrowDown size={14} />
              </button>
              <button
                aria-label={`Delete layer ${name}`}
                title="Delete the layer; its drawings move to the base layer"
                onClick={() => layers.deleteLayer(layer.id)}
              >
                <Trash2 size={14} />
              </button>
            </li>
          );
        })}
        <li>
          <input
            type="radio"
            name="draw-on"
            aria-label="Draw on Base layer"
            title="New drawings go on this layer"
            checked={layers.drawOn === null}
            onChange={() => layers.setDrawOn(null)}
          />
          <span className="drawing-layer-name">Base layer</span>
          <span className="drawing-layer-count" title="Drawings on this layer">
            {counts.get('') ?? 0}
          </span>
        </li>
      </ul>
      <p className="drawing-hint">
        Hidden layers are left out of the canvas and exports. Locked layers cannot be picked or
        erased; lock a single drawing from its panel.
      </p>
    </section>
  );
}

/** What one grid square measures; dimension lines without a label read in this unit. */
function ScaleForm({
  scale,
  onApply,
}: {
  scale: DrawingScale | undefined;
  onApply: (scale: DrawingScale | null) => void;
}) {
  const [value, setValue] = useState(String(scale?.gridValue ?? ''));
  const [unit, setUnit] = useState(scale?.unit ?? '');
  const [shown, setShown] = useState(scale);
  // Undo, or another tab's edit, changes the saved scale under the form.
  if (shown !== scale) {
    setShown(scale);
    setValue(String(scale?.gridValue ?? ''));
    setUnit(scale?.unit ?? '');
  }
  const number = Number(value);
  const valid =
    value.trim() !== '' &&
    Number.isFinite(number) &&
    number > 0 &&
    number <= 1_000_000 &&
    unit.trim().length > 0 &&
    unit.trim().length <= 12;
  return (
    <form
      className="drawing-scale"
      aria-label="Drawing scale"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) onApply({ gridValue: number, unit: unit.trim() });
      }}
    >
      <h3>Scale</h3>
      <p className="drawing-hint">
        {scale
          ? `1 grid square = ${scale.gridValue} ${scale.unit}`
          : 'Dimensions read in grid units (u).'}
      </p>
      <div className="drawing-options">
        <label>
          1 square =
          <input
            aria-label="Grid square size"
            inputMode="decimal"
            value={value}
            placeholder="0.5"
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        <label>
          Unit
          <input
            aria-label="Unit"
            value={unit}
            maxLength={12}
            placeholder="m"
            onChange={(event) => setUnit(event.target.value)}
          />
        </label>
      </div>
      <div className="drawing-actions">
        <button className="drawing-delete" type="submit" disabled={!valid}>
          Apply scale
        </button>
        {scale && (
          <button className="drawing-delete" type="button" onClick={() => onApply(null)}>
            Use grid units
          </button>
        )}
      </div>
    </form>
  );
}
