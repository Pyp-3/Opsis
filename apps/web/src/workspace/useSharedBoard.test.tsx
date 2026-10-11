// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyBoard } from '@opsis/schema';
import { apiFetch } from '../app-url';
import { AUTH_EXPIRED } from './board-library-api';
import { useSharedBoard } from './useSharedBoard';

vi.mock('../app-url', () => ({ apiFetch: vi.fn() }));
const fetch = vi.mocked(apiFetch);
const path = '/v1/guest/boards/00000000-0000-4000-8000-000000000001?page=hidden_page';
const entry = (title = 'Shared lesson', revision = 1) => ({
  id: '00000000-0000-4000-8000-000000000001',
  revision,
  access: 'viewer',
  snapshot: { board: { ...createEmptyBoard(), title }, past: [], future: [] },
});
const response = (title = 'Shared lesson', revision = 1) =>
  new Response(JSON.stringify(entry(title, revision)));
const flush = () => act(() => vi.advanceTimersByTimeAsync(0));

beforeEach(() => {
  vi.useFakeTimers();
  fetch.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('shared board refresh', () => {
  it('preserves unchanged documents and replaces changed content without losing the page link', async () => {
    fetch
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response('Shared lesson', 2))
      .mockResolvedValueOnce(response('Updated lesson', 3));
    const { result } = renderHook(() => useSharedBoard(path));
    await flush();
    const initial = result.current;
    expect(initial.status).toBe('ready');
    if (initial.status !== 'ready') throw new Error('Expected a loaded board');
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(result.current).toMatchObject({
      status: 'ready',
      entry: { revision: 2 },
      updated: false,
    });
    if (result.current.status !== 'ready') throw new Error('Expected a loaded board');
    expect(result.current.entry.snapshot.board).toBe(initial.entry.snapshot.board);
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(result.current).toMatchObject({
      status: 'ready',
      entry: { snapshot: { board: { title: 'Updated lesson' } } },
      updated: true,
    });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([path, path, path]);
  });

  it.each([400, 403, 404])(
    'removes the previous snapshot when access returns %s',
    async (status) => {
      fetch.mockResolvedValueOnce(response()).mockResolvedValueOnce(new Response(null, { status }));
      const { result } = renderHook(() => useSharedBoard(path));
      await flush();
      expect(result.current.status).toBe('ready');
      await act(() => vi.advanceTimersByTimeAsync(2_000));
      expect(result.current).toEqual({ status: 'missing' });
    },
  );

  it('clears stale content and announces an expired authenticated guest session', async () => {
    const expired = vi.fn();
    window.addEventListener(AUTH_EXPIRED, expired);
    try {
      fetch
        .mockResolvedValueOnce(response())
        .mockResolvedValueOnce(new Response(null, { status: 401 }));
      const { result } = renderHook(() => useSharedBoard(path));
      await flush();
      await act(() => vi.advanceTimersByTimeAsync(2_000));
      expect(result.current).toEqual({ status: 'missing' });
      expect(expired).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(AUTH_EXPIRED, expired);
    }
  });

  it('pauses periodic reads in hidden tabs and refreshes once on resume without overlapping requests', async () => {
    let visibility: DocumentVisibilityState = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    let finish!: (value: Response) => void;
    fetch.mockResolvedValueOnce(response()).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    renderHook(() => useSharedBoard(path));
    await flush();
    visibility = 'hidden';
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(fetch).toHaveBeenCalledTimes(1);
    visibility = 'visible';
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    act(() => window.dispatchEvent(new Event('focus')));
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(fetch).toHaveBeenCalledTimes(2);
    await act(async () => finish(response()));
  });

  it('hides the previous board immediately on navigation and ignores its late response', async () => {
    let finish!: (value: Response) => void;
    fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    fetch.mockResolvedValueOnce(response('Other board'));
    const { result, rerender } = renderHook(({ url }) => useSharedBoard(url), {
      initialProps: { url: path },
    });
    rerender({ url: '/v1/guest/boards/other' });
    expect(result.current).toEqual({ status: 'loading' });
    expect(fetch.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    await flush();
    await act(async () => finish(response('Old private content')));
    expect(result.current).toMatchObject({
      entry: { snapshot: { board: { title: 'Other board' } } },
    });
  });

  it.each(['/v1/guest/boards/other', null])(
    'requires fresh authorization when returning to a board after navigating through %s',
    async (destination) => {
      fetch.mockResolvedValueOnce(response());
      const { result, rerender } = renderHook(
        ({ url }: { url: string | null }) => useSharedBoard(url),
        {
          initialProps: { url: path as string | null },
        },
      );
      await flush();
      expect(result.current.status).toBe('ready');
      let finishReturn!: (value: Response) => void;
      if (destination) fetch.mockImplementationOnce(() => new Promise(() => {}));
      rerender({ url: destination });
      expect(result.current.status).toBe('loading');
      fetch.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishReturn = resolve;
          }),
      );
      rerender({ url: path });
      expect(result.current).toEqual({ status: 'loading' });
      await act(async () => finishReturn(new Response(null, { status: 404 })));
      expect(result.current).toEqual({ status: 'missing' });
    },
  );

  it('aborts on unmount and never polls or dispatches session events for a late result', async () => {
    let finish!: (value: Response) => void;
    fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const expired = vi.fn();
    window.addEventListener(AUTH_EXPIRED, expired);
    try {
      const { unmount } = renderHook(() => useSharedBoard(path));
      unmount();
      expect(fetch.mock.calls[0]![1]!.signal!.aborted).toBe(true);
      await act(async () => finish(new Response(null, { status: 401 })));
      await act(() => vi.advanceTimersByTimeAsync(20_000));
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(expired).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(AUTH_EXPIRED, expired);
    }
  });

  it('clears the old script on a network failure and recovers on the next refresh', async () => {
    fetch
      .mockResolvedValueOnce(response())
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce(response('Recovered'));
    const { result } = renderHook(() => useSharedBoard(path));
    await flush();
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(result.current).toEqual({ status: 'error', message: 'Offline' });
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(result.current).toMatchObject({
      status: 'ready',
      entry: { snapshot: { board: { title: 'Recovered' } } },
    });
  });
});
