import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
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
import { beatDuration, britishVoice, PACE, playbackTimeline, type Beat } from './playback';
import {
  NATURAL_VOICES,
  naturalNarrator,
  naturalVoicesSupported,
  sentences,
  type NaturalState,
} from './narrator';

const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;
/** If the platform accepts speech but never starts it (no voices installed), stop waiting. */
const SPEECH_START_TIMEOUT = 2500;
/** A short breath between spoken steps. */
const SPEECH_GAP = 300;
const VOICE_KEY = 'opsis:narrator-voice';
/** How many steps ahead the natural voice prepares. */
const LOOK_AHEAD = 4;
const IDLE: NaturalState = { status: 'idle' };

const readVoice = () => {
  try {
    return localStorage.getItem(VOICE_KEY) ?? '';
  } catch {
    return '';
  }
};
const rememberVoice = (value: string) => {
  try {
    localStorage.setItem(VOICE_KEY, value);
  } catch {
    // Remembering the voice is a convenience; the player works without it.
  }
};

function useNaturalState(enabled: boolean) {
  return useSyncExternalStore(
    (listener) => (enabled ? naturalNarrator().subscribe(listener) : () => undefined),
    () => (enabled ? naturalNarrator().state : IDLE),
  );
}

function useBritishVoices() {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => synth?.getVoices() ?? []);
  useEffect(() => {
    if (!synth) return;
    const update = () => setVoices(synth.getVoices());
    synth.addEventListener?.('voiceschanged', update);
    return () => synth.removeEventListener?.('voiceschanged', update);
  }, [synth]);
  const british = useMemo(() => voices.filter((voice) => /^en[-_]GB$/i.test(voice.lang)), [voices]);
  return { synth, british, preferred: britishVoice(voices) };
}

/** The agent drawing illustrations the icons evolve into; it runs alongside playback. */
export type IllustrationControl = {
  busy: boolean;
  elapsed: number;
  message: string;
  available: boolean;
  /** Every object already has a drawing, so asking again redraws them all. */
  redraw: boolean;
  onIllustrate: () => void;
};

/**
 * The timeline only changes when what is told changes. Drawings arriving mid-playback update
 * the board, and must not restart the step being spoken.
 */
