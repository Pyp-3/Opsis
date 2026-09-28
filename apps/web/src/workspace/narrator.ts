import type { NarratorRequest, NarratorResponse } from './narrator.worker';

/**
 * Kokoro's British voices, best first. They are neural voices, so they sound far more human
 * than the platform's speech synthesis (espeak on Linux, for example).
 */
export const NATURAL_VOICES = [
  { id: 'bf_emma', name: 'Emma' },
  { id: 'bm_george', name: 'George' },
  { id: 'bf_isabella', name: 'Isabella' },
  { id: 'bm_fable', name: 'Fable' },
] as const;

/** Where speech is made: the local Opsis API (fast, native) or this browser (fallback). */
export type NaturalDevice = 'server' | 'webgpu' | 'wasm';
export type NaturalState =
  | { status: 'idle' }
  | { status: 'loading'; progress: number | null }
  | { status: 'ready'; device: NaturalDevice }
  | { status: 'failed'; message: string };

type ServerStatus =
  | { state: 'off' | 'idle' | 'ready' }
  | { state: 'loading'; progress: number | null }
  | { state: 'failed'; message: string };
const SERVER_POLL = 800;

export const naturalVoicesSupported = () =>
  typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined' && typeof URL !== 'undefined';

/**
 * A narration split into sentences. Each is generated on its own, so the first can play
 * while the rest are still being made (on the CPU generation runs at about real time).
 */
export const sentences = (text: string) =>
  text
    .split(/(?<=[.!?])\s+(?=\S)/)
    .map((part) => part.trim())
    .filter(Boolean);

/** About 20 minutes of speech; older lines are released first. */
const CACHE_LIMIT = 150;

type Line = { id: number; url: Promise<string>; done: boolean };

/**
 * One shared narrator for the page, so the model loads once however often the player opens.
 * The Opsis API speaks several times faster than real time; the in-browser worker is kept
 * for when the API has speech turned off or is unreachable.
 */
class NaturalNarrator {
  private backend: Promise<'server' | 'browser'> | null = null;
  private worker: Worker | null = null;
  private nextId = 0;
  private pending = new Map<
    number,
    { resolve: (url: string) => void; reject: (e: Error) => void }
  >();
  private lines = new Map<string, Line>();
  private listeners = new Set<() => void>();
  state: NaturalState = { status: 'idle' };

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  private set(state: NaturalState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  private send(message: NarratorRequest) {
    if (!this.worker) {
      const worker = new Worker(new URL('./narrator.worker.ts', import.meta.url), {
        type: 'module',
      });
      worker.onmessage = ({ data }: MessageEvent<NarratorResponse>) => this.receive(data);
      worker.onerror = (event) => this.fail(event.message || 'The voice worker could not start.');
      this.worker = worker;
    }
    this.worker.postMessage(message);
  }

  private receive(data: NarratorResponse) {
    if (data.type === 'progress')
      this.set({ status: 'loading', progress: data.total ? data.loaded / data.total : null });
    else if (data.type === 'ready') this.set({ status: 'ready', device: data.device });
    else if (data.type === 'failed') this.fail(data.message);
    else {
      const request = this.pending.get(data.id);
      this.pending.delete(data.id);
      if (data.type === 'audio') request?.resolve(URL.createObjectURL(data.audio));
      else request?.reject(new Error(data.message));
    }
  }

  private fail(message: string) {
    this.set({ status: 'failed', message });
    for (const request of this.pending.values()) request.reject(new Error(message));
    this.pending.clear();
    this.lines.clear();
    this.worker?.terminate();
    this.worker = null;
  }

  private async serverStatus(method: 'GET' | 'POST' = 'GET') {
    const response = await fetch(method === 'GET' ? '/v1/speech' : '/v1/speech/warm', { method });
    if (!response.ok) throw new Error('Speech service unavailable');
    return (await response.json()) as ServerStatus;
  }

  /** Follows the server's model download until it is ready to speak. */
  private async followServer() {
    for (let status = await this.serverStatus('POST'); ; status = await this.serverStatus()) {
      if (status.state === 'ready') return this.set({ status: 'ready', device: 'server' });
      if (status.state === 'failed' || status.state === 'off')
        return this.fail(status.state === 'failed' ? status.message : 'Speech is turned off.');
      this.set({
        status: 'loading',
        progress: status.state === 'loading' ? status.progress : null,
      });
      await new Promise((resolve) => setTimeout(resolve, SERVER_POLL));
    }
  }

  private chooseBackend() {
    return (this.backend ??= this.serverStatus().then(
      (status) => (status.state === 'off' || status.state === 'failed' ? 'browser' : 'server'),
      () => 'browser' as const,
    ));
  }

  /** Starts downloading the model (once) without asking for any speech yet. */
  load() {
    if (this.state.status !== 'idle') return;
    this.set({ status: 'loading', progress: null });
    void this.chooseBackend().then((backend) => {
      if (backend === 'browser') this.send({ type: 'load' });
      else this.followServer().catch(() => this.fail('The speech service stopped responding.'));
    });
  }

  private async speakOnServer(text: string, voice: string, urgent: boolean) {
    const response = await fetch('/v1/speech', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, voice, urgent }),
    });
    if (!response.ok) throw new Error('The speech service could not speak this line.');
    return URL.createObjectURL(await response.blob());
  }

  /**
   * Spoken audio for one sentence, as an object URL. Repeat requests share one generation;
   * an urgent request moves a line that was only being prepared ahead to the front.
   */
  speak(text: string, voice: string, urgent = true): Promise<string> {
    const key = `${voice}\n${text}`;
    const known = this.lines.get(key);
    if (known) {
      if (urgent && !known.done)
        void this.chooseBackend().then((backend) =>
          backend === 'browser'
            ? this.send({ type: 'hurry', id: known.id })
            : this.speakOnServer(text, voice, true).then(URL.revokeObjectURL, () => undefined),
        );
      return known.url;
    }
    if (this.state.status === 'idle') this.load();
    const id = this.nextId++;
    const url = this.chooseBackend().then((backend) =>
      backend === 'server'
        ? this.speakOnServer(text, voice, urgent)
        : new Promise<string>((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.send({ type: 'speak', id, text, voice, urgent });
          }),
    );
    const line: Line = { id, url, done: false };
    this.lines.set(key, line);
    url.then(
      () => (line.done = true),
      () => this.lines.delete(key),
    );
    if (this.lines.size > CACHE_LIMIT) {
      const [oldest, line] = this.lines.entries().next().value!;
      this.lines.delete(oldest);
      line.url.then(URL.revokeObjectURL, () => undefined);
    }
    return url;
  }
}

let shared: NaturalNarrator | null = null;
export const naturalNarrator = () => (shared ??= new NaturalNarrator());
