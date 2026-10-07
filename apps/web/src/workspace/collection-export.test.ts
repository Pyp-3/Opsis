import { expect, it } from 'vitest';
import { createEmptyBoard, EMAIL_DEMO, type CollectionBundle } from '@opsis/schema';
import { collectionHtml } from './collection-export';

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
