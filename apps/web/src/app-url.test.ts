import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('application mount path', () => {
  it('keeps root deployments and desktop URLs unchanged', async () => {
    vi.stubEnv('BASE_URL', '/');
    const { appUrl, appPath } = await import('./app-url');
    expect(appUrl('/v1/boards')).toBe('/v1/boards');
    expect(appPath('/canvas')).toBe('/canvas');
  });

  it('mounts page links, API calls and login return paths under the same prefix', async () => {
    vi.stubEnv('BASE_URL', '/opsis/');
    const { appUrl, appPath, apiFetch } = await import('./app-url');
    expect(appUrl('/canvas?board=123')).toBe('/opsis/canvas?board=123');
    expect(appPath('/opsis')).toBe('/');
    expect(appPath('/opsis/boards')).toBe('/boards');
    expect(appPath('/opsis-other/boards')).toBe('/opsis-other/boards');
    const fetch = vi.fn().mockResolvedValue(new Response('stream'));
    vi.stubGlobal('fetch', fetch);
    const signal = new AbortController().signal;
    const init = { method: 'POST', body: 'request', signal };
    const response = await apiFetch('/v1/boards/generate', init);
    expect(fetch).toHaveBeenCalledWith('/opsis/v1/boards/generate', init);
    expect(await response.text()).toBe('stream');
    expect(() => appUrl('//other.example/path')).toThrow();
  });
});
