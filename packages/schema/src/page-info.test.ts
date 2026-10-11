import { describe, expect, it } from 'vitest';
import {
  BoardDocumentSchema,
  EMAIL_DEMO,
  addBoardPage,
  boardPage,
  createEmptyBoard,
  footnoteObjects,
  infoImageMarkup,
  infoLinkMarkup,
  infoSpans,
  infoTextImages,
  numberedFootnotes,
  parseInfoText,
  readerBoard,
  safeLinkAddress,
  tidyPageInfo,
  withBoardPage,
  type BoardDocument,
} from './index';

const image = 'a'.repeat(64);
const otherImage = 'b'.repeat(64);

describe('Info text', () => {
  it('reads paragraphs, line breaks, safe links and image lines', () => {
    expect(
      parseInfoText(
        `Mail moves in hops.\nSee [the RFC](https://www.rfc-editor.org/rfc/rfc5321).\n\n![Relay rack](image:${image})\nWrite to [us](mailto:team@example.org).`,
      ),
    ).toEqual([
      {
        kind: 'paragraph',
        lines: [
          [{ text: 'Mail moves in hops.' }],
          [
            { text: 'See ' },
            { text: 'the RFC', href: 'https://www.rfc-editor.org/rfc/rfc5321' },
            { text: '.' },
          ],
        ],
      },
      { kind: 'image', image, description: 'Relay rack' },
      {
        kind: 'paragraph',
        lines: [
          [{ text: 'Write to ' }, { text: 'us', href: 'mailto:team@example.org' }, { text: '.' }],
        ],
      },
    ]);
  });

  it('leaves unsafe or malformed links and images as literal text', () => {
    for (const text of [
      '[click](javascript:alert(1))',
      '[click](javascript:alert)',
      '[x](data:text/html;base64,PHNjcmlwdD4=)',
      '[x](https://user:secret@example.com/)',
      '[x](//example.com)',
      '[x](vbscript:msgbox)',
      '<img src=x onerror=alert(1)>',
    ])
      expect(infoSpans(text)).toEqual([{ text }]);
    // An image needs a stored image id, alone on its line; an outside address is only a link.
    expect(parseInfoText('![x](https://example.com/a.png)')).toEqual([
      {
        kind: 'paragraph',
        lines: [[{ text: '!' }, { text: 'x', href: 'https://example.com/a.png' }]],
      },
    ]);
    expect(parseInfoText(`before ![x](image:${image})`)[0]!.kind).toBe('paragraph');
    expect(safeLinkAddress('mailto:a@b.c?subject=<script>')).toBeNull();
    expect(safeLinkAddress(' https://example.com/a?b=c#d ')).toBe('https://example.com/a?b=c#d');
  });

  it('builds link and image markup that parses back', () => {
    expect(infoLinkMarkup('The [spec]', 'https://example.com')).toBe(
      '[The  spec](https://example.com)',
    );
    expect(infoLinkMarkup('', 'https://example.com')).toBe(
      '[https://example.com](https://example.com)',
    );
    expect(infoLinkMarkup('bad', 'javascript:alert(1)')).toBeNull();
    const line = infoImageMarkup(image, 'A [rack]\nphoto');
    expect(parseInfoText(line)).toEqual([{ kind: 'image', image, description: 'A  rack  photo' }]);
    expect(() => infoImageMarkup('../etc', 'x')).toThrow();
  });

  it('lists the stored images a page shows once each', () => {
    expect(
      infoTextImages(
        `![a](image:${image})\ntext\n![b](image:${otherImage})\n![again](image:${image})`,
      ),
    ).toEqual([image, otherImage]);
  });

  it('drops empty info', () => {
    expect(tidyPageInfo({ text: '  \n', footnotes: [] })).toBeUndefined();
    expect(tidyPageInfo({ text: 'Kept' })).toEqual({ text: 'Kept' });
  });
});

