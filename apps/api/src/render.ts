import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { MAX_PREVIEW_SVG, previewSvgProblem } from '@opsis/schema';

/**
 * Board previews for agents: the MCP tools build an SVG preview from the shared renderer and
 * this route turns it into a PNG they can look at. Only the plain shapes the preview uses are
 * accepted (`previewSvgProblem`), so the rasteriser never loads files, links or scripts.
 */

const RenderSchema = z.object({ svg: z.string().min(1).max(MAX_PREVIEW_SVG) }).strict();
/** Previews are at most 2000 pixels a side; this leaves room without unbounded work. */
const MAX_PIXELS = 2048 * 2048;

type Rasterise = (svg: string) => Promise<Buffer>;

async function sharpRasterise(svg: string): Promise<Buffer> {
  const { default: sharp } = await import('sharp');
  return sharp(Buffer.from(svg), { limitInputPixels: MAX_PIXELS }).png().toBuffer();
}

/**
 * `POST /v1/render` with `{ svg }` returns `{ mimeType: "image/png", data }` (base64).
 * `requireUser` says whether this process checks the caller itself; the desktop's speech
 * service leaves that to the native host that forwards to it.
 */
export function registerRender(
  app: FastifyInstance,
  {
    requireUser,
    rasterise = sharpRasterise,
  }: {
    requireUser: (request: FastifyRequest, reply: FastifyReply) => unknown;
    rasterise?: Rasterise;
  },
) {
  let busy = Promise.resolve();
  app.post('/v1/render', { bodyLimit: MAX_PREVIEW_SVG + 1024 }, async (request, reply) => {
    if (!requireUser(request, reply)) return reply;
    const body = RenderSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ message: 'Send the preview as { svg }.' });
    const problem = previewSvgProblem(body.data.svg);
    if (problem) return reply.code(400).send({ message: problem });
    // One render at a time: previews are occasional, and this bounds memory use.
    const turn = busy.then(() => rasterise(body.data.svg));
    busy = turn.then(
      () => undefined,
      () => undefined,
    );
    try {
      const png = await turn;
      return { mimeType: 'image/png', data: png.toString('base64') };
    } catch (error) {
      request.log.warn({ err: error }, 'preview render failed');
      return reply.code(422).send({ message: 'The preview could not be rendered.' });
    }
  });
}
