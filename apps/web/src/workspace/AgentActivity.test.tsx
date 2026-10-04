// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
