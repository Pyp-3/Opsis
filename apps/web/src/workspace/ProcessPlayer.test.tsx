// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DNS_DEMO, EMAIL_DEMO, type BoardDocument, type BoardGraph } from '@opsis/schema';
import { ProcessPlayer } from './ProcessPlayer';
import { playbackTimeline } from './playback';

const doc = (graph: BoardGraph): BoardDocument => ({
  ...graph,
  version: 2,
  agent: 'demo',
  positions: Object.fromEntries(graph.nodes.map((node, i) => [node.id, { x: 0, y: i * 200 }])),
});

type FakeUtterance = {
  text: string;
  lang: string;
  voice: SpeechSynthesisVoice | null;
  rate: number;
  onstart?: () => void;
  onend?: () => void;
  onerror?: (event: { error: string }) => void;
};
/** A speech engine that records requests; tests decide when speech starts and ends. */
function fakeSpeech(voices: Partial<SpeechSynthesisVoice>[]) {
  const spoken: FakeUtterance[] = [];
  let current: FakeUtterance | null = null;
  const synth = Object.assign(new EventTarget(), {
    getVoices: () => voices as SpeechSynthesisVoice[],
    speak: vi.fn((u: FakeUtterance) => {
      current = u;
      spoken.push(u);
    }),
    cancel: vi.fn(() => {
      const u = current;
      current = null;
      u?.onerror?.({ error: 'interrupted' });
    }),
  });
  vi.stubGlobal('speechSynthesis', synth);
  vi.stubGlobal(
    'SpeechSynthesisUtterance',
    class {
      lang = '';
      voice = null;
      rate = 1;
      constructor(public text: string) {}
    },
  );
  return {
    synth,
    spoken,
    start: () => act(() => current?.onstart?.()),
    finish: () =>
      act(() => {
        const u = current;
        current = null;
        u?.onstart?.();
        u?.onend?.();
      }),
    fail: () =>
      act(() => {
        const u = current;
        current = null;
        u?.onerror?.({ error: 'synthesis-failed' });
      }),
  };
}
const BRITISH = [
  { name: 'Google US English', lang: 'en-US', localService: false },
  { name: 'Google UK English Female', lang: 'en-GB', localService: false },
  { name: 'Google UK English Male', lang: 'en-GB', localService: false },
];

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const setup = (graph: BoardGraph = DNS_DEMO) => {
  const onBeat = vi.fn();
  const onClose = vi.fn();
  const board = doc(graph);
  render(<ProcessPlayer board={board} disabled={false} onBeat={onBeat} onClose={onClose} />);
  const slider = screen.getByRole('slider', { name: 'Process timeline' }) as HTMLInputElement;
  return { onBeat, onClose, slider, beats: playbackTimeline(board) };
};

