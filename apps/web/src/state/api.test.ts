import { describe, expect, it } from 'vitest';
import { loadFixture } from '../scene/fixtures';
import { ApiError, createSseParser, explain, saveOsg, shareOsg, visualize } from './api';

/** A fetch that answers with an SSE body delivered in the given chunks. */
function sseFetch(chunks: string[], status = 200): typeof fetch {
  return async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
          controller.close();
        },
      }),
      { status, headers: { 'content-type': 'text/event-stream' } },
    );
}

const jsonFetch =
  (body: unknown, status = 200): typeof fetch =>
  async () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('createSseParser', () => {
  it('parses events split across chunks and CRLF line endings', () => {
    const parse = createSseParser();
    expect(parse('event: parsing\r\ndata: {"stage":')).toEqual([]);
    expect(parse('"parsing"}\r\n\r\nevent: mapping\ndata: {}\n\n')).toEqual([
      { event: 'parsing', data: '{"stage":"parsing"}' },
      { event: 'mapping', data: '{}' },
    ]);
  });

  it('joins multi-line data and defaults the event name', () => {
    expect(createSseParser()('data: a\ndata: b\n\n')).toEqual([{ event: 'message', data: 'a\nb' }]);
  });
});

describe('visualize', () => {
  const osg = loadFixture('sandwich');

  it('reports each stage and resolves with the validated OSG', async () => {
    const stages: string[] = [];
    const done = `event: done\ndata: ${JSON.stringify({ stage: 'done', osg })}\n\n`;
    const result = await visualize({ utterance: 'x' }, (s) => stages.push(s), {
      fetcher: sseFetch([
        'event: parsing\ndata: {"stage":"parsing"}\n\n',
        'event: mapping\ndata: {"stage":"mapping"}\n\nevent: layout\ndata: {"stage":"layout"}\n\n',
        done.slice(0, 40),
        done.slice(40),
      ]),
    });
    expect(stages).toEqual(['parsing', 'mapping', 'layout', 'done']);
    expect(result.id).toBe(osg.id);
  });

  it('turns an SSE error event into an ApiError', async () => {
    const error = {
      code: 'unsafe_input',
      message: 'Let us try another sentence.',
      stage: 'parse',
      retryable: false,
    };
    await expect(
      visualize({ utterance: 'x' }, () => undefined, {
        fetcher: sseFetch([`event: error\ndata: ${JSON.stringify(error)}\n\n`]),
      }),
    ).rejects.toMatchObject({ code: 'unsafe_input', retryable: false });
  });

  it('rejects an invalid OSG in the done event', async () => {
    await expect(
      visualize({ utterance: 'x' }, () => undefined, {
        fetcher: sseFetch(['event: done\ndata: {"stage":"done","osg":{"id":1}}\n\n']),
      }),
    ).rejects.toMatchObject({ code: 'bad_response' });
  });

  it('reports a network failure as retryable', async () => {
    const offline: typeof fetch = async () => {
      throw new TypeError('Failed to fetch');
    };
    await expect(
      visualize({ utterance: 'x' }, () => undefined, { fetcher: offline }),
    ).rejects.toMatchObject({ code: 'network_error', retryable: true });
  });

  it('uses the error body of a non-2xx reply', async () => {
    const error = {
      code: 'rate_limit_exceeded',
      message: 'Slow down.',
      stage: 'request',
      retryable: true,
    };
    await expect(
      visualize({ utterance: 'x' }, () => undefined, { fetcher: jsonFetch(error, 429) }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

describe('explain', () => {
  it('validates the explanation', async () => {
    const body = {
      schemaVersion: 'exp/1',
      nodeId: 'e_tomato',
      osgId: '20000000-0000-4000-8000-000000000002',
      level: 'summary',
      audience: 'teen',
      summary: 'A tomato is a juicy fruit.',
      confidence: 'high',
    };
    const request = {
      osgId: body.osgId,
      nodeId: 'e_tomato',
      level: 'summary',
      audience: 'teen',
    } as const;
    await expect(explain(request, { fetcher: jsonFetch(body) })).resolves.toMatchObject({
      summary: body.summary,
    });
    await expect(
      explain(request, { fetcher: jsonFetch({ ...body, confidence: 'maybe' }) }),
    ).rejects.toMatchObject({ code: 'bad_response' });
  });
});

describe('OSG persistence', () => {
  it('saves to the id route and validates the returned OSG', async () => {
    const osg = loadFixture('sandwich');
    let request: { input: string; init?: RequestInit } | undefined;
    const fetcher: typeof fetch = async (input, init) => {
      request = { input: String(input), ...(init ? { init } : {}) };
      return new Response(JSON.stringify(osg), { status: 200 });
    };
    await expect(saveOsg(osg, { fetcher })).resolves.toEqual(osg);
    expect(request?.input).toBe(`/v1/osg/${osg.id}`);
    expect(request?.init?.method).toBe('PUT');
    expect(JSON.parse(String(request?.init?.body))).toEqual(osg);
  });

  it('creates and validates a read-only share link', async () => {
    const osg = loadFixture('sandwich');
    const body = {
      token: 'token',
      osgId: osg.id,
      url: '/v1/shared/token',
      readOnly: true as const,
    };
    await expect(shareOsg(osg.id, { fetcher: jsonFetch(body) })).resolves.toEqual(body);
    await expect(
      shareOsg(osg.id, { fetcher: jsonFetch({ ...body, readOnly: false }) }),
    ).rejects.toMatchObject({ code: 'bad_response' });
  });
});
