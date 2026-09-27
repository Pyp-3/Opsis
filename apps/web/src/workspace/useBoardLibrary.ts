import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { BoardSnapshotSchema, type BoardSnapshot } from '@opsis/schema';
import { restoreBoard } from './model';

const RECOVERY = 'opsis:library-recovery:v1';
function writeRecovery(value: unknown) {
  const text = JSON.stringify(value);
  // A per-tab copy prevents another tab from replacing unsaved recovery data.
  let saved = false;
  for (const storage of [sessionStorage, localStorage]) {
    try {
      storage.setItem(RECOVERY, text);
      saved = true;
    } catch {
      /* Try the other store. */
    }
  }
  if (!saved) throw new Error('Browser recovery storage is full or unavailable.');
}
const Entry = z.object({
  id: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  snapshot: BoardSnapshotSchema,
});
const List = z.array(
  z.object({
    id: z.string().uuid(),
    title: z.string(),
    revision: z.number(),
    updatedAt: z.number(),
  }),
);
export function restoreLibrary() {
  try {
    const raw = sessionStorage.getItem(RECOVERY) ?? localStorage.getItem(RECOVERY);
    if (raw) return { ...Entry.parse(JSON.parse(raw)), error: '' };
    return {
      id: crypto.randomUUID(),
      revision: 0,
      snapshot: { board: restoreBoard(), past: [], future: [] } as BoardSnapshot,
      error: '',
    };
  } catch {
    return {
      id: crypto.randomUUID(),
      revision: 0,
      snapshot: { board: null, past: [], future: [] } as BoardSnapshot,
      error:
        'Saved recovery data could not be read. It has not been overwritten. Import a backup to continue.',
    };
  }
}

export function useBoardLibrary(
  initial: ReturnType<typeof restoreLibrary>,
  snapshot: BoardSnapshot,
  replace: (next: BoardSnapshot) => void,
) {
  const active = useRef({ id: initial.id, revision: initial.revision });
  const current = useRef(snapshot);
  const lastSaved = useRef<BoardSnapshot | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const [entries, setEntries] = useState<z.infer<typeof List>>([]);
  const [status, setStatus] = useState('');
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState(initial.error);
  const [activeId, setActiveId] = useState(initial.id);
  useEffect(() => {
    current.current = snapshot;
  }, [snapshot]);

  const refresh = useCallback(async () => {
    const response = await fetch('/v1/boards');
    if (!response.ok) throw new Error('Saved-board service unavailable.');
    setEntries(List.parse(await response.json()));
  }, []);
  useEffect(() => {
    // Async network completion synchronizes the library with its external store.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh().catch((e: Error) => setError(e.message));
  }, [refresh]);

  const save = useCallback(() => {
    const target = current.current;
    const identity = active.current;
    const job = queue.current
      .catch(() => undefined)
      .then(async () => {
        if (lastSaved.current === target) return;
        if (!target.board && !target.past.length && !target.future.length) {
          await refresh();
          setStatus('');
          setError('');
          return;
        }
        setStatus('Saving…');
        const response = await fetch(`/v1/boards/${identity.id}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ snapshot: target, revision: identity.revision }),
        });
        if (!response.ok) {
          const payload = await response.json();
          throw new Error(
            payload.message ?? 'Could not save. Your local recovery copy is retained.',
          );
        }
        const saved = (await response.json()) as { revision: number };
        identity.revision = saved.revision;
        lastSaved.current = target;
        // Never replace a newer local edit with this completed request's older snapshot.
        try {
          writeRecovery({ ...active.current, snapshot: current.current });
          setError('');
        } catch {
          setError('Saved to SQLite, but browser recovery storage is unavailable.');
        }
        setStatus(target === current.current ? 'Saved to SQLite' : 'Saving…');
        await refresh();
      });
    queue.current = job;
    return job.catch((e: Error) => {
      setError(e.message);
      setStatus('Could not save · retry or export');
      throw e;
    });
  }, [refresh]);

  useEffect(() => {
    if (initial.error && !snapshot.board) return;
    try {
      writeRecovery({ ...active.current, snapshot });
    } catch {
      // Report a real external storage failure; this is not derived render state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError(
        'Local recovery is unavailable. Keep this tab open until the server save completes.',
      );
    }
    const timer = setTimeout(() => {
      void save().catch(() => undefined);
    }, 350);
    return () => clearTimeout(timer);
  }, [snapshot, save, initial.error]);

  const open = useCallback(
    async (id?: string) => {
      setSwitching(true);
      try {
        await save();
        const entry = id
          ? await (async () => {
              const response = await fetch(`/v1/boards/${id}`);
              if (!response.ok) throw new Error('Could not open this board.');
              return Entry.parse(await response.json());
            })()
          : {
              id: crypto.randomUUID(),
              revision: 0,
              snapshot: { board: null, past: [], future: [] } as BoardSnapshot,
            };
        active.current = { id: entry.id, revision: entry.revision };
        current.current = entry.snapshot;
        lastSaved.current = entry.snapshot;
        let warning = '';
        try {
          writeRecovery(entry);
        } catch {
          warning = 'Browser recovery is unavailable; wait for SQLite saves before closing.';
        }
        setActiveId(entry.id);
        replace(entry.snapshot);
        setError(warning);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not switch boards.');
        return false;
      } finally {
        setSwitching(false);
      }
    },
    [save, replace],
  );
  const saveCopy = async () => {
    setSwitching(true);
    try {
      await queue.current.catch(() => undefined);
      active.current = { id: crypto.randomUUID(), revision: 0 };
      setActiveId(active.current.id);
      lastSaved.current = null;
      writeRecovery({ ...active.current, snapshot: current.current });
      await save();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save a separate copy.');
    } finally {
      setSwitching(false);
    }
  };
  const managing = useRef(false);
  const manage = async (
    action: 'create' | 'rename' | 'delete',
    entry?: z.infer<typeof List>[number],
    title?: string,
  ) => {
    if (managing.current) return false;
    managing.current = true;
    setSwitching(true);
    try {
      await save();
      const isActive = entry?.id === active.current.id;
      const response = await fetch(action === 'create' ? '/v1/boards' : `/v1/boards/${entry!.id}`, {
        method: action === 'create' ? 'POST' : action === 'rename' ? 'PATCH' : 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(action === 'delete' ? {} : { title }),
          ...(action === 'create'
            ? {}
            : { revision: isActive ? active.current.revision : entry!.revision }),
        }),
      });
      if (!response.ok)
        throw new Error((await response.json()).message ?? 'Board operation failed.');
      if (
        action === 'create' ||
        (action === 'rename' && isActive) ||
        (action === 'delete' && isActive)
      ) {
        const next =
          action === 'delete'
            ? {
                id: crypto.randomUUID(),
                revision: 0,
                snapshot: { board: null, past: [], future: [] } as BoardSnapshot,
              }
            : Entry.parse(await response.json());
        active.current = { id: next.id, revision: next.revision };
        current.current = next.snapshot;
        lastSaved.current = next.snapshot;
        setActiveId(next.id);
        replace(next.snapshot);
        writeRecovery(next);
        setStatus(action === 'delete' ? '' : 'Saved to SQLite');
      }
      await refresh();
      setError('');
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Board operation failed.');
      return false;
    } finally {
      managing.current = false;
      setSwitching(false);
    }
  };
  return { entries, status, switching, error, activeId, open, save, saveCopy, refresh, manage };
}
