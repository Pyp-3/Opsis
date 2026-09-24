// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// WebGL is unavailable in jsdom; the canvas chunk is covered by browser checks.
vi.mock('./SceneCanvas', () => ({ default: () => null }));

const { default: SceneViewer } = await import('./SceneViewer');

afterEach(cleanup);

describe('SceneViewer', () => {
  it('opens the fixture summary when a node is chosen and closes it again', () => {
    render(<SceneViewer fixture="sun-east" />);
    fireEvent.click(screen.getByRole('button', { name: 'Sun' }));
    expect(screen.getByRole('heading', { name: 'Sun' })).toBeDefined();
    expect(
      screen.getByText('The Sun is the star at the centre of our solar system.'),
    ).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Close summary' }));
    expect(screen.queryByRole('heading', { name: 'Sun' })).toBeNull();
  });

  it('shows the "Did you know?" chip for rises', () => {
    render(<SceneViewer fixture="sun-east" />);
    fireEvent.click(screen.getByRole('button', { name: 'Rises' }));
    expect(screen.getByRole('note').textContent).toMatch(/only appears to rise/);
  });

  it('offers explode only for the sandwich, toggled by button and E key', () => {
    render(<SceneViewer fixture="sun-east" />);
    expect(screen.queryByRole('button', { name: 'Explode' })).toBeNull();
    cleanup();
    render(<SceneViewer fixture="sandwich" />);
    const button = screen.getByRole('button', { name: 'Explode' });
    fireEvent.click(button);
    expect(button.textContent).toBe('Assemble');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(window, { key: 'e' });
    expect(button.textContent).toBe('Explode');
  });

  it('badges optional parts in the outline', () => {
    render(<SceneViewer fixture="sandwich" />);
    expect(screen.getAllByText('optional')).toHaveLength(4);
  });
});
