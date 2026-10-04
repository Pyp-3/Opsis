import { BoardDocumentSchema, type BoardDocument } from './board';

/** Deterministic local text import; no model call and no implied factual verification. */
export function boardFromText(text: string, sourceName: string): BoardDocument {
  if (!text.trim() || text.length > 100000)
    throw new Error('Use a non-empty text document up to 100,000 characters.');
  const paragraphs = text
    .trim()
    .split(/\n\s*\n/)
    .flatMap((paragraph) => {
      const parts: string[] = [];
      for (let offset = 0; offset < paragraph.length; offset += 2800)
        parts.push(paragraph.slice(offset, offset + 2800));
      return parts;
    });
  if (paragraphs.length > 50)
    throw new Error('This document needs more than 50 concepts. Import a smaller section.');
  return BoardDocumentSchema.parse({
    version: 2,
    agent: 'demo',
    title: sourceName.slice(0, 100) || 'Imported text',
    description:
      'Local document import. Review excerpts and relationships before using this explanation.',
    nodes: paragraphs.map((paragraph, index) => ({
      id: `text_${index + 1}`,
      label:
        paragraph
          .split('\n')[0]!
          .replace(/^#+\s*/, '')
          .slice(0, 80) || `Section ${index + 1}`,
      icon: 'file',
      kind: 'note',
      summary: paragraph.slice(0, 400),
      explanation: paragraph,
      references: [
        { title: `${sourceName.slice(0, 160)} · section ${index + 1}`, excerpt: paragraph },
      ],
    })),
    edges: [],
    positions: Object.fromEntries(
      paragraphs.map((_, index) => [`text_${index + 1}`, { x: 24, y: 24 + index * 240 }]),
    ),
  });
}
