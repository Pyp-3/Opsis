/// <reference lib="webworker" />
import { KokoroTTS, type GenerateOptions } from 'kokoro-js';

/**
 * Runs the Kokoro neural voice off the main thread so the canvas stays smooth while speech
 * is generated. The model is fetched once and then served from the browser cache. With a GPU
 * (WebGPU) it speaks many times faster than real time; on the CPU it is about real time, so
 * the player asks for the line it needs now first and prepares the rest in the background.
 */
export type NarratorRequest =
  | { type: 'load' }
  | { type: 'speak'; id: number; text: string; voice: string; urgent: boolean }
  | { type: 'hurry'; id: number };
export type NarratorResponse =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready'; device: 'webgpu' | 'wasm' }
  | { type: 'failed'; message: string }
  | { type: 'audio'; id: number; audio: Blob }
  | { type: 'error'; id: number; message: string };

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
/** Files under this size (configs, tokenizer) would make the download bar jump about. */
const TRACKED_FILE = 1_000_000;
const post = (message: NarratorResponse) => self.postMessage(message);
const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function gpuAvailable() {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return Boolean(gpu && (await gpu.requestAdapter()));
  } catch {
    return false;
  }
}

type Progress = { status: string; file?: string; loaded?: number; total?: number };
let model: Promise<KokoroTTS> | null = null;
function load() {
  if (model) return model;
  const files = new Map<string, { loaded: number; total: number }>();
  const progress_callback = (info: Progress) => {
    if (info.status !== 'progress' || !info.file || !info.total || info.total < TRACKED_FILE)
      return;
    files.set(info.file, { loaded: info.loaded ?? 0, total: info.total });
    let loaded = 0,
      total = 0;
    for (const file of files.values()) {
      loaded += file.loaded;
      total += file.total;
    }
    post({ type: 'progress', loaded, total });
  };
  const open = async (device: 'webgpu' | 'wasm') => {
    const tts = await KokoroTTS.from_pretrained(MODEL, {
      // The recommended pairings: full precision on the GPU, 8-bit (about 90 MB) on the CPU.
      dtype: device === 'webgpu' ? 'fp32' : 'q8',
      device,
      progress_callback,
    });
    post({ type: 'ready', device });
    return tts;
  };
  model = gpuAvailable()
    .then((gpu) => (gpu ? open('webgpu').catch(() => open('wasm')) : open('wasm')))
    .catch((error: unknown) => {
      model = null;
      post({ type: 'failed', message: describe(error) });
      throw error;
    });
  return model;
}

// One generation at a time (the ONNX session is not re-entrant). The line the listener is
// waiting for jumps the queue; look-ahead lines fill the gaps.
type Speak = Extract<NarratorRequest, { type: 'speak' }>;
const urgent: Speak[] = [];
const later: Speak[] = [];
let working = false;
async function work() {
  if (working) return;
  working = true;
  try {
    for (let next = urgent.shift() ?? later.shift(); next; next = urgent.shift() ?? later.shift()) {
      try {
        const tts = await load();
        const audio = await tts.generate(next.text, {
          voice: next.voice as NonNullable<GenerateOptions['voice']>,
        });
        post({ type: 'audio', id: next.id, audio: audio.toBlob() });
      } catch (error) {
        post({ type: 'error', id: next.id, message: describe(error) });
      }
    }
  } finally {
    working = false;
  }
}

self.onmessage = ({ data }: MessageEvent<NarratorRequest>) => {
  if (data.type === 'load') {
    load().catch(() => undefined);
    return;
  }
  if (data.type === 'hurry') {
    const queued = later.findIndex((item) => item.id === data.id);
    if (queued >= 0) urgent.push(...later.splice(queued, 1));
    return;
  }
  (data.urgent ? urgent : later).push(data);
  void work();
};
