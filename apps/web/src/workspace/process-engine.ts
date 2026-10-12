import {
  EngineRequestSchema,
  EngineResultSchema,
  applyProcessResults,
  type EngineRequest,
  type EngineResult,
} from '@opsis/engine';
import type { BoardGraph } from '@opsis/schema';

type Subscriber = {
  resolve: (result: EngineResult) => void;
  reject: (error: Error) => void;
  detach: () => void;
};
type Job = { id: number; key: string; request: EngineRequest; subscribers: Set<Subscriber> };
let worker: Worker | undefined;
let sequence = 0;
let active: Job | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
const queue: Job[] = [];
const pending = new Map<string, Job>();
const cache = new Map<string, EngineResult>();
const MAX_QUEUED = 8;

function releaseWorker() {
  worker?.terminate();
  worker = undefined;
}

function finish(job: Job, outcome: EngineResult | Error) {
  clearTimeout(timer);
  timer = undefined;
  active = undefined;
  pending.delete(job.key);
  if (!(outcome instanceof Error)) {
    cache.set(job.key, outcome);
    if (cache.size > 8) cache.delete(cache.keys().next().value!);
  }
  for (const subscriber of job.subscribers) {
    subscriber.detach();
    if (outcome instanceof Error) subscriber.reject(outcome);
    else subscriber.resolve(outcome);
  }
  job.subscribers.clear();
  dispatch();
}

function failActive(message: string) {
  releaseWorker();
  if (active) finish(active, new Error(message));
}

/** Dispatch one job at a time; its deadline excludes time waiting behind another job. */
function dispatch() {
  if (active || !queue.length) return;
  const job = queue.shift()!;
  active = job;
  try {
    if (!worker) {
      const created = new Worker(new URL('./process.worker.ts', import.meta.url), {
        type: 'module',
      });
      worker = created;
      created.onmessage = (event: MessageEvent) => {
        // A terminated worker's late response cannot settle a replacement worker's job.
        if (worker !== created || !active || active.id !== event.data?.id) return;
        const current = active;
        let outcome: EngineResult | Error;
        try {
          outcome =
            event.data.ok === true
              ? EngineResultSchema.parse(event.data.result)
              : new Error(
                  typeof event.data.error === 'string'
                    ? event.data.error.slice(0, 2000)
                    : 'The process could not be calculated.',
                );
        } catch {
          outcome = new Error('The process engine returned invalid data.');
        }
        finish(current, outcome);
      };
      created.onerror = () => {
        if (worker === created) failActive('The process engine could not load. Try again.');
      };
      created.onmessageerror = () => {
        if (worker === created) failActive('The process engine could not return its result.');
      };
    }
    timer = setTimeout(() => {
      if (active === job) failActive('The process calculation timed out. Try a smaller sample.');
    }, 10_000);
    worker.postMessage({ id: job.id, request: job.request });
  } catch {
    failActive('The process engine could not start.');
  }
}

export function processRequest(board: Pick<BoardGraph, 'nodes'>): EngineRequest {
  return EngineRequestSchema.parse({
    version: 3,
    nodes: board.nodes.flatMap((node) =>
      node.process ? [{ id: node.id, process: node.process }] : [],
    ),
  });
}

/** Saves/exports remain subscribed by default; previews may cancel their own subscription. */
export function calculateProcess(
  request: EngineRequest,
  options: { signal?: AbortSignal } = {},
): Promise<EngineResult> {
  const { signal } = options;
  if (signal?.aborted)
    return Promise.reject(new DOMException('Calculation cancelled.', 'AbortError'));
  const input = EngineRequestSchema.parse(request);
  if (!input.nodes.length) return Promise.resolve({ version: 3, nodes: [] });
  const key = JSON.stringify(input);
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return Promise.resolve(cached);
  }
  let job = pending.get(key);
  if (!job) {
    if (queue.length >= MAX_QUEUED)
      return Promise.reject(
        new Error('The process engine is busy. Try again when the current calculations finish.'),
      );
    job = { id: ++sequence, key, request: input, subscribers: new Set() };
    pending.set(key, job);
    queue.push(job);
  }
  const current = job;
  const promise = new Promise<EngineResult>((resolve, reject) => {
    const subscriber: Subscriber = {
      resolve,
      reject,
      detach: () => signal?.removeEventListener('abort', cancel),
    };
    function cancel() {
      subscriber.detach();
      current.subscribers.delete(subscriber);
      reject(new DOMException('Calculation cancelled.', 'AbortError'));
      if (current.subscribers.size) return;
      pending.delete(current.key);
      if (active === current) {
        clearTimeout(timer);
        timer = undefined;
        releaseWorker();
        active = undefined;
      } else {
        const index = queue.indexOf(current);
        if (index !== -1) queue.splice(index, 1);
      }
      dispatch();
    }
    current.subscribers.add(subscriber);
    signal?.addEventListener('abort', cancel, { once: true });
  });
  dispatch();
  return promise;
}

export async function populateProcess<T extends BoardGraph>(board: T): Promise<T> {
  return applyProcessResults(board, await calculateProcess(processRequest(board)));
}
