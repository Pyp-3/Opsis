import { useEffect, useState } from 'react';
import { appPath, appUrl } from './app-url';

const CHANGE = 'opsis:navigate';

/** Client-side navigation that keeps browser back/forward working. */
export function navigate(path: string, replace = false) {
  const target = appUrl(path);
  if (target === location.pathname + location.search + location.hash) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', target);
  window.dispatchEvent(new Event(CHANGE));
}

export function usePath() {
  const [path, setPath] = useState(() => appPath());
  useEffect(() => {
    const update = () => setPath(appPath());
    window.addEventListener('popstate', update);
    window.addEventListener(CHANGE, update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener(CHANGE, update);
    };
  }, []);
  return path;
}
