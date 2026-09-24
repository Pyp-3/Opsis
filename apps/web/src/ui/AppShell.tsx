import { cssVariables, t } from '@opsis/ui';
import { Suspense, lazy, useEffect, useRef, type CSSProperties } from 'react';
import { useSession } from '../state/context';
import { currentOsg, LAST_OSG_STORAGE_KEY } from '../state/session';
import { useReducedMotion } from '../scene/useReducedMotion';
import { Breadcrumbs, ErrorState, Onboarding, Toolbar } from './Chrome';
import { InputBar } from './InputBar';
import { useShortcuts } from './useShortcuts';
import './ui.css';

// three.js and the primitives registry load only with the first diagram (PROMPT.md §12.3).
const SceneViewer = lazy(() => import('../scene/SceneViewer'));
const CanvasEditor = lazy(() => import('../canvas/CanvasEditor'));

/** Moves focus to the diagram title after navigation left focus nowhere (e.g. after Open). */
function useFocusOnNavigate(osgId: string | undefined) {
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (osgId && (document.activeElement === document.body || !document.activeElement))
      title.current?.focus();
  }, [osgId]);
  return title;
}

/** The Opsis single-page app: input, progress, breadcrumbs, toolbar and the diagram. */
export function AppShell() {
  const status = useSession((s) => s.status);
  const osg = useSession(currentOsg);
  const paletteId = useSession((s) => s.paletteId);
  const viewMode = useSession((s) => s.viewMode);
  const systemReduced = useReducedMotion();
  const reduceMotion = useSession((s) => s.reduceMotion) ?? systemReduced;
  const title = useFocusOnNavigate(osg?.id);
  const restoreSaved = useSession((s) => s.restoreSaved);
  useShortcuts();

  useEffect(() => {
    const id = window.localStorage.getItem(LAST_OSG_STORAGE_KEY);
    if (id) restoreSaved(id);
  }, [restoreSaved]);

  return (
    <div
      className={`opsis-app${reduceMotion ? ' opsis-reduce-motion' : ''}`}
      style={cssVariables(paletteId) as CSSProperties}
    >
      <a className="opsis-skip" href="#opsis-diagram">
        {t('app.skipToDiagram')}
      </a>
      <header className="opsis-header">
        <h1>{t('app.title')}</h1>
        <p className="opsis-muted">{t('app.tagline')}</p>
      </header>
      <InputBar />
      <main
        id="opsis-diagram"
        className="opsis-main"
        tabIndex={-1}
        aria-busy={status === 'loading'}
      >
        <ErrorState />
        {osg ? (
          <>
            <Breadcrumbs />
            <h2 ref={title} tabIndex={-1} className="opsis-diagram-title">
              {osg.title}
            </h2>
            <Toolbar systemReducedMotion={systemReduced} />
            <Suspense
              fallback={
                <p className="opsis-loading" role="status">
                  {t(viewMode === '2d' ? 'state.loading2d' : 'state.loading3d')}
                </p>
              }
            >
              {viewMode === '2d' ? (
                <CanvasEditor key={osg.id} osg={osg} />
              ) : (
                <SceneViewer key={osg.id} osg={osg} reducedMotion={reduceMotion} />
              )}
            </Suspense>
          </>
        ) : status === 'idle' || status === 'error' ? (
          <>
            <Toolbar systemReducedMotion={systemReduced} />
            <Onboarding />
          </>
        ) : (
          <div className="opsis-skeleton" aria-hidden="true" />
        )}
      </main>
    </div>
  );
}
