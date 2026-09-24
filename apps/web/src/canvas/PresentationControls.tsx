import { t } from '@opsis/ui';
import type { PresentationStep } from './presentation';

type Props = {
  active: boolean;
  playing: boolean;
  stepIndex: number;
  steps: readonly PresentationStep[];
  onEnter: () => void;
  onExit: () => void;
  onPlayPause: () => void;
  onReplay: () => void;
  onStep: (index: number) => void;
};

/** Keyboard- and screen-reader-accessible controls for the derived presentation timeline. */
export function PresentationControls(props: Props) {
  if (!props.active) {
    return (
      <button type="button" onClick={props.onEnter} disabled={props.steps.length === 0}>
        {t('canvas.present')}
      </button>
    );
  }

  const step = props.steps[props.stepIndex];
  const finalStep = props.stepIndex >= props.steps.length - 1;
  return (
    <div
      className="opsis-presentation-controls"
      role="group"
      aria-label={t('canvas.presentationControls')}
    >
      <button
        type="button"
        onClick={() => props.onStep(props.stepIndex - 1)}
        disabled={props.stepIndex === 0}
        aria-label={t('canvas.previousStep')}
      >
        ←
      </button>
      <button
        type="button"
        onClick={props.onPlayPause}
        aria-label={t(props.playing ? 'canvas.pause' : 'canvas.play')}
      >
        {t(props.playing ? 'canvas.pause' : 'canvas.play')}
      </button>
      <button type="button" onClick={props.onReplay} aria-label={t('canvas.replay')}>
        {t('canvas.replay')}
      </button>
      <label className="opsis-presentation-controls__scrubber">
        <span className="opsis-visually-hidden">{t('canvas.scrub')}</span>
        <input
          type="range"
          min={0}
          max={Math.max(0, props.steps.length - 1)}
          step={1}
          value={props.stepIndex}
          onChange={(event) => props.onStep(Number(event.currentTarget.value))}
          aria-valuetext={step?.description}
        />
      </label>
      <output className="opsis-presentation-controls__status" aria-live="polite">
        {step?.title} · {props.stepIndex + 1}/{props.steps.length}
      </output>
      <button
        type="button"
        onClick={() => props.onStep(props.stepIndex + 1)}
        disabled={finalStep}
        aria-label={t('canvas.nextStep')}
      >
        →
      </button>
      <button type="button" onClick={props.onExit}>
        {t('canvas.exitPresentation')}
      </button>
    </div>
  );
}
