import type { Beat } from '@opsis/schema';

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
