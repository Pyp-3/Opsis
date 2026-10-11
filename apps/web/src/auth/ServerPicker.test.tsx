// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServerPicker } from './ServerPicker';

type Status = { remote: boolean; url: string; label: string };
const local: Status = { remote: false, url: '', label: 'This computer' };
const remote: Status = {
  remote: true,
  url: 'https://opsis.example.com/opsis',
  label: 'opsis.example.com/opsis',
};

function desktop(current: Status, connect: (address: string) => Promise<Status>) {
  const bridge = {
    ServerConnection: vi.fn(async () => current),
    ConnectServer: vi.fn(connect),
    UseThisComputer: vi.fn(async () => local),
  };
  (window as unknown as { go: unknown }).go = { main: { Desktop: bridge } };
  const assign = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, assign },
  });
  return { bridge, assign };
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { go?: unknown }).go;
});

describe('server picker', () => {
  it('is not shown outside the desktop app', () => {
    const { container } = render(<ServerPicker variant="sign-in" />);
    expect(container.innerHTML).toBe('');
  });

  it('connects to a server, showing why an address was refused', async () => {
    const { bridge, assign } = desktop(local, async (address) => {
      if (address.startsWith('http://')) throw 'Opsis servers must use https://.';
      return remote;
    });
    render(<ServerPicker variant="sign-in" />);
    expect(await screen.findByText('This computer')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(screen.queryByRole('button', { name: /Use this computer/ })).toBeNull();
    const field = screen.getByLabelText('Server address');
    fireEvent.change(field, { target: { value: 'http://example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Opsis servers must use https://.');
    expect(assign).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: 'opsis.example.com/opsis' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
    expect(bridge.ConnectServer).toHaveBeenLastCalledWith('opsis.example.com/opsis');
  });

  it('names the server in use and can return to this computer', async () => {
    const { bridge, assign } = desktop(remote, async () => remote);
    render(<ServerPicker variant="account" />);
    expect(await screen.findByText('opsis.example.com/opsis')).toBeTruthy();
    expect(screen.getByText('Opsis server')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    fireEvent.click(screen.getByRole('button', { name: /Use this computer/ }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
    expect(bridge.UseThisComputer).toHaveBeenCalled();
  });
});
