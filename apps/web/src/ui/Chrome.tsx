import { t } from '@opsis/ui';
import { useId } from 'react';
import { ExportControls } from '../canvas/ExportControls';
import { useSession } from '../state/context';
import { breadcrumbsFor, currentOsg, sceneExplodable, type Audience } from '../state/session';

/** The five onboarding sentences (PROMPT.md §13 M5). The first two are the North Star. */
export const SAMPLE_SENTENCES = [
  'The sun rises in the east.',
  'A sandwich can contain bread, tomato, ham.',
  'Water evaporates, forms clouds, and falls as rain.',
  'A cat is a mammal, and a mammal is an animal.',
  'Plants use sunlight, water and carbon dioxide to make sugar and oxygen.',
] as const;

/** Empty state: what Opsis does, five samples to try and the keyboard shortcuts. */
export function Onboarding() {
  const submit = useSession((s) => s.submit);
  const headingId = useId();
  return (
    <section className="opsis-onboarding" aria-labelledby={headingId}>
      <h2 id={headingId}>{t('onboarding.title')}</h2>
      <p>{t('onboarding.body')}</p>
      <ul className="opsis-samples">
        {SAMPLE_SENTENCES.map((sentence) => (
          <li key={sentence}>
            <button type="button" onClick={() => submit(sentence)}>
              {sentence}
            </button>
          </li>
        ))}
      </ul>
      <p className="opsis-muted">{t('onboarding.keys')}</p>
    </section>
  );
}

/** Error state with "Try again" when the API says the failure is retryable. */
export function ErrorState() {
  const error = useSession((s) => s.error);
  const retry = useSession((s) => s.retry);
  const dismiss = useSession((s) => s.dismissError);
  if (!error) return null;
  return (
    <div className="opsis-error" role="alert">
      <p>
        <strong>{t('state.error')}.</strong> {error.message}
      </p>
      <div className="opsis-error__actions">
        {error.retryable && retry ? (
          <button type="button" className="opsis-primary" onClick={retry}>
            {t('state.retry')}
          </button>
        ) : null}
        <button type="button" onClick={dismiss}>
          {t('state.dismiss')}
        </button>
      </div>
    </div>
  );
}

/** Drill-down path; every crumb but the current one goes back (Backspace goes up one). */
export function Breadcrumbs() {
  const osg = useSession(currentOsg);
  const goTo = useSession((s) => s.goTo);
  const crumbs = osg ? breadcrumbsFor(osg) : [];
  // A lone root crumb would only repeat the diagram title.
  if (crumbs.length < 2) return null;
  return (
    <nav className="opsis-breadcrumbs" aria-label={t('breadcrumbs.label')}>
      <ol>
        {crumbs.map((crumb, i) => (
          <li key={`${crumb.id}-${i}`}>
            {i === crumbs.length - 1 ? (
              <span aria-current="page">{crumb.label}</span>
            ) : (
              <button
                type="button"
                onClick={() => goTo(i)}
                aria-keyshortcuts={i === crumbs.length - 2 ? 'Backspace' : undefined}
              >
                {crumb.label}
              </button>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

const AUDIENCES: Audience[] = ['child', 'teen', 'adult'];

/** Diagram toolbar: explode, fit, view mode, export, reading level and display options. */
export function Toolbar({ systemReducedMotion }: { systemReducedMotion: boolean }) {
  const osg = useSession(currentOsg);
  const exploded = useSession((s) => s.exploded);
  const toggleExplode = useSession((s) => s.toggleExplode);
  const zoomToFit = useSession((s) => s.zoomToFit);
  const audience = useSession((s) => s.audience);
  const setAudience = useSession((s) => s.setAudience);
  const paletteId = useSession((s) => s.paletteId);
  const setPaletteId = useSession((s) => s.setPaletteId);
  const reduceMotion = useSession((s) => s.reduceMotion) ?? systemReducedMotion;
  const setReduceMotion = useSession((s) => s.setReduceMotion);
  const viewMode = useSession((s) => s.viewMode);
  const setViewMode = useSession((s) => s.setViewMode);
  const levelId = useId();
  const explodable = sceneExplodable(osg?.scenes[0]);

  return (
    <div className="opsis-toolbar" role="toolbar" aria-label={t('toolbar.label')}>
      {osg ? (
        <>
          {explodable ? (
            <button
              type="button"
              onClick={toggleExplode}
              aria-pressed={exploded}
              aria-keyshortcuts="E"
            >
              {exploded ? t('toolbar.assemble') : t('toolbar.explode')}
            </button>
          ) : null}
          <button type="button" onClick={zoomToFit}>
            {t('toolbar.zoomToFit')}
          </button>
          <span role="group" aria-label={t('toolbar.viewLabel')} className="opsis-segmented">
            <button
              type="button"
              aria-pressed={viewMode === '3d'}
              onClick={() => setViewMode('3d')}
            >
              {t('toolbar.view3d')}
            </button>
            <button
              type="button"
              aria-pressed={viewMode === '2d'}
              onClick={() => setViewMode('2d')}
            >
              {t('toolbar.view2d')}
            </button>
          </span>
          <ExportControls osg={osg} />
        </>
      ) : null}
      <span className="opsis-toolbar__field">
        <label htmlFor={levelId}>{t('toolbar.readingLevel')}</label>
        <select
          id={levelId}
          value={audience}
          onChange={(e) => setAudience(e.target.value as Audience)}
        >
          {AUDIENCES.map((a) => (
            <option key={a} value={a}>
              {t(`audience.${a}`)}
            </option>
          ))}
        </select>
      </span>
      <label className="opsis-toolbar__field">
        <input
          type="checkbox"
          checked={paletteId === 'colorBlindSafe'}
          onChange={(e) => setPaletteId(e.target.checked ? 'colorBlindSafe' : 'default')}
        />
        {t('toolbar.colorBlind')}
      </label>
      <label className="opsis-toolbar__field">
        <input
          type="checkbox"
          checked={reduceMotion}
          onChange={(e) => setReduceMotion(e.target.checked)}
        />
        {t('toolbar.reduceMotion')}
      </label>
    </div>
  );
}