function useTimeline(board: BoardDocument) {
  const told = useMemo(() => JSON.stringify(playbackTimeline(board)), [board]);
  return useMemo(() => JSON.parse(told) as Beat[], [told]);
}

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
}: {
  board: BoardDocument;
  disabled: boolean;
  onBeat: (beats: Beat[], index: number) => void;
  onClose: () => void;
  illustration?: IllustrationControl;
}) {
  const beats = useTimeline(board);
  const [position, setPosition] = useState(0);
  const index = Math.min(position, beats.length - 1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [narrate, setNarrate] = useState(false);
  const [voiceChoice, setVoiceChoice] = useState(readVoice);
  const [speechIssue, setSpeechIssue] = useState('');
  const [preparing, setPreparing] = useState(false);
  const { synth, british, preferred } = useBritishVoices();
  const [naturalSupported] = useState(naturalVoicesSupported);
  const natural = useNaturalState(naturalSupported);
  // Choices are "natural:<kokoro id>" or "system:<voice name>"; natural voices lead when they
  // can run, as they sound far more human than the platform's speech synthesis.
  const naturalVoice =
    NATURAL_VOICES.find((item) => `natural:${item.id}` === voiceChoice) ??
    (naturalSupported && !voiceChoice.startsWith('system:') ? NATURAL_VOICES[0] : null);
  const voice = british.find((item) => `system:${item.name}` === voiceChoice) ?? preferred;
  const engine = !narrate
    ? 'off'
    : naturalVoice && natural.status !== 'failed'
      ? 'natural'
      : synth
        ? 'system'
        : 'off';
  const beat = beats[index]!;
  const last = index >= beats.length - 1;

  const onBeatRef = useRef(onBeat);
  useEffect(() => {
    onBeatRef.current = onBeat;
  }, [onBeat]);
  useEffect(() => onBeatRef.current(beats, index), [beats, index]);

  useEffect(() => {
    if (engine !== 'natural' || !naturalVoice) return;
    const narrator = naturalNarrator();
    narrator.load();
    // Prepare the coming steps in the background, so playback rarely waits for the voice.
    for (const next of beats.slice(index, index + LOOK_AHEAD))
      for (const part of sentences(next.narration))
        narrator.speak(part, naturalVoice.id, false).catch(() => undefined);
  }, [engine, naturalVoice, beats, index]);

  useEffect(() => {
    if (!playing || disabled) return;
    let finished = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const advance = (delay: number) =>
      timers.push(
        setTimeout(() => {
          if (finished) return;
          finished = true;
          if (index >= beats.length - 1) setPlaying(false);
          else setPosition(index + 1);
        }, delay),
      );
    const silent = () => advance(beatDuration(beat.narration, speed));
    let audio: HTMLAudioElement | null = null;
    if (engine === 'natural' && naturalVoice) {
      const narrator = naturalNarrator();
      const fallBack = (message: string) => {
        if (finished) return;
        setPreparing(false);
        setSpeechIssue(message);
        silent();
      };
      // Sentence by sentence: each plays as soon as it is ready while the next is made.
      const parts = sentences(beat.narration);
      const say = (part: number) => {
        if (part >= parts.length) return advance(SPEECH_GAP);
        setPreparing(true);
        narrator.speak(parts[part]!, naturalVoice.id).then(
          (url) => {
            if (finished) return;
            setPreparing(false);
            audio = new Audio(url);
            audio.playbackRate = speed * PACE.natural;
            audio.preservesPitch = true;
            audio.onended = () => say(part + 1);
            audio.onerror = () =>
              fallBack('The natural voice stopped unexpectedly; continuing with captions.');
            audio.play().catch(() => fallBack('Audio could not play; continuing with captions.'));
          },
          () => fallBack('The natural voice could not speak this step; continuing with captions.'),
        );
        // Ask for the rest of this step straight after, ahead of the look-ahead queue.
        for (const rest of parts.slice(part + 1))
          narrator.speak(rest, naturalVoice.id).catch(() => undefined);
      };
      say(0);
    } else if (engine === 'system' && synth) {
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(beat.narration);
      utterance.lang = 'en-GB';
      if (voice) utterance.voice = voice;
      utterance.rate = speed * PACE.system;
      let started = false;
      utterance.onstart = () => {
        started = true;
      };
      utterance.onend = () => advance(SPEECH_GAP);
      utterance.onerror = (event) => {
        if (finished || event.error === 'interrupted' || event.error === 'canceled') return;
        setSpeechIssue('The narrator stopped unexpectedly; continuing with captions.');
        silent();
      };
      synth.speak(utterance);
      timers.push(
        setTimeout(() => {
          if (started || finished) return;
          setSpeechIssue('No speech voice responded; continuing with captions only.');
          synth.cancel();
          silent();
        }, SPEECH_START_TIMEOUT),
      );
    } else silent();
    return () => {
      finished = true;
      timers.forEach(clearTimeout);
      audio?.pause();
      setPreparing(false);
      if (engine === 'system') synth?.cancel();
    };
  }, [playing, disabled, index, beats, beat.narration, engine, naturalVoice, synth, voice, speed]);

  useEffect(() => () => synth?.cancel(), [synth]);

  const go = (next: number) => setPosition(Math.max(0, Math.min(beats.length - 1, next)));
  return (
    <section className="process-player" aria-label="Process player">
      <p className="player-caption" aria-live={playing ? 'off' : 'polite'}>
        <strong>{beat.title}</strong>
        <span>{beat.narration}</span>
      </p>
      <div className="player-controls">
        <button
          aria-label="Previous step"
          disabled={disabled || index === 0}
          onClick={() => go(index - 1)}
        >
          <SkipBack size={16} />
        </button>
        <button
          className="player-play"
          aria-label={playing ? 'Pause' : last ? 'Replay' : 'Play'}
          disabled={disabled}
          onClick={() => {
            setSpeechIssue('');
            if (!playing && last) setPosition(0);
            setPlaying(!playing);
          }}
        >
          {playing ? (
            <Pause size={18} fill="currentColor" />
          ) : (
            <Play size={18} fill="currentColor" />
          )}
        </button>
        <button aria-label="Next step" disabled={disabled || last} onClick={() => go(index + 1)}>
          <SkipForward size={16} />
        </button>
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
          style={{ ['--progress' as string]: `${(index / Math.max(1, beats.length - 1)) * 100}%` }}
          onChange={(event) => go(Number(event.target.value))}
        />
        <span className="player-count">
          {index + 1} / {beats.length}
        </span>
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
            {illustration.busy ? <LoaderCircle size={16} className="spin" /> : <Brush size={16} />}
            <span>
              {illustration.busy
                ? `Drawing… ${illustration.elapsed}s`
                : illustration.redraw
                  ? 'Redraw'
                  : 'Illustrate'}
            </span>
          </button>
        )}
        <button aria-label="Close player" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      {illustration?.message && !illustration.busy && (
        <p className="player-illustration-status" role="status">
          {illustration.message}
        </p>
      )}
      {narrate && (
        <div className="player-voice">
          {naturalSupported || british.length > 1 ? (
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
