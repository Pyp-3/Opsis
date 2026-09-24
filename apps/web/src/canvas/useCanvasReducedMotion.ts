import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/** Resolves the session override, falling back to the operating-system motion preference. */
export function useCanvasReducedMotion(override: boolean | null): boolean {
  const [systemPreference, setSystemPreference] = useState(
    () => globalThis.matchMedia?.(QUERY).matches ?? false,
  );

  useEffect(() => {
    const media = globalThis.matchMedia?.(QUERY);
    if (!media) return;
    const update = () => setSystemPreference(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return override ?? systemPreference;
}
