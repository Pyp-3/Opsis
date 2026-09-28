import { describe, expect, it } from 'vitest';
import {
  DNS_DEMO,
  EMAIL_DEMO,
  withoutNarration,
  type BoardDocument,
  type BoardGraph,
} from '@opsis/schema';
import { beatDuration, britishVoice, playbackTimeline, revealed, spokenName } from './playback';

const doc = (graph: BoardGraph): BoardDocument => ({
  ...graph,
  version: 2,
  agent: 'demo',
  positions: Object.fromEntries(graph.nodes.map((node, i) => [node.id, { x: 0, y: i * 200 }])),
});
/** A board from before narration existed: playback must still speak in sentences. */
const unnarrated = (graph: BoardGraph): BoardGraph => ({
  ...withoutNarration(graph),
  nodes: graph.nodes.map(withoutNarration),
  edges: graph.edges.map(withoutNarration),
});
const voice = (name: string, lang: string, localService = true) =>
  ({ name, lang, localService, default: false, voiceURI: name }) as SpeechSynthesisVoice;

describe('process playback timeline', () => {
  it('follows numbered arrows in message order, like a sequence diagram', () => {
    const beats = playbackTimeline(doc(DNS_DEMO));
    expect(beats[0]).toMatchObject({ id: 'intro', nodeId: null, edgeId: null });
    expect(beats[0]!.narration).toBe(DNS_DEMO.narration);
    const steps = beats
      .filter((beat) => beat.edgeId)
      .map((beat) => DNS_DEMO.edges.find((edge) => edge.id === beat.edgeId)!.label);
    const numbers = steps.map((label) => Number(/^(\d+)/.exec(label)![1]));
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    expect(new Set(beats.map((beat) => beat.edgeId).filter(Boolean)).size).toBe(steps.length);
    // Every object is introduced, and each step lands on the arrow's target.
    expect(new Set(beats.map((beat) => beat.nodeId).filter(Boolean))).toEqual(
      new Set(DNS_DEMO.nodes.map((node) => node.id)),
    );
    for (const beat of beats.filter((b) => b.edgeId))
      expect(DNS_DEMO.edges.find((edge) => edge.id === beat.edgeId)!.target).toBe(beat.nodeId);
    // The arrow's line, then the line introducing the object it reaches for the first time.
    const [query] = DNS_DEMO.edges;
    const resolver = DNS_DEMO.nodes.find((node) => node.id === query!.target)!;
    expect(beats.find((beat) => beat.edgeId)!.narration).toBe(
      `${query!.narration} ${resolver.narration}`,
    );
  });

  it('words older, unnarrated boards as grammatical sentences', () => {
    const beats = playbackTimeline(doc(unnarrated(DNS_DEMO)));
    expect(beats[0]!.narration).toBe(DNS_DEMO.description);
    expect(beats[1]!.narration).toBe('Client asks for the address of google.com.');
    const steps = beats.filter((beat) => beat.edgeId).map((beat) => beat.narration);
    expect(steps[0]).toBe(
      'First, client asks the recursive resolver: address for google.com? ' +
        'The recursive resolver follows referrals on behalf of the client.',
    );
    expect(steps[2]).toBe(
      'The root server replies to the recursive resolver: refer to .com servers.',
    );
    expect(steps.at(-1)).toBe(
      'Finally, the recursive resolver replies to Client: return the answer.',
    );
    for (const line of beats.map((beat) => beat.narration)) {
      expect(line).not.toMatch(/Step \d|\.\.|\?\./);
      expect(line).toMatch(/[.!?]$/);
      for (const node of DNS_DEMO.nodes) expect(line).not.toMatch(new RegExp(`^${node.label}:`));
    }
  });

  it('says labels the way a person would', () => {
    expect(spokenName('Recursive resolver')).toBe('the recursive resolver');
    expect(spokenName('Sending server')).toBe('the sending server');
    expect(spokenName('Their inbox')).toBe('their inbox');
    for (const label of ['Client', '.com TLD server', 'Google Cloud', 'DNS'])
      expect(spokenName(label)).toBe(label);
  });

  it('follows the flow from the start when arrows are not numbered', () => {
    const beats = playbackTimeline(doc(EMAIL_DEMO));
    expect(beats).toHaveLength(EMAIL_DEMO.nodes.length + 1);
    expect(beats[1]!.narration).toBe(EMAIL_DEMO.nodes[0]!.narration);
    const seen = new Set<string>();
    for (const beat of beats.slice(1)) {
      if (beat.edgeId) {
        const edge = EMAIL_DEMO.edges.find((item) => item.id === beat.edgeId)!;
        expect(seen.has(edge.source), `${beat.id} arrives from an introduced object`).toBe(true);
      }
      seen.add(beat.nodeId!);
    }
    expect(seen.size).toBe(EMAIL_DEMO.nodes.length);
  });

  it('includes every object in cycles and disconnected boards, once each', () => {
    const graph: BoardGraph = {
      ...EMAIL_DEMO,
      edges: [
        { id: 'a', source: EMAIL_DEMO.nodes[0]!.id, target: EMAIL_DEMO.nodes[1]!.id, label: '' },
        { id: 'b', source: EMAIL_DEMO.nodes[1]!.id, target: EMAIL_DEMO.nodes[0]!.id, label: '' },
      ],
    };
    const beats = playbackTimeline(doc(graph));
    const ids = beats.map((beat) => beat.nodeId).filter(Boolean);
    expect(ids).toHaveLength(EMAIL_DEMO.nodes.length);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('narrates complete sentences built from summaries when a board has no narration', () => {
    const beats = playbackTimeline(doc(unnarrated(EMAIL_DEMO)));
    expect(beats[1]!.narration).toBe('First, a message starts with you.');
    for (const beat of beats.slice(1)) {
      expect(beat.narration).toMatch(/[.!?]$/);
      expect(beat.narration).not.toMatch(/\.\./);
      const node = EMAIL_DEMO.nodes.find((item) => item.id === beat.nodeId)!;
      expect(beat.narration.toLowerCase()).toContain(
        node.summary.replace(/[.!?]$/, '').toLowerCase(),
      );
      // Labels are captions, never read out as "Label: summary".
      expect(beat.narration).not.toContain(`${node.label}:`);
    }
  });

  it('speaks the agent’s narration for every step of a narrated board', () => {
    const beats = playbackTimeline(doc(EMAIL_DEMO));
    expect(beats.map((beat) => beat.narration)).toEqual([
      EMAIL_DEMO.narration,
      EMAIL_DEMO.nodes[0]!.narration,
      ...EMAIL_DEMO.edges.map(
        (edge) =>
          `${edge.narration} ${EMAIL_DEMO.nodes.find((node) => node.id === edge.target)!.narration}`,
      ),
    ]);
  });

  it('reveals only what has been reached so far', () => {
    const beats = playbackTimeline(doc(DNS_DEMO));
    let previous = 0;
    beats.forEach((_, i) => {
      const { nodes, edges } = revealed(beats, i);
      expect(nodes.size + edges.size).toBeGreaterThanOrEqual(previous);
      previous = nodes.size + edges.size;
    });
    expect(revealed(beats, beats.length - 1).nodes.size).toBe(DNS_DEMO.nodes.length);
  });
});

describe('narration timing and voice', () => {
  it('holds silent beats long enough to read and respects speed', () => {
    expect(beatDuration('Short.', 1)).toBeCloseTo(2200 / 1.5);
    const long = 'word '.repeat(40);
    expect(beatDuration(long, 1)).toBeGreaterThan(beatDuration(long, 1.5));
    expect(beatDuration(long, 0.75)).toBeGreaterThan(beatDuration(long, 1));
  });

  it('prefers a natural British English voice and never picks another accent', () => {
    const voices = [
      voice('Google US English', 'en-US', false),
      voice('eSpeak English (Great Britain)', 'en-GB'),
      voice('Microsoft Sonia Online (Natural) - English (United Kingdom)', 'en-GB', false),
      voice('Karen', 'en-AU'),
    ];
    expect(britishVoice(voices)?.name).toMatch(/Sonia/);
    expect(britishVoice([voice('Daniel', 'en_GB')])?.name).toBe('Daniel');
    expect(britishVoice([voice('Alex', 'en-US'), voice('Karen', 'en-AU')])).toBeNull();
    expect(britishVoice([])).toBeNull();
  });
});
