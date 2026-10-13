// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RefObject } from 'react';
import { bookMetrics, useBookMetrics } from './InfoSpread';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('open book page size', () => {
  it('lays two book-shaped pages side by side when there is room', () => {
    const laptop = bookMetrics(1016, 615)!;
    expect(laptop.pageW).toBeGreaterThanOrEqual(400);
    expect(laptop.pageH).toBeGreaterThan(laptop.pageW);
    expect(2 * laptop.pageW).toBeLessThanOrEqual(1016 - 64);
    // The text block is the page less its margins, head and folio.
    expect(laptop.textW).toBe(laptop.pageW - 2 * laptop.margin);
    expect(laptop.textH).toBe(laptop.pageH - laptop.top - laptop.bottom);

    // A large screen gets taller, book-proportioned pages, never wider than a comfortable page.
    const desktop = bookMetrics(2400, 1300)!;
    expect(desktop.pageH).toBe(1000);
    expect(desktop.pageW).toBeLessThanOrEqual(660);
    expect(desktop.pageW / desktop.pageH).toBeLessThan(0.8);
  });

  it('falls back to the single scrolling page when two pages would not fit', () => {
    expect(bookMetrics(390, 760)).toBeNull();
    expect(bookMetrics(860, 900)).toBeNull();
    expect(bookMetrics(1400, 400)).toBeNull();
  });

  it('remeasures after a newly shown tab finishes layout', () => {
    let width = 0;
    let height = 0;
    let nextFrame: FrameRequestCallback | undefined;
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      nextFrame = callback;
      return 1;
    });
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect = disconnect;
      },
    );
    const scroller = {
      current: {
        get clientWidth() {
          return width;
        },
        get clientHeight() {
          return height;
        },
      } as HTMLElement,
    } as RefObject<HTMLElement>;
    const bar = { current: { offsetHeight: 49 } as HTMLElement } as RefObject<HTMLElement>;

    const { result, unmount } = renderHook(() => useBookMetrics(scroller, bar));
    expect(result.current).toBeNull();
    width = 1016;
    height = 664;
    act(() => nextFrame!(performance.now()));
    expect(result.current).toEqual(bookMetrics(1016, 615));

    unmount();
    expect(frame).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledWith(1);
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
