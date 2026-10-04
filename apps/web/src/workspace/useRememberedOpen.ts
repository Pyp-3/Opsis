import { useCallback, useState } from 'react';

/**
 * Whether a tuckable piece of the workspace is open, remembered on this device so the
 * reader's preferred amount of canvas space survives reloads. Storage is a convenience
 * only: when it is unavailable the toggle still works for the session.
 */
export function useRememberedOpen(key: string, initial: boolean) {
  const [open, setOpenState] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? initial : stored === 'true';
    } catch {
      return initial;
    }
  });
  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      try {
        localStorage.setItem(key, String(next));
      } catch {
        // Remembering the choice is a convenience only.
      }
    },
    [key],
  );
  return [open, setOpen] as const;
}
