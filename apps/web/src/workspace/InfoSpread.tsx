import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode, RefObject, UIEvent } from 'react';

/**
 * The Info book as an open book: two facing pages either side of a spine, sized like a real
 * book's pages. The open board page's text flows from one page to the next as CSS columns of
 * page width and height, and the reader turns through them a spread at a time.
 *
 * Only the reading view is laid out this way; writing uses the single scrolling page, where
 * forms have room. Narrow windows (phones, a docked panel) also read on one scrolling page.
 */
export type BookMetrics = {
  /** One page, paper included. */
  pageW: number;
  pageH: number;
  /** The page's side margins; the space for its running head (top) and folio (bottom). */
  margin: number;
  top: number;
  bottom: number;
  /** The text block on one page. */
  textW: number;
  textH: number;
};

const DESK_X = 32;
const DESK_Y = 24;

/** The page size for a desk of this size, or null when two facing pages would not fit. */
export function bookMetrics(width: number, height: number): BookMetrics | null {
  const availW = width - 2 * DESK_X;
  const availH = height - 2 * DESK_Y;
  if (availW < 820 || availH < 420) return null;
  const pageH = Math.floor(Math.min(availH, 1000));
  // Book proportions where there is room; never narrower than a comfortable reading measure.
  const pageW = Math.floor(Math.min(availW / 2, Math.max(pageH * 0.76, 400), 660));
  const margin = Math.round(Math.max(28, Math.min(60, pageW * 0.1)));
  const top = 58;
  const bottom = 50;
  return {
    pageW,
    pageH,
    margin,
    top,
    bottom,
    textW: pageW - 2 * margin,
    textH: pageH - top - bottom,
  };
}

