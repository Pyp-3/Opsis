import { afterEach, describe, expect, it, vi } from 'vitest';
import { kokoroEngine } from './speech';
const mock = vi.hoisted(() => ({
  fromPretrained: vi.fn(),
  generate: vi.fn(),
  env: { cacheDir: '' },
}));
vi.mock('@huggingface/transformers', () => ({ env: mock.env }));
vi.mock('kokoro-js', () => ({ KokoroTTS: { from_pretrained: mock.fromPretrained } }));
afterEach(() => vi.resetAllMocks());
describe('natural voice preloading', () => {
  it('shares a startup warmup with subsequent requests and uses the disk cache', async () => {
    mock.fromPretrained.mockResolvedValue({ generate: mock.generate });
    mock.generate.mockResolvedValue({ toWav: () => new Uint8Array([82, 73, 70, 70]) });
    const engine = kokoroEngine('test-model-cache');
    engine.warm();
    engine.warm();
    expect(engine.status().state).toBe('loading');
    expect(await engine.generate('Hello.', 'bf_emma')).toEqual(Buffer.from('RIFF'));
    expect(mock.env.cacheDir).toBe('test-model-cache');
    expect(mock.fromPretrained).toHaveBeenCalledTimes(1);
    expect(engine.status()).toEqual({ state: 'ready' });
  });
  it('reports a failed warmup without an unhandled rejection and permits retry', async () => {
    mock.fromPretrained
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValue({ generate: mock.generate });
    const engine = kokoroEngine();
    engine.warm();
    await vi.waitFor(() =>
      expect(engine.status()).toEqual({ state: 'failed', message: 'Offline' }),
    );
    engine.warm();
    await vi.waitFor(() => expect(engine.status()).toEqual({ state: 'ready' }));
    expect(mock.fromPretrained).toHaveBeenCalledTimes(2);
  });
});
