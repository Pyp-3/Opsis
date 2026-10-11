import { MAX_IMAGE_BYTES, MAX_IMAGE_SIDE } from '@opsis/schema';
import { apiFetch, appUrl } from '../app-url';

/** Pictures the browser can decode safely as pixels; SVG is never accepted. */
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/bmp'];
export const INFO_IMAGE_ACCEPT = ACCEPTED.join(',');

function canvasFor(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

const encode = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * Re-draws a chosen picture as fresh pixels and encodes it as WebP (PNG or JPEG where WebP is
 * unavailable), at most `MAX_IMAGE_SIDE` on its longest side and `MAX_IMAGE_BYTES` in size. Only
 * the pixels survive, so metadata such as a photo's location and anything hidden in the original
 * file are left behind. The server checks the result again.
 */
export async function prepareInfoImage(file: File): Promise<Blob> {
  if (!ACCEPTED.includes(file.type)) throw new Error('Choose a PNG, JPEG, WebP or GIF picture.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('That picture could not be read.');
  }
  try {
    let scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    for (let attempt = 0; attempt < 6; attempt++) {
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = canvasFor(width, height);
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
      for (const quality of [0.88, 0.76, 0.62]) {
        const blob =
          (await encode(canvas, 'image/webp', quality)) ??
          (await encode(canvas, 'image/png', quality));
        if (!blob) continue;
        // Browsers without a WebP encoder return PNG, which ignores quality.
        const usable = ['image/webp', 'image/png', 'image/jpeg'].includes(blob.type);
        if (usable && blob.size <= MAX_IMAGE_BYTES) return blob;
        if (blob.type === 'image/png') {
          const jpeg = await encode(canvas, 'image/jpeg', quality);
          if (jpeg && jpeg.size <= MAX_IMAGE_BYTES) return jpeg;
        }
      }
      scale *= 0.75;
    }
  } finally {
    bitmap.close();
  }
  throw new Error('That picture is too large, even when made smaller.');
}

function base64Of(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('That picture could not be read.'));
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.readAsDataURL(blob);
  });
}

/** Stores a prepared picture with the board; resolves to the image's id. */
export async function uploadInfoImage(boardId: string, blob: Blob): Promise<string> {
  const response = await apiFetch(`/v1/boards/${boardId}/images`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: await base64Of(blob) }),
  });
  const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!response.ok || !body.id) throw new Error(body.message ?? 'The picture could not be added.');
  return body.id;
}

/** Where a stored image is read: signed-out link visitors use the board's open address. */
export function infoImageSource(boardId: string, image: string, signedOut = false) {
  return appUrl(`/v1/${signedOut ? 'guest/' : ''}boards/${boardId}/images/${image}`);
}
