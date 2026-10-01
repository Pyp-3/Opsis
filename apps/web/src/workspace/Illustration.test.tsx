// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EMAIL_DEMO,
  EMAIL_DEMO_ILLUSTRATIONS,
  type BoardDocument,
  type Illustration,
} from '@opsis/schema';
import { IllustrationView } from './Illustration';
import { ProcessPlayer } from './ProcessPlayer';
import { layoutBoard, withoutIllustrations } from './model';
import { startActivity } from './agentActivity';

afterEach(cleanup);

const board: BoardDocument = {
  ...EMAIL_DEMO,
  version: 2,
  agent: 'demo',
  positions: Object.fromEntries(EMAIL_DEMO.nodes.map((node, i) => [node.id, { x: 0, y: i * 200 }])),
  nodes: EMAIL_DEMO.nodes.map((node) => ({
    ...node,
    illustration: EMAIL_DEMO_ILLUSTRATIONS[node.id],
  })),
};

describe('IllustrationView', () => {
  it('animates with SVG animation elements while current', () => {
    const { container } = render(
      <IllustrationView illustration={EMAIL_DEMO_ILLUSTRATIONS.app!} animate />,
    );
    expect(container.querySelector('animateTransform')).not.toBeNull();
    // The flap opens by morphing between paths.
    expect(container.querySelector('animate[attributeName="d"]')).not.toBeNull();
    // Strokes that draw themselves in use a unit path length.
    expect(container.querySelector('rect[pathLength="1"]')).not.toBeNull();
  });
  it('rests on each layer’s own picture when still', () => {
    const { container } = render(
      <IllustrationView illustration={EMAIL_DEMO_ILLUSTRATIONS.recipient!} animate={false} />,
    );
    expect(container.querySelectorAll('animate, animateTransform, animateMotion')).toHaveLength(0);
    expect(container.querySelector('[stroke-dasharray]')).toBeNull();
    expect(container.querySelectorAll('path, rect, circle')).toHaveLength(4);
  });
  it('holds a delayed motion’s first frame until it starts', () => {
    const drawing: Illustration = {
      layers: [
        {
          shape: 'circle',
          cx: 50,
          cy: 50,
          r: 10,
          stroke: 'none',
          fill: 'coral',
          motions: [
            {
              type: 'scale',
              duration: 0.5,
              delay: 1,
              repeat: 'once',
              values: [0, 1],
              origin: [50, 50],
            },
          ],
        },
      ],
    };
    const { container } = render(<IllustrationView illustration={drawing} animate />);
    const [hold, main] = container.querySelectorAll('animateTransform');
    expect(hold!.getAttribute('values')).toBe('0;0');
    expect(hold!.getAttribute('dur')).toBe('1s');
    expect(main!.getAttribute('begin')).toBe('1s');
  });
});

describe('illustrated boards', () => {
  it('are sent to agents without drawings, which survive a follow-up that keeps the icon', async () => {
    const stripped = withoutIllustrations(board);
    expect(stripped.nodes.some((node) => node.illustration)).toBe(false);
    const graph = {
      ...EMAIL_DEMO,
      nodes: EMAIL_DEMO.nodes.map((node) =>
        node.id === 'app' ? { ...node, icon: 'phone-device' as const } : node,
      ),
    };
    const next = await layoutBoard(graph, 'demo', board);
    expect(next.nodes.find((node) => node.id === 'sender')!.illustration).toEqual(
      EMAIL_DEMO_ILLUSTRATIONS.sender,
    );
    expect(next.nodes.find((node) => node.id === 'app')!.illustration).toBeUndefined();
  });
  it('offers to illustrate from the player, and to redraw once every object is drawn', () => {
    const onIllustrate = vi.fn();
    const control = {
      busy: false,
      elapsed: 0,
      message: '',
      available: true,
      redraw: true,
      activity: startActivity(),
      onIllustrate,
    };
    const { rerender } = render(
      <ProcessPlayer
        board={board}
        disabled={false}
        onBeat={() => undefined}
        onClose={() => undefined}
        illustration={control}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /redraw/i }));
    expect(onIllustrate).toHaveBeenCalledTimes(1);
    rerender(
      <ProcessPlayer
        board={board}
        disabled={false}
        onBeat={() => undefined}
        onClose={() => undefined}
        illustration={{ ...control, busy: true, elapsed: 7 }}
      />,
    );
    expect(
      (screen.getByRole('button', { name: /drawing… 7s/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
