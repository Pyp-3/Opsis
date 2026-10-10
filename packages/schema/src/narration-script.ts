import type { BoardDocument } from './board';
import { everyBoardPage, readerBoard } from './board-pages';

/**
 * The process player's spoken script, shared by the browser, which plays it, and the hosts, which
 * only speak a line for someone who is not signed in when it belongs to a board they may read.
 */

/** Roots first, following outgoing paths; cycle/disconnected fallback visits every node once. */
export function walkthroughOrder(board: BoardDocument): string[] {
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    board.edges.filter((edge) => edge.source === id).forEach((edge) => visit(edge.target));
  };
  board.nodes
    .filter((node) => !board.edges.some((edge) => edge.target === node.id))
    .forEach((node) => visit(node.id));
  board.nodes.forEach((node) => visit(node.id));
  return [...visited];
}

/**
 * A narration split into sentences. Each is generated on its own, so the first can play
 * while the rest are still being made (on the CPU generation runs at about real time).
 */
export const sentences = (text: string) =>
  text
    .split(/(?<=[.!?])\s+(?=\S)/)
    .map((part) => part.trim())
    .filter(Boolean);

/** One moment of the played-back process: an object, optionally reached along an arrow. */
export type Beat = {
  id: string;
  nodeId: string | null;
  edgeId: string | null;
  title: string;
  narration: string;
};

const sentence = (text: string) => {
  const trimmed = text.trim();
  return !trimmed || /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};
const upperFirst = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
/** Lower-cases an ordinary capitalised first word; acronyms like "DNS" and "I" stay. */
const lowerFirst = (text: string) =>
  /^([A-Z][a-z]|(?!I\b)[A-Z]\b)/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
/** "3. Refer to .com servers" → 3; labels without a leading number sort last. */
const stepNumber = (label: string) => {
  const match = /^\s*(\d+)[.):]/.exec(label);
  return match ? Number(match[1]) : null;
};
const withoutNumber = (label: string) => label.replace(/^\s*\d+[.):]\s*/, '');

const PERSONAL = /^(you|your|their|our|my|his|her|its|we|they|i)\b/i;
/**
 * How a label is said aloud mid-sentence: "Recursive resolver" becomes "the recursive
 * resolver" and "Their inbox" becomes "their inbox". Single words and names in Title Case
 * stay as written.
 */
export function spokenName(label: string) {
  const text = label.trim();
  if (PERSONAL.test(text)) return lowerFirst(text);
  const [first = '', ...rest] = text.split(/\s+/);
  const common =
    rest.length > 0 &&
    /^[A-Z][a-z]+$/.test(first) &&
    !PERSONAL.test(text) &&
    rest.every((word) => !/^[A-Z][a-z]/.test(word));
  return common ? `the ${lowerFirst(text)}` : text;
}

type BoardNode = BoardDocument['nodes'][number];
type BoardEdge = BoardDocument['edges'][number];

/**
 * What the narrator says on first reaching an object. Agents write this as spoken prose;
 * older boards fall back to a sentence built from the summary, never "Label: summary".
 */
function nodeLine(node: BoardNode, lead: '' | 'First' | 'Also' = '') {
  if (node.narration?.trim()) return sentence(node.narration);
  const summary = sentence(node.summary);
  // "Follows referrals…" reads as a verb phrase, so it gets its subject back.
  const verbPhrase =
    /^[A-Z][a-z]+s\b/.test(summary) && !/^(This|Its|Thus|Perhaps|Always|Sometimes)\b/.test(summary);
  const line =
    verbPhrase && !PERSONAL.test(node.label)
      ? `${upperFirst(spokenName(node.label))} ${lowerFirst(summary)}`
      : summary;
  return lead ? `${lead}, ${lowerFirst(line)}` : line;
}

type Kind = NonNullable<BoardEdge['kind']>;
const ACTIONS: Record<Exclude<Kind, 'flow'>, (from: string, to: string) => string> = {
  request: (from, to) => `${from} asks ${to}`,
  response: (from, to) => `${from} replies to ${to}`,
  feedback: (from, to) => `${from} gives ${to} feedback`,
  retry: (from, to) => `${from} tries ${to} again`,
};
/** A plain flow needs no actor, and varying the phrasing keeps a long walk from droning. */
const FLOWS = [
  (to: string) => `From there, it moves on to ${to}`,
  (to: string) => `Next comes ${to}`,
  (to: string) => `Then it reaches ${to}`,
];

