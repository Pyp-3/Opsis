import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { BoardPageIdSchema } from '@opsis/schema';
import { LRUCache } from 'lru-cache';
import { z } from 'zod';

/**
 * The process player's natural narrator. Kokoro runs natively here (onnxruntime-node uses
 * every core), several times faster than real time, where the browser's WebAssembly build
 * manages about real time. The model (~330 MB) is preloaded at server startup and kept on disk.
 */
export const SPEECH_VOICES = ['bf_emma', 'bm_george', 'bf_isabella', 'bm_fable'] as const;
export type SpeechVoice = (typeof SPEECH_VOICES)[number];

export type SpeechStatus =
  | { state: 'off' }
  | { state: 'idle' }
  | { state: 'loading'; progress: number | null }
  | { state: 'ready' }
  | { state: 'failed'; message: string };

export interface SpeechEngine {
  status(): SpeechStatus;
  /** Starts loading the model without generating anything. */
  warm(): void;
  /** A WAV recording of the text. */
  generate(text: string, voice: SpeechVoice): Promise<Buffer>;
}

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const defaultModelDir = fileURLToPath(new URL('../data/models', import.meta.url));
const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

type Kokoro = Awaited<ReturnType<(typeof import('kokoro-js'))['KokoroTTS']['from_pretrained']>>;

/** Kokoro on the server's CPU; warm and generate share one model-loading promise. */
export function kokoroEngine(modelDir = process.env.OPSIS_MODEL_DIR ?? defaultModelDir) {
  let status: SpeechStatus = { state: 'idle' };
  let model: Promise<Kokoro> | null = null;
  const load = () => {
    if (model) return model;
    status = { state: 'loading', progress: null };
    const files = new Map<string, { loaded: number; total: number }>();
    model = (async () => {
      const { env } = await import('@huggingface/transformers');
      env.cacheDir = modelDir;
      const { KokoroTTS } = await import('kokoro-js');
      return KokoroTTS.from_pretrained(MODEL, {
        dtype: 'fp32',
        device: 'cpu',
        progress_callback: (info) => {
          // Small files (configs, tokenizer) would make the progress jump about.
          if (info.status !== 'progress' || info.total < 1_000_000) return;
          files.set(info.file, { loaded: info.loaded, total: info.total });
          let loaded = 0,
            total = 0;
          for (const file of files.values()) {
            loaded += file.loaded;
            total += file.total;
          }
          status = { state: 'loading', progress: total ? loaded / total : null };
        },
      });
    })().then(
      (tts) => {
        status = { state: 'ready' };
        return tts;
      },
      (error: unknown) => {
        status = { state: 'failed', message: describe(error) };
        model = null;
        throw error;
      },
    );
    return model;
  };
  return {
    status: () => status,
    warm: () => void load().catch(() => undefined),
    async generate(text: string, voice: SpeechVoice) {
      const audio = await (await load()).generate(text, { voice });
      return Buffer.from(audio.toWav());
    },
  } satisfies SpeechEngine;
}

const SpeechRequestSchema = z
  .object({
    text: z.string().trim().min(1).max(600),
    voice: z.enum(SPEECH_VOICES),
    /** Lines the listener is waiting for jump ahead of lines prepared in advance. */
    urgent: z.boolean().default(true),
    /**
     * The board being played, and the page on screen (which may be a hidden page opened by its
     * link). People who are not signed in as members may only hear that board's own script.
     */
    board: z
      .object({ id: z.string().uuid(), page: BoardPageIdSchema.optional() })
      .strict()
      .optional(),
  })
  .strict();
export type NarrationSource = { id: string; page?: string | undefined };
/** Whether this request may have `text` spoken; see narration-access.ts. */
export type NarrationCheck = (
  request: FastifyRequest,
  text: string,
  source: NarrationSource | undefined,
) => boolean;

/** Waiting lines beyond this are refused, so a runaway client cannot queue unbounded work. */
const QUEUE_LIMIT = 80;

export function registerSpeech(
  app: FastifyInstance,
  engine: SpeechEngine | null,
  mayNarrate: NarrationCheck = () => true,
) {
  app.get('/v1/speech', async () => (engine ? engine.status() : { state: 'off' }));
  if (!engine) {
    app.post('/v1/speech', async (_, reply) =>
      reply.code(503).send({ message: 'The natural narrator is turned off on this server.' }),
    );
    return;
  }
  app.post('/v1/speech/warm', async () => {
    engine.warm();
    return engine.status();
  });

  const recordings = new LRUCache<string, Promise<Buffer>>({ max: 300 });
  type Job = { key: string; start: () => Promise<unknown> };
  const urgent: Job[] = [],
    later: Job[] = [];
  let working = false;
  // One generation at a time: the model already uses every core for each line.
  const work = async () => {
    if (working) return;
    working = true;
    for (let job = urgent.shift() ?? later.shift(); job; job = urgent.shift() ?? later.shift())
      await job.start().catch(() => undefined);
    working = false;
  };

  app.post('/v1/speech', async (request, reply) => {
    const body = SpeechRequestSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ message: 'Invalid speech request.' });
    const { text, voice, urgent: isUrgent, board } = body.data;
    if (!mayNarrate(request, text, board))
      return reply.code(403).send({
        message: 'The narrator only reads the script of a board you can open.',
      });
    const key = `${voice}\n${text}`;
    let recording = recordings.get(key);
    if (recording && isUrgent) {
      // Already waiting as a look-ahead line: the listener now needs it first.
      const queued = later.findIndex((job) => job.key === key);
      if (queued >= 0) urgent.push(...later.splice(queued, 1));
    }
    if (!recording) {
      if (urgent.length + later.length >= QUEUE_LIMIT)
        return reply.code(503).send({ message: 'The narrator is busy; try again shortly.' });
      recording = new Promise<Buffer>((resolve, reject) => {
        (isUrgent ? urgent : later).push({
          key,
          start: () => engine.generate(text, voice).then(resolve, reject),
        });
      });
      recordings.set(key, recording);
      recording.catch(() => recordings.delete(key));
      void work();
    }
    try {
      const wav = await recording;
      return reply
        .header('content-type', 'audio/wav')
        .header('cache-control', 'no-store')
        .send(wav);
    } catch (error) {
      return reply.code(503).send({ message: `The narrator could not speak: ${describe(error)}` });
    }
  });
}
