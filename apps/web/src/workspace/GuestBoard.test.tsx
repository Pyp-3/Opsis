// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addBoardPage, createEmptyBoard, updateBoardPage } from '@opsis/schema';
import { apiFetch } from '../app-url';
import { GuestBoard } from './GuestBoard';
import { GuestWorkspace } from './GuestWorkspace';

vi.mock('../app-url', async (original) => ({
  ...(await original<typeof import('../app-url')>()),
  apiFetch: vi.fn(),
}));
vi.mock('./ReadOnlyBoard', () => ({
  ReadOnlyBoard: ({ pageId, onPage }: { pageId: string; onPage: (id: string) => void }) => (
    <div>
      <output aria-label="Current page">{pageId}</output>
      <button onClick={() => onPage('cccccccccccccccccccccccccccccccc')}>Turn to cover</button>
    </div>
  ),
}));
const fetch = vi.mocked(apiFetch);
const id = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
const board = updateBoardPage(
  addBoardPage(
    { ...createEmptyBoard(), title: 'Shared lesson' },
    { id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', title: 'Hidden lesson' },
    { firstPage: { id: 'cccccccccccccccccccccccccccccccc', title: 'Cover' } },
  ),
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  { hidden: true },
);
const response = (revision = 1) =>
  new Response(
    JSON.stringify({
      id,
      revision,
      access: 'viewer',
      owner: { name: 'Owner' },
      snapshot: { board: { ...board, description: `Revision ${revision}` }, past: [], future: [] },
    }),
  );
const flush = () => act(() => vi.advanceTimersByTimeAsync(0));

beforeEach(() => {
  vi.useFakeTimers();
  fetch.mockReset();
  history.replaceState(null, '', '/');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('guest board views', () => {
  it('refreshes an anonymous page link while preserving page turns and removes revoked content', async () => {
    fetch
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response(2))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    const unavailable = vi.fn();
    render(
      <GuestBoard
        boardId={id}
        pageId="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        onUnavailable={unavailable}
      />,
    );
    await flush();
    expect(screen.getByLabelText('Current page').textContent).toBe(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Turn to cover' }));
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(screen.getByLabelText('Current page').textContent).toBe(
      'cccccccccccccccccccccccccccccccc',
    );
    expect(screen.getByRole('status', { name: '' }).textContent).toContain('Board updated');
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      `/v1/guest/boards/${id}?page=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`,
      `/v1/guest/boards/${id}?page=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`,
    ]);
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(screen.queryByLabelText('Current page')).toBeNull();
    expect(screen.queryByText('Shared by Owner · view only')).toBeNull();
    expect(unavailable).toHaveBeenCalledTimes(1);
  });

  it('refreshes a restricted guest and scopes hidden-page links to board navigation and browser history', async () => {
    history.replaceState(null, '', `/canvas?board=${id}&page=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`);
    fetch.mockResolvedValueOnce(response()).mockResolvedValueOnce(response(2));
    render(<GuestWorkspace onSignOut={vi.fn()} />);
    await flush();
    expect(screen.getByLabelText('Current page').textContent).toBe(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(screen.getByLabelText('Current page').textContent).toBe(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
    expect(screen.getByRole('status', { name: '' }).textContent).toContain('Board updated');
    expect(fetch.mock.calls[1]![0]).toBe(`/v1/boards/${id}?page=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`);

    fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify([{ id: otherId, title: 'Other board', revision: 1, updatedAt: 1 }]),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Public boards' }));
    await flush();
    fetch.mockResolvedValueOnce(response());
    fireEvent.click(screen.getByRole('button', { name: 'Other board' }));
    await flush();
    expect(fetch.mock.calls.at(-1)![0]).toBe(`/v1/boards/${otherId}`);
    expect(screen.getByLabelText('Current page').textContent).toBe(
      'cccccccccccccccccccccccccccccccc',
    );

    fetch.mockResolvedValueOnce(response());
    act(() => {
      history.replaceState(null, '', `/canvas?board=${id}&page=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await flush();
    expect(fetch.mock.calls.at(-1)![0]).toBe(
      `/v1/boards/${id}?page=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`,
    );
    expect(screen.getByLabelText('Current page').textContent).toBe(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );

    fetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(screen.queryByLabelText('Current page')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('no longer available');
  });
});