/** What the narrator says while crossing an arrow; "First" and "Finally" frame a sequence. */
function edgeLine(
  edge: BoardEdge,
  from: BoardNode,
  to: BoardNode,
  turn: number,
  lead: '' | 'First' | 'Finally' = '',
) {
  if (edge.narration?.trim()) return sentence(edge.narration);
  const kind = edge.kind ?? 'flow';
  // A flow arrow's label ("Deliver", "SMTP") is a caption on the canvas, not part of a sentence.
  const line = sentence(
    kind === 'flow'
      ? FLOWS[turn % FLOWS.length]!(spokenName(to.label))
      : [
          ACTIONS[kind](upperFirst(spokenName(from.label)), spokenName(to.label)),
          lowerFirst(withoutNumber(edge.label).trim()),
        ]
          .filter(Boolean)
          .join(': '),
  );
  return lead ? `${lead}, ${lowerFirst(line)}` : line;
}

/**
 * The order a process is told in. Boards whose arrows are numbered ("1.", "2." …) follow
 * those numbers, like a sequence diagram; others follow the flow from their starting objects.
 * Each beat is spoken prose: the agent's narration where it wrote some, otherwise sentences
 * built from labels and summaries. Captions show the same words the narrator says.
 */
export function playbackTimeline(board: BoardDocument): Beat[] {
  const nodes = new Map(board.nodes.map((node) => [node.id, node]));
  const intro: Beat = {
    id: 'intro',
    nodeId: null,
    edgeId: null,
    title: board.title,
    narration: sentence(board.narration?.trim() || board.description || board.title),
  };
  const introduced = new Set<string>();
  const nodeBeat = (id: string, lead: '' | 'First' | 'Also' = ''): Beat => {
    const node = nodes.get(id)!;
    introduced.add(id);
    return {
      id: `node:${id}`,
      nodeId: id,
      edgeId: null,
      title: node.label,
      narration: nodeLine(node, lead),
    };
  };
  const numbered = board.edges
    .map((edge) => ({ edge, n: stepNumber(edge.label) }))
    .filter((item): item is { edge: BoardEdge; n: number } => item.n !== null)
    .sort((a, b) => a.n - b.n);
  if (board.edges.length && numbered.length >= Math.ceil(board.edges.length / 2)) {
    const beats = [intro];
    const first = numbered[0]!.edge.source;
    if (nodes.has(first)) beats.push(nodeBeat(first));
    numbered.forEach(({ edge, n }, i) => {
      const from = nodes.get(edge.source),
        to = nodes.get(edge.target);
      if (!from || !to) return;
      const lead = i === 0 ? 'First' : i === numbered.length - 1 ? 'Finally' : '';
      const fresh = !introduced.has(to.id);
      introduced.add(to.id);
      beats.push({
        id: `edge:${edge.id}`,
        nodeId: to.id,
        edgeId: edge.id,
        title: `${n}. ${withoutNumber(edge.label) || to.label}`,
        narration: [edgeLine(edge, from, to, i, lead), fresh ? nodeLine(to) : '']
          .filter(Boolean)
          .join(' '),
      });
    });
    // Objects no numbered arrow reaches still deserve a mention at the end.
    for (const node of board.nodes)
      if (!introduced.has(node.id)) beats.push(nodeBeat(node.id, 'Also'));
    return beats;
  }
  const beats = [intro];
  for (const id of walkthroughOrder(board)) {
    const via = board.edges.find(
      (edge) => edge.target === id && introduced.has(edge.source) && edge.source !== id,
    );
    if (!via) {
      beats.push(nodeBeat(id, beats.length === 1 ? 'First' : 'Also'));
      continue;
    }
    const node = nodes.get(id)!;
    introduced.add(id);
    beats.push({
      id: `edge:${via.id}`,
      nodeId: id,
      edgeId: via.id,
      title: node.label,
      narration: `${edgeLine(via, nodes.get(via.source)!, node, beats.length)} ${nodeLine(node)}`,
    });
  }
  return beats;
}

/** Everything reached up to and including a beat: shown in full while the rest is dimmed. */

/**
 * Every sentence the player can speak for a board, as someone who only views it sees it: every
 * page they may read, including the hidden page their link names.
 */
export function narrationLines(board: BoardDocument, revealPageId?: string | null): Set<string> {
  return new Set(
    everyBoardPage(readerBoard(board, revealPageId)).flatMap(({ board: page }) =>
      playbackTimeline(page).flatMap((beat) => sentences(beat.narration)),
    ),
  );
}
