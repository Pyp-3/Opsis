import { useEffect, useState } from 'react';

/** Wide enough for the chat to sit beside a usable canvas. */
export const DOCK_QUERY = '(min-width: 1100px)';

/** Whether a media query matches, following changes. False where matchMedia is missing. */
export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) return;
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}
