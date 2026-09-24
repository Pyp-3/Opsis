// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { ApiError } from './state/api';
import { fakeApi } from './state/fakeApi';
import { createSessionStore } from './state/session';
import { loadFixture } from './scene/fixtures';
import { SAMPLE_SENTENCES } from './ui/Chrome';

// WebGL is unavailable in jsdom; the canvas chunk is covered by browser checks.
vi.mock('./scene/SceneCanvas', () => ({ default: () => null }));

vi.stubGlobal(
  'ResizeObserver',
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderApp(api = fakeApi()) {
  const store = createSessionStore(api);
  render(<App store={store} />);
  return { api, store };
}

async function draw(sentence: string) {
  fireEvent.change(screen.getByLabelText(/type a sentence/i), { target: { value: sentence } });
  fireEvent.click(screen.getByRole('button', { name: 'Draw it' }));
  return screen.findByRole('navigation', { name: 'Diagram as list' });
}

const outlineButton = (name: RegExp | string) =>
  within(screen.getByRole('navigation', { name: 'Diagram as list' })).getByRole('button', { name });

/** axe-core violations of serious or critical impact. */
async function seriousViolations() {
  const result = await axe.run(document.body, {
    // jsdom does not lay out or paint, so contrast is checked by a token test and the browser run.
    rules: { 'color-contrast': { enabled: false } },
  });
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`);
}

describe('App', () => {
  it('shows onboarding with five sample sentences', async () => {
    renderApp();
    expect(screen.getByRole('heading', { name: 'Opsis', level: 1 })).toBeDefined();
    for (const sentence of SAMPLE_SENTENCES)
      expect(screen.getByRole('button', { name: sentence })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: SAMPLE_SENTENCES[1] }));
    expect(await screen.findByRole('heading', { name: 'A Sandwich and Its Parts' })).toBeDefined();
    expect((screen.getByLabelText(/type a sentence/i) as HTMLInputElement).value).toBe(
      SAMPLE_SENTENCES[1],
    );
  });

  it('validates empty input', () => {
    const { api } = renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Draw it' }));
    expect(screen.getByRole('alert').textContent).toBe('Type a sentence first.');
    expect(api.visualize).not.toHaveBeenCalled();
  });

  it('shows progress only after 300 ms', async () => {
    vi.useFakeTimers();
    let finish: (() => void) | undefined;
    const api = fakeApi();
    const base = api.visualize.getMockImplementation()!;
    api.visualize.mockImplementation(
      (body, onProgress, options) =>
        new Promise((resolve) => {
          onProgress('parsing');
          finish = () => void base(body, onProgress, options).then(resolve);
        }),
    );
    renderApp(api);
    fireEvent.change(screen.getByLabelText(/type a sentence/i), { target: { value: 'sandwich' } });
    fireEvent.click(screen.getByRole('button', { name: 'Draw it' }));
    expect(screen.queryByText(/Reading the sentence…/)).toBeNull();
    act(() => void vi.advanceTimersByTime(299));
    expect(screen.queryByText(/Reading the sentence…/)).toBeNull();
    act(() => void vi.advanceTimersByTime(1));
    expect(screen.getByRole('status').textContent).toBe('Reading the sentence…');
    expect(screen.getByRole('list', { name: 'Building your diagram' }).textContent).toMatch(
      /Reading the sentence \(in progress\)/,
    );
    await act(async () => {
      finish?.();
      await vi.runAllTimersAsync();
    });
    expect(screen.queryByText(/Reading the sentence…/)).toBeNull();
  });

  it('clicking a part shows its summary; "Explain more" shows the explanation', async () => {
    const { api } = renderApp();
    await draw('A sandwich can contain bread, tomato, ham.');
    fireEvent.click(outlineButton(/^Tomato/));
    const panel = screen.getByRole('complementary', { name: 'Tomato' });
    expect(within(panel).getByRole('tab', { name: 'Summary' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(await within(panel).findByText('Summary of e_tomato for teen.')).toBeDefined();
    expect(within(panel).getByText('optional', { exact: false })).toBeDefined();

    fireEvent.click(within(panel).getByRole('button', { name: 'Explain more' }));
    expect(await within(panel).findByText('What e_tomato is.')).toBeDefined();
    expect(within(panel).getByText(/Unsure/)).toBeDefined();
    expect(
      within(panel)
        .getByText(/Botanically a tomato is a fruit/)
        .closest('[role=note]')?.textContent,
    ).toMatch(/^Did you know\?/);

    // Cached: switching tabs back and forth does not call the API again.
    fireEvent.click(within(panel).getByRole('tab', { name: 'Summary' }));
    fireEvent.click(within(panel).getByRole('tab', { name: 'Explanation' }));
    expect(api.explain).toHaveBeenCalledTimes(2);
  });

  it('shows "Did you know?" chips from the diagram notes', async () => {
    renderApp();
    await draw('The sun rises in the east.');
    fireEvent.click(outlineButton('Rises'));
    expect(screen.getByRole('note').textContent).toMatch(/Did you know\?.*only appears to rise/);
  });

  it('opens Tomato as a child diagram and the breadcrumb goes back', async () => {
    const { api } = renderApp();
    await draw('sandwich');
    fireEvent.click(outlineButton(/^Tomato/));
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(
      await screen.findByRole('heading', { name: 'A tomato has skin, flesh and seeds' }),
    ).toBeDefined();
    expect(api.drilldown).toHaveBeenCalledWith(
      { osgId: '20000000-0000-4000-8000-000000000002', nodeId: 'e_tomato' },
      expect.anything(),
    );
    const crumbs = screen.getByRole('navigation', { name: 'Diagram path' });
    expect(within(crumbs).getByText('Tomato').getAttribute('aria-current')).toBe('page');
    fireEvent.click(within(crumbs).getByRole('button', { name: 'Sandwich' }));
    expect(await screen.findByRole('heading', { name: 'A Sandwich and Its Parts' })).toBeDefined();
  });

  it('supports the keyboard shortcuts', async () => {
    renderApp();
    await draw('sandwich');
    const explode = screen.getByRole('button', { name: 'Explode' });
    fireEvent.keyDown(window, { key: 'e' });
    expect(explode.getAttribute('aria-pressed')).toBe('true');
    expect(explode.textContent).toBe('Assemble');
    fireEvent.keyDown(window, { key: 'E' });
    expect(explode.textContent).toBe('Explode');

    // Shift+Enter on a node opens the explanation directly.
    const ham = outlineButton(/^Ham/);
    ham.focus();
    fireEvent.keyDown(ham, { key: 'Enter', shiftKey: true });
    const panel = screen.getByRole('complementary', { name: 'Ham' });
    expect(
      within(panel).getByRole('tab', { name: 'Explanation' }).getAttribute('aria-selected'),
    ).toBe('true');

    // Escape closes the panel; O on the focused node drills down.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('complementary')).toBeNull();
    const tomato = outlineButton(/^Tomato/);
    tomato.focus();
    fireEvent.keyDown(tomato, { key: 'o' });
    expect(
      await screen.findByRole('heading', { name: 'A tomato has skin, flesh and seeds' }),
    ).toBeDefined();

    // Backspace goes up one breadcrumb, but not while typing in the input.
    fireEvent.keyDown(screen.getByLabelText(/type a sentence/i), { key: 'Backspace' });
    expect(
      screen.getByRole('heading', { name: 'A tomato has skin, flesh and seeds' }),
    ).toBeDefined();
    fireEvent.keyDown(document.body, { key: 'Backspace' });
    expect(await screen.findByRole('heading', { name: 'A Sandwich and Its Parts' })).toBeDefined();
  });

  it('switches tabs with the arrow keys', async () => {
    renderApp();
    await draw('sandwich');
    fireEvent.click(outlineButton(/^Ham/));
    const summary = screen.getByRole('tab', { name: 'Summary' });
    fireEvent.keyDown(summary, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Explanation' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Explanation' }));
  });

  it('the outline mirrors the scene nodes and connections', async () => {
    renderApp();
    await draw('sandwich');
    const outline = screen.getByRole('navigation', { name: 'Diagram as list' });
    const names = within(outline)
      .getAllByRole('button')
      .map((b) => b.getAttribute('data-node-id'));
    expect(names).toEqual(['e_sandwich', 'e_bread_top', 'e_ham', 'e_tomato', 'e_bread_bottom']);
    expect(within(outline).getAllByText('optional')).toHaveLength(4);
    // Accessible description comes from the summary.
    const tomato = outlineButton(/^Tomato/);
    const desc = document.getElementById(tomato.getAttribute('aria-describedby') ?? '');
    expect(desc?.textContent).toMatch(/tomato/i);
  });

  it('explode is only offered for explodable scenes', async () => {
    renderApp();
    await draw('The sun rises in the east.');
    expect(screen.queryByRole('button', { name: 'Explode' })).toBeNull();
  });

  it('shows errors with "Try again" for retryable failures', async () => {
    const api = fakeApi();
    api.visualize.mockRejectedValueOnce(
      new ApiError({
        code: 'pipeline_error',
        message: 'Could not build.',
        stage: 'visualize',
        retryable: true,
      }),
    );
    renderApp(api);
    fireEvent.change(screen.getByLabelText(/type a sentence/i), { target: { value: 'sandwich' } });
    fireEvent.click(screen.getByRole('button', { name: 'Draw it' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not build\./);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'A Sandwich and Its Parts' })).toBeDefined();
  });

  it('palette and reading level toggles update the session', async () => {
    const { store, api } = renderApp();
    await draw('sandwich');
    fireEvent.click(screen.getByLabelText('Colour-blind-safe colours'));
    expect(store.getState().paletteId).toBe('colorBlindSafe');
    fireEvent.change(screen.getByLabelText('Reading level'), { target: { value: 'child' } });
    fireEvent.click(outlineButton(/^Ham/));
    await waitFor(() =>
      expect(api.explain).toHaveBeenCalledWith(expect.objectContaining({ audience: 'child' })),
    );
    fireEvent.click(screen.getByLabelText('Reduce motion'));
    expect(store.getState().reduceMotion).toBe(true);
  });

  it('keeps unsaved 2D history and dirty state across a 3D round trip', async () => {
    const { store, api } = renderApp();
    await draw('sandwich');
    fireEvent.click(screen.getByRole('button', { name: '2D' }));

    const initialNodeCount = store.getState().trail.at(-1)?.scenes[0]?.nodes.length;
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    expect(store.getState().trail.at(-1)?.scenes[0]?.nodes).toHaveLength(
      (initialNodeCount ?? 0) + 1,
    );
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: '3D' }));
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(screen.getAllByText('New idea was added to this diagram.').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Explain more' }));
    expect(screen.getByText('Save this diagram to explain a new node.')).toBeDefined();
    expect(api.explain).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '2D' }));

    const undo = await screen.findByRole('button', { name: 'Undo' });
    expect(undo.hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(undo);
    expect(store.getState().trail.at(-1)?.scenes[0]?.nodes).toHaveLength(initialNodeCount ?? 0);
  });

  it('explains Auto mode and keeps selection, pedagogy and reading level in the 2D equivalent', async () => {
    const api = fakeApi();
    api.visualize.mockImplementation(async (_body, onProgress) => {
      for (const stage of ['parsing', 'mapping', 'layout', 'done'] as const) onProgress(stage);
      const osg = loadFixture('sun-east');
      osg.scenes[0]!.dimension = '2d';
      return osg;
    });
    const { store } = renderApp(api);
    await draw('The sun rises in the east.');
    expect(screen.getByRole('button', { name: 'Auto' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/Auto uses 3D only for curator-approved spatial scenes/)).toBeDefined();

    fireEvent.change(screen.getByLabelText('Reading level'), { target: { value: 'child' } });
    fireEvent.click(outlineButton('Rises'));
    expect(screen.getByRole('note').textContent).toMatch(/only appears to rise/);

    fireEvent.click(screen.getByRole('button', { name: '3D' }));
    expect(store.getState()).toMatchObject({ selectedId: 'e_rises', audience: 'child' });
    expect(screen.getByRole('complementary', { name: 'Rises' })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Auto' }));
    expect(store.getState()).toMatchObject({ viewPreference: 'auto', viewMode: '2d' });
    expect(screen.getByRole('complementary', { name: 'Rises' })).toBeDefined();
  });

  it('has no serious axe violations in the empty, diagram and panel states', async () => {
    renderApp();
    expect(await seriousViolations()).toEqual([]);
    await draw('sandwich');
    fireEvent.click(outlineButton(/^Tomato/));
    await screen.findByText('Summary of e_tomato for teen.');
    expect(await seriousViolations()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Explain more' }));
    await screen.findByText('What e_tomato is.');
    expect(await seriousViolations()).toEqual([]);
  });
});
