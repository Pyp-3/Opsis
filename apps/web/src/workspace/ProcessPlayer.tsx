import { useProcessPlayback, SPEEDS, rememberVoice } from './useProcessPlayback';
import {
  Brush,
  LoaderCircle,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { BoardDocument } from '@opsis/schema';
import { AgentActivity } from './AgentActivityView';
import type { AgentActivity as AgentActivityState } from './agentActivity';
import { ProcessDataView } from './ProcessDataView';
import type { ProcessState } from './useProcessEngine';
import type { Beat } from './playback';
import { NATURAL_VOICES } from './narrator';

const MAX_TICKS = 40;

/** The agent drawing illustrations the icons evolve into; it runs alongside playback. */
export type IllustrationControl = {
  busy: boolean;
  elapsed: number;
  message: string;
  activity: AgentActivityState;
  available: boolean;
  /** Every object already has a drawing, so asking again redraws them all. */
  redraw: boolean;
  onIllustrate: () => void;
};

/**
 * Plays a board as a short film: a scrubbable timeline of steps, captions for each, and an
 * optional British English narrator. The canvas follows along through `onBeat`.
 */
export function ProcessPlayer({
  board,
  disabled,
  onBeat,
  onClose,
  illustration,
  process,
}: {
  board: BoardDocument;
  disabled: boolean;
  onBeat: (beats: Beat[], index: number) => void;
  onClose: () => void;
  illustration?: IllustrationControl;
  process?: ProcessState;
}) {
  const {
    beats,
    index,
    playing,
    speed,
    setSpeed,
    narrate,
    setNarrate,
    setVoiceChoice,
    speechIssue,
    setSpeechIssue,
    preparing,
    synth,
    british,
    naturalSupported,
    natural,
    naturalVoice,
    voice,
    engine,
    beat,
    last,
    go,
    toggle,
  } = useProcessPlayback(board, disabled, onBeat);
  const sample = process?.results.get(
    beat.nodeId ?? board.nodes.find((node) => node.process?.op === 'source')?.id ?? '',
  );
  const sampleNode = sample && board.nodes.find((node) => node.id === sample.id);
  const failure = beat.nodeId ? process?.failures.get(beat.nodeId) : undefined;

  const ratio = index / Math.max(1, beats.length - 1);
  const voiceOptions =
    (naturalSupported && natural.status !== 'failed' ? NATURAL_VOICES.length : 0) + british.length;
  return (
    <section className="process-player" aria-label="Process player">
      <p className="player-caption" aria-live={playing ? 'off' : 'polite'}>
        <span className="player-caption-body" key={beat.id}>
          <strong>{beat.title}</strong>
          <span>{beat.narration}</span>
        </span>
      </p>
      {sample && (
        <ProcessDataView
          key={beat.id}
          result={sample}
          command={sampleNode?.terminal?.command ?? sampleNode?.label ?? 'Sample data'}
          animate={playing && !disabled}
        />
      )}
      {process?.status === 'calculating' && (
        <p className="player-data-status" role="status">
          Calculating sample…
        </p>
      )}
      {process?.status === 'failed' && (
        <p className="player-data-status" role="status">
          {process.message}
        </p>
      )}
      {failure && (
        <p className="player-data-status" role="status">
          {failure.error.message}
        </p>
      )}
      <div className="player-controls">
        <div className="player-transport">
          <button
            aria-label="Previous step"
            aria-keyshortcuts="ArrowLeft J"
            title="Previous step (←)"
            disabled={disabled || index === 0}
            onClick={() => go(index - 1)}
          >
            <SkipBack size={16} />
          </button>
          <button
            className="player-play"
            aria-label={playing ? 'Pause' : last ? 'Replay' : 'Play'}
            aria-keyshortcuts="Space K"
            title={`${playing ? 'Pause' : last ? 'Replay' : 'Play'} (Space)`}
            disabled={disabled}
            onClick={toggle}
          >
            {playing ? (
              <Pause size={18} fill="currentColor" />
            ) : (
              <Play size={18} fill="currentColor" className="player-play-icon" />
            )}
          </button>
          <button
            aria-label="Next step"
            aria-keyshortcuts="ArrowRight L"
            title="Next step (→)"
            disabled={disabled || last}
            onClick={() => go(index + 1)}
          >
            <SkipForward size={16} />
          </button>
        </div>
        <div className="player-timeline">
          <div className="player-track" style={{ ['--ratio' as string]: ratio }}>
            <div className="player-track-inner" aria-hidden>
              <span className="player-track-rail">
                <span className="player-track-fill" />
              </span>
              {beats.length <= MAX_TICKS &&
                beats.map((item, at) => (
                  <span
                    key={item.id}
                    className={`player-track-tick ${at <= index ? 'is-reached' : ''}`}
                    style={{ left: `${(at / Math.max(1, beats.length - 1)) * 100}%` }}
                  />
                ))}
              <span className="player-track-thumb" />
            </div>
            <input
              className="player-scrubber"
              type="range"
              min={0}
              max={beats.length - 1}
              step={1}
              value={index}
              disabled={disabled}
              aria-label="Process timeline"
              aria-valuetext={`Step ${index + 1} of ${beats.length}: ${beat.title}`}
              onChange={(event) => go(Number(event.target.value))}
            />
          </div>
          <span className="player-count" aria-hidden>
            {index + 1} / {beats.length}
          </span>
        </div>
        <div className="player-options">
          <label className="player-speed">
            <span className="sr-only">Playback speed</span>
            <select
              value={speed}
              onChange={(event) => setSpeed(Number(event.target.value) as (typeof SPEEDS)[number])}
            >
              {SPEEDS.map((value) => (
                <option key={value} value={value}>
                  {value}×
                </option>
              ))}
            </select>
          </label>
          <button
            className="player-narrator"
            aria-pressed={narrate}
            disabled={!synth && !naturalSupported}
            title={
              synth || naturalSupported
                ? 'British English narrator'
                : 'Speech is not supported in this browser'
            }
            onClick={() => {
              setSpeechIssue('');
              setNarrate(!narrate);
              if (narrate && engine === 'system') synth?.cancel();
            }}
          >
            {narrate ? <Volume2 size={16} /> : <VolumeX size={16} />}
            <span>Narrator</span>
          </button>
          {illustration && (
            <button
              className="player-illustrate"
              aria-busy={illustration.busy}
              disabled={disabled || illustration.busy || !illustration.available}
              title={
                illustration.available
                  ? 'Ask the agent to draw animated illustrations that the icons evolve into (uses the selected model)'
                  : 'The selected agent is unavailable'
              }
              onClick={illustration.onIllustrate}
            >
              {illustration.busy ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Brush size={16} />
              )}
              <span>
                {illustration.busy
                  ? `Drawing… ${illustration.elapsed}s`
                  : illustration.redraw
                    ? 'Redraw'
                    : 'Illustrate'}
              </span>
            </button>
          )}
        </div>
        <button
          className="player-close"
          aria-label="Close player"
          title="Close player"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>
      {illustration?.busy && (
        <AgentActivity
          activity={illustration.activity}
          elapsed={illustration.elapsed}
          agent="The illustrator"
        />
      )}
      {illustration?.message && !illustration.busy && (
        <p className="player-illustration-status" role="status">
          {illustration.message}
        </p>
      )}
      {narrate && (
        <div className="player-voice">
          {voiceOptions > 1 ? (
            <label>
              Voice
              <select
                value={
                  engine === 'natural' && naturalVoice
                    ? `natural:${naturalVoice.id}`
                    : voice
                      ? `system:${voice.name}`
                      : ''
                }
                onChange={(event) => {
                  setSpeechIssue('');
                  setVoiceChoice(event.target.value);
                  rememberVoice(event.target.value);
                }}
              >
                {naturalSupported && natural.status !== 'failed' && (
                  <optgroup label="Natural voices (one-time download)">
                    {NATURAL_VOICES.map((item) => (
                      <option key={item.id} value={`natural:${item.id}`}>
                        {item.name} — natural British
                      </option>
                    ))}
                  </optgroup>
                )}
                {british.length > 0 && (
                  <optgroup label="This device">
                    {british.map((item) => (
                      <option key={item.name} value={`system:${item.name}`}>
                        {item.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
          ) : (
            <span>
              {voice
                ? `Voice: ${voice.name}`
                : 'No British voice is installed; your system voice will read in British English (en-GB) where it can.'}
            </span>
          )}
          {engine === 'natural' && natural.status === 'loading' ? (
            <span role="status">
              Downloading the natural voice (one time)
              {natural.progress !== null ? `… ${Math.round(natural.progress * 100)}%` : '…'}
            </span>
          ) : engine === 'natural' && preparing ? (
            <span role="status">Preparing narration…</span>
          ) : naturalVoice && natural.status === 'failed' ? (
            <span role="status">
              The natural voice could not load, so your device voice is reading instead.
            </span>
          ) : (
            speechIssue && <span role="status">{speechIssue}</span>
          )}
        </div>
      )}
    </section>
  );
}
