// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMAIL_DEMO, type BoardDocument, type CustomIcon } from '@opsis/schema';
import { NodeIcon } from './NodeIcon';
import { IconPicker } from './IconPicker';
import { boardSvg } from './export';
import { layoutBoard } from './model';

afterEach(cleanup);

const seal: CustomIcon = {
  name: 'Wax seal',
  layers: [
    { shape: 'circle', cx: 12, cy: 12, r: 8 },
    { shape: 'path', d: 'M8 12h8' },
    { shape: 'circle', cx: 12, cy: 12, r: 1.5, fill: true },
  ],
};

describe('custom icons', () => {
  it('draw like library icons, in the icon colour', () => {
    const { container } = render(<NodeIcon node={{ icon: 'box', customIcon: seal }} size={48} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('data-custom-icon')).toBe('Wax seal');
    expect(svg.querySelectorAll('circle')).toHaveLength(2);
    expect(svg.querySelectorAll('[fill="currentColor"]')).toHaveLength(1);
    expect(
      render(<NodeIcon node={{ icon: 'mail' }} />).container.querySelector('.lucide-mail'),
    ).not.toBeNull();
  });
  it('are shown as the current choice and replaced by picking a library icon', () => {
    const onPick = vi.fn();
    render(<IconPicker value="box" custom={seal} onPick={onPick} />);
    const pressed = (name: string) =>
      screen.getByRole('button', { name }).getAttribute('aria-pressed');
    expect(pressed('Current icon, drawn by the agent: Wax seal')).toBe('true');
    expect(pressed('Use box icon')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Use box icon' }));
    expect(onPick).toHaveBeenCalledWith('box');
  });
  it('appear in SVG exports and survive a follow-up that keeps the fallback icon', async () => {
    const board: BoardDocument = {
      ...EMAIL_DEMO,
      version: 2,
      agent: 'claude',
      positions: Object.fromEntries(
        EMAIL_DEMO.nodes.map((node, i) => [node.id, { x: 0, y: i * 200 }]),
      ),
      nodes: EMAIL_DEMO.nodes.map((node) =>
        node.id === 'sender' ? { ...node, customIcon: seal } : node,
      ),
    };
    expect(boardSvg(board)).toContain('data-custom-icon="Wax seal"');
    const next = await layoutBoard(EMAIL_DEMO, 'claude', board);
    expect(next.nodes.find((node) => node.id === 'sender')!.customIcon).toEqual(seal);
    const swapped = {
      ...EMAIL_DEMO,
      nodes: EMAIL_DEMO.nodes.map((node) =>
        node.id === 'sender' ? { ...node, icon: 'users' as const } : node,
      ),
    };
    const replaced = await layoutBoard(swapped, 'claude', board);
    expect(replaced.nodes.find((node) => node.id === 'sender')!.customIcon).toBeUndefined();
  });
});
