// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import {
  CANVAS_BACKGROUNDS,
  CANVAS_ICON_TINTS,
  EMAIL_DEMO,
  type BoardDocument,
} from '@opsis/schema';
import { CanvasSettingsPage } from './CanvasSettingsPage';
import {
  CANVAS_PALETTES,
  DEFAULT_LOOK,
  ICON_COLORS,
  applyLook,
  lookOf,
  lookVariables,
} from './canvas-theme';
import { boardSvg } from './export';

const board: BoardDocument = { ...EMAIL_DEMO, version: 2, agent: 'demo', positions: {} };

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function Harness({ onCommit }: { onCommit: (board: BoardDocument) => void }) {
  const [current, setCurrent] = useState(board);
  return (
    <CanvasSettingsPage
      board={current}
      busy={false}
      commit={(next) => {
        onCommit(next);
        setCurrent(next);
      }}
    />
  );
}

describe('canvas colours', () => {
  it('paints exactly the palettes and tints agents can choose', () => {
    expect(CANVAS_PALETTES.map((palette) => palette.id)).toEqual([...CANVAS_BACKGROUNDS]);
    expect(ICON_COLORS.map((icon) => icon.id)).toEqual([...CANVAS_ICON_TINTS]);
  });
  it('defines every token for every palette and icon colour', () => {
    const names = Object.keys(lookVariables(DEFAULT_LOOK));
    for (const palette of CANVAS_PALETTES)
      for (const icon of ICON_COLORS) {
        const variables = lookVariables({ canvas: palette.id, icon: icon.id });
        expect(Object.keys(variables)).toEqual(names);
        expect(Object.values(variables).every(Boolean)).toBe(true);
        expect(variables['--bp-icon']).toBe(icon.color);
      }
  });

  it('keeps each canvas’s own colours on the board, falling back for unknown ids', () => {
    expect(lookOf(board)).toEqual(DEFAULT_LOOK);
    expect(lookOf({ ...board, look: { canvas: 'forest', icon: 'mint' } })).toEqual({
      canvas: 'forest',
      icon: 'mint',
    });
    expect(lookOf({ ...board, look: { canvas: 'neon', icon: 'mint' } })).toEqual({
      canvas: DEFAULT_LOOK.canvas,
      icon: 'mint',
    });
    applyLook({ canvas: 'forest', icon: 'mint' });
    const forest = CANVAS_PALETTES.find((palette) => palette.id === 'forest')!;
    expect(document.documentElement.style.getPropertyValue('--bp-bg-1')).toBe(forest.background[0]);
  });

  it('saves the background and icon colour to this canvas and resets them', () => {
    const commit = vi.fn();
    render(<Harness onCommit={commit} />);
    expect(screen.getByRole('button', { name: 'Blueprint' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Forest' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mint' }));
    expect(commit).toHaveBeenLastCalledWith(
      expect.objectContaining({ look: { canvas: 'forest', icon: 'mint' } }),
    );
    expect(screen.getByRole('button', { name: 'Forest' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reset colours' }));
    expect(commit).toHaveBeenLastCalledWith(expect.objectContaining({ look: DEFAULT_LOOK }));
    expect(
      (screen.getByRole('button', { name: 'Reset colours' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('renames the canvas and edits its big-picture summary', () => {
    const commit = vi.fn();
    render(<Harness onCommit={commit} />);
    fireEvent.blur(screen.getByLabelText('Name'), { target: { value: 'Mail, explained' } });
    expect(commit).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Mail, explained' }));
    fireEvent.blur(screen.getByLabelText('Big-picture summary'), {
      target: { value: 'Where a message goes.' },
    });
    expect(commit).toHaveBeenLastCalledWith(
      expect.objectContaining({ description: 'Where a message goes.' }),
    );
  });

  it('exports diagrams in the canvas’s own colours', () => {
    const plum = CANVAS_PALETTES.find((palette) => palette.id === 'plum')!;
    const svg = boardSvg({ ...board, look: { canvas: 'plum', icon: 'sky' } });
    expect(svg).toContain(`fill="${plum.deep}"`);
    expect(svg).toContain('color="#9fd8f5"');
    expect(boardSvg(board, DEFAULT_LOOK)).toContain(`fill="${CANVAS_PALETTES[0].deep}"`);
  });
});
