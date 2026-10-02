// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EMAIL_DEMO, type BoardDocument } from '@opsis/schema';
import { CanvasLookPicker } from './CanvasLookPicker';
import {
  CANVAS_PALETTES,
  DEFAULT_LOOK,
  ICON_COLORS,
  canvasLook,
  lookVariables,
  setCanvasLook,
} from './canvas-theme';
import { boardSvg } from './export';

const root = () => document.documentElement.style;

afterEach(() => {
  cleanup();
  setCanvasLook(DEFAULT_LOOK);
  localStorage.clear();
});

describe('canvas colours', () => {
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

  it('applies, remembers and resets the chosen background and icon colour', () => {
    render(<CanvasLookPicker />);
    fireEvent.click(screen.getByRole('button', { name: 'Canvas colours' }));
    const panel = screen.getByRole('dialog', { name: 'Canvas colours' });
    expect(screen.getByRole('button', { name: 'Blueprint' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Forest' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mint' }));
    const forest = CANVAS_PALETTES.find((palette) => palette.id === 'forest')!;
    expect(root().getPropertyValue('--bp-bg-1')).toBe(forest.background[0]);
    expect(root().getPropertyValue('--bp-icon')).toBe('#9fe6c0');
    expect(screen.getByRole('button', { name: 'Forest' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(JSON.parse(localStorage.getItem('opsis:canvas-look:v1')!)).toEqual({
      canvas: 'forest',
      icon: 'mint',
    });
    expect(canvasLook()).toEqual({ canvas: 'forest', icon: 'mint' });
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(root().getPropertyValue('--bp-bg-1')).toBe(CANVAS_PALETTES[0].background[0]);
    expect((screen.getByRole('button', { name: 'Reset' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    // Escape closes the panel and returns focus to the toolbar button.
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Canvas colours' }));
  });

  it('closes when clicking outside', () => {
    render(<CanvasLookPicker />);
    fireEvent.click(screen.getByRole('button', { name: 'Canvas colours' }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('exports diagrams in the chosen colours', () => {
    const board: BoardDocument = { ...EMAIL_DEMO, version: 2, agent: 'demo', positions: {} };
    const plum = CANVAS_PALETTES.find((palette) => palette.id === 'plum')!;
    const svg = boardSvg(board, { canvas: 'plum', icon: 'sky' });
    expect(svg).toContain(`fill="${plum.deep}"`);
    expect(svg).toContain('color="#9fd8f5"');
    expect(boardSvg(board, DEFAULT_LOOK)).toContain(`fill="${CANVAS_PALETTES[0].deep}"`);
  });
});
