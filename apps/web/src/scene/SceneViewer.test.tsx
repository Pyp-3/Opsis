// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionProvider } from '../state/context';
import { fakeApi } from '../state/fakeApi';
import { createSessionStore } from '../state/session';
import { loadFixture, type FixtureId } from './fixtures';

// WebGL is unavailable in jsdom; the canvas chunk is covered by browser checks.
vi.mock('./SceneCanvas', () => ({ default: () => null }));

const { default: SceneViewer } = await import('./SceneViewer');

afterEach(cleanup);

function renderViewer(fixture: FixtureId) {
  const osg = loadFixture(fixture);
  const store = createSessionStore(fakeApi());
  store.setState({ trail: [osg], status: 'ready' });
  render(
    <SessionProvider store={store}>
      <SceneViewer osg={osg} reducedMotion={false} />
    </SessionProvider>,
  );
  return store;
}

describe('SceneViewer', () => {
  it('opens the summary panel when a node is chosen and closes it again', () => {
    renderViewer('sun-east');
    fireEvent.click(screen.getByRole('button', { name: 'Sun' }));
    const panel = screen.getByRole('complementary', { name: 'Sun' });
    expect(
      within(panel).getByText('The Sun is the star at the centre of our solar system.'),
    ).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }));
    expect(screen.queryByRole('heading', { name: 'Sun' })).toBeNull();
  });

  it('only offers Open for drillable nodes', () => {
    renderViewer('sun-east');
    fireEvent.click(screen.getByRole('button', { name: 'Compass (main)' }));
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sun' }));
    expect(screen.getByRole('button', { name: 'Open' })).toBeDefined();
  });

  it('badges optional parts in the outline', () => {
    renderViewer('sandwich');
    expect(screen.getAllByText('optional')).toHaveLength(4);
  });
});