describe('Footnotes', () => {
  const board: BoardDocument = {
    ...EMAIL_DEMO,
    version: 2,
    agent: 'demo',
    positions: {},
    groups: [{ id: 'outbound', label: 'Outbound', nodeIds: [], collapsed: false, boundary: true }],
    drawings: [
      {
        id: 'd1',
        shape: 'rect',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        ink: 'sky',
        strokeWidth: 2,
        line: 'solid',
      },
      {
        id: 's1',
        shape: 'line',
        points: [
          [0, 0],
          [4, 4],
        ],
        ink: 'sky',
        strokeWidth: 2,
        line: 'solid',
        groupId: 'pump',
      },
      {
        id: 's2',
        shape: 'text',
        x: 0,
        y: 0,
        text: 'Pump P-1',
        ink: 'sky',
        strokeWidth: 1,
        line: 'solid',
        groupId: 'pump',
      },
    ],
  };
  const [first, second] = board.nodes;

  it('lists every object in reading order', () => {
    const objects = footnoteObjects(board);
    expect(objects[0]).toEqual({ target: { kind: 'concept', id: first!.id }, label: first!.label });
    expect(objects.map((object) => object.target.kind)).toEqual([
      ...board.nodes.map(() => 'concept'),
      ...board.edges.map(() => 'connection'),
      'group',
      'drawing-group',
      'drawing',
    ]);
    expect(objects.find((object) => object.target.kind === 'drawing-group')!.label).toBe(
      'Drawing group “Pump P-1”',
    );
    expect(objects.at(-1)!.label).toBe('Box');
  });

  it('numbers notes as the reader meets them, unattached ones last', () => {
    const page: BoardDocument = {
      ...board,
      info: {
        footnotes: [
          {
            id: 'gone',
            target: { kind: 'concept', id: 'removed' },
            text: 'Was on a removed concept',
          },
          { id: 'b', target: { kind: 'concept', id: second!.id }, text: 'On the second' },
          { id: 'box', target: { kind: 'drawing', id: 'd1' }, text: 'On the box' },
          { id: 'a', target: { kind: 'concept', id: first!.id }, text: 'On the first' },
        ],
      },
    };
    expect(
      numberedFootnotes(page).map(({ number, note, object }) => [number, note.id, !!object]),
    ).toEqual([
      [1, 'a', true],
      [2, 'b', true],
      [3, 'box', true],
      [4, 'gone', false],
    ]);
    // A footnote on an object that is gone is still a valid board.
    expect(BoardDocumentSchema.safeParse(page).success).toBe(true);
  });

  it('validates info on every page and keeps it per page', () => {
    const note = { id: 'n', target: { kind: 'concept' as const, id: first!.id }, text: 'Note' };
    expect(
      BoardDocumentSchema.safeParse({ ...board, info: { footnotes: [note, note] } }).success,
    ).toBe(false);
    expect(
      BoardDocumentSchema.safeParse({
        ...board,
        info: {
          text: Array.from(
            { length: 13 },
            (_, i) => `![${i}](image:${String(i % 10).repeat(64)})`,
          ).join('\n'),
        },
      }).success,
    ).toBe(true);
    expect(
      BoardDocumentSchema.safeParse({
        ...board,
        info: {
          text: Array.from(
            { length: 13 },
            (_, i) => `![${i}](image:${i.toString(16).padStart(2, '0').repeat(32)})`,
          ).join('\n'),
        },
      }).success,
    ).toBe(false);
    expect(
      BoardDocumentSchema.safeParse({
        ...board,
        info: { footnotes: [{ ...note, text: 'x'.repeat(601) }] },
      }).success,
    ).toBe(false);

    const secondId = 'second-page-0001';
    const paged = addBoardPage(
      { ...board, info: { text: 'First page' } },
      { id: secondId, title: 'Second' },
      { firstPage: { id: 'first-page-00001', title: 'First' } },
    );
    const written = withBoardPage(paged, secondId, {
      ...boardPage(paged, secondId),
      info: { text: 'Second page', footnotes: [] },
    });
    expect(BoardDocumentSchema.parse(written).info).toEqual({ text: 'First page' });
    expect(boardPage(written, secondId).info?.text).toBe('Second page');
  });

  it('keeps a hidden page’s info from viewers', () => {
    const secretId = 'secret-page-0001';
    const paged = addBoardPage(
      createEmptyBoard('Pitch'),
      { id: secretId, title: 'Secret' },
      { firstPage: { id: 'cover-page-0001', title: 'Cover' } },
    );
    const written = withBoardPage(paged, secretId, {
      ...boardPage(paged, secretId),
      info: { text: 'Private plan' },
    });
    const hidden = BoardDocumentSchema.parse({
      ...written,
      pages: written.pages!.map((page) =>
        page.id === secretId ? { ...page, hidden: true } : page,
      ),
    });
    expect(JSON.stringify(readerBoard(hidden, null))).not.toContain('Private plan');
    expect(JSON.stringify(readerBoard(hidden, secretId))).toContain('Private plan');
  });
});
