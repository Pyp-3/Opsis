/// <reference lib="webworker" />
import { calculateInRust } from '@opsis/engine/runtime';
import type { EngineRequest } from '@opsis/engine';

const worker = self as unknown as DedicatedWorkerGlobalScope;
worker.onmessage = async (event: MessageEvent<{ id: number; request: EngineRequest }>) => {
  const { id, request } = event.data;
  try {
    worker.postMessage({ id, ok: true, result: await calculateInRust(request) });
  } catch (error) {
    worker.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : 'The process could not be calculated.',
    });
  }
};
