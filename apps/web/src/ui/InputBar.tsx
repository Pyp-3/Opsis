import { t } from '@opsis/ui';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { useSession } from '../state/context';

/** Maximum utterance length accepted by `/v1/visualize` in the MVP (PROMPT.md §11). */
export const MAX_UTTERANCE = 500;
/** Progress appears only for requests slower than this (PROMPT.md §12.3). */
export const PROGRESS_DELAY_MS = 300;

const STAGES = ['parsing', 'mapping', 'layout'] as const;

/** Pipeline progress, shown once a request has taken longer than `PROGRESS_DELAY_MS`. */
export function ProgressDisplay() {
  const loading = useSession((s) => s.status === 'loading');
  const stage = useSession((s) => s.stage);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => setVisible(true), PROGRESS_DELAY_MS);
    return () => {
      clearTimeout(timer);
      setVisible(false);
    };
  }, [loading]);

  if (!loading || !visible) return null;
  const active = stage === null ? -1 : STAGES.indexOf(stage as (typeof STAGES)[number]);
  const current = stage && stage !== 'done' ? t(`progress.${stage}`) : t('progress.label');
  return (
    <div className="opsis-progress">
      <p role="status" className="opsis-progress__status">
        {current}…
      </p>
      {stage ? (
        <ol aria-label={t('progress.label')}>
          {STAGES.map((step, i) => {
            const state =
              stage === 'done' || i < active ? 'done' : i === active ? 'active' : 'pending';
            const status =
              state === 'done'
                ? t('progress.stepDone')
                : state === 'active'
                  ? t('progress.stepActive')
                  : t('progress.stepPending');
            return (
              <li
                key={step}
                className={`opsis-progress__step opsis-progress__step--${state}`}
                aria-current={state === 'active' ? 'step' : undefined}
              >
                <span aria-hidden="true">
                  {state === 'done' ? '✓' : state === 'active' ? '●' : '○'}
                </span>{' '}
                {t(`progress.${step}`)} <span className="opsis-visually-hidden">({status})</span>
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}

/** Sentence input with validation, submit/cancel and progress. */
export function InputBar() {
  const draft = useSession((s) => s.draft);
  const setDraft = useSession((s) => s.setDraft);
  const submit = useSession((s) => s.submit);
  const cancel = useSession((s) => s.cancel);
  const loading = useSession((s) => s.status === 'loading');
  const [problem, setProblem] = useState<string | null>(null);
  const inputId = useId();
  const hintId = useId();
  const problemId = useId();

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (text === '') return setProblem(t('input.empty'));
    if (text.length > MAX_UTTERANCE) return setProblem(t('input.tooLong', { max: MAX_UTTERANCE }));
    setProblem(null);
    submit(text);
  };

  return (
    <form className="opsis-input" onSubmit={onSubmit} aria-label={t('input.region')}>
      <label htmlFor={inputId}>{t('input.label')}</label>
      <div className="opsis-input__row">
        <input
          id={inputId}
          type="text"
          value={draft}
          placeholder={t('input.placeholder')}
          autoComplete="off"
          spellCheck
          aria-invalid={problem !== null}
          aria-describedby={problem ? `${problemId} ${hintId}` : hintId}
          onChange={(e) => {
            setDraft(e.target.value);
            if (problem) setProblem(null);
          }}
        />
        <button type="submit" className="opsis-primary" disabled={loading}>
          {t('input.submit')}
        </button>
        {loading ? (
          <button type="button" onClick={cancel}>
            {t('input.cancel')}
          </button>
        ) : null}
      </div>
      <p id={hintId} className="opsis-input__hint">
        {t('input.counter', { count: draft.length, max: MAX_UTTERANCE })}
      </p>
      {problem ? (
        <p id={problemId} className="opsis-input__problem" role="alert">
          {problem}
        </p>
      ) : null}
      <ProgressDisplay />
    </form>
  );
}
