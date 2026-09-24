import {
  ErrorResponseSchema,
  ExplanationSchema,
  OSGSchema,
  VisualizeProgressSchema,
  type ErrorResponse,
  type ExplainRequest,
  type Explanation,
  type OSG,
  type VisualizeProgress,
  type VisualizeRequest,
} from '@opsis/schema';
import { t } from '@opsis/ui';

/**
 * Client for the Opsis API (PROMPT.md §11). Calls go to same-origin `/v1`; in development
 * Vite proxies them to the API. Every response is validated with the shared Zod schemas.
 */

/** A failure the UI can show: the API's `{ code, message, stage, retryable }` shape. */
export class ApiError extends Error {
  readonly code: string;
  readonly stage: string;
  readonly retryable: boolean;
  constructor({ code, message, stage, retryable }: ErrorResponse) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.stage = stage;
    this.retryable = retryable;
  }
}

const networkError = () =>
  new ApiError({
    code: 'network_error',
    message: t('state.network'),
    stage: 'request',
    retryable: true,
  });

const unexpectedError = (stage: string) =>
  new ApiError({ code: 'bad_response', message: t('state.unexpected'), stage, retryable: true });

/** Turns an error body (or anything else) into an `ApiError`. */
function toApiError(body: unknown, stage: string): ApiError {
  const parsed = ErrorResponseSchema.safeParse(body);
  return parsed.success ? new ApiError(parsed.data) : unexpectedError(stage);
}

/** True when the error came from an `AbortController`. */
export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

async function request(
  path: string,
  init: RequestInit,
  stage: string,
  fetcher: typeof fetch,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(path, init);
  } catch (error) {
    if (isAbort(error)) throw error;
    throw networkError();
  }
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) throw toApiError(body, stage);
  return body;
}

const jsonInit = (body: unknown, signal?: AbortSignal): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json' },
  body: JSON.stringify(body),
  ...(signal ? { signal } : {}),
});

/** One parsed Server-Sent Event. */
export type SseEvent = { event: string; data: string };

/**
 * Incremental SSE parser: feed it text chunks as they arrive and it returns every event
 * completed so far. Handles events split across chunks and CRLF line endings.
 */
export function createSseParser(): (chunk: string) => SseEvent[] {
  let buffer = '';
  return (chunk) => {
    buffer += chunk.replace(/\r\n?/g, '\n');
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';
    return blocks.flatMap((block) => {
      let event = 'message';
      const data: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      return data.length > 0 ? [{ event, data: data.join('\n') }] : [];
    });
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * `POST /v1/visualize` with SSE progress. Calls `onProgress` for each pipeline stage and
 * resolves with the validated OSG from the `done` event.
 */
export async function visualize(
  body: VisualizeRequest,
  onProgress: (stage: VisualizeProgress) => void,
  { signal, fetcher = fetch }: { signal?: AbortSignal; fetcher?: typeof fetch } = {},
): Promise<OSG> {
  let response: Response;
  try {
    response = await fetcher('/v1/visualize', {
      ...jsonInit(body, signal),
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    });
  } catch (error) {
    if (isAbort(error)) throw error;
    throw networkError();
  }
  if (!response.ok || !response.body) {
    throw toApiError(await response.json().catch(() => undefined), 'visualize');
  }
  const parse = createSseParser();
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    for (const { event, data } of parse(value)) {
      const payload = parseJson(data);
      if (event === 'error') throw toApiError(payload, 'visualize');
      const stage = VisualizeProgressSchema.safeParse(event);
      if (!stage.success) continue;
      onProgress(stage.data);
      if (stage.data === 'done') {
        const osg = OSGSchema.safeParse((payload as { osg?: unknown } | undefined)?.osg);
        if (!osg.success) throw unexpectedError('visualize');
        await reader.cancel().catch(() => undefined);
        return osg.data;
      }
    }
  }
  throw unexpectedError('visualize');
}

/** `POST /v1/explain` → validated `Explanation`. */
export async function explain(
  body: ExplainRequest,
  { signal, fetcher = fetch }: { signal?: AbortSignal; fetcher?: typeof fetch } = {},
): Promise<Explanation> {
  const result = ExplanationSchema.safeParse(
    await request('/v1/explain', jsonInit(body, signal), 'explain', fetcher),
  );
  if (!result.success) throw unexpectedError('explain');
  return result.data;
}

/** `POST /v1/drilldown` → validated child `OSG`. */
export async function drilldown(
  body: { osgId: string; nodeId: string },
  { signal, fetcher = fetch }: { signal?: AbortSignal; fetcher?: typeof fetch } = {},
): Promise<OSG> {
  const result = OSGSchema.safeParse(
    await request('/v1/drilldown', jsonInit(body, signal), 'drilldown', fetcher),
  );
  if (!result.success) throw unexpectedError('drilldown');
  return result.data;
}

/** `GET /v1/osg/:id` → validated `OSG`. */
export async function loadOsg(
  id: string,
  { fetcher = fetch }: { fetcher?: typeof fetch } = {},
): Promise<OSG> {
  const result = OSGSchema.safeParse(
    await request(
      `/v1/osg/${encodeURIComponent(id)}`,
      { headers: { accept: 'application/json' } },
      'storage',
      fetcher,
    ),
  );
  if (!result.success) throw unexpectedError('storage');
  return result.data;
}
