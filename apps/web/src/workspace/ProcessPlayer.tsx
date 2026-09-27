import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, SkipBack, SkipForward, Volume2, VolumeX, X } from 'lucide-react';
import type { BoardDocument } from '@opsis/schema';
import { beatDuration, britishVoice, playbackTimeline, type Beat } from './playback';

const SPEEDS = [0.75, 1, 1.25, 1.5] as const;
/** If the platform accepts speech but never starts it (no voices installed), stop waiting. */
const SPEECH_START_TIMEOUT = 2500;

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

/**
 * Plays a board as a short film: a scrubbable timeline of steps, captions for each, and an
 * optional British English narrator. The canvas follows along through `onBeat`.
 */
export function ProcessPlayer({
  board,
  disabled,
  onBeat,
  onClose,
}: {
  board: BoardDocument;
  disabled: boolean;
  onBeat: (beats: Beat[], index: number) => void;
  onClose: () => void;
}) {
  const beats = useMemo(() => playbackTimeline(board), [board]);
  const [position, setPosition] = useState(0);
  const index = Math.min(position, beats.length - 1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [narrate, setNarrate] = useState(false);
  const [voiceName, setVoiceName] = useState('');
  const [speechIssue, setSpeechIssue] = useState('');
  const { synth, british, preferred } = useBritishVoices();
  const voice = british.find((item) => item.name === voiceName) ?? preferred;
  const beat = beats[index]!;
  const last = index >= beats.length - 1;

  const onBeatRef = useRef(onBeat);
  useEffect(() => {
    onBeatRef.current = onBeat;
  }, [onBeat]);
  useEffect(() => onBeatRef.current(beats, index), [beats, index]);

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
    if (narrate && synth) {
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(beat.narration);
      utterance.lang = 'en-GB';
      if (voice) utterance.voice = voice;
      utterance.rate = speed;
      let started = false;
      utterance.onstart = () => {
        started = true;
      };
      utterance.onend = () => advance(450);
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
      if (narrate) synth?.cancel();
    };
  }, [playing, disabled, index, beats, beat.narration, narrate, synth, voice, speed]);

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
          disabled={!synth}
          title={synth ? 'British English narrator' : 'Speech is not supported in this browser'}
          onClick={() => {
            setSpeechIssue('');
            setNarrate(!narrate);
            if (narrate) synth?.cancel();
          }}
        >
          {narrate ? <Volume2 size={16} /> : <VolumeX size={16} />}
          <span>Narrator</span>
        </button>
        <button aria-label="Close player" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      {narrate && (
        <div className="player-voice">
          {british.length > 1 ? (
            <label>
              Voice
              <select
                value={voice?.name ?? ''}
                onChange={(event) => setVoiceName(event.target.value)}
              >
                {british.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span>
              {voice
                ? `Voice: ${voice.name}`
                : 'No British voice is installed; your system voice will read in British English (en-GB) where it can.'}
            </span>
          )}
          {speechIssue && <span role="status">{speechIssue}</span>}
        </div>
      )}
    </section>
  );
}
