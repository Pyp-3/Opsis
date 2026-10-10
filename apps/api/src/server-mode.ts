import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A personal Opsis server: the Fastify host behind an HTTPS reverse proxy (such as Nginx) at
 * one public origin. Its operator creates the accounts, so sign-up is closed, and the agent
 * CLIs are the ones configured on the server, so accounts cannot choose an executable path.
 * Without `OPSIS_PUBLIC_ORIGIN` the host stays the loopback-only local application.
 */
export type ServerMode = {
  /** The exact origin people open, such as `https://opsis.example.com`. */
  publicOrigin: string;
  /** `host[:port]` of that origin; requests naming any other host are refused. */
  publicHost: string;
  /** Which peers may set X-Forwarded-* headers (Fastify `trustProxy`); loopback by default. */
  trustedProxy: string;
  /** The built web application (`apps/web/dist`) this host serves. */
  webRoot: string;
  /** Operator-managed, public-view-only accounts. Never accepted from a browser. */
  guestEmails?: string[];
};

const defaultWebRoot = fileURLToPath(new URL('../../web/dist', import.meta.url));

export function serverModeFromEnv(env: NodeJS.ProcessEnv = process.env): ServerMode | null {
  const origin = env.OPSIS_PUBLIC_ORIGIN?.trim();
  if (!origin) return null;
  let url: URL | undefined;
  try {
    url = new URL(origin);
  } catch {
    url = undefined;
  }
  if (
    url?.protocol !== 'https:' ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error(
      'OPSIS_PUBLIC_ORIGIN must be an HTTPS origin without a path, such as https://opsis.example.com.',
    );
  const trustedProxy = env.OPSIS_TRUSTED_PROXY?.trim() || 'loopback';
  const webRoot = env.OPSIS_WEB_ROOT?.trim() || defaultWebRoot;
  if (!existsSync(join(webRoot, 'index.html')))
    throw new Error(
      `No built web app at ${webRoot}. Run "pnpm --filter web build" or set OPSIS_WEB_ROOT.`,
    );
  const guestEmails = env.OPSIS_GUEST_EMAILS?.split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  return {
    publicOrigin: url.origin,
    publicHost: url.host,
    trustedProxy,
    webRoot,
    ...(guestEmails?.length ? { guestEmails } : {}),
  };
}

/**
 * The web app's needs: its own scripts plus WebAssembly (process engine, narrator), workers,
 * inline styles from React, Google Fonts, and the narrator's model and ONNX runtime downloads.
 */
export const WEB_APP_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net",
  "worker-src 'self' blob:",
  "connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