describe('process player', () => {
  it('scrubs to any step and keeps captions, count and canvas in sync', () => {
    fakeSpeech(BRITISH);
    const { slider, onBeat, beats } = setup();
    expect(slider.max).toBe(String(beats.length - 1));
    expect(onBeat).toHaveBeenLastCalledWith(beats, 0);
    fireEvent.change(slider, { target: { value: '4' } });
    expect(onBeat).toHaveBeenLastCalledWith(beats, 4);
    expect(slider.getAttribute('aria-valuetext')).toBe(
      `Step 5 of ${beats.length}: ${beats[4]!.title}`,
    );
    expect(screen.getByText(beats[4]!.narration)).toBeDefined();
    expect(screen.getByText(`5 / ${beats.length}`)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
    expect(onBeat).toHaveBeenLastCalledWith(beats, 5);
    fireEvent.click(screen.getByRole('button', { name: 'Previous step' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous step' }));
    expect(onBeat).toHaveBeenLastCalledWith(beats, 3);
  });

  it('plays silently like a video, reaches the end and offers a replay', () => {
    const speech = fakeSpeech(BRITISH);
    const { slider, beats } = setup(EMAIL_DEMO);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    for (let i = 1; i < beats.length; i++) {
      act(() => vi.advanceTimersByTime(20000));
      expect(slider.value).toBe(String(i));
    }
    act(() => vi.advanceTimersByTime(20000));
    expect(screen.getByRole('button', { name: 'Replay' })).toBeDefined();
    expect(speech.synth.speak).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Replay' }));
    expect(slider.value).toBe('0');
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDefined();
  });

  it('pauses without advancing and resumes from the same step', () => {
    fakeSpeech(BRITISH);
    const { slider } = setup(EMAIL_DEMO);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    act(() => vi.advanceTimersByTime(20000));
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    act(() => vi.advanceTimersByTime(60000));
    expect(slider.value).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    act(() => vi.advanceTimersByTime(20000));
    expect(slider.value).toBe('2');
  });

  it('narrates each step once in British English and advances when the speech ends', () => {
    const speech = fakeSpeech(BRITISH);
    const { slider, beats } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Narrator' }));
    expect(screen.getByRole('combobox', { name: 'Voice' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    for (let i = 0; i < beats.length; i++) {
      const utterance = speech.spoken.at(-1)!;
      expect(utterance.text).toBe(beats[i]!.narration);
      expect(utterance.lang).toBe('en-GB');
      expect(utterance.voice?.lang).toBe('en-GB');
      speech.finish();
      // Speech drives the pace: nothing moves until it finishes, then a short breath.
      act(() => vi.advanceTimersByTime(500));
      if (i < beats.length - 1) expect(slider.value).toBe(String(i + 1));
    }
    expect(speech.spoken.map((u) => u.text)).toEqual(beats.map((beat) => beat.narration));
    expect(screen.getByRole('button', { name: 'Replay' })).toBeDefined();
  });

  it('uses the chosen British voice and speed', () => {
    const speech = fakeSpeech(BRITISH);
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Narrator' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Voice' }), {
      target: { value: 'system:Google UK English Male' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Playback speed' }), {
      target: { value: '1.25' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    // "1×" is the engine's 1.5, which reads at a natural walkthrough pace.
    expect(speech.spoken.at(-1)).toMatchObject({ rate: 1.25 * 1.5 });
    expect(speech.spoken.at(-1)!.voice?.name).toBe('Google UK English Male');
  });

  it('stops speaking when paused, scrubbed, muted or closed', () => {
    const speech = fakeSpeech(BRITISH);
    const { slider } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Narrator' }));
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    speech.start();
    const cancels = () => speech.synth.cancel.mock.calls.length;
    let before = cancels();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(cancels()).toBeGreaterThan(before);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    before = cancels();
    fireEvent.change(slider, { target: { value: '6' } });
    expect(cancels()).toBeGreaterThan(before);
    expect(speech.spoken.at(-1)!.text).toContain('Step'); // resumed at the new step
    before = cancels();
    fireEvent.click(screen.getByRole('button', { name: 'Narrator' }));
    expect(cancels()).toBeGreaterThan(before);
    before = cancels();
    cleanup();
    expect(cancels()).toBeGreaterThan(before);
  });

  it('falls back to captions when no voice responds or speech fails', () => {
    const speech = fakeSpeech([]);
    const { slider } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Narrator' }));
    expect(screen.getByText(/No British voice is installed/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(speech.spoken.at(-1)!.lang).toBe('en-GB');
    act(() => vi.advanceTimersByTime(2600));
    expect(screen.getByRole('status').textContent).toMatch(/captions only/);
    act(() => vi.advanceTimersByTime(20000));
    expect(slider.value).toBe('1');
    speech.fail();
    expect(screen.getByRole('status').textContent).toMatch(/stopped unexpectedly/);
    act(() => vi.advanceTimersByTime(20000));
    expect(slider.value).toBe('2');
  });

  it('disables the narrator where speech synthesis does not exist', () => {
    vi.stubGlobal('speechSynthesis', undefined);
    setup();
    expect((screen.getByRole('button', { name: 'Narrator' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('closes on request', () => {
    fakeSpeech(BRITISH);
    const { onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Close player' }));
    expect(onClose).toHaveBeenCalled();
  });
});
