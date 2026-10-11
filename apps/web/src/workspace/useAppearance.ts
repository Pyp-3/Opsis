import { useEffect, useRef, useState } from 'react';
import {
  applyAppTheme,
  readAppTheme,
  saveAppearance,
  writeAppTheme,
  type AppTheme,
} from './app-theme';

/**
 * The account's look, changed live: a change applies at once and is cached in this browser, and
 * saving to the account waits until a picker stops moving. Used by Settings and the Info book's
 * text controls.
 */
export function useAppearance() {
  const [theme, setThemeState] = useState<AppTheme>(() => readAppTheme());
  const [saved, setSaved] = useState<'saved' | 'saving' | 'failed'>('saved');
  const pending = useRef<{ timer: number; theme: AppTheme } | null>(null);
  useEffect(
    () => () => {
      if (!pending.current) return;
      window.clearTimeout(pending.current.timer);
      void saveAppearance(pending.current.theme).catch(() => undefined);
    },
    [],
  );
  const set = (next: AppTheme) => {
    setThemeState(next);
    applyAppTheme(next);
    writeAppTheme(next);
    setSaved('saving');
    if (pending.current) window.clearTimeout(pending.current.timer);
    pending.current = {
      theme: next,
      timer: window.setTimeout(() => {
        pending.current = null;
        saveAppearance(next).then(
          () => setSaved('saved'),
          () => setSaved('failed'),
        );
      }, 400),
    };
  };
  return { theme, set, saved };
}
