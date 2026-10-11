import { describe, expect, it } from 'vitest';
import { EMAIL_DEMO, type BoardDocument } from '@opsis/schema';
import { pageInfoHtml, pageInfoMarkdown } from './info-export';
import { boardMarkdown } from './export';
import { collectionHtml } from './collection-export';

const image = 'c'.repeat(64);
const board: BoardDocument = {
  ...EMAIL_DEMO,
  version: 2,
  agent: 'demo',
  positions: {},
  info: {
    text: `Hops <b>between</b> [servers](https://example.com/a?b=1&c=2).\n[bad](javascript:alert(1))\n\n![Rack "A"](image:${image})`,
    footnotes: [
      {
        id: 'n1',
        target: { kind: 'concept', id: EMAIL_DEMO.nodes[0]!.id },
        text: 'See [notes](https://example.com/notes) <script>',
      },
    ],
  },
};
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );

describe('Info in exports', () => {
  it('writes the text, safe links, pictures and numbered notes as Markdown', () => {
    const safe = (value: string) => value.replace(/[\\`*_{}[\]<>#|]/g, '\\$&');
    const markdown = pageInfoMarkdown(board, safe);
    expect(markdown).toContain(
      'Hops \\<b\\>between\\</b\\> [servers](https://example.com/a?b=1&c=2).',
    );
    expect(markdown).toContain('\\[bad\\](javascript:alert(1))');
    expect(markdown).toContain('*Picture: Rack "A"*');
    expect(markdown).toContain(
      `1. **${EMAIL_DEMO.nodes[0]!.label}:** See [notes](https://example.com/notes) \\<script\\>`,
    );
    expect(boardMarkdown(board)).toContain('[servers](https://example.com/a?b=1&c=2)');
  });

  it('escapes everything in HTML and embeds only the pictures it was given', () => {
    const html = pageInfoHtml(board, escape, new Map([[image, 'data:image/png;base64,AAAA']]));
    expect(html).toContain('Hops &lt;b&gt;between&lt;/b&gt; ');
    expect(html).toContain(
      '<a href="https://example.com/a?b=1&amp;c=2" rel="noopener noreferrer">servers</a>',
    );
    expect(html).not.toContain('href="javascript');
    expect(html).toContain(
      '<img class="info-picture" alt="Rack &quot;A&quot;" src="data:image/png;base64,AAAA">',
    );
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script');
    expect(pageInfoHtml(board, escape, new Map())).toContain(
      '<p><em>Picture: Rack &quot;A&quot;</em></p>',
    );
    const file = collectionHtml(
      {
        format: 'opsis-collection',
        version: 1,
        name: 'Book',
        boards: [{ id: crypto.randomUUID(), title: 'Mail', tags: [], board }],
      },
      { images: new Map([[image, 'data:image/png;base64,AAAA']]) },
    );
    expect(file).toContain('src="data:image/png;base64,AAAA"');
    expect(file).toContain('img-src data:');
  });
});
