import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { BoardDocument } from '@opsis/schema';
import { beatDuration, britishVoice, PACE, playbackTimeline, type Beat } from './playback';
import {
  NATURAL_VOICES,
  naturalNarrator,
  naturalVoicesSupported,
  sentences,
  type NaturalState,
} from './narrator';

export const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;
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
export const rememberVoice = (value: string) => {
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

/**
 * The timeline only changes when what is told changes. Drawings arriving mid-playback update
 * the board, and must not restart the step being spoken.
 */
function useTimeline(board: BoardDocument) {
  const told = useMemo(() => JSON.stringify(playbackTimeline(board)), [board]);
  return useMemo(() => JSON.parse(told) as Beat[], [told]);
}

/** Owns playback timing, narration resources, and keyboard subscriptions. */
export function useProcessPlayback(
  board: BoardDocument,
  disabled: boolean,
  onBeat: (beats: Beat[], index: number) => void,
) {
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
  const toggle = () => {
    setSpeechIssue('');
    if (!playing && last) setPosition(0);
    setPlaying(!playing);
  };
  // Player shortcuts: Space or K plays and pauses, arrows or J/L step, Home/End jump.
  const keys = useRef({ toggle, go, index, last: beats.length - 1, disabled });
  useEffect(() => {
    keys.current = { toggle, go, index, last: beats.length - 1, disabled };
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const { toggle, go, index, last, disabled } = keys.current;
      if (disabled || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey)
        return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      // Leave typing, native controls and focused canvas items (which move with arrows) alone.
      if (target?.closest('input,textarea,select,[contenteditable],.react-flow__node')) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      // Space and Enter already press a focused button.
      if (target?.closest('button,summary,a') && (key === ' ' || key === 'Enter')) return;
      const action = (
        {
          ' ': toggle,
          k: toggle,
          ArrowLeft: () => go(index - 1),
          j: () => go(index - 1),
          ArrowRight: () => go(index + 1),
          l: () => go(index + 1),
          Home: () => go(0),
          End: () => go(last),
        } as Record<string, () => void>
      )[key];
      if (!action) return;
      event.preventDefault();
      action();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return {
    beats,
    index,
    playing,
    speed,
    setSpeed,
    narrate,
    setNarrate,
    voiceChoice,
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
  };
}
