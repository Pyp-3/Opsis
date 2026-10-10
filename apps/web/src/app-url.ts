/** Vite's build-time mount point; desktop and ordinary development builds use `/`. */
const base = import.meta.env.BASE_URL.replace(/\/$/, '');

export function appUrl(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//'))
    throw new Error('Expected an application-relative path.');
  return `${base}${path}`;
}

export function appPath(pathname = location.pathname): string {
  if (!base) return pathname;
  if (pathname === base) return '/';
  return pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : pathname;
}

/** Preserve fetch streaming, cancellation and native desktop transport. */
export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return globalThis.fetch(appUrl(path), init);
}
