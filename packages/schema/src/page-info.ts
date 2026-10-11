import { z } from 'zod';

/**
 * A page's Info: the editor's own text about the page and footnotes on its objects, read in the
 * Info tab like a page of a book beside the canvas.
 *
 * The text is plain. Two pieces of syntax are recognised and nothing else: `[label](address)`
 * is a link when the address is HTTP, HTTPS or `mailto:`, and a line holding only
 * `![description](image:<id>)` is an image the board stores (see board-images.ts). Anything that
 * does not match, such as a `javascript:` address, stays literal text. Readers render the parsed
 * spans as text and links, never as markup, so the text cannot inject anything into the page.
 *
 * Footnotes name the object they annotate by kind and id. They are kept when that object goes
 * (by hand, review, regeneration or MCP), and then read as unattached, so no note is ever lost.
 */
export const MAX_INFO_TEXT = 8000;
export const MAX_FOOTNOTES = 60;
export const MAX_FOOTNOTE_TEXT = 600;
/** Images one page's text may show. */
export const MAX_INFO_IMAGES = 12;

/** An HTTP or HTTPS address without credentials or whitespace. */
// Go's pure contract VM has no browser URL constructor. Keep this bounded
// syntax check identical in the browser, Node and native host.
export const HTTP_LINK_PATTERN =
  /^https?:\/\/(?:\[[0-9a-f:.]+\]|[^\s/?#:@\\]+)(?::\d{1,5})?(?:[/?#][^\s\\]*)?$/i;
const MAILTO_PATTERN = /^mailto:[^\s@<>()"'\\]{1,64}@[^\s@<>()"'\\/]{1,253}$/i;
/** Stored images are named by the SHA-256 of their bytes. */
export const IMAGE_ID_PATTERN = /^[0-9a-f]{64}$/;

export const FOOTNOTE_TARGETS = [
  'concept',
  'connection',
  'group',
  'drawing',
  'drawing-group',
] as const;
export type FootnoteTargetKind = (typeof FOOTNOTE_TARGETS)[number];

const objectId = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/);
export const FootnoteSchema = z
  .object({
    id: objectId,
    target: z.object({ kind: z.enum(FOOTNOTE_TARGETS), id: objectId }).strict(),
    text: z.string().trim().min(1).max(MAX_FOOTNOTE_TEXT),
  })
  .strict();
export type Footnote = z.infer<typeof FootnoteSchema>;
export type FootnoteTarget = Footnote['target'];

export const PageInfoSchema = z
  .object({
    text: z.string().max(MAX_INFO_TEXT).optional(),
    footnotes: z.array(FootnoteSchema).max(MAX_FOOTNOTES).optional(),
  })
  .strict()
  .superRefine((info, context) => {
    const ids = (info.footnotes ?? []).map((note) => note.id);
    if (new Set(ids).size !== ids.length)
      context.addIssue({ code: 'custom', message: 'Footnotes need unique IDs.' });
    if (infoTextImages(info.text ?? '').length > MAX_INFO_IMAGES)
      context.addIssue({
        code: 'custom',
        message: `A page's Info can show up to ${MAX_INFO_IMAGES} images.`,
      });
  });
export type PageInfo = z.infer<typeof PageInfoSchema>;

/** The address a link may open, or null when it is not one the reader may follow. */
export function safeLinkAddress(address: string): string | null {
  const trimmed = address.trim();
  if (trimmed.length > 2000) return null;
  return HTTP_LINK_PATTERN.test(trimmed) || MAILTO_PATTERN.test(trimmed) ? trimmed : null;
}

export type InfoSpan = { text: string; href?: string };
export type InfoBlock =
  | { kind: 'paragraph'; lines: InfoSpan[][] }
  | { kind: 'image'; image: string; description: string };

const LINK = /\[([^[\]\n]{1,200})\]\(([^()\s]{1,2000})\)/g;
const IMAGE_LINE = /^!\[([^[\]\n]{0,200})\]\(image:([0-9a-f]{64})\)$/;

/** Text with its links picked out; anything that is not a safe link stays literal. */
export function infoSpans(text: string): InfoSpan[] {
  const spans: InfoSpan[] = [];
  let at = 0;
  const push = (span: InfoSpan) => {
    const last = spans[spans.length - 1];
    if (!span.href && last && !last.href) last.text += span.text;
    else if (span.text) spans.push(span);
  };
  for (const match of text.matchAll(LINK)) {
    const href = safeLinkAddress(match[2]!);
    if (!href) continue;
    push({ text: text.slice(at, match.index) });
    push({ text: match[1]!, href });
    at = match.index + match[0].length;
  }
  push({ text: text.slice(at) });
  return spans;
}

/** Paragraphs (split by blank lines, keeping single line breaks) and image lines. */
export function parseInfoText(text: string): InfoBlock[] {
  const blocks: InfoBlock[] = [];
  let paragraph: string[] = [];
  const close = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', lines: paragraph.map(infoSpans) });
    paragraph = [];
  };
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const image = IMAGE_LINE.exec(line.trim());
    if (image) {
      close();
      blocks.push({ kind: 'image', image: image[2]!, description: image[1]!.trim() });
    } else if (!line.trim()) close();
    else paragraph.push(line);
  }
  close();
  return blocks;
}

