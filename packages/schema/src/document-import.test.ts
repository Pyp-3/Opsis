import { describe, it, expect } from 'vitest';
import { boardFromText } from './document-import';

describe('document import', () => {
  it('imports exact source excerpts locally, with no invented relationships and explicit bounds', () => {
    const imported = boardFromText('First paragraph.\n\nSecond paragraph.', 'notes.txt');
    expect(imported.nodes).toHaveLength(2);
    expect(imported.edges).toEqual([]);
    expect(imported.nodes[1]?.references?.[0]?.excerpt).toBe('Second paragraph.');
    expect(() => boardFromText('x'.repeat(100001), 'large')).toThrow();
    expect(() =>
      boardFromText(Array.from({ length: 51 }, () => 'a').join('\n\n'), 'many'),
    ).toThrow();
  });
});