/** Measures the book's desk (the scroller less its toolbar) and gives the page size for it. */
export function useBookMetrics(
  scroller: RefObject<HTMLElement | null>,
  bar: RefObject<HTMLElement | null>,
) {
  const [metrics, setMetrics] = useState<BookMetrics | null>(null);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () => {
      const next = bookMetrics(
        element.clientWidth,
        element.clientHeight - (bar.current?.offsetHeight ?? 0),
      );
      setMetrics((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
    };
    measure();
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [scroller, bar]);
  return metrics;
}

const vars = (metrics: BookMetrics): CSSProperties =>
  ({
    '--page-w': `${metrics.pageW}px`,
    '--page-h': `${metrics.pageH}px`,
    '--margin': `${metrics.margin}px`,
    '--top': `${metrics.top}px`,
    '--bottom': `${metrics.bottom}px`,
    '--text-w': `${metrics.textW}px`,
    '--text-h': `${metrics.textH}px`,
  }) as CSSProperties;

/** The flowing text's own layout: exactly two page-wide columns per spread. */
const flowStyle = (metrics: BookMetrics): CSSProperties => ({
  width: 2 * metrics.pageW - 2 * metrics.margin,
  height: metrics.textH,
  columnWidth: metrics.textW,
  columnGap: 2 * metrics.margin,
  columnFill: 'auto',
});

/** How far one column is from the next. */
const step = (metrics: BookMetrics) => metrics.textW + 2 * metrics.margin;

/**
 * One page of a spread, as a copy laid out exactly like the live text, showing one column of
 * it. The turning leaf and the page it lands on are made of these. A copy is inert: it can be
 * neither focused nor read aloud, since the live text is the book.
 */
export function BookFace({
  metrics,
  side,
  head,
  folio,
  column,
  children,
}: {
  metrics: BookMetrics;
  side: 'left' | 'right';
  head: string;
  folio: number | null;
  column: number;
  children: ReactNode;
}) {
  return (
    <div
      className={`book-face-page is-${side}`}
      ref={(element) => {
        if (element) element.inert = true;
      }}
    >
      <span className="book-head">{head}</span>
      <div className="book-face-text">
        <div
          className="info-leaf book-flow book-flow-copy"
          style={{
            ...flowStyle(metrics),
            transform: `translateX(${-column * step(metrics)}px)`,
          }}
        >
          {children}
        </div>
      </div>
      {folio !== null && <span className="book-folio">{folio}</span>}
    </div>
  );
}

export type SpreadTurn = {
  key: number;
  direction: 'next' | 'previous';
  /** The page lifting away (front) and what is on its back, which lands on the other side. */
  front: ReactNode;
  back: ReactNode;
  /** The page it lands on, shown until it is covered. */
  under: ReactNode;
};

/**
 * Two facing pages of the open board page's text. `spread` is which pair of pages is open;
 * moving focus or a link to text on another spread turns to it.
 */
export function BookSpread({
  metrics,
  label,
  spread,
  onSpread,
  onColumns,
  heads,
  corners,
  turn,
  onTurned,
  children,
}: {
  metrics: BookMetrics;
  label: string;
  spread: number;
  onSpread: (spread: number) => void;
  /** Reports how many pages (columns) the text fills. */
  onColumns: (columns: number) => void;
  heads: { left: string; right: string };
  corners: ReactNode;
  turn: SpreadTurn | null;
  onTurned: () => void;
  children: ReactNode;
}) {
  const clip = useRef<HTMLDivElement>(null);
  const flow = useRef<HTMLElement>(null);
  const [columns, setColumns] = useState(1);
  const [tick, setTick] = useState(0);
  const intent = useRef<number | null>(null);
  // While a pointer is pressed, turning would move the text under it and lose the click; the
  // turn waits until it is released.
  const pressing = useRef(false);
  const pending = useRef<number | null>(null);
  const spreadWidth = 2 * metrics.pageW;

  // Pictures and web fonts change how far the text runs, so count again when they arrive.
  useEffect(() => {
    let live = true;
    void document.fonts?.ready.then(() => live && setTick((value) => value + 1));
    return () => {
      live = false;
    };
  }, []);
  useLayoutEffect(() => {
    const element = flow.current;
    if (!element) return;
    const count = Math.max(
      1,
      Math.round((element.scrollWidth + 2 * metrics.margin) / metrics.pageW),
    );
    if (count !== columns) setColumns(count);
    onColumns(count);
    // The text, the page size and arriving pictures (tick) are what change its length.
  }, [children, metrics, columns, onColumns, tick]);
  // Keep the open spread in view; the text block never scrolls by itself.
  useLayoutEffect(() => {
    if (clip.current) clip.current.scrollLeft = spread * spreadWidth;
  }, [spread, spreadWidth, tick]);

  const last = Math.max(0, Math.ceil(columns / 2) - 1);
  const open = (target: number) => {
    if (clip.current) clip.current.scrollLeft = target * spreadWidth;
    if (target !== spread) onSpread(target);
  };
  const press = () => {
    pressing.current = true;
    window.addEventListener(
      'pointerup',
      () => {
        pressing.current = false;
        // After the click has reached what was pressed.
        window.setTimeout(() => {
          const target = pending.current;
          pending.current = null;
          if (target !== null) open(target);
        });
      },
      { once: true, capture: true },
    );
  };
  const settle = (event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    const expected = spread * spreadWidth;
    if (Math.abs(element.scrollLeft - expected) < 1) return;
    // Focus or "scroll into view" moved the text: open the spread that holds what it showed.
    const target = Math.min(
      last,
      Math.max(
        0,
        intent.current ?? Math.floor((element.scrollLeft + element.clientWidth / 2) / spreadWidth),
      ),
    );
    intent.current = null;
    if (pressing.current) {
      pending.current = target;
      return;
    }
    open(target);
  };
  const follow = (target: EventTarget) => {
    const element = clip.current;
    if (!element || !(target instanceof HTMLElement)) return;
    // Focus on the whole text (the book itself) keeps the open spread, even though the browser
    // scrolls the text's start into view.
    if (target === flow.current) {
      intent.current = spread;
      requestAnimationFrame(() => {
        intent.current = null;
      });
      return;
    }
    const x =
      target.getBoundingClientRect().left -
      element.getBoundingClientRect().left +
      element.scrollLeft;
    const wanted = Math.min(last, Math.max(0, Math.floor(Math.floor(x / step(metrics)) / 2)));
    intent.current = wanted;
    requestAnimationFrame(() => {
      intent.current = null;
    });
    if (pressing.current) pending.current = wanted;
    else if (wanted !== spread) onSpread(wanted);
  };

  // The leaf is cleared when its turn ends, or after it should have, if no end is reported.
  const turnKey = turn?.key;
  useEffect(() => {
    if (turnKey === undefined) return;
    const timer = window.setTimeout(onTurned, 1200);
    return () => window.clearTimeout(timer);
  }, [turnKey, onTurned]);

  const leftFolio = 2 * spread + 1;
  const rightFolio = 2 * spread + 2 <= columns ? 2 * spread + 2 : null;
  return (
    <div className="book-spread" style={vars(metrics)}>
      <div className="book-paper is-left" aria-hidden />
      <div className="book-paper is-right" aria-hidden />
      <span className="book-head is-left" aria-hidden>
        {heads.left}
      </span>
      <span className="book-head is-right" aria-hidden>
        {heads.right}
      </span>
      <div
        className="book-text"
        ref={clip}
        onScroll={settle}
        onPointerDownCapture={press}
        onFocusCapture={(event) => follow(event.target)}
        onLoadCapture={() => setTick((value) => value + 1)}
      >
        <article
          className="info-leaf book-flow"
          aria-label={label}
          tabIndex={-1}
          ref={flow}
          style={flowStyle(metrics)}
        >
          {children}
        </article>
        {/* Makes the last spread scrollable to exactly its place, even when its right page is
            short or empty. */}
        <div
          className="book-text-extent"
          aria-hidden
          style={{ width: last * spreadWidth + 2 * metrics.pageW - 2 * metrics.margin }}
        />
      </div>
      <span className="book-folio is-left" aria-hidden>
        {leftFolio}
      </span>
      {rightFolio !== null && (
        <span className="book-folio is-right" aria-hidden>
          {rightFolio}
        </span>
      )}
      <span className="sr-only" aria-live="polite">
        {`Pages ${leftFolio}${rightFolio ? `–${rightFolio}` : ''} of ${columns}`}
      </span>
      {corners}
      {turn && (
        <>
          <div
            key={`under-${turn.key}`}
            className={`book-under is-${turn.direction === 'next' ? 'left' : 'right'}`}
            aria-hidden
          >
            {turn.under}
          </div>
          <div
            key={`turn-${turn.key}`}
            className={`book-turn is-${turn.direction}`}
            aria-hidden
            onAnimationEnd={(event) => {
              // The faces turn separately; the turn is over when the back has landed.
              if (event.animationName.startsWith('book-leaf-back')) onTurned();
            }}
          >
            <div className="book-turn-face is-front">{turn.front}</div>
            <div className="book-turn-face is-back">{turn.back}</div>
          </div>
        </>
      )}
    </div>
  );
}
