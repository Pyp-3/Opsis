import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineRequest, EngineResult } from '@opsis/engine';

class TestWorker {
  static instances: TestWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | undefined;
  onerror: (() => void) | undefined;
  onmessageerror: (() => void) | undefined;
  messages: { id: number; request: EngineRequest }[] = [];
  terminate = vi.fn();
  constructor() {
    TestWorker.instances.push(this);
  }
  postMessage(message: { id: number; request: EngineRequest }) {
    this.messages.push(message);
  }
  respond(index = this.messages.length - 1, invalid = false) {
    const message = this.messages[index]!;
    const result: EngineResult = {
      version: 3,
      nodes: message.request.nodes.map((node) => ({
        status: 'ok',
        id: node.id,
        input: '',
        output: '',
        inputRows: 0,
        outputRows: 0,
        origins: [],
        inputs: [],
        drawing: { height: 18, paths: [] },
      })),
    };
    this.onmessage?.({
      data: { id: message.id, ok: true, result: invalid ? {} : result },
    } as MessageEvent);
  }
}
const request = (id: string): EngineRequest => ({
  version: 3,
  nodes: [{ id, process: { op: 'source', text: 'a\n' } }],
});
const latest = () => TestWorker.instances.at(-1)!;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  TestWorker.instances = [];
  vi.stubGlobal('Worker', TestWorker);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('process worker scheduling', () => {
  it('shares work while cancellation of a preview preserves its save subscriber', async () => {
    const { calculateProcess } = await import('./process-engine');
    const controller = new AbortController();
    const preview = calculateProcess(request('shared'), { signal: controller.signal });
    const cancelled = expect(preview).rejects.toMatchObject({ name: 'AbortError' });
    const save = calculateProcess(request('shared'));
    controller.abort();
    await cancelled;
    expect(latest().terminate).not.toHaveBeenCalled();
    expect(latest().messages).toHaveLength(1);
    latest().respond();
    expect((await save).nodes[0]?.id).toBe('shared');
    await calculateProcess(request('shared'));
    expect(latest().messages).toHaveLength(1);
  });

  it('removes obsolete queued previews without discarding queued saves', async () => {
    const { calculateProcess } = await import('./process-engine');
    const first = calculateProcess(request('first'));
    const controller = new AbortController();
    const obsolete = calculateProcess(request('obsolete'), { signal: controller.signal });
    const cancelled = expect(obsolete).rejects.toMatchObject({ name: 'AbortError' });
    const save = calculateProcess(request('save'));
    controller.abort();
    await cancelled;
    latest().respond();
    await first;
    expect(latest().messages.map((message) => message.request.nodes[0]?.id)).toEqual([
      'first',
      'save',
    ]);
    latest().respond();
    await save;
  });

  it('releases an abandoned active preview and ignores its late response', async () => {
    const { calculateProcess } = await import('./process-engine');
    const controller = new AbortController();
    const obsolete = calculateProcess(request('obsolete'), { signal: controller.signal });
    const cancelled = expect(obsolete).rejects.toMatchObject({ name: 'AbortError' });
    const old = latest();
    const save = calculateProcess(request('save'));
    controller.abort();
    await cancelled;
    expect(old.terminate).toHaveBeenCalledOnce();
    expect(TestWorker.instances).toHaveLength(2);
    old.respond();
    latest().respond();
    expect((await save).nodes[0]?.id).toBe('save');
  });

  it('times out only the active job and gives queued work a fresh deadline', async () => {
    const { calculateProcess } = await import('./process-engine');
    const first = calculateProcess(request('stalled'));
    const failed = expect(first).rejects.toThrow('timed out');
    const save = calculateProcess(request('save'));
    const old = latest();
    await vi.advanceTimersByTimeAsync(10_000);
    await failed;
    expect(old.terminate).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(9_999);
    latest().respond();
    expect((await save).nodes[0]?.id).toBe('save');
  });

  it('bounds the queue and finishes all accepted saves in order', async () => {
    const { calculateProcess } = await import('./process-engine');
    const saves = Array.from({ length: 9 }, (_, i) => calculateProcess(request(`save-${i}`)));
    await expect(calculateProcess(request('overflow'))).rejects.toThrow('busy');
    for (let i = 0; i < saves.length; i++) {
      expect(latest().messages.at(-1)?.request.nodes[0]?.id).toBe(`save-${i}`);
      latest().respond();
      await saves[i];
    }
  });

  it('recovers queued work after a worker crash without accepting an old response', async () => {
    const { calculateProcess } = await import('./process-engine');
    const first = calculateProcess(request('first'));
    const failed = expect(first).rejects.toThrow('could not load');
    const save = calculateProcess(request('save'));
    const old = latest();
    old.onerror?.();
    await failed;
    old.respond();
    latest().respond();
    await save;
  });

  it('rejects malformed output without poisoning later calculations or the cache', async () => {
    const { calculateProcess } = await import('./process-engine');
    const first = calculateProcess(request('first'));
    const failed = expect(first).rejects.toThrow('invalid data');
    const second = calculateProcess(request('second'));
    latest().respond(0, true);
    await failed;
    latest().respond();
    await second;
    const retry = calculateProcess(request('first'));
    latest().respond();
    await retry;
    expect(latest().messages).toHaveLength(3);
  });

  it('does not start already cancelled work', async () => {
    const { calculateProcess } = await import('./process-engine');
    const controller = new AbortController();
    controller.abort();
    await expect(
      calculateProcess(request('cancelled'), { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(TestWorker.instances).toHaveLength(0);
  });
});
