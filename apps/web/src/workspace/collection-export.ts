import {
  CollectionBundleSchema,
  everyBoardPage,
  readerBoard,
  type BoardDocument,
  type CollectionBundle,
} from '@opsis/schema';
import { boardSvg } from './export';

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );

/**
 * An offline document: escaped prose, inert SVG images and internal board links only. Every page
 * of each board is shown in order; pages hidden from viewers are left out unless the owner asks
 * for them, because this file is made to be passed on.
 */
export function collectionHtml(input: CollectionBundle, options: { hiddenPages?: boolean } = {}) {
  const bundle = CollectionBundleSchema.parse(input);
  const titles = new Map(bundle.boards.map((board) => [board.id, board.title]));
  const contents = bundle.boards
    .map((entry) => `<li><a href="#board-${entry.id}">${escape(entry.title)}</a></li>`)
    .join('');
  const concepts = (board: BoardDocument, heading: 'h3' | 'h4') =>
    `<ol>${board.nodes
      .map(
        (
          node,
        ) => `<li><${heading}>${escape(node.label)}</${heading}><p>${escape(node.summary)}</p><p>${escape(node.explanation)}</p>
      ${node.notes ? `<p><strong>Notes:</strong> ${escape(node.notes)}</p>` : ''}
      ${node.linkedBoardId && titles.has(node.linkedBoardId) ? `<p><a href="#board-${node.linkedBoardId}">Continue to ${escape(titles.get(node.linkedBoardId)!)}</a></p>` : ''}
      ${(node.references ?? []).map((reference) => `<p>Source: ${escape(reference.title)}${reference.url ? ` — ${escape(reference.url)}` : ''}</p>`).join('')}
      </li>`,
      )
      .join('')}</ol>`;
  const picture = (board: BoardDocument, label: string) =>
    `<img alt="Diagram: ${escape(label)}" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(boardSvg(board))}">`;
  const pages = (board: BoardDocument, title: string) => {
    const shown = options.hiddenPages ? board : readerBoard(board);
    if (!shown.pages) return `${picture(shown, title)}${concepts(shown, 'h3')}`;
    return everyBoardPage(shown)
      .map(({ page, board: view }, index) => {
        const name = `Page ${index + 1}: ${page!.title}${page!.hidden ? ' (hidden from viewers)' : ''}`;
        return `<article class="page"><h3>${escape(name)}</h3>${picture(view, `${title}, ${name}`)}${concepts(view, 'h4')}</article>`;
      })
      .join('');
  };
  const boards = bundle.boards
    .map(
      (entry) =>
        `<section id="board-${entry.id}"><h2>${escape(entry.title)}</h2>${
          entry.board
            ? `
    <p>${escape(entry.board.description)}</p>${pages(entry.board, entry.title)}`
            : '<p>Empty board.</p>'
        }</section>`,
    )
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
    <title>${escape(bundle.name)} · Opsis</title><style>
    body{font:16px/1.6 system-ui,sans-serif;color:#172c3c;background:white;max-width:1000px;margin:auto;padding:32px}a{color:#175879}img{width:100%;height:auto;max-height:80vh;object-fit:contain}p{white-space:pre-wrap;overflow-wrap:anywhere}section{border-top:1px solid #bcc8d0;margin-top:40px;padding-top:24px}article.page{margin-top:28px}li{break-inside:avoid}h1,h2,h3{line-height:1.2}@media print{body{padding:0;font-size:11pt}section,article.page{break-before:page;border:0}img{max-height:65vh}a{color:inherit}nav{break-after:page}.print-help{display:none}}@page{margin:18mm}
    </style></head><body><h1>${escape(bundle.name)}</h1><p>Read-only collection walkthrough · ${bundle.boards.length} boards</p><p class="print-help">Use your browser’s Print command to print this walkthrough or save it as PDF.</p><nav aria-label="Contents"><ol>${contents}</ol></nav>${boards}</body></html>`;
}

export function printCollection(html: string) {
  const frame = document.createElement('iframe');
  frame.title = 'Printable collection walkthrough';
  frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-10000px;border:0';
  frame.onload = () => {
    const target = frame.contentWindow;
    if (!target) {
      frame.remove();
      return;
    }
    target.addEventListener('afterprint', () => frame.remove(), { once: true });
    target.focus();
    target.print();
  };
  frame.srcdoc = html;
  document.body.append(frame);
  // Some embedded browsers do not dispatch afterprint.
  setTimeout(() => frame.remove(), 300_000);
}
