import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMAIL_DEMO } from '@opsis/schema';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { prepareAttachments } from './attachments.js';

const base64 = (text: string) => Buffer.from(text).toString('base64');
const PNG = { name: 'diagram.png', mediaType: 'image/png', data: base64('fake png') };

describe('document uploads', () => {
  it('inlines text, stages images, and extracts PDF text for both agents', async () => {
    const extract = vi.fn(async () => 'Quarterly process: intake, review, approval and payment.');
    const prepared = await prepareAttachments(
      [
        { name: 'notes.md', mediaType: 'text/markdown', data: base64('# Steps\nA then B') },
        { name: 'policy.pdf', mediaType: 'application/pdf', data: base64('%PDF') },
        PNG,
      ],
      'codex',
      extract,
    );
    expect(prepared.documents.map((doc) => doc.name)).toEqual(['notes.md', 'policy.pdf']);
    expect(prepared.files).toEqual([
      expect.objectContaining({ name: '3-diagram.png', kind: 'image' }),
    ]);
  });

  it('hands a scanned PDF to Claude but refuses it for Codex', async () => {
    const scanned = { name: 'scan.pdf', mediaType: 'application/pdf', data: base64('%PDF') };
    const none = async () => '';
    await expect(prepareAttachments([scanned], 'claude', none)).resolves.toMatchObject({
      files: [{ name: '1-scan.pdf', kind: 'pdf' }],
    });
    await expect(prepareAttachments([scanned], 'codex', none)).rejects.toThrow(/no text layer/);
  });

  it('rejects unsupported and binary files', async () => {
    await expect(
      prepareAttachments(
        [{ name: 'a.exe', mediaType: 'application/x-msdownload', data: '' }],
        'claude',
      ),
    ).rejects.toThrow(/not a supported type/);
    await expect(
      prepareAttachments(
        [{ name: 'a.txt', mediaType: 'text/plain', data: base64('a\u0000b') }],
        'claude',
      ),
    ).rejects.toThrow(/binary/);
  });

  const apps: FastifyInstance[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('sends extracted text in the prompt and staged files to the agent', async () => {
    const complete = vi.fn(async () => JSON.stringify(EMAIL_DEMO));
    const app = buildApp({
      databasePath: ':memory:',
      llm: null,
      boardClientFactory: async () => ({ model: 'test', complete }),
    });
    apps.push(app);
    const result = await app.inject({
      method: 'POST',
      url: '/v1/boards/generate',
      payload: {
        agent: 'claude',
        prompt: 'Diagram this',
        attachments: [
          { name: 'notes.txt', mediaType: 'text/plain', data: base64('Intake then review') },
          PNG,
        ],
      },
    });
    expect(result.statusCode).toBe(200);
    const [request, , files] = complete.mock.calls[0] as unknown as [
      { system: string; user: string },
      AbortSignal,
      { name: string }[],
    ];
    expect(JSON.parse(request.user).documents).toEqual([
      { name: 'notes.txt', text: 'Intake then review' },
    ]);
    expect(request.system).toContain('attachments/2-diagram.png');
    expect(files.map((file) => file.name)).toEqual(['2-diagram.png']);
  });

  it('refuses uploads for the demo agent', async () => {
    const app = buildApp({ databasePath: ':memory:', llm: null });
    apps.push(app);
    const result = await app.inject({
      method: 'POST',
      url: '/v1/boards/generate',
      payload: { agent: 'demo', prompt: 'Explain email', attachments: [PNG] },
    });
    expect(result.statusCode).toBe(400);
  });
});
