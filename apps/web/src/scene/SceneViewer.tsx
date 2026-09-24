import type { OSG } from '@opsis/schema';
import { t } from '@opsis/ui';
import { Suspense, lazy, useEffect, useState } from 'react';
import { useSession } from '../state/context';
import { Outline } from '../ui/Outline';
import { SidePanel } from '../ui/SidePanel';
import { nodeInfo } from './model';
import './scene.css';

const SceneCanvas = lazy(() => import('./SceneCanvas'));

/** 3D viewer for one OSG: canvas, "Diagram as list" outline and side panel. */
export default function SceneViewer({ osg, reducedMotion }: { osg: OSG; reducedMotion: boolean }) {
  const scene = osg.scenes[0];
  const exploded = useSession((s) => s.exploded);
  const selectedId = useSession((s) => s.selectedId);
  const paletteId = useSession((s) => s.paletteId);
  const fitSignal = useSession((s) => s.fitSignal);
  const select = useSession((s) => s.select);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  useEffect(() => {
    document.body.style.cursor = hoveredId ? 'pointer' : '';
  }, [hoveredId]);

  if (!scene) return <p role="alert">{t('state.noScenes')}</p>;
  const selected = scene.nodes.find((n) => n.id === selectedId);

  return (
    <section className="opsis-viewer" aria-label={osg.title}>
      <div className="opsis-stage">
        <div className="opsis-canvas">
          <Suspense
            fallback={
              <p className="opsis-loading" role="status">
                {t('state.loading3d')}
              </p>
            }
          >
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
              onSelect={(id) => select(id)}
            />
          </Suspense>
          {selected ? <SidePanel node={selected} info={nodeInfo(osg, selected)} /> : null}
        </div>
        <Outline
          osg={osg}
          scene={scene}
          selectedId={selectedId}
          onSelect={(id, tab) => select(id, tab)}
          onHover={setHoveredId}
        />
      </div>
    </section>
  );
}
