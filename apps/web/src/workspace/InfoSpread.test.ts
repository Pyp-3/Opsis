import { describe, expect, it } from 'vitest';
import { bookMetrics } from './InfoSpread';

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
});
