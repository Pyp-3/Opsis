/**
 * The local application exposes this machine's CLI accounts, so it listens on loopback only.
 * A personal server (OPSIS_PUBLIC_ORIGIN) may listen elsewhere for a proxy on another host;
 * it then refuses any request that did not arrive over HTTPS through a trusted proxy.
 */
export function listenHost(value = '127.0.0.1', serverMode = false) {
  if (serverMode || ['127.0.0.1', '::1', 'localhost'].includes(value)) return value;
  throw new Error(
    'The local application listens on loopback only. To host Opsis behind an HTTPS proxy, set OPSIS_PUBLIC_ORIGIN; see docs/SERVER.md.',
  );
}
