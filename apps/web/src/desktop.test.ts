// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText, installDesktopTransport, saveBlob } from './desktop';

afterEach(() => vi.unstubAllGlobals());

function nativeBridge() {
  const native = {
    CancelRequest: vi.fn(async () => undefined),
    SaveFile: vi.fn(async () => true),
    CopyText: vi.fn(async () => undefined),
  };
  vi.stubGlobal('go', { main: { Desktop: native } });
  return native;
}

describe('desktop platform boundary', () => {
  it('leaves ordinary browser requests unchanged', async () => {
    const fetch = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    installDesktopTransport();
    expect(window.fetch).toBe(fetch);
  });

  it('keeps streaming responses intact and cancels native work after headers arrive', async () => {
    const native = nativeBridge();
    const response = new Response('progress\n');
    const fetch = vi.fn<typeof window.fetch>(async () => response);
    vi.stubGlobal('fetch', fetch);
    installDesktopTransport();
    const controller = new AbortController();
    const result = await window.fetch('/v1/boards/generate', { signal: controller.signal });
    expect(result).toBe(response);
    const init = fetch.mock.calls[0]?.[1] as RequestInit | undefined;
    const id = new Headers(init?.headers).get('X-Opsis-Request-ID');
    expect(id).toBeTruthy();
    controller.abort();
    expect(native.CancelRequest).toHaveBeenCalledWith(id);
  });

  it('does not modify external downloads or start an already cancelled request', async () => {
    nativeBridge();
    const fetch = vi.fn(async () => new Response(''));
    vi.stubGlobal('fetch', fetch);
    installDesktopTransport();
    await window.fetch('https://example.test/model.onnx');
    expect(fetch).toHaveBeenCalledWith('https://example.test/model.onnx', undefined);
    const controller = new AbortController();
    controller.abort();
    await expect(window.fetch('/v1/boards', { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects gracefully when a browser cannot provide clipboard access', async () => {
    vi.stubGlobal('navigator', {});
    await expect(copyText('example')).rejects.toBeInstanceOf(Error);
  });

  it('uses native export and clipboard without browser download navigation', async () => {
    const native = nativeBridge();
    await saveBlob(new Blob(['Hello · Opsis'], { type: 'text/plain' }), 'board.txt');
    expect(native.SaveFile).toHaveBeenCalledWith(
      'board.txt',
      btoa(unescape(encodeURIComponent('Hello · Opsis'))),
    );
    await copyText('example');
    expect(native.CopyText).toHaveBeenCalledWith('example');
  });
});
