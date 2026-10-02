import {
  EngineRequestSchema,
  EngineResultSchema,
  applyProcessResults,
  type EngineRequest,
  type EngineResult,
} from '@opsis/engine';
import type { BoardGraph } from '@opsis/schema';

let worker: Worker | undefined;
let sequence = 0;
const pending = new Map<
  number,
  {
    resolve: (result: EngineResult) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
const cache = new Map<string, Promise<EngineResult>>();

function stop(message: string) {
  worker?.terminate();
  worker = undefined;
  for (const job of pending.values()) {
    clearTimeout(job.timer);
    job.reject(new Error(message));
  }
  pending.clear();
  cache.clear();
}

export function processRequest(board: Pick<BoardGraph, 'nodes'>): EngineRequest {
  return EngineRequestSchema.parse({
    version: 2,
    nodes: board.nodes.flatMap((node) =>
      node.process ? [{ id: node.id, process: node.process }] : [],
    ),
  });
}

/** One shared worker, bounded requests, and a small cache independent of node positions. */
export function calculateProcess(request: EngineRequest): Promise<EngineResult> {
  const input = EngineRequestSchema.parse(request);
  if (!input.nodes.length) return Promise.resolve({ version: 2, nodes: [] });
  const key = JSON.stringify(input);
  const cached = cache.get(key);
  if (cached) return cached;
  const promise = new Promise<EngineResult>((resolve, reject) => {
    if (!worker) {
      worker = new Worker(new URL('./process.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent) => {
        const job = pending.get(event.data.id);
        if (!job) return;
        clearTimeout(job.timer);
        pending.delete(event.data.id);
        try {
          if (event.data.ok === true) job.resolve(EngineResultSchema.parse(event.data.result));
          else
            job.reject(
              new Error(
                typeof event.data.error === 'string'
                  ? event.data.error.slice(0, 2000)
                  : 'The process could not be calculated.',
              ),
            );
        } catch {
          job.reject(new Error('The process engine returned invalid data.'));
        }
      };
      worker.onerror = () => stop('The process engine could not load. Reload the canvas to retry.');
      worker.onmessageerror = () => stop('The process engine could not return its result.');
    }
    const id = ++sequence;
    const timer = setTimeout(
      () => stop('The process calculation timed out. Try a smaller sample.'),
      10_000,
    );
    pending.set(id, { resolve, reject, timer });
    try {
      worker.postMessage({ id, request: input });
    } catch {
      stop('The process engine could not start.');
    }
  });
  cache.set(key, promise);
  if (cache.size > 8) cache.delete(cache.keys().next().value!);
  void promise.catch(() => {
    if (cache.get(key) === promise) cache.delete(key);
  });
  return promise;
}

export async function populateProcess<T extends BoardGraph>(board: T): Promise<T> {
  return applyProcessResults(board, await calculateProcess(processRequest(board)));
}
