/** Opsis exposes local CLI accounts and is currently a loopback-only application. */
export function listenHost(value = '127.0.0.1') {
  if (!['127.0.0.1', '::1', 'localhost'].includes(value))
    throw new Error(
      'Opsis currently supports loopback hosting only. See docs/RELEASE-READINESS.md before deploying a network service.',
    );
  return value;
}
