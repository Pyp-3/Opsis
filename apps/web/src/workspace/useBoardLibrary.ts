import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { BoardSnapshotSchema, type BoardSnapshot } from '@opsis/schema';
import { restoreBoard } from './model';
import { mergeBoardSnapshots } from './board-sync';

const RECOVERY_BASE = 'opsis:library-recovery:v1';
/** Recovery copies are kept per account, so people sharing a browser never see each other's. */
let RECOVERY = RECOVERY_BASE;
let scoped = false;
export function setRecoveryScope(userId: string) {
  RECOVERY = `${RECOVERY_BASE}:${userId}`;
  scoped = true;
}
/** Fired when the API says the session has ended; the app returns to sign-in. */
export const AUTH_EXPIRED = 'opsis:auth-expired';
export type BoardAccess = 'owner' | 'viewer';
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
  savedSnapshot: BoardSnapshotSchema.optional(),
  /** `viewer` for someone else's public board: shown, never saved. */
  access: z.enum(['owner', 'viewer']).optional(),
  owner: z.object({ name: z.string() }).optional(),
});
const List = z.array(
  z.object({
    id: z.string().uuid(),
    title: z.string(),
    revision: z.number(),
    updatedAt: z.number(),
    visibility: z.enum(['private', 'public']).optional(),
  }),
);
export function restoreLibrary(): z.infer<typeof Entry> & { error: string } {
  try {
    const raw = sessionStorage.getItem(RECOVERY) ?? localStorage.getItem(RECOVERY);
    if (raw) return { ...Entry.parse(JSON.parse(raw)), error: '' };
    return {
      id: crypto.randomUUID(),
      revision: 0,
      // The pre-library browser board belongs to whoever used this browser before accounts.
      snapshot: { board: scoped ? null : restoreBoard(), past: [], future: [] } as BoardSnapshot,
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
  paused = false,
) {
  const active = useRef({ id: initial.id, revision: initial.revision });
  const current = useRef(snapshot);
  const lastSaved = useRef<BoardSnapshot | null>(
    initial.savedSnapshot ?? (initial.revision ? initial.snapshot : null),
  );
  const pausedRef = useRef(paused);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const [entries, setEntries] = useState<z.infer<typeof List>>([]);
  const [status, setStatus] = useState('');
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState(initial.error);
  const [activeId, setActiveId] = useState(initial.id);
  const [access, setAccessState] = useState<BoardAccess>(initial.access ?? 'owner');
  const [owner, setOwner] = useState(initial.owner?.name ?? '');
  const accessRef = useRef(access);
  const setAccess = useCallback((next: BoardAccess, ownerName = '') => {
    accessRef.current = next;
    setAccessState(next);
    setOwner(ownerName);
  }, []);
  useEffect(() => {
    current.current = snapshot;
    pausedRef.current = paused;
  }, [snapshot, paused]);

  const refresh = useCallback(async () => {
    const response = await fetch('/v1/boards');
    if (response.status === 401) {
      window.dispatchEvent(new Event(AUTH_EXPIRED));
      throw new Error('Your session ended. Sign in again.');
    }
    if (!response.ok) throw new Error('Saved-board service unavailable.');
    const next = List.parse(await response.json());
    setEntries((before) => (JSON.stringify(before) === JSON.stringify(next) ? before : next));
    return next;
  }, []);
  useEffect(() => {
    // Async network completion synchronizes the library with its external store.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh().catch((e: Error) => setError(e.message));
  }, [refresh]);

  const save = useCallback(() => {
    const job = queue.current
      .catch(() => undefined)
      .then(async () => {
        let target = current.current;
        const identity = active.current;
        // Someone else's board is only viewed here; there is nothing of ours to save.
        if (accessRef.current === 'viewer') return;
        if (lastSaved.current === target) return;
        if (lastSaved.current && JSON.stringify(lastSaved.current) === JSON.stringify(target)) {
          lastSaved.current = target;
          setStatus(identity.revision ? 'Saved to SQLite' : '');
          return;
        }
        if (!target.board && !target.past.length && !target.future.length) {
          await refresh();
          setStatus('');
          setError('');
          return;
        }
        setStatus('Saving…');
        let recoveredCopy = false;
        const preserveCopy = () => {
          identity.id = crypto.randomUUID();
          identity.revision = 0;
          setActiveId(identity.id);
          lastSaved.current = null;
          target = current.current;
          recoveredCopy = true;
        };
        let response: Response | undefined;
        for (let attempt = 0; attempt < 4; attempt++) {
          response = await fetch(`/v1/boards/${identity.id}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ snapshot: target, revision: identity.revision }),
          });
          if (response.status !== 409) break;
          const latest = await fetch(`/v1/boards/${identity.id}`);
          if (latest.status === 404) {
            preserveCopy();
            continue;
          }
          if (!latest.ok) throw new Error('Could not sync this board. Local recovery is retained.');
          const remote = Entry.parse(await latest.json());
          try {
            target = mergeBoardSnapshots(lastSaved.current, current.current, remote.snapshot);
          } catch {
            // Preserve all edits if a combined graph exceeds the schema limits.
            preserveCopy();
            continue;
          }
          identity.revision = remote.revision;
          lastSaved.current = remote.snapshot;
          current.current = target;
          replace(target);
        }
        if (response?.status === 409) {
          preserveCopy();
          response = await fetch(`/v1/boards/${identity.id}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ snapshot: target, revision: 0 }),
          });
        }
        if (!response) throw new Error('Could not save this board.');
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
          writeRecovery({ ...active.current, snapshot: current.current, savedSnapshot: target });
          setError('');
        } catch {
          setError('Saved to SQLite, but browser recovery storage is unavailable.');
        }
        setStatus(
          recoveredCopy
            ? 'Saved separate copy · concurrent edits retained'
            : target === current.current
              ? 'Saved to SQLite'
              : 'Saving…',
        );
        await refresh();
      });
    queue.current = job;
    return job.catch((e: Error) => {
      setError(e.message);
      setStatus('Could not save · retry or export');
      throw e;
    });
  }, [refresh, replace]);

  useEffect(() => {
    let disposed = false;
    let polling = false;
    const sync = () => {
      if (polling || pausedRef.current) return;
      polling = true;
      const job = queue.current
        .catch(() => undefined)
        .then(async () => {
          if (disposed || pausedRef.current) return;
          const list = await refresh();
          const identity = active.current;
          const local = current.current;
          if (
            !identity.revision ||
            (lastSaved.current && JSON.stringify(local) !== JSON.stringify(lastSaved.current))
          )
            return;
          if (list.find((entry) => entry.id === identity.id)?.revision === identity.revision)
            return;
          const response = await fetch(`/v1/boards/${identity.id}`);
          if (
            disposed ||
            identity !== active.current ||
            local !== current.current ||
            pausedRef.current
          )
            return;
          if (response.status === 404) {
            const empty: BoardSnapshot = { board: null, past: [], future: [] };
            active.current = { id: crypto.randomUUID(), revision: 0 };
            current.current = empty;
            lastSaved.current = empty;
            const wasShared = accessRef.current === 'viewer';
            setActiveId(active.current.id);
            setAccess('owner');
            replace(empty);
            writeRecovery({ ...active.current, snapshot: empty, savedSnapshot: empty });
            setStatus(
              wasShared
                ? 'That board is no longer shared · new canvas ready'
                : 'Board deleted in another view · new canvas ready',
            );
            setError('');
            return;
          }
          if (!response.ok) return;
          const remote = Entry.parse(await response.json());
          if (
            identity !== active.current ||
            local !== current.current ||
            pausedRef.current ||
            remote.revision === identity.revision
          )
            return;
          identity.revision = remote.revision;
          current.current = remote.snapshot;
          lastSaved.current = remote.snapshot;
          replace(remote.snapshot);
          writeRecovery({ ...identity, snapshot: remote.snapshot, savedSnapshot: remote.snapshot });
          setStatus('Synced · saved to SQLite');
          setError('');
          await refresh();
        });
      queue.current = job;
      void job
        .catch(() => undefined)
        .finally(() => {
          polling = false;
        });
    };
    const timer = setInterval(sync, 1500);
    sync();
    window.addEventListener('focus', sync);
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener('focus', sync);
    };
  }, [refresh, replace, setAccess]);

  useEffect(() => {
    if (initial.error && !snapshot.board) return;
    try {
      writeRecovery({ ...active.current, snapshot, savedSnapshot: lastSaved.current ?? undefined });
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
        setAccess(entry.access ?? 'owner', entry.owner?.name);
        replace(entry.snapshot);
        setStatus(id ? (entry.access === 'viewer' ? '' : 'Saved to SQLite') : '');
        setError(warning);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not switch boards.');
        return false;
      } finally {
        setSwitching(false);
      }
    },
    [save, replace, setAccess],
  );
  const saveCopy = async () => {
    setSwitching(true);
    try {
      await queue.current.catch(() => undefined);
      // A copy of someone else's board is yours to edit.
      setAccess('owner');
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
    action: 'create' | 'rename' | 'delete' | 'share',
    entry?: z.infer<typeof List>[number],
    title?: string,
    visibility?: 'private' | 'public',
  ) => {
    if (managing.current) return false;
    managing.current = true;
    setSwitching(true);
    try {
      await save();
      const isActive = entry?.id === active.current.id;
      const response = await fetch(action === 'create' ? '/v1/boards' : `/v1/boards/${entry!.id}`, {
        method: action === 'create' ? 'POST' : action === 'delete' ? 'DELETE' : 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(action === 'delete' ? {} : action === 'share' ? { visibility } : { title }),
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
        setAccess('owner');
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
  return {
    entries,
    status,
    switching,
    error,
    activeId,
    access,
    owner,
    open,
    save,
    saveCopy,
    refresh,
    manage,
  };
}
