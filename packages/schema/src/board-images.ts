import { z } from 'zod';
import type { BoardDocument, BoardSnapshot } from './board';
import { IMAGE_ID_PATTERN, infoTextImages } from './page-info';

/**
 * Images in a page's Info are stored once per board, outside the board document, and named by
 * the SHA-256 of their bytes. Keeping them out of the document means undo history and saved
 * revisions, which copy the document, never copy an image.
 *
 * Only PNG, JPEG and WebP are accepted, recognised by their signature rather than by any name
 * or declared type; SVG and other formats that can carry script are refused. The browser
 * re-encodes a chosen picture before upload (dropping metadata such as location), and both hosts
 * check the bytes again with `imageFileInfo` before storing them.
 */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
/** Longest side the browser re-encodes to, and the most a stored image may have. */
export const MAX_IMAGE_SIDE = 2400;
/** Images one board may store, counting ones its saved revisions still show. */
export const MAX_BOARD_IMAGES = 200;
/** How many leading bytes `imageFileInfo` needs to find the dimensions. */
export const IMAGE_HEADER_BYTES = 256 * 1024;

export const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];
export type ImageFileInfo = { mediaType: ImageMediaType; width: number; height: number };

const u16be = (bytes: Uint8Array, at: number) => (bytes[at]! << 8) | bytes[at + 1]!;
const u32be = (bytes: Uint8Array, at: number) =>
  ((bytes[at]! << 24) >>> 0) + (bytes[at + 1]! << 16) + (bytes[at + 2]! << 8) + bytes[at + 3]!;
const ascii = (bytes: Uint8Array, at: number, text: string) =>
  [...text].every((char, index) => bytes[at + index] === char.charCodeAt(0));

function pngSize(bytes: Uint8Array) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || signature.some((byte, index) => bytes[index] !== byte)) return null;
  if (!ascii(bytes, 12, 'IHDR')) return null;
  return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
}

// Start-of-frame markers carry the dimensions; C4, C8 and CC are other tables.
const JPEG_FRAMES = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);
function jpegSize(bytes: Uint8Array) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1]!;
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    if (JPEG_FRAMES.has(marker))
      return { height: u16be(bytes, at + 5), width: u16be(bytes, at + 7) };
    const length = u16be(bytes, at + 2);
    if (length < 2) return null;
    at += 2 + length;
  }
  return null;
}

function webpSize(bytes: Uint8Array) {
  if (bytes.length < 30 || !ascii(bytes, 0, 'RIFF') || !ascii(bytes, 8, 'WEBP')) return null;
  if (ascii(bytes, 12, 'VP8 ')) {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    return {
      width: (bytes[26]! | (bytes[27]! << 8)) & 0x3fff,
      height: (bytes[28]! | (bytes[29]! << 8)) & 0x3fff,
    };
  }
  if (ascii(bytes, 12, 'VP8L')) {
    if (bytes[20] !== 0x2f) return null;
    return {
      width: 1 + (((bytes[22]! & 0x3f) << 8) | bytes[21]!),
      height: 1 + (((bytes[24]! & 0x0f) << 10) | (bytes[23]! << 2) | ((bytes[22]! & 0xc0) >> 6)),
    };
  }
  if (ascii(bytes, 12, 'VP8X'))
    return {
      width: 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16)),
      height: 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16)),
    };
  return null;
}

/**
 * What an uploaded file is, from its own bytes (the first `IMAGE_HEADER_BYTES` are enough), or
 * null unless it is a PNG, JPEG or WebP picture within the size limits.
 */
export function imageFileInfo(bytes: Uint8Array, totalBytes = bytes.length): ImageFileInfo | null {
  if (totalBytes < 1 || totalBytes > MAX_IMAGE_BYTES) return null;
  const found: [ImageMediaType, { width: number; height: number } | null][] = [
    ['image/png', pngSize(bytes)],
    ['image/jpeg', jpegSize(bytes)],
    ['image/webp', webpSize(bytes)],
  ];
  for (const [mediaType, size] of found) {
    if (!size) continue;
    const { width, height } = size;
    if (width < 1 || height < 1 || width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE) return null;
    return { mediaType, width, height };
  }
  return null;
}

function documentImages(board: BoardDocument | null, into: Set<string>) {
  if (!board) return;
  const texts = [board.info?.text, ...(board.pages ?? []).map((page) => page.content?.info?.text)];
  for (const text of texts) for (const image of infoTextImages(text ?? '')) into.add(image);
}

/**
 * Every stored image a board shows on any page, including in its undo history, so an image
 * stays readable through undo, redo and restored revisions.
 */
export function snapshotImageIds(snapshot: BoardSnapshot): string[] {
  const ids = new Set<string>();
  for (const board of [snapshot.board, ...snapshot.past, ...snapshot.future])
    documentImages(board, ids);
  return [...ids].sort();
}

/** The stored images a single board document shows on any page. */
export function boardImageIds(board: BoardDocument): string[] {
  const ids = new Set<string>();
  documentImages(board, ids);
  return [...ids].sort();
}

/**
 * A picture carried inside an exported file (a collection bundle or an editable board file), so
 * the file shows its pictures on any Opsis server. Importing uploads each one again, where the
 * server checks it like any upload; one whose bytes do not hash to its id is skipped.
 */
export const BundledImageSchema = z
  .object({
    id: z.string().regex(IMAGE_ID_PATTERN),
    mediaType: z.enum(IMAGE_MEDIA_TYPES),
    data: z
      .string()
      .max(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4)
      .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  })
  .strict();
export type BundledImage = z.infer<typeof BundledImageSchema>;
export const BundledImagesSchema = z
  .array(BundledImageSchema)
  .max(MAX_BOARD_IMAGES * 10)
  .refine((images) => new Set(images.map((image) => image.id)).size === images.length, {
    message: 'Duplicate pictures.',
  });
