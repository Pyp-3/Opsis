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

it('syncs two views, merges concurrent edits, and allows a new canvas after a stale save', async () => {
  const id = crypto.randomUUID();
  let server = { id, revision: 1, snapshot: structuredClone(snapshot) };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/v1/boards')
        return Response.json([
          { id, revision: server.revision, title: server.snapshot.board!.title, updatedAt: 1 },
        ]);
      if (!options?.method) return Response.json(server);
      const body = JSON.parse(options.body as string);
      if (body.revision !== server.revision)
        return Response.json({ message: 'Stale revision' }, { status: 409 });
      server = { id, revision: server.revision + 1, snapshot: body.snapshot };
      return Response.json(server);
    }),
  );
  const initial = { ...server, savedSnapshot: server.snapshot, error: '' };
  const useView = () => {
    const history = useBoardHistory(initial.snapshot);
    return { history, library: useBoardLibrary(initial, history.snapshot, history.replace) };
  };
  const first = renderHook(useView),
    second = renderHook(useView);
  await act(async () => {
    const a = structuredClone(snapshot.board!),
      b = structuredClone(snapshot.board!);
    a.nodes[0]!.label = 'First view edit';
    b.nodes[1]!.label = 'Second view edit';
    first.result.current.history.commit(a);
    second.result.current.history.commit(b);
  });
  await act(async () => {
    await Promise.all([first.result.current.library.save(), second.result.current.library.save()]);
  });
  expect(server.snapshot.board!.nodes[0]!.label).toBe('First view edit');
  expect(server.snapshot.board!.nodes[1]!.label).toBe('Second view edit');
  await waitFor(
    () => expect(first.result.current.history.board).toEqual(second.result.current.history.board),
    { timeout: 4000 },
  );
  expect(first.result.current.library.error).toBe('');
  expect(second.result.current.library.error).toBe('');
  await act(async () => {
    expect(await first.result.current.library.open()).toBe(true);
  });
  expect(first.result.current.history.board).toBeNull();
  expect(second.result.current.history.board!.nodes[1]!.label).toBe('Second view edit');
});

it('waits for an active interaction to finish before pulling another view’s update', async () => {
  const id = crypto.randomUUID();
  const remote = structuredClone(snapshot);
  remote.board!.nodes[0]!.label = 'Remote edit';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/v1/boards') return Response.json([]);
      return Response.json({ id, revision: 2, snapshot: remote });
    }),
  );
  const initial = { id, revision: 1, snapshot, savedSnapshot: snapshot, error: '' };
  const { result, rerender } = renderHook(
    ({ paused }) => {
      const history = useBoardHistory(snapshot);
      return {
        history,
        library: useBoardLibrary(initial, history.snapshot, history.replace, paused),
      };
    },
    { initialProps: { paused: true } },
  );
  await new Promise((resolve) => setTimeout(resolve, 1700));
  expect(result.current.history.board!.nodes[0]!.label).not.toBe('Remote edit');
  rerender({ paused: false });
  await waitFor(() => expect(result.current.history.board!.nodes[0]!.label).toBe('Remote edit'), {
    timeout: 4000,
  });
  expect(result.current.library.status).toContain('Synced');
});

it('preserves unsaved edits from a deleted board under a new ID and does not block New canvas', async () => {
  const id = crypto.randomUUID();
  const saved: { id: string; snapshot: BoardSnapshot }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/v1/boards') return Response.json([]);
      if (!options?.method) return Response.json({}, { status: 404 });
      if (url === `/v1/boards/${id}`) return Response.json({}, { status: 409 });
      const body = JSON.parse(options.body as string);
      saved.push({ id: url.split('/').at(-1)!, snapshot: body.snapshot });
      return Response.json({ revision: 1 });
    }),
  );
  const initial = { id, revision: 1, snapshot, savedSnapshot: snapshot, error: '' };
  const { result } = renderHook(() => {
    const history = useBoardHistory(snapshot);
    return { history, library: useBoardLibrary(initial, history.snapshot, history.replace, true) };
  });
  await act(async () => {
    const next = structuredClone(snapshot.board!);
    next.nodes[0]!.label = 'Unsaved edit';
    result.current.history.commit(next);
  });
  await act(async () => {
    expect(await result.current.library.open()).toBe(true);
  });
  expect(saved).toHaveLength(1);
  expect(saved[0]!.id).not.toBe(id);
  expect(saved[0]!.snapshot.board!.nodes[0]!.label).toBe('Unsaved edit');
  expect(result.current.history.board).toBeNull();
  expect(result.current.library.error).toBe('');
});

it('opens a fresh draft when a clean board is deleted elsewhere without recreating it', async () => {
  const id = crypto.randomUUID();
  const fetch = vi.fn(async (url: string) =>
    url === '/v1/boards' ? Response.json([]) : Response.json({}, { status: 404 }),
  );
  vi.stubGlobal('fetch', fetch);
  const initial = {
    id,
    revision: 1,
    snapshot,
    savedSnapshot: structuredClone(snapshot),
    error: '',
  };
  const { result } = renderHook(() => {
    const history = useBoardHistory(snapshot);
    return { history, library: useBoardLibrary(initial, history.snapshot, history.replace) };
  });
  await waitFor(() => expect(result.current.history.board).toBeNull());
  expect(result.current.library.activeId).not.toBe(id);
  expect(result.current.library.error).toBe('');
  expect(result.current.library.status).toContain('deleted in another view');
  expect(
    fetch.mock.calls.every(([url]) => url === '/v1/boards' || url === `/v1/boards/${id}`),
  ).toBe(true);
});
