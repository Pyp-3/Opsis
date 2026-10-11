import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import sharp from 'sharp';
import { createEmptyBoard, infoImageMarkup, MAX_IMAGE_SIDE } from '@opsis/schema';
import { buildApp } from './app';

const picture = (format: 'png' | 'jpeg' | 'webp', width = 32, height = 20) => {
  const blank = sharp({
    create: { width, height, channels: 3, background: { r: 20, g: 120, b: 200 } },
  });
  return blank.toFormat(format).toBuffer();
};

it('stores Info images once, checks their bytes and serves them only to readers', async () => {
  const app = buildApp({ databasePath: ':memory:', speech: null });
  const signup = async (email: string) =>
    String(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/auth/signup',
          payload: { name: email, email, password: 'correct horse' },
        })
      ).headers['set-cookie'],
    ).split(';')[0]!;
  try {
    const owner = await signup('owner@example.com');
    const editor = await signup('editor@example.com');
    const stranger = await signup('stranger@example.com');
    const as = (cookie: string | null) => (cookie ? { headers: { cookie } } : {});
    const created = (
      await app.inject({
        method: 'POST',
        url: '/v1/boards',
        ...as(owner),
        payload: { title: 'Book' },
      })
    ).json();
    const path = `/v1/boards/${created.id}`;
    const upload = (cookie: string | null, data: Buffer | string) =>
      app.inject({
        method: 'POST',
        url: `${path}/images`,
        ...as(cookie),
        payload: { data: typeof data === 'string' ? data : data.toString('base64') },
      });

    // Each format is recognised by its bytes; the name is the SHA-256 of what was sent.
    const png = await picture('png');
    const stored = await upload(owner, png);
    expect(stored.statusCode).toBe(201);
    const id = createHash('sha256').update(png).digest('hex');
    expect(stored.json()).toEqual({ id, mediaType: 'image/png', width: 32, height: 20 });
    for (const format of ['jpeg', 'webp'] as const)
      expect((await upload(owner, await picture(format))).json()).toMatchObject({
        mediaType: `image/${format}`,
      });
    // The same bytes again are the same image.
    expect((await upload(owner, png)).json().id).toBe(id);

    // Anything else is refused: SVG with script, HTML, oversize sides, sloppy base64, no sign-in.
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    expect((await upload(owner, svg)).statusCode).toBe(400);
    expect((await upload(owner, Buffer.from('<html><script>alert(1)</script>'))).statusCode).toBe(
      400,
    );
    expect((await upload(owner, await picture('png', MAX_IMAGE_SIDE + 1, 4))).statusCode).toBe(400);
    expect((await upload(owner, `${png.toString('base64')}!`)).statusCode).toBe(400);
    expect((await upload(null, png)).statusCode).toBe(401);
    expect((await upload(stranger, png)).statusCode).toBe(404);

    // Served as the checked type, never sniffed, sandboxed, to the owner only while private.
    const read = (cookie: string | null, image = id) =>
      app.inject({ method: 'GET', url: `${path}/images/${image}`, ...as(cookie) });
    const served = await read(owner);
    expect(served.statusCode).toBe(200);
    expect(served.headers).toMatchObject({
      'content-type': 'image/png',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    });
    expect(served.rawPayload.equals(png)).toBe(true);
    expect((await read(stranger)).statusCode).toBe(404);
    expect((await read(null)).statusCode).toBe(401);
    const guest = (image = id) =>
      app.inject({ method: 'GET', url: `/v1/guest/boards/${created.id}/images/${image}` });
    expect((await guest()).statusCode).toBe(404);
    expect((await read(owner, '../../etc/passwd')).statusCode).toBe(404);

    // An invited editor may add images; a viewer of a link board may only read them.
    await app.inject({
      method: 'PUT',
      url: `${path}/editors`,
      ...as(owner),
      payload: { email: 'editor@example.com', enabled: true, revision: 1 },
    });
    expect((await upload(editor, await picture('png', 8, 8))).statusCode).toBe(201);
    const revision = (await app.inject({ method: 'GET', url: path, ...as(owner) })).json().revision;
    await app.inject({
      method: 'PATCH',
      url: path,
      ...as(owner),
      payload: { revision, visibility: 'link' },
    });
    expect((await read(stranger)).statusCode).toBe(200);
    expect((await guest()).statusCode).toBe(200);
    expect((await upload(stranger, png)).statusCode).toBe(403);

    // Another board cannot read an image it does not show, but a copy that shows it can.
    const other = (
      await app.inject({
        method: 'POST',
        url: '/v1/boards',
        ...as(stranger),
        payload: { title: 'Mine' },
      })
    ).json();
    const fromOther = () =>
      app.inject({ method: 'GET', url: `/v1/boards/${other.id}/images/${id}`, ...as(stranger) });
    expect((await fromOther()).statusCode).toBe(404);
    const board = { ...createEmptyBoard('Mine'), info: { text: infoImageMarkup(id, 'Rack') } };
    const saved = await app.inject({
      method: 'PUT',
      url: `/v1/boards/${other.id}`,
      ...as(stranger),
      payload: { revision: 1, snapshot: { board, past: [], future: [] } },
    });
    expect(saved.statusCode).toBe(200);
    expect((await fromOther()).statusCode).toBe(200);

    // The owner's copy of the book keeps its images after the original is deleted.
    const current = (await app.inject({ method: 'GET', url: path, ...as(owner) })).json();
    await app.inject({
      method: 'PUT',
      url: path,
      ...as(owner),
      payload: {
        revision: current.revision,
        snapshot: { board: { ...board, title: 'Book' }, past: [], future: [] },
      },
    });
    const copy = (
      await app.inject({
        method: 'POST',
        url: `${path}/duplicate`,
        ...as(owner),
        payload: { revision: current.revision + 1 },
      })
    ).json();
    await app.inject({
      method: 'DELETE',
      url: path,
      ...as(owner),
      payload: { revision: current.revision + 1 },
    });
    expect(
      (await app.inject({ method: 'GET', url: `/v1/boards/${copy.id}/images/${id}`, ...as(owner) }))
        .statusCode,
    ).toBe(200);
    expect((await read(owner)).statusCode).toBe(404);
  } finally {
    await app.close();
  }
});
