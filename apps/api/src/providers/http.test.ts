import { afterEach, expect, it, vi } from 'vitest';
import { providerHttp, withProviderSlot } from './http';

afterEach(() => vi.unstubAllGlobals());
const request = {
  provider: 'kimi',
  method: 'POST',
  path: '/v1/chat/completions',
  key: 'fixture-secret',
  body: '{}',
} as const;

it('uses the fixed official origin, refuses redirects and redacts provider errors without retries', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(new Response('fixture-secret provider diagnostics', { status: 401 }));
  vi.stubGlobal('fetch', fetch);
  await expect(providerHttp(request)).rejects.toThrow('provider_auth');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith(
    'https://api.moonshot.ai/v1/chat/completions',
    expect.objectContaining({
      redirect: 'error',
      headers: { 'content-type': 'application/json', authorization: 'Bearer fixture-secret' },
    }),
  );
  fetch.mockRejectedValueOnce(new Error('fixture-secret redirect diagnostics'));
  await expect(providerHttp(request)).rejects.toThrow('provider_failed');
});

it('bounds response bytes before decoding JSON', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x'.repeat(4 * 1024 * 1024 + 1))));
  await expect(providerHttp(request)).rejects.toThrow('harness_overflow');
});

it('caps concurrent completions and releases slots after failures', async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = withProviderSlot(() => pending);
  const second = withProviderSlot(() => pending);
  try {
    await expect(withProviderSlot(async () => 'unexpected')).rejects.toThrow('provider_busy');
  } finally {
    release();
    await Promise.all([first, second]);
  }
  await expect(
    withProviderSlot(async () => {
      throw new Error('fixture failure');
    }),
  ).rejects.toThrow('fixture failure');
  await expect(withProviderSlot(async () => 'available')).resolves.toBe('available');
});