/** The stored images a page's text shows, in order, without repeats. */
export function infoTextImages(text: string): string[] {
  const ids = parseInfoText(text).flatMap((block) => (block.kind === 'image' ? [block.image] : []));
  return [...new Set(ids)];
}

/** The text to insert for a link, or null when the address is not one readers may follow. */
export function infoLinkMarkup(label: string, address: string): string | null {
  const href = safeLinkAddress(address);
  const name = label.replace(/[[\]\n]/g, ' ').trim() || href;
  if (!href || !name || name.length > 200) return null;
  return `[${name}](${href})`;
}

/** The line to insert for a stored image. */
export function infoImageMarkup(image: string, description: string): string {
  if (!IMAGE_ID_PATTERN.test(image)) throw new Error('Unknown image.');
  return `![${description
    .replace(/[[\]\n]/g, ' ')
    .trim()
    .slice(0, 200)}](image:${image})`;
}

/** Info without empty parts; undefined when nothing is left. */
export function tidyPageInfo(info: PageInfo | undefined): PageInfo | undefined {
  if (!info) return undefined;
  const text = info.text?.trim() ? info.text : undefined;
  const footnotes = info.footnotes?.length ? info.footnotes : undefined;
  if (!text && !footnotes) return undefined;
  return { ...(text ? { text } : {}), ...(footnotes ? { footnotes } : {}) };
}

/** What a footnote can be written on: one object of the page, named for the reader. */
export type FootnoteObject = { target: FootnoteTarget; label: string };

const SHAPE_NAMES: Record<string, string> = {
  stroke: 'Freehand stroke',
  line: 'Line',
  arrow: 'Arrow',
  rect: 'Box',
  ellipse: 'Ellipse',
  text: 'Text',
  dimension: 'Dimension',
  polygon: 'Polygon',
  arc: 'Arc',
  path: 'Path',
};

/** Only the fields footnotes read, so any page or document can be passed. */
type FootnotePage = {
  nodes: readonly { id: string; label: string }[];
  edges: readonly { id: string; source: string; target: string; label: string }[];
  groups?: readonly { id: string; label: string }[] | undefined;
  drawings?:
    | readonly {
        id: string;
        shape: string;
        text?: string | undefined;
        groupId?: string | undefined;
      }[]
    | undefined;
  info?: PageInfo | undefined;
};

const quoted = (text: string) => {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > 40 ? `“${line.slice(0, 39)}…”` : `“${line}”`;
};

/**
 * Every object on a page a footnote can annotate, in reading order: concepts, then
 * connections, concept groups, drawing groups and single drawings.
 */
export function footnoteObjects(page: FootnotePage): FootnoteObject[] {
  const label = (id: string) => page.nodes.find((node) => node.id === id)?.label ?? id;
  const objects: FootnoteObject[] = [
    ...page.nodes.map((node) => ({
      target: { kind: 'concept' as const, id: node.id },
      label: node.label,
    })),
    ...page.edges.map((edge) => ({
      target: { kind: 'connection' as const, id: edge.id },
      label: `${label(edge.source)} → ${label(edge.target)}${edge.label ? ` (${edge.label})` : ''}`,
    })),
    ...(page.groups ?? []).map((group) => ({
      target: { kind: 'group' as const, id: group.id },
      label: `Group: ${group.label}`,
    })),
  ];
  const drawings = page.drawings ?? [];
  const groups = [...new Set(drawings.flatMap((drawing) => drawing.groupId ?? []))];
  for (const groupId of groups) {
    const members = drawings.filter((drawing) => drawing.groupId === groupId);
    const words = members.find((drawing) => drawing.shape === 'text' && drawing.text?.trim());
    objects.push({
      target: { kind: 'drawing-group', id: groupId },
      label: words?.text
        ? `Drawing group ${quoted(words.text)}`
        : `Drawing group of ${members.length}`,
    });
  }
  for (const drawing of drawings) {
    if (drawing.groupId) continue;
    const name = SHAPE_NAMES[drawing.shape] ?? 'Drawing';
    objects.push({
      target: { kind: 'drawing', id: drawing.id },
      label: drawing.text?.trim() ? `${name} ${quoted(drawing.text)}` : name,
    });
  }
  return objects;
}

export const sameFootnoteTarget = (a: FootnoteTarget, b: FootnoteTarget) =>
  a.kind === b.kind && a.id === b.id;

export type NumberedFootnote = {
  number: number;
  note: Footnote;
  /** The object it annotates, or null once that object is gone. */
  object: FootnoteObject | null;
};

/**
 * A page's footnotes numbered as the reader meets them: in the order of the objects they
 * annotate, each object's notes in the order written, and unattached notes last.
 */
export function numberedFootnotes(page: FootnotePage): NumberedFootnote[] {
  const notes = page.info?.footnotes ?? [];
  if (!notes.length) return [];
  const objects = footnoteObjects(page);
  const rank = (note: Footnote) => {
    const index = objects.findIndex((object) => sameFootnoteTarget(object.target, note.target));
    return index < 0 ? objects.length : index;
  };
  return notes
    .map((note, order) => ({ note, order, rank: rank(note) }))
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map(({ note, rank: index }, position) => ({
      number: position + 1,
      note,
      object: objects[index] ?? null,
    }));
}
