// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ProcessResult } from '@opsis/engine';
import { ProcessDataView } from './ProcessDataView';

const result: ProcessResult = {
  status: 'ok',
  id: 'sample',
  input: 'a\n'.repeat(100),
  output: 'a\n'.repeat(100),
  inputRows: 100,
  outputRows: 100,
  origins: Array.from({ length: 100 }, (_, i) => [i]),
  inputs: [],
  drawing: {
    height: 1008,
    paths: Array.from({ length: 100 }, (_, i) => ({
      d: `M 6 ${9 + i * 10} L 48 ${9 + i * 10}`,
      kept: true,
    })),
  },
};
const pause = vi.fn();
const resume = vi.fn();
const reset = vi.fn();
let intersect: ((entries: { isIntersecting: boolean }[]) => void) | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(SVGSVGElement.prototype, {
    pauseAnimations: pause,
    unpauseAnimations: resume,
    setCurrentTime: reset,
  });
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: typeof intersect) {
        intersect = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('keeps every trace while bounding moving particles and synchronizing their start', () => {
  const { container, rerender } = render(<ProcessDataView result={result} command="cat" animate />);
  expect(container.querySelectorAll('path')).toHaveLength(100);
  const motions = [...container.querySelectorAll('animateMotion')];
  expect(motions).toHaveLength(12);
  expect(motions.every((motion) => motion.getAttribute('begin') === '0s')).toBe(true);
  expect(reset).toHaveBeenCalledWith(0);
  rerender(<ProcessDataView result={result} command="cat" />);
  expect(container.querySelectorAll('animateMotion')).toHaveLength(0);
  expect(pause).toHaveBeenCalled();
});

it('pauses offscreen and hidden playback and resumes when visible', () => {
  render(<ProcessDataView result={result} command="cat" animate />);
  intersect?.([{ isIntersecting: false }]);
  expect(pause).toHaveBeenCalled();
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  intersect?.([{ isIntersecting: true }]);
  resume.mockClear();
  document.dispatchEvent(new Event('visibilitychange'));
  expect(resume).not.toHaveBeenCalled();
  visibility.mockReturnValue('visible');
  document.dispatchEvent(new Event('visibilitychange'));
  expect(resume).toHaveBeenCalledOnce();
});

it('retains static traces without particles for readers who prefer reduced motion', () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const { container } = render(<ProcessDataView result={result} command="cat" animate />);
  expect(container.querySelectorAll('path')).toHaveLength(100);
  expect(container.querySelectorAll('animateMotion')).toHaveLength(0);
  expect(resume).not.toHaveBeenCalled();
});
