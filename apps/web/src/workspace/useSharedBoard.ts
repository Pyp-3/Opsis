import { useEffect, useState } from 'react';
import { apiFetch } from '../app-url';
import { AUTH_EXPIRED, BoardEntrySchema } from './board-library-api';

type Entry = ReturnType<typeof BoardEntrySchema.parse>;
export type SharedBoardState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error'; message: string }
  | { status: 'ready'; entry: Entry; updated: boolean };

/** Refreshes a viewer's authorized snapshot without mounting save or recovery machinery. */
export function useSharedBoard(path: string | null): SharedBoardState {
  const [result, setResult] = useState<{ path: string | null; state: SharedBoardState }>({
    path,
    state: { status: 'loading' },
  });
  // Discard a previous navigation's snapshot, including when returning to that same URL
  // before the intervening request finished. Access must be confirmed again first.
  if (result.path !== path) setResult({ path, state: { status: 'loading' } });
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polling = false;
    const refresh = async () => {
      if (polling || controller.signal.aborted) return;
      clearTimeout(timer);
      polling = true;
      try {
        const response = await apiFetch(path, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if ([400, 401, 403, 404].includes(response.status)) {
          setResult({ path, state: { status: 'missing' } });
          if (response.status === 401) window.dispatchEvent(new Event(AUTH_EXPIRED));
          return;
        }
        if (!response.ok) throw new Error('Could not refresh this shared board. Try again soon.');
        const entry = BoardEntrySchema.parse(await response.json());
        if (controller.signal.aborted) return;
        setResult((previous) => {
          const before = previous.path === path ? previous.state : null;
          const unchanged =
            before?.status === 'ready' &&
            JSON.stringify(before.entry.snapshot.board) === JSON.stringify(entry.snapshot.board);
          // Metadata/revisions may change without changing the drawing or the spoken script.
          // Preserve the document reference so a routine poll cannot restart playback.
          const next = unchanged
            ? { ...entry, snapshot: { ...entry.snapshot, board: before.entry.snapshot.board } }
            : entry;
          return {
            path,
            state: {
              status: 'ready',
              entry: next,
              updated: before?.status === 'ready' && (before.updated || !unchanged),
            },
          };
        });
      } catch (failure) {
        if (!controller.signal.aborted)
          setResult({
            path,
            state: {
              status: 'error',
              message: failure instanceof Error ? failure.message : 'Could not refresh this board.',
            },
          });
      } finally {
        polling = false;
        if (!controller.signal.aborted && document.visibilityState !== 'hidden')
          timer = setTimeout(() => void refresh(), 2_000);
      }
    };
    const resume = () => {
      if (document.visibilityState !== 'hidden') void refresh();
      else clearTimeout(timer);
    };
    void refresh();
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      controller.abort();
      clearTimeout(timer);
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [path]);
  // Navigation must hide the previous board before the new request has even started.
  return result.path === path ? result.state : { status: 'loading' };
}
