import { describe, expect, it } from 'vitest';
import { progressReader, type HarnessProgress } from './progress.js';
import { extractHarnessResult } from './envelope.js';

const stream = (event: object) => JSON.stringify({ type: 'stream_event', event });
const text = (value: string) =>
  stream({ type: 'content_block_delta', delta: { type: 'text_delta', text: value } });
const json = (value: string) =>
  stream({ type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: value } });

/** The shape Claude Code 2.1 streams with --include-partial-messages, trimmed. */
const CLAUDE = [
  JSON.stringify({ type: 'system', subtype: 'init' }),
  stream({ type: 'content_block_start', content_block: { type: 'thinking' } }),
  JSON.stringify({ type: 'system', subtype: 'thinking_tokens', estimated_tokens: 50 }),
  JSON.stringify({ type: 'system', subtype: 'thinking_tokens', estimated_tokens: 247 }),
  stream({ type: 'content_block_start', content_block: { type: 'text' } }),
  text('**Tracing** the query'),
  text(' to root\n- Separating'),
  text(' replies'),
  stream({ type: 'content_block_start', content_block: { type: 'tool_use' } }),
  json('{"title":"DNS","nodes":[{"id":"client","label":"Your'),
  json(' browser"},{"id":"resolver","label":"Recursive \\"resolver\\""}],'),
  json('"edges":[{"id":"q","source":"client","target":"resolver"},{"id":"a","sour'),
  json('ce":"resolver"}]}'),
  JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    structured_output: { title: 'DNS' },
  }),
];

describe('agent progress', () => {
  it('reads Claude’s thinking, its notes line by line, and the diagram as it is drafted', () => {
    const read = progressReader('claude');
    const events: HarnessProgress[] = CLAUDE.flatMap(read);
    expect(events).toContainEqual({ type: 'phase', phase: 'thinking' });
    expect(events).toContainEqual({ type: 'thinking', tokens: 247 });
    const notes = events.filter((event) => event.type === 'note');
    expect(notes).toContainEqual({ type: 'note', text: 'Tracing the query', done: false });
    expect(notes.filter((note) => note.type === 'note' && note.done)).toEqual([
      { type: 'note', text: 'Tracing the query to root', done: true },
      // The last line is finished when the answer begins.
      { type: 'note', text: 'Separating replies', done: true },
    ]);
    const drafts = events.filter((event) => event.type === 'drafting');
    expect(drafts.at(-1)).toEqual({
      type: 'drafting',
      items: 2,
      links: 2,
      latest: 'Recursive "resolver"',
    });
  });
  it('names illustrations by ID while they are drawn', () => {
    const read = progressReader('claude');
    const events = [
      json('{"illustrations":[{"id":"wind","illustration":{"layers":[]}},{"id":"sea'),
      json('","illustration":{}}]}'),
    ].flatMap(read);
    expect(events.at(-1)).toEqual({ type: 'drafting', items: 2, links: 0, latest: 'sea' });
  });
  it('turns Codex reasoning summaries into notes', () => {
    const read = progressReader('codex');
    const events = [
      '{"type":"turn.started"}',
      '{"type":"item.completed","item":{"type":"reasoning","text":"**Mapping DNS actors**\\n\\nDetails"}}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"{}"}}',
      'not json',
    ].flatMap(read);
    expect(events).toEqual([
      { type: 'phase', phase: 'thinking' },
      { type: 'note', text: 'Mapping DNS actors', done: true },
      { type: 'phase', phase: 'drafting' },
    ]);
  });
  it('still finds Claude’s answer at the end of a streamed run', () => {
    expect(extractHarnessResult('claude', CLAUDE.join('\n'))).toBe('{"title":"DNS"}');
  });
});
