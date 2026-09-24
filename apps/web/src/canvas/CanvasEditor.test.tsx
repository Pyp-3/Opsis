// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStore } from 'zustand';
import { loadFixture } from '../scene/fixtures';
import { SessionProvider } from '../state/context';
import { fakeApi } from '../state/fakeApi';
import { createSessionStore, currentOsg, type SessionStore } from '../state/session';
import CanvasEditor from './CanvasEditor';

vi.stubGlobal(
  'ResizeObserver',
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

function ConnectedEditor({ store }: { store: SessionStore }) {
  const osg = useStore(store, currentOsg);
  return osg ? <CanvasEditor osg={osg} /> : null;
}

afterEach(cleanup);

describe('CanvasEditor presentation state', () => {
  it('never mutates the OSG and leaves editing functional before and after reduced-motion playback', () => {
    const store = createSessionStore(fakeApi());
    store.setState({
      status: 'ready',
      trail: [loadFixture('sun-east')],
      viewMode: '2d',
      reduceMotion: true,
    });
    render(
      <SessionProvider store={store}>
        <ConnectedEditor store={store} />
      </SessionProvider>,
    );

    const initialCount = currentOsg(store.getState())?.scenes[0]?.nodes.length ?? 0;
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(currentOsg(store.getState())?.scenes[0]?.nodes).toHaveLength(initialCount + 1);
    const canonicalBeforePlayback = structuredClone(currentOsg(store.getState()));

    fireEvent.click(screen.getByRole('button', { name: 'Present' }));
    expect(store.getState().selectedId).toMatch(/^user_/u);
    expect(screen.getByRole('button', { name: 'Add' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Play presentation' }));
    expect(store.getState().selectedId).toBe('e_east');
    expect(currentOsg(store.getState())).toEqual(canonicalBeforePlayback);

    fireEvent.click(screen.getByRole('button', { name: 'Exit presentation' }));
    expect(screen.getByRole('button', { name: 'Add' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(currentOsg(store.getState())?.scenes[0]?.nodes).toHaveLength(initialCount + 2);
  });
});
