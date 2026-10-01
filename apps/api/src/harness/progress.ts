import type { HarnessProvider } from './types.js';

/**
 * What an agent is doing while it works, distilled from its CLI's event stream. These are
 * shown live, the way Claude Code shows its own progress. Thinking text itself is not exposed
 * by the CLIs; only how much of it there is.
 */
export type HarnessProgress =
  | { type: 'phase'; phase: 'starting' | 'thinking' | 'writing' | 'drafting' }
  | { type: 'thinking'; tokens: number }
  /** A progress note the agent wrote; `done` is false while the line is still arriving. */
  | { type: 'note'; text: string; done: boolean }
  /** The answer as it is written: how many objects and connections, and the latest named. */
  | { type: 'drafting'; items: number; links: number; latest: string | null };

type Json = Record<string, unknown>;
const record = (value: unknown): Json | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null;

/** Notes are short and plain; markdown emphasis and list markers are dropped. */
const clean = (text: string) =>
  text
    .replace(/[*_`#]+/gu, '')
    .replace(/^\s*[-•>\d.)]+\s*/u, '')
    .trim()
    .slice(0, 140);

/** Keys worth following in a streamed answer; a match needs its closing quote to count. */
const KEYS = /"(edges|label|source|id)"\s*:\s*(?:"((?:[^"\\]|\\.)*)")?/gu;
const unescape = (text: string) => {
  try {
    return JSON.parse(`"${text}"`) as string;
  } catch {
    return text;
  }
};

/**
 * Follows the JSON answer as it streams, reading each new part once. Labels before `"edges"`
 * name objects and each `"source"` after it is a connection. Illustration lists have no
 * labels, so their IDs name what is being drawn.
 */
class DraftReader {
  private text = '';
  private cursor = 0;
  private inEdges = false;
  private labels = 0;
  private ids = 0;
  private links = 0;
  private latest: string | null = null;
  add(chunk: string): HarnessProgress | null {
    this.text += chunk;
    const before = `${this.labels}:${this.ids}:${this.links}:${this.latest}`;
    KEYS.lastIndex = this.cursor;
    for (let match; (match = KEYS.exec(this.text));) {
      const [whole, key, value] = match;
      // A key whose string value has not finished arriving is read again next time.
      const next = this.text[match.index + whole.length];
      if (value === undefined && (next === undefined || next === '"')) break;
      this.cursor = match.index + whole.length;
      if (key === 'edges') this.inEdges = true;
      else if (key === 'source' && this.inEdges) this.links++;
      else if (key === 'label' && !this.inEdges && value !== undefined) {
        this.labels++;
        this.latest = unescape(value);
      } else if (key === 'id' && !this.labels && !this.inEdges && value !== undefined) {
        this.ids++;
        this.latest = unescape(value);
      }
    }
    if (`${this.labels}:${this.ids}:${this.links}:${this.latest}` === before) return null;
    return {
      type: 'drafting',
      items: this.labels || this.ids,
      links: this.links,
      latest: this.latest,
    };
  }
}

/** Turns a CLI's stdout lines into progress, keeping whatever state that needs. */
export function progressReader(provider: HarnessProvider) {
  let note = '';
  let phase = '';
  let thinking = 0;
  const draft = new DraftReader();
  const enter = (next: 'starting' | 'thinking' | 'writing' | 'drafting'): HarnessProgress[] => {
    if (phase === next) return [];
    phase = next;
    return [{ type: 'phase', phase: next }];
  };
  const finishNote = (): HarnessProgress[] => {
    const text = clean(note);
    note = '';
    return text ? [{ type: 'note', text, done: true }] : [];
  };

  function claude(event: Json): HarnessProgress[] {
    if (event.type === 'system' && event.subtype === 'init') return enter('starting');
    if (event.type === 'system' && event.subtype === 'thinking_tokens') {
      const tokens = Number(event.estimated_tokens);
      if (!Number.isFinite(tokens) || tokens <= thinking) return enter('thinking');
      thinking = tokens;
      return [...enter('thinking'), { type: 'thinking', tokens }];
    }
    if (event.type !== 'stream_event') return [];
    const inner = record(event.event);
    if (inner?.type === 'content_block_start') {
      const block = record(inner.content_block);
      if (block?.type === 'thinking') return enter('thinking');
      if (block?.type === 'text') return enter('writing');
      if (block?.type === 'tool_use') return [...finishNote(), ...enter('drafting')];
      return [];
    }
    if (inner?.type !== 'content_block_delta') return [];
    const delta = record(inner.delta);
    if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
      const out: HarnessProgress[] = [];
      const lines = (note + delta.text).split('\n');
      note = lines.pop() ?? '';
      for (const line of lines) {
        const text = clean(line);
        if (text) out.push({ type: 'note', text, done: true });
      }
      const partial = clean(note);
      if (partial) out.push({ type: 'note', text: partial, done: false });
      return out;
    }
    if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
      const drafted = draft.add(delta.partial_json);
      return drafted ? [drafted] : [];
    }
    return [];
  }

  function codex(event: Json): HarnessProgress[] {
    if (event.type === 'turn.started') return enter('thinking');
    const item = record(event.item);
    if (event.type !== 'item.completed' || !item) return [];
    // Codex shares concise reasoning summaries when the model reasons; each is a note.
    if (item.type === 'reasoning' && typeof item.text === 'string') {
      const text = clean(item.text.split('\n').find((line) => line.trim()) ?? '');
      return text ? [{ type: 'note', text, done: true }] : [];
    }
    if (item.type === 'agent_message') return enter('drafting');
    return [];
  }

  return (line: string): HarnessProgress[] => {
    let event: Json | null;
    try {
      event = record(JSON.parse(line));
    } catch {
      return [];
    }
    if (!event) return [];
    return provider === 'claude' ? claude(event) : provider === 'codex' ? codex(event) : [];
  };
}
