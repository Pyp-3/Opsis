import { cssVariables, type PaletteId } from '@opsis/ui';
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from 'react';
import { loadFixture, type FixtureId } from './fixtures';
import { isExplodable, nodeInfo } from './model';
import { SummaryPanel } from './SummaryPanel';
import { useReducedMotion } from './useReducedMotion';
import './scene.css';

const SceneCanvas = lazy(() => import('./SceneCanvas'));

/** True when a key event comes from a text field, where shortcuts must not fire. */
function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  );
}

/** 3D viewer for a fixture: toolbar, canvas, "diagram as list" outline and summary panel. */
export default function SceneViewer({ fixture }: { fixture: FixtureId }) {
  const osg = useMemo(() => loadFixture(fixture), [fixture]);
  const scene = osg.scenes[0];
  const reducedMotion = useReducedMotion();
  const [exploded, setExploded] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paletteId, setPaletteId] = useState<PaletteId>('default');
  const [fitSignal, setFitSignal] = useState(0);
  const explodable = scene ? isExplodable(scene) : false;

  const toggleExplode = useCallback(() => setExploded((e) => !e), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.toLowerCase() === 'e' && explodable) toggleExplode();
      if (e.key === 'Escape') setSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [explodable, toggleExplode]);

  useEffect(() => {
    document.body.style.cursor = hoveredId ? 'pointer' : '';
  }, [hoveredId]);

  if (!scene) return <p role="alert">This diagram has no scenes.</p>;
  const selected = scene.nodes.find((n) => n.id === selectedId);

  return (
    <section
      className="opsis-viewer"
      aria-label={osg.title}
      style={cssVariables(paletteId) as CSSProperties}
    >
      <div className="opsis-toolbar" role="toolbar" aria-label="Diagram controls">
        {explodable ? (
          <button
            type="button"
            onClick={toggleExplode}
            aria-pressed={exploded}
            aria-keyshortcuts="E"
          >
            {exploded ? 'Assemble' : 'Explode'}
          </button>
        ) : null}
        <button type="button" onClick={() => setFitSignal((n) => n + 1)}>
          Zoom to fit
        </button>
        <label>
          <input
            type="checkbox"
            checked={paletteId === 'colorBlindSafe'}
            onChange={(e) => setPaletteId(e.target.checked ? 'colorBlindSafe' : 'default')}
          />
          Colour-blind-safe colours
        </label>
      </div>
      <div className="opsis-stage">
        <div className="opsis-canvas">
          <Suspense fallback={<p className="opsis-loading">Loading 3D view…</p>}>
            <SceneCanvas
              osg={osg}
              scene={scene}
              exploded={exploded}
              reducedMotion={reducedMotion}
              paletteId={paletteId}
              hoveredId={hoveredId}
              selectedId={selectedId}
              fitSignal={fitSignal}
              onHover={setHoveredId}
              onSelect={setSelectedId}
            />
          </Suspense>
        </div>
        <nav className="opsis-outline" aria-label="Diagram as list">
          <h2>Diagram as list</h2>
          <ul>
            {scene.nodes.map((node) => (
              <li key={node.id}>
                <button
                  type="button"
                  aria-pressed={selectedId === node.id}
                  aria-description={nodeInfo(osg, node).summary}
                  onClick={() => setSelectedId(node.id)}
                  onMouseEnter={() => setHoveredId(node.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  {node.label}
                  {node.optional ? <span className="opsis-badge">optional</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        {selected ? (
          <SummaryPanel info={nodeInfo(osg, selected)} onClose={() => setSelectedId(null)} />
        ) : null}
      </div>
    </section>
  );
}
