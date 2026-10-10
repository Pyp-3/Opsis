// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DNS_DEMO, type BoardDocument } from '@opsis/schema';
import type { NaturalState } from './narrator';
import { playbackTimeline, sentences } from '@opsis/schema';

const narrator = vi.hoisted(() => ({
  state: { status: 'ready', device: 'wasm' } as NaturalState,
  listeners: new Set<() => void>(),
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  },
  load: vi.fn(),
  speak: vi.fn<(text: string, voice: string, urgent?: boolean) => Promise<string>>((text, voice) =>
    Promise.resolve(`blob:${voice}:${text}`),
  ),
}));
vi.mock('./narrator', async (original) => ({
  ...(await original<typeof import('./narrator')>()),
  naturalVoicesSupported: () => true,
  naturalNarrator: () => narrator,
}));
const { ProcessPlayer } = await import('./ProcessPlayer');

type FakeAudio = {
  src: string;
  playbackRate: number;
  preservesPitch: boolean;
  onended?: () => void;
  pause: ReturnType<typeof vi.fn>;
};
const played: FakeAudio[] = [];
const spoken: { text: string }[] = [];

const board: BoardDocument = {
  ...DNS_DEMO,
  version: 2,
  agent: 'demo',
  positions: Object.fromEntries(DNS_DEMO.nodes.map((node, i) => [node.id, { x: 0, y: i * 200 }])),
};
const beats = playbackTimeline(board);

beforeEach(() => {
  vi.useFakeTimers();
  narrator.state = { status: 'ready', device: 'wasm' };
  narrator.speak.mockClear();
  narrator.load.mockClear();
  played.length = 0;
  spoken.length = 0;
  localStorage.clear();
  vi.stubGlobal(
    'Audio',
    class {
      playbackRate = 1;
      preservesPitch = false;
      onended?: () => void;
      pause = vi.fn();
      constructor(public src: string) {
        played.push(this);
      }
      play() {
        return Promise.resolve();
      }
    },
  );
  vi.stubGlobal(
    'speechSynthesis',
    Object.assign(new EventTarget(), {
      getVoices: () => [{ name: 'Google UK English Female', lang: 'en-GB', localService: false }],
      speak: (u: { text: string }) => spoken.push(u),
      cancel: vi.fn(),
    }),
  );
  vi.stubGlobal(
    'SpeechSynthesisUtterance',
    class {
      constructor(public text: string) {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const flush = () => act(() => vi.advanceTimersByTimeAsync(0));

describe('natural narrator', () => {
  it('reads each step sentence by sentence, preparing the next steps ahead', async () => {
    render(<ProcessPlayer board={board} disabled={false} onBeat={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Narrator' }));
    expect((screen.getByRole('combobox', { name: 'Voice' }) as HTMLSelectElement).value).toBe(
      'natural:bf_emma',
    );
    expect(narrator.load).toHaveBeenCalled();
    // Before anything plays, the coming steps are queued in the background.
    for (const part of sentences(beats[2]!.narration))
      expect(narrator.speak).toHaveBeenCalledWith(part, 'bf_emma', false);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    await flush();
    const first = sentences(beats[0]!.narration);
    expect(first.length).toBeGreaterThan(1);
    expect(played.map((audio) => audio.src)).toEqual([`blob:bf_emma:${first[0]}`]);
    expect(played[0]).toMatchObject({ playbackRate: 1.15, preservesPitch: true });
    const slider = screen.getByRole('slider', { name: 'Process timeline' }) as HTMLInputElement;
    // The audio sets the pace: nothing moves until the step's last sentence ends.
    await act(() => vi.advanceTimersByTimeAsync(20000));
    expect(slider.value).toBe('0');
    for (let i = 0; i < first.length; i++) {
      expect(played[i]!.src).toBe(`blob:bf_emma:${first[i]}`);
      act(() => played[i]!.onended?.());
      await flush();
    }
    expect(slider.value).toBe('0');
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(slider.value).toBe('1');
    await flush();
    expect(played.at(-1)!.src).toBe(`blob:bf_emma:${sentences(beats[1]!.narration)[0]}`);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(played.at(-1)!.pause).toHaveBeenCalled();
    expect(spoken).toHaveLength(0);
  });

  it('shows download progress while the voice model loads', () => {
    narrator.state = { status: 'loading', progress: 0.42 };
    render(<ProcessPlayer board={board} disabled={false} onBeat={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Narrator' }));
    expect(screen.getByRole('status').textContent).toMatch(/Downloading the natural voice.*42%/);
  });

  it('falls back to the device voice when the natural voice cannot load', () => {
    narrator.state = { status: 'failed', message: 'offline' };
    render(<ProcessPlayer board={board} disabled={false} onBeat={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Narrator' }));
    expect(screen.getByRole('status').textContent).toMatch(/device voice is reading instead/);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(spoken.at(-1)!.text).toBe(beats[0]!.narration);
    expect(narrator.speak).not.toHaveBeenCalled();
  });

  it('remembers a chosen device voice', () => {
    render(<ProcessPlayer board={board} disabled={false} onBeat={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Narrator' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Voice' }), {
      target: { value: 'system:Google UK English Female' },
    });
    expect(localStorage.getItem('opsis:narrator-voice')).toBe('system:Google UK English Female');
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(spoken.at(-1)!.text).toBe(beats[0]!.narration);
  });
});
