// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { EMAIL_DEMO, TERMINAL_PIPELINE_EXAMPLE, type BoardDocument } from '@opsis/schema';
import { Workspace } from './Workspace';
import { playbackTimeline } from '@opsis/schema';

vi.mock('@xyflow/react', async (original) => {
  const actual = await original<typeof import('@xyflow/react')>();
  const flow = {
    fitView: vi.fn(),
    setViewport: vi.fn(),
    setCenter: vi.fn(),
    getZoom: () => 1,
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
  };
  return {
    ...actual,
    useReactFlow: () => flow,
    ReactFlowProvider: ({ children }: { children: ReactNode }) => children,
    ReactFlow: () => <div aria-label="Graph renderer" />,
  };
});
vi.mock('./model', async (original) => ({
  ...(await original<typeof import('./model')>()),
  layoutBoard: async (graph: typeof EMAIL_DEMO, agent: string) => ({
    ...graph,
    version: 2,
    positions: {},
    agent,
  }),
}));
// Use the real Rust/WASM calculations through an in-process transport in jsdom.
vi.mock('./process-engine', async (original) => {
  const actual = await original<typeof import('./process-engine')>();
  const { readFile } = await import('node:fs/promises');
  const { resolve } = await import('node:path');
  const { calculateInRust } = await import('@opsis/engine/runtime');
  const { applyProcessResults } = await import('@opsis/engine');
  const bytes = new Uint8Array(
    await readFile(resolve(process.cwd(), 'packages/engine/dist/opsis_engine_bg.wasm')),
  ).buffer;
  const calculate = (request: Parameters<typeof calculateInRust>[0]) =>
    calculateInRust(request, bytes);
  return {
    ...actual,
    calculateProcess: calculate,
    populateProcess: async (board: typeof EMAIL_DEMO) =>
      applyProcessResults(board, await calculate(actual.processRequest(board))),
  };
});

beforeEach(() => {
  // The canvas has its own route; the landing page lives at /.
  history.replaceState(null, '', '/canvas');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});
