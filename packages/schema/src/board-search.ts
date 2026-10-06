import { z } from 'zod';
import type { BoardDocument } from './board';

/**
 * Keyword search across saved boards, shared by both hosts so ranking cannot drift.
 * Every term must appear in one concept (or the board's own title/description/groups);
 * matches in labels and titles rank above matches in longer text.
 */
export const SearchQuerySchema = z.object({ q: z.string().trim().min(2).max(200) }).strict();
export const MAX_SEARCH_RESULTS = 50;
/** Hits kept per board, so one large board cannot crowd out every other match. */
const MAX_HITS_PER_BOARD = 10;

export type SearchableBoard = {
  id: string;
  title: string;
  access: 'owner' | 'editor';
  board: BoardDocument | null;
};
export type SearchField =
  | 'title'
  | 'description'
  | 'group'
  | 'label'
  | 'summary'
  | 'explanation'
  | 'notes'
  | 'source'
  | 'connection';
export type SearchHit = {
  boardId: string;
  boardTitle: string;
  access: 'owner' | 'editor';
  /** The matching concept; absent for a match on the board itself. */
  conceptId?: string;
  /** The concept label, or the board title for a board-level hit. */
  label: string;
  field: SearchField;
  snippet: string;
  score: number;
};

const WEIGHT: Record<SearchField, number> = {
  title: 10,
  label: 10,
  summary: 5,
  group: 4,
  description: 3,
  connection: 3,
  explanation: 2,
  notes: 2,
  source: 2,
};

/** Lower-cased, accent-free text so “resume” finds “Résumé”. */
export function foldText(value: string) {
  return value.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function searchTerms(query: string) {
  return [...new Set(foldText(query).split(/\s+/).filter(Boolean))].slice(0, 12);
}

type Unit = { conceptId?: string; label: string; fields: [SearchField, string][] };

function units(board: BoardDocument, title: string): Unit[] {
  const edgesFrom = (id: string) =>
    board.edges
      .filter((edge) => edge.source === id)
      .flatMap((edge) => [edge.label, edge.condition ?? '', edge.description ?? '']);
  return [
    {
      label: title,
      fields: [
        ['title', title],
        ['description', board.description],
        ...(board.groups ?? []).map((group): [SearchField, string] => ['group', group.label]),
      ],
    },
    ...board.nodes.map((node) => ({
      conceptId: node.id,
      label: node.label,
      fields: [
        ['label', node.label],
        ['summary', node.summary],
        ['explanation', node.explanation],
        ['notes', node.notes ?? ''],
        ...(node.references ?? []).map((reference): [SearchField, string] => [
          'source',
          [reference.title, reference.excerpt ?? '', reference.url ?? ''].join(' '),
        ]),
        ...edgesFrom(node.id).map((text): [SearchField, string] => ['connection', text]),
      ] as [SearchField, string][],
    })),
  ];
}

/** A window of the field around the first matched term. */
function snippet(text: string, term: string) {
  const at = foldText(text).indexOf(term);
  const start = Math.max(0, at - 50);
  const end = Math.min(text.length, Math.max(at, 0) + term.length + 90);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

/** Hits within one board, best first. */
export function searchBoard(target: SearchableBoard, query: string): SearchHit[] {
  const terms = searchTerms(query);
  const phrase = foldText(query.trim());
  if (!terms.length || !target.board) return [];
  const hits: SearchHit[] = [];
  for (const unit of units(target.board, target.title)) {
    const fields = unit.fields
      .filter(([, text]) => text)
      .map(([field, text]) => ({ field, text, folded: foldText(text) }));
    let score = 0;
    let best: (typeof fields)[number] | undefined;
    let complete = true;
    for (const term of terms) {
      const matching = fields.filter((field) => field.folded.includes(term));
      if (!matching.length) {
        complete = false;
        break;
      }
      const top = matching.reduce((a, b) => (WEIGHT[b.field] > WEIGHT[a.field] ? b : a));
      score += WEIGHT[top.field];
      if (!best || WEIGHT[top.field] > WEIGHT[best.field]) best = top;
    }
    if (!complete || !best) continue;
    if (terms.length > 1 && fields.some((field) => field.folded.includes(phrase))) score += 5;
    hits.push({
      boardId: target.id,
      boardTitle: target.title,
      access: target.access,
      ...(unit.conceptId ? { conceptId: unit.conceptId } : {}),
      label: unit.label,
      field: best.field,
      snippet: snippet(best.text, terms.find((term) => best.folded.includes(term)) ?? terms[0]!),
      score,
    });
  }
  return rankSearchHits(hits, MAX_HITS_PER_BOARD);
}

/** Best first; ties keep boards together and concepts in board order. */
export function rankSearchHits(hits: SearchHit[], limit = MAX_SEARCH_RESULTS) {
  return hits
    .map((hit, index) => ({ hit, index }))
    .sort((a, b) => b.hit.score - a.hit.score || a.index - b.index)
    .slice(0, limit)
    .map(({ hit }) => hit);
}

export function searchBoards(boards: SearchableBoard[], query: string) {
  return rankSearchHits(boards.flatMap((board) => searchBoard(board, query)));
}
