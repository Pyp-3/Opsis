// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopUpdates, UpdateStatus } from '../desktop';
import { UpdateNotice } from './UpdateNotice';

afterEach(cleanup);

const status = (overrides: Partial<UpdateStatus> = {}): UpdateStatus => ({
  supported: true,
  available: true,
  current: '0.1.0-build.50.1.gaaaaaaaaaaaa',
  version: '0.1.0-build.54.1.gbbbbbbbbbbbb',
  canInstall: true,
  ...overrides,
});

function updates(result: UpdateStatus, install = vi.fn(async () => undefined)) {
  return {
    check: vi.fn(async () => result),
    install,
    openPage: vi.fn(async () => undefined),
  } satisfies DesktopUpdates;
}

describe('desktop update notice', () => {
  it('stays hidden in browsers and when no newer build exists', async () => {
    const { container, rerender } = render(<UpdateNotice updates={undefined} />);
    expect(container.innerHTML).toBe('');
    const current = updates(status({ available: false }));
    rerender(<UpdateNotice updates={current} />);
    await waitFor(() => expect(current.check).toHaveBeenCalled());
    expect(container.innerHTML).toBe('');
  });

  it('installs only after consent and reports progress', async () => {
    const native = updates(status());
    render(<UpdateNotice updates={native} />);
    expect(await screen.findByText('An Opsis update is available.')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('0.1.0-build.54');
    expect(native.install).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Install and restart' }));
    expect(native.install).toHaveBeenCalledOnce();
    expect(screen.getByRole('status').textContent).toContain('Opsis will restart');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('offers a retry when installation fails', async () => {
    const native = updates(
      status(),
      vi.fn(async () => {
        throw new Error('signature');
      }),
    );
    render(<UpdateNotice updates={native} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Install and restart' }));
    expect(await screen.findByText(/could not be installed/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(native.install).toHaveBeenCalledTimes(2);
  });

  it('sends portable copies to the download page and remembers a dismissal', async () => {
    const native = updates(status({ canInstall: false }));
    const { container } = render(<UpdateNotice updates={native} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Download' }));
    expect(native.openPage).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Install and restart' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(container.innerHTML).toBe('');
  });
});
