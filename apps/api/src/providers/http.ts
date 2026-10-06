import { setTimeout as delay } from 'node:timers/promises';
import { API_ORIGINS, type ProviderTransport } from './api-client';
import { HarnessError } from '../harness/errors';

let activeCompletions = 0;
/** Keep instance-wide API generation concurrency bounded, including background polling. */
export async function withProviderSlot<T>(work: () => Promise<T>): Promise<T> {
  if (activeCompletions >= 2) throw new HarnessError('provider_busy');
  activeCompletions++;
  try {
    return await work();
  } finally {
    activeCompletions--;
  }
}

/** Fixed provider origins, no redirects, bounded output, and no error-body logging. */
export const providerHttp: ProviderTransport = async (request, caller) => {
  const timeout = AbortSignal.timeout(request.path.endsWith(':cancel') ? 5000 : 180000);
  const signal = caller ? AbortSignal.any([caller, timeout]) : timeout;
  try {
    const response = await fetch(API_ORIGINS[request.provider] + request.path, {
      method: request.method,
      redirect: 'error',
      signal,
      headers: {
        'content-type': 'application/json',
        ...(request.provider === 'antigravity'
          ? { 'x-goog-api-key': request.key, 'Api-Revision': '2026-05-20' }
          : { authorization: `Bearer ${request.key}` }),
      },
      ...(request.body === undefined ? {} : { body: request.body }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new HarnessError(
        response.status === 401 || response.status === 403
          ? 'provider_auth'
          : response.status === 429
            ? 'provider_quota'
            : 'provider_failed',
      );
    }
    const reader = response.body?.getReader();
    if (!reader) throw new HarnessError('harness_malformed');
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.length;
        if (length > 4 * 1024 * 1024) throw new HarnessError('harness_overflow');
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch {
      throw new HarnessError('harness_malformed');
    }
  } catch (error) {
    if (error instanceof HarnessError) throw error;
    throw new HarnessError(
      caller?.aborted
        ? 'harness_cancelled'
        : timeout.aborted
          ? 'harness_timeout'
          : 'provider_failed',
    );
  }
};
export async function providerPause(signal?: AbortSignal) {
  try {
    await delay(1000, undefined, { signal });
  } catch {
    throw new HarnessError('harness_cancelled');
  }
}
