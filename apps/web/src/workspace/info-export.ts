import {
  infoSpans,
  infoTextImages,
  numberedFootnotes,
  parseInfoText,
  readerBoard,
  everyBoardPage,
  type BoardDocument,
  type CollectionBundle,
  type InfoSpan,
} from '@opsis/schema';
import { infoImageSource } from './info-images';

/** A page's Info for a Markdown export: its text, then its footnotes. Empty when it has none. */
export function pageInfoMarkdown(page: BoardDocument, safe: (value: string) => string): string {
  const spans = (items: InfoSpan[]) =>
    items
      .map((span) => (span.href ? `[${safe(span.text)}](${span.href})` : safe(span.text)))
      .join('');
  const text = parseInfoText(page.info?.text ?? '')
    .map((block) =>
      block.kind === 'image'
        ? `*Picture${block.description ? `: ${safe(block.description)}` : ''}*`
        : block.lines.map(spans).join('  \n'),
    )
    .join('\n\n');
  const notes = numberedFootnotes(page)
    .map(
      ({ number, note, object }) =>
        `${number}. **${safe(object?.label ?? 'No longer on this page')}:** ${spans(infoSpans(note.text))}`,
    )
    .join('\n');
  return [text, notes && `**Notes**\n\n${notes}`].filter(Boolean).join('\n\n');
}

/**
 * A page's Info for the offline HTML walkthrough: escaped text, links that may only be HTTP(S)
 * or mailto, and pictures embedded from `images` (shown as a caption when one is missing).
 */
export function pageInfoHtml(
  page: BoardDocument,
  escape: (value: string) => string,
  images: ReadonlyMap<string, string>,
): string {
  const spans = (items: InfoSpan[]) =>
    items
      .map((span) =>
        span.href
          ? `<a href="${escape(span.href)}" rel="noopener noreferrer">${escape(span.text)}</a>`
          : escape(span.text),
      )
      .join('');
  const text = parseInfoText(page.info?.text ?? '')
    .map((block) => {
      if (block.kind === 'paragraph') return `<p>${block.lines.map(spans).join('<br>')}</p>`;
      const source = images.get(block.image);
      const caption = block.description
        ? `<figcaption>${escape(block.description)}</figcaption>`
        : '';
      return source
        ? `<figure><img class="info-picture" alt="${escape(block.description)}" src="${source}">${caption}</figure>`
        : `<p><em>Picture${block.description ? `: ${escape(block.description)}` : ''}</em></p>`;
    })
    .join('');
  const notes = numberedFootnotes(page)
    .map(
      ({ number, note, object }) =>
        `<li value="${number}"><strong>${escape(object?.label ?? 'No longer on this page')}:</strong> ${spans(infoSpans(note.text))}</li>`,
    )
    .join('');
  return `${text ? `<div class="info">${text}</div>` : ''}${notes ? `<h5>Notes</h5><ol class="notes">${notes}</ol>` : ''}`;
}

const dataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('A picture could not be read.'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });

/**
 * The pictures a collection's pages show, as data URLs for a self-contained file. Only images
 * served as PNG, JPEG or WebP are embedded; a picture that cannot be fetched is left out.
 */
export async function collectionInfoImages(
  bundle: CollectionBundle,
  options: { hiddenPages?: boolean } = {},
): Promise<Map<string, string>> {
  const images = new Map<string, string>();
  for (const entry of bundle.boards) {
    if (!entry.board) continue;
    const shown = options.hiddenPages ? entry.board : readerBoard(entry.board);
    const ids = everyBoardPage(shown).flatMap(({ board }) =>
      infoTextImages(board.info?.text ?? ''),
    );
    for (const id of ids) {
      if (images.has(id)) continue;
      const response = await fetch(infoImageSource(entry.id, id)).catch(() => null);
      const blob = response?.ok ? await response.blob() : null;
      if (blob && ['image/png', 'image/jpeg', 'image/webp'].includes(blob.type))
        images.set(id, await dataUrl(blob));
    }
  }
  return images;
}
