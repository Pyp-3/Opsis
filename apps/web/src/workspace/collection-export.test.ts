import { expect, it } from 'vitest';
import {
  addBoardPage,
  boardPage,
  createEmptyBoard,
  EMAIL_DEMO,
  updateBoardPage,
  withBoardPage,
  type CollectionBundle,
} from '@opsis/schema';
import { collectionHtml } from './collection-export';
import { allPagesMarkdown, allPagesSvg, boardSvg } from './export';

const EMAIL_BOARD = { ...createEmptyBoard('Email', 'demo'), ...EMAIL_DEMO };

it('exports escaped offline content and only links to boards in the collection', () => {
  const source = '00000000-0000-4000-8000-000000000001',
    target = '00000000-0000-4000-8000-000000000002';
  const bundle: CollectionBundle = {
    format: 'opsis-collection',
    version: 1,
    name: 'Notes < & >',
    boards: [
      {
        id: source,
        title: 'Start',
        tags: [],
        board: {
          ...createEmptyBoard('Start', 'demo'),
          ...EMAIL_DEMO,
          drawings: [
            {
              id: 'sketch',
              shape: 'text',
              x: 10,
              y: 20,
              text: 'Collection sketch',
              ink: 'mint',
              line: 'solid',
              strokeWidth: 2,
            },
          ],
          nodes: EMAIL_DEMO.nodes.map((node, index) => ({
            ...node,
            notes: 'Literal <em>notes</em>',
            ...(index === 0 ? { linkedBoardId: target } : {}),
          })),
        },
      },
      { id: target, title: 'Finish', tags: [], board: null },
    ],
  };
  const html = collectionHtml(bundle);
  expect(html).toContain('Notes &lt; &amp; &gt;');
  expect(html).toContain('Literal &lt;em&gt;notes&lt;/em&gt;');
  expect(html).toContain(`href="#board-${target}">Continue to Finish`);
  expect(html).toContain('data:image/svg+xml;');
  const diagram = /src="data:image\/svg\+xml;charset=utf-8,([^"]+)"/.exec(html)![1]!;
  expect(decodeURIComponent(diagram)).toContain('Collection sketch');
  expect(html).toContain('@media print');
  expect(html).not.toContain('<script');
  expect(html).not.toContain('<iframe');
});

it('shows every page, leaving pages hidden from viewers out unless asked for', () => {
  const id = '00000000-0000-4000-8000-000000000003';
  let board = addBoardPage(
    { ...createEmptyBoard('Pitch', 'demo'), ...EMAIL_DEMO, title: 'Pitch' },
    { id: 'pricing-page-001', title: 'Pricing' },
    { firstPage: { id: 'cover-page-0001', title: 'Cover' } },
  );
  board = addBoardPage(board, { id: 'roadmap-page-01', title: 'Roadmap' });
  board = withBoardPage(board, 'pricing-page-001', {
    ...boardPage(board, 'pricing-page-001'),
    nodes: [{ ...EMAIL_DEMO.nodes[0]!, id: 'secret', label: 'Secret price' }],
    positions: { secret: { x: 0, y: 0 } },
  });
  board = updateBoardPage(board, 'pricing-page-001', { hidden: true });
  const bundle: CollectionBundle = {
    format: 'opsis-collection',
    version: 1,
    name: 'Deck',
    boards: [{ id, title: 'Pitch', tags: [], board }],
  };
  const shared = collectionHtml(bundle);
  expect(shared).toContain('Page 1: Cover');
  expect(shared).toContain('Page 2: Roadmap');
  expect(shared).not.toContain('Secret price');
  expect(shared).not.toContain('Pricing');
  expect(shared.match(/data:image\/svg\+xml/g)).toHaveLength(2);
  const everything = collectionHtml(bundle, { hiddenPages: true });
  expect(everything).toContain('Page 2: Pricing (hidden from viewers)');
  expect(everything).toContain('Secret price');
  expect(everything.match(/data:image\/svg\+xml/g)).toHaveLength(3);

  // Exports of every page, stacked in one picture and one set of notes.
  const notes = allPagesMarkdown(board);
  expect(notes.startsWith('# Pitch\n')).toBe(true);
  expect(notes).toContain('## Page 1: Cover');
  expect(notes).toContain('## Page 2: Pricing (hidden from viewers)');
  expect(notes).toContain('### 1. Secret price');
  const svg = allPagesSvg(board);
  expect(svg.match(/<svg x="/g)).toHaveLength(3);
  expect(svg).toContain('Pitch · Page 3: Roadmap');
  expect(allPagesSvg(EMAIL_BOARD)).toBe(boardSvg(EMAIL_BOARD));
});
