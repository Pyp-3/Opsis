// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { EMAIL_DEMO, type BoardDocument } from '@opsis/schema';
import { Workspace } from './Workspace';

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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});
const board: BoardDocument = { ...EMAIL_DEMO, version: 2, agent: 'claude', positions: {} };
function setup(candidate?: typeof EMAIL_DEMO) {
  localStorage.setItem('opsis:board:v2', JSON.stringify(board));
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/v1/agents')
      return Response.json([{ id: 'claude', available: true, detail: 'Fixture ready' }]);
    if (url === '/v1/boards') return Response.json([]);
    if (options?.method === 'PUT') return Response.json({ revision: 1 });
    if (url === '/v1/boards/generate')
      return Response.json(candidate ? { candidate, changes: ['Remove concept: sender'] } : board, {
        status: candidate ? 409 : 200,
      });
    throw new Error(`Unexpected request ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  render(<Workspace />);
  return fetch;
}
describe('current workspace integration', () => {
  it('recognises the terminal reference without an agent call and exposes troubleshooting', async () => {
    const fetch = vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/v1/agents')
        return Response.json([{ id: 'claude', available: false, detail: 'Offline fixture' }]);
      if (url === '/v1/boards') return Response.json([]);
      if (options?.method === 'PUT') return Response.json({ revision: 1 });
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetch);
    render(<Workspace />);
    await screen.findByText('Offline fixture');
    fireEvent.change(screen.getByLabelText('What would you like to understand?'), {
      target: { value: 'What does `cat users.txt | head -10` do?' },
    });
    expect(screen.getByText('Local terminal example · no agent call')).toBeDefined();
    expect(
      (screen.getByRole('button', { name: 'Generate diagram' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Generate diagram' }));
    const steps = await screen.findByRole('navigation', { name: 'Diagram steps' });
    fireEvent.click(within(steps).getByRole('button', { name: 'Read the file' }));
    const details = screen.getByRole('region', { name: 'Terminal step expectations' });
    expect(within(details).getByText('cat users.txt')).toBeDefined();
    expect(within(details).getByText('Expected output')).toBeDefined();
    expect(within(details).getByText('[file contents] → stdout → pipe')).toBeDefined();
    expect(screen.queryByText('How it works')).toBeNull();
    fireEvent.click(within(details).getByText('Permission denied'));
    expect(within(details).getByText(/request authorised access/)).toBeDefined();
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
  it('shows topic suggestions and prepares them without generating', async () => {
    const fetch = setup();
    // Suggestions stay tucked away until asked for, so they never cover the diagram.
    expect(
      screen.queryByRole('button', { name: 'Show what happens if delivery fails' }),
    ).toBeNull();
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
    fireEvent.change(screen.getByLabelText('What would you like to understand?'), {
      target: { value: 'Expand a step' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate diagram' }));
    await screen.findByRole('region', { name: 'Review proposed changes' });
    const steps = screen.getByRole('navigation', { name: 'Diagram steps' });
    expect(within(steps).getByRole('button', { name: /You write/ })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Apply reviewed changes' }));
    expect(within(steps).queryByRole('button', { name: /You write/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(within(steps).getByRole('button', { name: /You write/ })).toBeDefined();
  });
});