const board: BoardDocument = { ...EMAIL_DEMO, version: 2, agent: 'claude', positions: {} };
function setup(candidate?: typeof EMAIL_DEMO, responseStatus = 409) {
  localStorage.setItem('opsis:board:v2', JSON.stringify(board));
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/chat')) {
      if (options?.method === 'PUT') {
        const { thread, revision } = JSON.parse(String(options.body));
        return Response.json({ ...thread, revision: revision + 1, updatedAt: Date.now() });
      }
      return Response.json([]);
    }
    if (url.endsWith('/backlinks')) return Response.json([]);
    if (url === '/v1/agents')
      return Response.json([{ id: 'claude', available: true, detail: 'Fixture ready' }]);
    if (url === '/v1/boards') return Response.json([]);
    if (url === '/v1/speech') return Response.json({ state: 'off' });
    if (options?.method === 'PUT') return Response.json({ revision: 1 });
    if (url === '/v1/boards/generate')
      return Response.json(
        candidate && responseStatus === 409
          ? { candidate, changes: ['Remove concept: sender'] }
          : (candidate ?? board),
        {
          status: candidate ? responseStatus : 200,
        },
      );
    throw new Error(`Unexpected request ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  render(<Workspace />);
  return fetch;
}
describe('current workspace integration', () => {
  it('updates an open details panel as playback advances and keeps a closed panel closed', async () => {
    setup();
    await screen.findByRole('navigation', { name: 'Diagram steps' });
    fireEvent.click(screen.getByRole('button', { name: 'Play the process' }));
    const steps = screen.getByRole('navigation', { name: 'Diagram steps' });
    fireEvent.click(within(steps).getByRole('button', { name: /You write/ }));
    expect(screen.getByRole('complementary', { name: 'Details for You write' })).toBeDefined();
    const timeline = await screen.findByRole('slider', { name: 'Process timeline' });
    const beats = playbackTimeline(board);
    const inbox = beats.findIndex((beat) => beat.nodeId === 'recipient');
    const sender = beats.findIndex((beat) => beat.nodeId === 'sender');
    fireEvent.change(timeline, { target: { value: String(inbox) } });
    expect(screen.getByRole('complementary', { name: 'Details for Their inbox' })).toBeDefined();
    fireEvent.click(within(steps).getByRole('button', { name: /You write/ }));
    expect(screen.getByRole('complementary', { name: 'Details for You write' })).toBeDefined();
    fireEvent.change(timeline, { target: { value: String(sender) } });
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
    fireEvent.change(timeline, { target: { value: String(inbox) } });
    expect(screen.queryByRole('complementary', { name: /Details for/ })).toBeNull();
  });
  it('deletes the selected concept with the Delete key, closes the panel, and can undo', async () => {
    setup();
    await screen.findByRole('navigation', { name: 'Diagram steps' });
    const steps = screen.getByRole('navigation', { name: 'Diagram steps' });
    fireEvent.click(within(steps).getByRole('button', { name: /You write/ }));
    expect(screen.getByRole('complementary', { name: 'Details for You write' })).toBeDefined();
    fireEvent.keyDown(document.body, { key: 'Delete' });
    expect(within(steps).queryByRole('button', { name: /You write/ })).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Details for You write' })).toBeNull();
    // Deletion is one undoable action routed through the board history.
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(within(steps).getByRole('button', { name: /You write/ })).toBeDefined();
  });
  it('does not delete on Delete while typing in a field', async () => {
    setup();
    await screen.findByRole('navigation', { name: 'Diagram steps' });
    const steps = screen.getByRole('navigation', { name: 'Diagram steps' });
    fireEvent.click(within(steps).getByRole('button', { name: /You write/ }));
    fireEvent.click(screen.getByRole('tab', { name: 'Chat' }));
    const prompt = screen.getByLabelText('What would you like to understand?');
    fireEvent.keyDown(prompt, { key: 'Delete' });
    expect(within(steps).getByRole('button', { name: /You write/ })).toBeDefined();
  });
  it('recognises the terminal reference without an agent call and exposes troubleshooting', async () => {
    const fetch = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/chat')) {
        if (options?.method === 'PUT') {
          const { thread, revision } = JSON.parse(String(options.body));
          return Response.json({ ...thread, revision: revision + 1, updatedAt: Date.now() });
        }
        return Response.json([]);
      }
      if (url.endsWith('/backlinks')) return Response.json([]);
      if (url === '/v1/agents')
        return Response.json([{ id: 'claude', available: false, detail: 'Offline fixture' }]);
      if (url === '/v1/boards') return Response.json([]);
      if (options?.method === 'PUT') return Response.json({ revision: 1 });
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetch);
    render(<Workspace />);
    fireEvent.click(screen.getByRole('tab', { name: 'Chat' }));
    await screen.findByText('Offline fixture');
    fireEvent.click(screen.getByRole('tab', { name: /Canvas/ }));
    fireEvent.click(screen.getByRole('tab', { name: 'Chat' }));
    fireEvent.change(screen.getByLabelText('What would you like to understand?'), {
      target: { value: 'What does `cat users.txt | head -10` do?' },
    });
    expect(screen.getByText('Local terminal example · no agent call')).toBeDefined();
    expect(
      (screen.getByRole('button', { name: 'Generate diagram' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Generate diagram' }));
    const steps = await screen.findByRole('navigation', { name: 'Diagram steps' });
    fireEvent.click(screen.getByRole('tab', { name: /Canvas/ }));
    await waitFor(() => expect(screen.queryByText('Calculating sample…')).toBeNull());
    fireEvent.click(within(steps).getByRole('button', { name: 'Read the file' }));
    const details = screen.getByRole('region', { name: 'Terminal step expectations' });
    await within(details).findByText('Calculated');
    expect(within(details).getByText('cat users.txt')).toBeDefined();
    expect(within(details).getByText('Example output')).toBeDefined();
    const sample = within(details).getByText('Sample input').closest('details')!;
    fireEvent.click(within(details).getByText('Sample input'));
    expect(sample.textContent).toContain('logan');
    expect(details.querySelector('.terminal-output')?.textContent?.split('\n')).toHaveLength(12);
    expect(screen.queryByText('How it works')).toBeNull();
    fireEvent.click(within(details).getByText('Permission denied'));
    expect(within(details).getByText(/request authorised access/)).toBeDefined();
    fireEvent.click(within(steps).getByRole('button', { name: 'Keep ten lines' }));
    const output = screen
      .getByRole('region', { name: 'Terminal step expectations' })
      .querySelector('.terminal-output')!;
    expect(output.textContent?.split('\n')).toHaveLength(10);
    expect(output.textContent).toContain('jules');
    expect(output.textContent).not.toContain('kai');
    expect(fetch.mock.calls.some(([url]) => url === '/v1/boards/generate')).toBe(false);
    await waitFor(() =>
      expect(
        fetch.mock.calls.some(
          ([, options]) =>
            options?.method === 'PUT' && options.body?.toString().includes('cat users.txt'),
        ),
      ).toBe(true),
    );
  });
  it('updates a sample, calculates downstream outputs, plays the result and supports undo', async () => {
    const terminalBoard: BoardDocument = {
      ...TERMINAL_PIPELINE_EXAMPLE,
      version: 2,
      agent: 'claude',
      positions: {},
    };
    localStorage.setItem('opsis:board:v2', JSON.stringify(terminalBoard));
    const fetch = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/chat')) {
        if (options?.method === 'PUT') {
          const { thread, revision } = JSON.parse(String(options.body));
          return Response.json({ ...thread, revision: revision + 1, updatedAt: Date.now() });
        }
        return Response.json([]);
      }
      if (url.endsWith('/backlinks')) return Response.json([]);
      if (url === '/v1/agents')
        return Response.json([{ id: 'claude', available: false, detail: 'Offline fixture' }]);
      if (url === '/v1/boards') return Response.json([]);
      if (url === '/v1/speech') return Response.json({ state: 'off' });
      if (options?.method === 'PUT') return Response.json({ revision: 1 });
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetch);
    render(<Workspace />);
    fireEvent.click(screen.getByRole('tab', { name: 'Chat' }));
    await screen.findByText('Offline fixture');
    fireEvent.click(screen.getByRole('tab', { name: /Canvas/ }));
    const steps = screen.getByRole('navigation', { name: 'Diagram steps' });
    fireEvent.click(within(steps).getByRole('button', { name: 'Text file' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Sample data' }), {
      target: { value: 'nairobi\nkisumu\nmombasa' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Update sample' }));
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Update sample' }) as HTMLButtonElement).disabled,
      ).toBe(true),
    );
    fireEvent.click(within(steps).getByRole('button', { name: 'Keep ten lines' }));
    await within(screen.getByRole('region', { name: 'Terminal step expectations' })).findByText(
      '3 → 3 lines',
    );
    expect(
      screen
        .getByRole('region', { name: 'Terminal step expectations' })
        .querySelector('.terminal-output')?.textContent,
    ).toBe('nairobi\nkisumu\nmombasa');
    fireEvent.click(screen.getByRole('button', { name: 'Play the process' }));
    const beats = playbackTimeline(terminalBoard);
    fireEvent.change(screen.getByRole('slider', { name: 'Process timeline' }), {
      target: { value: String(beats.findIndex((beat) => beat.nodeId === 'first-lines')) },
    });
    const preview = await screen.findByRole('region', { name: 'Calculated sample flow' });
    expect(
      within(preview).getByRole('img', { name: '3 lines passed through; 0 stopped' }),
    ).toBeDefined();
    expect(preview.querySelectorAll('path')).toHaveLength(3);
    expect(preview.querySelectorAll('pre')[1]?.textContent).toBe('nairobi\nkisumu\nmombasa');
    fireEvent.click(screen.getByRole('button', { name: 'Close player' }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    fireEvent.click(within(steps).getByRole('button', { name: 'Keep ten lines' }));
    await within(screen.getByRole('region', { name: 'Terminal step expectations' })).findByText(
      '12 → 10 lines',
    );
    expect(fetch.mock.calls.some(([url]) => url === '/v1/boards/generate')).toBe(false);
  });
  it('shows topic suggestions and prepares them without generating', async () => {
    const fetch = setup();
    // Suggestions stay tucked away until asked for, so they never cover the diagram.
    expect(
      screen.queryByRole('button', { name: 'Show what happens if delivery fails' }),
    ).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Chat' }));
    fireEvent.click(screen.getByRole('button', { name: /Next steps/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Show what happens if delivery fails' }));
    expect(screen.queryByRole('group', { name: 'Next steps' })).toBeNull();
    expect(
      (screen.getByLabelText('What would you like to understand?') as HTMLTextAreaElement).value,
    ).toBe('Show what happens if delivery fails');
    await waitFor(() => expect(screen.getByText('Fixture ready')).toBeDefined());
    expect(fetch.mock.calls.some(([url]) => url === '/v1/boards/generate')).toBe(false);
  });
  it('does not apply destructive follow-ups without explicit review', async () => {
    const candidate = {
      ...EMAIL_DEMO,
      nodes: EMAIL_DEMO.nodes.slice(1),
      edges: EMAIL_DEMO.edges.slice(1),
    };
    setup(candidate);
    fireEvent.click(screen.getByRole('tab', { name: 'Chat' }));
    fireEvent.change(screen.getByLabelText('What would you like to understand?'), {
      target: { value: 'Expand a step' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate diagram' }));
    fireEvent.click(screen.getByRole('tab', { name: /Canvas/ }));
    await screen.findByRole('region', { name: 'Review proposed changes' });
    expect(screen.getByRole('img', { name: `Proposed diagram: ${candidate.title}` })).toBeDefined();
    const steps = screen.getByRole('navigation', { name: 'Diagram steps' });
    expect(within(steps).getByRole('button', { name: /You write/ })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Apply reviewed changes' }));
    expect(within(steps).queryByRole('button', { name: /You write/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(within(steps).getByRole('button', { name: /You write/ })).toBeDefined();
  });
  it('previews additive replies, compares layouts, and discards without saving changes', async () => {
    const candidate = {
      ...EMAIL_DEMO,
      nodes: [
        ...EMAIL_DEMO.nodes,
        { ...EMAIL_DEMO.nodes[0]!, id: 'archive', label: 'Archive copy' },
      ],
      edges: [
        ...EMAIL_DEMO.edges,
        {
          id: 'archive-path',
          source: 'recipient',
          target: 'archive',
          label: 'Archive',
          kind: 'flow' as const,
        },
      ],
    };
    const fetch = setup(candidate, 200);
    await screen.findByRole('navigation', { name: 'Diagram steps' });
    await waitFor(() =>
      expect(fetch.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(true),
    );
    const savesBefore = fetch.mock.calls.filter(
      ([url, options]) => options?.method === 'PUT' && !url.endsWith('/chat'),
    ).length;
    fireEvent.click(screen.getByRole('tab', { name: 'Chat' }));
    fireEvent.change(screen.getByLabelText('What would you like to understand?'), {
      target: { value: 'Add an archive' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate diagram' }));
    fireEvent.click(screen.getByRole('tab', { name: /Canvas/ }));
    const review = await screen.findByRole('region', { name: 'Review proposed changes' });
    const proposed = within(review).getByRole('img') as HTMLImageElement;
    expect(decodeURIComponent(proposed.src)).toContain('Archive copy');
    expect(within(review).getByText('Add concept: Archive copy')).toBeDefined();
    expect(
      within(screen.getByRole('navigation', { name: 'Diagram steps' })).queryByRole('button', {
        name: 'Archive copy',
      }),
    ).toBeNull();
    fireEvent.click(within(review).getByRole('button', { name: 'Current' }));
    expect(
      decodeURIComponent((within(review).getByRole('img') as HTMLImageElement).src),
    ).not.toContain('Archive copy');
    fireEvent.click(within(review).getByRole('button', { name: 'Proposed' }));
    fireEvent.click(within(review).getByRole('button', { name: 'Zoom in preview' }));
    expect((within(review).getByRole('img') as HTMLImageElement).style.width).toBe('150%');
    fireEvent.click(within(review).getByRole('button', { name: 'Keep current board' }));
    expect(screen.queryByRole('region', { name: 'Review proposed changes' })).toBeNull();
    expect(
      fetch.mock.calls.filter(
        ([url, options]) => options?.method === 'PUT' && !url.endsWith('/chat'),
      ),
    ).toHaveLength(savesBefore);
  });
  it('tucks the big picture away and brings it back on request', async () => {
    setup();
    await screen.findByRole('navigation', { name: 'Diagram steps' });
    const hide = screen.getByRole('button', { name: 'Hide the big picture' });
    expect(hide.getAttribute('aria-expanded')).toBe('true');
    // Starting playback counts as working on the canvas.
    fireEvent.click(screen.getByRole('button', { name: 'Play the process' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close player' }));
    const show = screen.getByRole('button', { name: 'Show the big picture' });
    expect(show.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(show);
    expect(
      screen.getByRole('button', { name: 'Hide the big picture' }).getAttribute('aria-expanded'),
    ).toBe('true');
    // Once the reader opens it again it stays open while they work.
    fireEvent.click(screen.getByRole('button', { name: 'Play the process' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close player' }));
    expect(screen.getByRole('button', { name: 'Hide the big picture' })).toBeDefined();
  });
  it('opens each canvas’s own look page and paints the canvas in its colours', async () => {
    setup();
    await screen.findByRole('navigation', { name: 'Diagram steps' });
    fireEvent.click(screen.getByRole('button', { name: 'Canvas colours' }));
    expect(location.pathname).toBe('/canvas/settings');
    expect(await screen.findByRole('heading', { level: 1, name: board.title })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Forest' }));
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--bp-bg-1')).toBe('#21503f'),
    );
    fireEvent.click(screen.getByRole('link', { name: 'Back to canvas' }));
    expect(location.pathname).toBe('/canvas');
    expect(screen.getByRole('navigation', { name: 'Diagram steps' })).toBeDefined();
  });
});

describe('pages', () => {
  it('lands on the home page and opens an example on the canvas', async () => {
    history.replaceState(null, '', '/');
    setup();
    expect(screen.getByRole('heading', { level: 1, name: 'See what you mean.' })).toBeDefined();
    // The sidebar on the landing page is navigation only; concepts belong to the canvas.
    expect(screen.queryByRole('navigation', { name: 'Diagram steps' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Home' }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: 'Open example: An email’s journey' }));
    await waitFor(() => expect(location.pathname).toBe('/canvas'));
    expect(await screen.findByRole('button', { name: 'Play the process' })).toBeDefined();
    expect(screen.getByRole('navigation', { name: 'Diagram steps' })).toBeDefined();
  });
  it('shows the board manager with a manager sidebar', async () => {
    history.replaceState(null, '', '/boards');
    setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Your boards' })).toBeDefined();
    expect(screen.getByRole('link', { name: /Manage boards/ }).getAttribute('aria-current')).toBe(
      'page',
    );
    fireEvent.click(screen.getByRole('link', { name: 'Home' }));
    expect(location.pathname).toBe('/');
  });
});
