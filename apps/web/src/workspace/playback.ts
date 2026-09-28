import type { BoardDocument } from '@opsis/schema';
import { walkthroughOrder } from './Walkthrough';

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
/** "3. Refer to .com servers" → 3; labels without a leading number sort last. */
const stepNumber = (label: string) => {
  const match = /^\s*(\d+)[.):]/.exec(label);
  return match ? Number(match[1]) : null;
};
const withoutNumber = (label: string) => label.replace(/^\s*\d+[.):]\s*/, '');

/**
 * The order a process is told in. Boards whose arrows are numbered ("1.", "2." …) follow
 * those numbers, like a sequence diagram; others follow the flow from their starting objects.
 * Every beat carries a short spoken summary so playback, captions and narration agree.
 */
export function playbackTimeline(board: BoardDocument): Beat[] {
  const nodes = new Map(board.nodes.map((node) => [node.id, node]));
  const intro: Beat = {
    id: 'intro',
    nodeId: null,
    edgeId: null,
    title: board.title,
    narration: [sentence(board.title), sentence(board.description)].filter(Boolean).join(' '),
  };
  const introduced = new Set<string>();
  const nodeBeat = (id: string, lead = ''): Beat => {
    const node = nodes.get(id)!;
    introduced.add(id);
    return {
      id: `node:${id}`,
      nodeId: id,
      edgeId: null,
      title: node.label,
      narration: [lead, sentence(`${node.label}: ${node.summary}`)].filter(Boolean).join(' '),
    };
  };
  const numbered = board.edges
    .map((edge) => ({ edge, n: stepNumber(edge.label) }))
    .filter((item): item is { edge: (typeof board.edges)[number]; n: number } => item.n !== null)
    .sort((a, b) => a.n - b.n);
  if (board.edges.length && numbered.length >= Math.ceil(board.edges.length / 2)) {
    const beats = [intro];
    const first = numbered[0]!.edge.source;
    if (nodes.has(first)) beats.push(nodeBeat(first, 'It starts with'));
    for (const { edge, n } of numbered) {
      const from = nodes.get(edge.source),
        to = nodes.get(edge.target);
      if (!from || !to) continue;
      const action = sentence(
        `Step ${n}: ${from.label} to ${to.label}, ${withoutNumber(edge.label)}`,
      );
      const fresh = !introduced.has(to.id);
      introduced.add(to.id);
      beats.push({
        id: `edge:${edge.id}`,
        nodeId: to.id,
        edgeId: edge.id,
        title: `${n}. ${withoutNumber(edge.label) || to.label}`,
        narration: fresh ? `${action} ${sentence(to.summary)}` : action,
      });
    }
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
      beats.push(nodeBeat(id, beats.length === 1 ? 'It starts with' : ''));
      continue;
    }
    const from = nodes.get(via.source)!;
    const node = nodes.get(id)!;
    introduced.add(id);
    beats.push({
      id: `edge:${via.id}`,
      nodeId: id,
      edgeId: via.id,
      title: node.label,
      narration: [
        sentence(
          via.label
            ? `${from.label} ${via.label.toLowerCase()} to ${node.label}`
            : `Then, ${node.label}`,
        ),
        sentence(`${node.label}: ${node.summary}`),
      ].join(' '),
    });
  }
  return beats;
}

/** Everything reached up to and including a beat: shown in full while the rest is dimmed. */
export function revealed(beats: Beat[], index: number) {
  const nodes = new Set<string>(),
    edges = new Set<string>();
  for (const beat of beats.slice(0, index + 1)) {
    if (beat.nodeId) nodes.add(beat.nodeId);
    if (beat.edgeId) edges.add(beat.edgeId);
  }
  return { nodes, edges };
}

/**
 * What "1×" means for each way of telling the process. Speech engines' own 1.0 drags for a
 * walkthrough (their 1.5 felt like a natural 1), so the player's scale sits above them.
 */
export const PACE = { captions: 1.5, system: 1.5, natural: 1.15 } as const;

/** Silent playback holds each beat long enough to read its caption. */
export function beatDuration(text: string, speed: number) {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(2200, words * 330 + 900) / (speed * PACE.captions);
}

/**
 * The best available British English voice. Natural/online voices sound far better than
 * the robotic defaults, so they win; otherwise any en-GB voice; otherwise none (the
 * utterance still asks for en-GB so the platform can choose).
 */
export function britishVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const british = voices.filter((voice) => /^en[-_]GB$/i.test(voice.lang));
  const score = (voice: SpeechSynthesisVoice) =>
    (/natural|neural|online|premium|enhanced/i.test(voice.name) ? 4 : 0) +
    (/google|microsoft|siri|daniel|serena|kate|libby|ryan|sonia/i.test(voice.name) ? 2 : 0) +
    (voice.localService ? 0 : 1);
  return british.sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name))[0] ?? null;
}
