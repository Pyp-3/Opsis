import { describe, expect, it } from 'vitest';
import {
  MAX_IMAGE_BYTES,
  imageFileInfo,
  snapshotImageIds,
  boardImageIds,
  createEmptyBoard,
  type BoardDocument,
} from './index';

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(
    parts.flatMap((part) =>
      typeof part === 'string' ? [...part].map((char) => char.charCodeAt(0)) : part,
    ),
  );
const be32 = (value: number) => [
  value >>> 24,
  (value >> 16) & 255,
  (value >> 8) & 255,
  value & 255,
];
const le16 = (value: number) => [value & 255, value >> 8];
const le24 = (value: number) => [value & 255, (value >> 8) & 255, value >> 16];

const png = (width: number, height: number) =>
  bytes(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    be32(13),
    'IHDR',
    be32(width),
    be32(height),
    [8, 6, 0, 0, 0],
  );
const jpeg = (width: number, height: number) =>
  bytes(
    [0xff, 0xd8],
    // An APP1 segment before the frame, as cameras write.
    [0xff, 0xe1, 0, 8],
    'Exif\0\0',
    [0xff, 0xc2, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3],
    new Array(9).fill(0),
  );
const webp = (chunk: string, body: number[]) =>
  bytes('RIFF', [0, 0, 0, 0], 'WEBP', chunk, [0, 0, 0, 0], body, new Array(16).fill(0));

describe('Stored image checks', () => {
  it('recognises PNG, JPEG and WebP by their bytes and reads their size', () => {
    expect(imageFileInfo(png(640, 480))).toEqual({
      mediaType: 'image/png',
      width: 640,
      height: 480,
    });
    expect(imageFileInfo(jpeg(1024, 768))).toEqual({
      mediaType: 'image/jpeg',
      width: 1024,
      height: 768,
    });
    // Lossy: frame tag, start code, then 14-bit sizes.
    expect(
      imageFileInfo(webp('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(300), ...le16(200)])),
    ).toEqual({
      mediaType: 'image/webp',
      width: 300,
      height: 200,
    });
    // Lossless: signature then packed sizes minus one.
    const [w, h] = [300 - 1, 200 - 1];
    expect(
      imageFileInfo(
        webp('VP8L', [
          0x2f,
          w & 0xff,
          ((w >> 8) & 0x3f) | ((h & 3) << 6),
          (h >> 2) & 0xff,
          (h >> 10) & 0xf,
        ]),
      ),
    ).toEqual({ mediaType: 'image/webp', width: 300, height: 200 });
    expect(imageFileInfo(webp('VP8X', [0, 0, 0, 0, ...le24(299), ...le24(199)]))).toEqual({
      mediaType: 'image/webp',
      width: 300,
      height: 200,
    });
  });

  it('refuses other formats, oversize pictures and truncated files', () => {
    const svg = bytes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(imageFileInfo(svg)).toBeNull();
    expect(imageFileInfo(bytes('GIF89a', [1, 0, 1, 0]))).toBeNull();
    expect(imageFileInfo(bytes('<html><body>', png(1, 1).join(',')))).toBeNull();
    // A PNG signature before HTML is still checked as a PNG, whose header is missing.
    expect(
      imageFileInfo(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], '<script>')),
    ).toBeNull();
    expect(imageFileInfo(png(5000, 10))).toBeNull();
    expect(imageFileInfo(png(0, 10))).toBeNull();
    expect(imageFileInfo(jpeg(10, 9000))).toBeNull();
    expect(imageFileInfo(png(10, 10), MAX_IMAGE_BYTES + 1)).toBeNull();
    expect(imageFileInfo(new Uint8Array())).toBeNull();
    expect(imageFileInfo(jpeg(10, 10).slice(0, 12))).toBeNull();
  });

  it('lists every stored image a board shows, including in its undo history', () => {
    const [a, b, c] = ['a', 'b', 'c'].map((char) => char.repeat(64));
    const board: BoardDocument = {
      ...createEmptyBoard('Images'),
      info: { text: `![one](image:${a})\nNot ![two](image:${b})` },
    };
    expect(boardImageIds(board)).toEqual([a]);
    const before: BoardDocument = { ...board, info: { text: `![old](image:${c})` } };
    expect(snapshotImageIds({ board, past: [before], future: [] })).toEqual([a, c]);
    expect(snapshotImageIds({ board: null, past: [], future: [] })).toEqual([]);
  });
});
