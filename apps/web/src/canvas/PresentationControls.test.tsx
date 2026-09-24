// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PresentationControls } from './PresentationControls';
import type { PresentationStep } from './presentation';

const steps: PresentationStep[] = [
  {
    id: 'one',
    title: 'Input: Sunlight',
    description: '1 of 2: Sunlight',
    visibleNodeIds: ['sun'],
    visibleEdgeIds: [],
    focusNodeIds: ['sun'],
    emphasizedEdgeIds: [],
    selectedNodeId: 'sun',
  },
  {
    id: 'two',
    title: 'Plant',
    description: '2 of 2: Plant',
    visibleNodeIds: ['sun', 'plant'],
    visibleEdgeIds: ['sun-plant'],
    focusNodeIds: ['sun', 'plant'],
    emphasizedEdgeIds: ['sun-plant'],
    selectedNodeId: 'plant',
  },
];

afterEach(cleanup);

describe('PresentationControls', () => {
  it('offers a labelled entry control while editing', () => {
    const onEnter = vi.fn();
    render(
      <PresentationControls
        active={false}
        playing={false}
        stepIndex={0}
        steps={steps}
        onEnter={onEnter}
        onExit={vi.fn()}
        onPlayPause={vi.fn()}
        onReplay={vi.fn()}
        onStep={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Present' }));
    expect(onEnter).toHaveBeenCalledOnce();
  });

  it('exposes pause, replay, scrub and fit-step navigation to assistive technology', () => {
    const onStep = vi.fn();
    const onPlayPause = vi.fn();
    render(
      <PresentationControls
        active
        playing
        stepIndex={1}
        steps={steps}
        onEnter={vi.fn()}
        onExit={vi.fn()}
        onPlayPause={onPlayPause}
        onReplay={vi.fn()}
        onStep={onStep}
      />,
    );
    expect(screen.getByRole('group', { name: 'Presentation controls' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Pause presentation' }));
    expect(onPlayPause).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Next step' }).hasAttribute('disabled')).toBe(true);
    const scrubber = screen.getByRole('slider', { name: 'Presentation step' });
    expect(scrubber.getAttribute('aria-valuetext')).toBe('2 of 2: Plant');
    fireEvent.change(scrubber, { target: { value: '0' } });
    expect(onStep).toHaveBeenCalledWith(0);
  });
});
