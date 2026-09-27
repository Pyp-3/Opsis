// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EMAIL_DEMO, type BoardSnapshot } from '@opsis/schema';
import { restoreLibrary, useBoardLibrary } from './useBoardLibrary';
import { useBoardHistory } from './useBoardHistory';

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});
const snapshot: BoardSnapshot = {
  board: { ...EMAIL_DEMO, version: 2, agent: 'demo', positions: {} },
  past: [null],
  future: [],
};
it('migrates a browser board without removing the old copy and restores a stable recovery ID', () => {
  localStorage.setItem('opsis:board:v2', JSON.stringify(snapshot.board));
  const initial = restoreLibrary();
  expect(initial.snapshot.board).toEqual(snapshot.board);
  localStorage.setItem('opsis:library-recovery:v1', JSON.stringify(initial));
  expect(restoreLibrary().id).toBe(initial.id);
  expect(localStorage.getItem('opsis:board:v2')).not.toBeNull();
});

it('retains the current board when a save fails and blocks switching until it is saved', async () => {
  const initial = { id: crypto.randomUUID(), revision: 0, snapshot, error: '' };
  let failing = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/v1/boards') return Response.json([]);
      return failing
        ? Response.json({ message: 'Conflict: keep your local changes' }, { status: 409 })
        : Response.json({ revision: 1 });
    }),
  );
  const { result } = renderHook(() => {
    const history = useBoardHistory(snapshot);
    return { history, library: useBoardLibrary(initial, history.snapshot, history.replace) };
  });
  await act(async () => {
    expect(await result.current.library.open()).toBe(false);
  });
  expect(result.current.history.board).toEqual(snapshot.board);
  expect(JSON.parse(localStorage.getItem('opsis:library-recovery:v1')!).snapshot).toEqual(snapshot);
  failing = false;
  await act(async () => {
    expect(await result.current.library.open()).toBe(true);
  });
  expect(result.current.history.board).toBeNull();
  await waitFor(() => expect(result.current.library.error).toBe(''));
});
