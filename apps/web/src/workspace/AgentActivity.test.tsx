// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentDrawing } from '@opsis/schema';
import { AgentActivity } from './AgentActivityView';
import { applyProgress, startActivity, VERBS, type AgentActivity as State } from './agentActivity';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const headline = () => document.querySelector('.activity-headline')!.textContent;
const meta = () => document.querySelector('.activity-meta')!.textContent;
const quiet = startActivity(() => 0);

describe('agent activity', () => {
  it('keeps a quiet wait moving with rotating verbs, elapsed time and tokens', () => {
    const thinking = applyProgress(quiet, { type: 'thinking', tokens: 4200 });
    const { rerender } = render(<AgentActivity activity={thinking} elapsed={1} agent="Claude" />);
    expect(headline()).toBe(`${VERBS[0]}…`);
    expect(meta()).toBe('(1s · 4.2k tokens estimated thinking)');
    rerender(<AgentActivity activity={thinking} elapsed={7} agent="Claude" />);
    expect(headline()).toBe(`${VERBS[2]}…`);
  });
  it('reveals notes that arrive together one at a time, then shows the drafting', () => {
    let state: State = quiet;
    for (const text of ['Mapping the refrigerant loop', 'Placing the compressor indoors'])
      state = applyProgress(state, { type: 'note', text, done: true });
    state = applyProgress(state, { type: 'drafting', items: 3, links: 2, latest: 'Compressor' });
    render(<AgentActivity activity={state} elapsed={75} agent="Claude" />);
    act(() => vi.advanceTimersByTime(0));
    expect(headline()).toBe('Mapping the refrigerant loop…');
    act(() => vi.advanceTimersByTime(900));
    expect(headline()).toBe('Drawing Compressor…');
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Mapping the refrigerant loop',
      'Placing the compressor indoors',
    ]);
    expect(meta()).toBe('(75s · 3 objects, 2 links)');
  });
});

it('ignores malformed progress and bounds accumulated notes without losing valid state', () => {
  let state = startActivity();
  expect(applyProgress(state, { type: 'node', node: { id: 'invalid' } } as never)).toBe(state);
  expect(applyProgress(state, { type: 'phase', phase: 'unknown' } as never)).toBe(state);
  for (let i = 0; i < 80; i++)
    state = applyProgress(state, { type: 'note', text: `Note ${i}`, done: true });
  expect(state.notes).toHaveLength(50);
  expect(state.notes.at(-1)).toBe('Note 79');
});

it('collects streamed sketch drawings, replacing one sent again and clearing on a retry', () => {
  const wall: AgentDrawing = {
    id: 'wall',
    shape: 'line',
    points: [
      [0, 0],
      [96, 0],
    ],
    ink: 'ink',
    line: 'solid',
    strokeWidth: 2,
  };
  let state = applyProgress(
    startActivity(() => 0),
    { type: 'drawing', drawing: wall },
  );
  state = applyProgress(state, { type: 'drawing', drawing: { ...wall, ink: 'coral' } });
  state = applyProgress(state, { type: 'drawing', drawing: { id: 'bad' } } as never);
  expect(state.drawings).toEqual([{ ...wall, ink: 'coral' }]);
  expect(applyProgress(state, { type: 'preview-reset' }).drawings).toEqual([]);
});
