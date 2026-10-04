import { useEffect, useRef } from 'react';

/**
 * The landing backdrop: a circuit of orthogonal traces with right-angle bends and junction nodes,
 * laid on a faint grid, with light pulses that flow along the traces and flare each node they reach.
 * It echoes what Opsis draws — concepts wired together — without depicting anything literal.
 *
 * The grid and traces are painted once to an offscreen canvas and blitted each frame; only the
 * pulses animate, so the whole thing stays cheap. Colours follow the live theme, and
 * prefers-reduced-motion gets a single still frame with no animation loop.
 */
export function HomeBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const CELL = 16; // px per character cell
    const PITCH = 7; // lattice spacing (in cells) between candidate nodes
    const FONT = `12px ${
      getComputedStyle(document.body).getPropertyValue('--font-mono') ||
      'ui-monospace, SFMono-Regular, Menlo, monospace'
    }`;

    const read = (name: string, fallback: string) =>
      getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;
    let ink = read('--ink', '#1f2d27');
    let accent = read('--accent-text', '#3d6a4b');

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let cols = 0;
    let rows = 0;
    let width = 0;
    let height = 0;
    const offscreen = document.createElement('canvas');
    const octx = offscreen.getContext('2d')!;

    // Direction bits for a trace cell: which neighbours it links to.
    const U = 1;
    const D = 2;
    const L = 4;
    const R = 8;
    const GLYPH: Record<number, string> = {
      [L | R]: '─',
      [U | D]: '│',
      [D | R]: '┌',
      [D | L]: '┐',
      [U | R]: '└',
      [U | L]: '┘',
      [U | D | R]: '├',
      [U | D | L]: '┤',
      [D | L | R]: '┬',
      [U | L | R]: '┴',
      [U | D | L | R]: '┼',
      [U]: '╵',
      [D]: '╷',
      [L]: '╴',
      [R]: '╶',
    };
    const glyphOf = (mask: number) => GLYPH[mask] ?? '·';

    type Pt = { x: number; y: number };
    let masks!: Int8Array; // connection bitmask per cell
    let nodes!: Uint8Array; // 1 where a junction node sits
    let paths: Pt[][] = []; // ordered cell routes, for pulses to follow
    const idx = (x: number, y: number) => y * cols + x;
    const inBounds = (x: number, y: number) => x >= 0 && x < cols && y >= 0 && y < rows;

    const addBits = (i: number, bits: number) => {
      masks[i] = (masks[i]! | bits) as number;
    };
    const link = (a: Pt, b: Pt) => {
      // Set the mutual direction bits between two orthogonally adjacent cells.
      if (!inBounds(a.x, a.y) || !inBounds(b.x, b.y)) return;
      const ia = idx(a.x, a.y);
      const ib = idx(b.x, b.y);
      if (b.x === a.x + 1) {
        addBits(ia, R);
        addBits(ib, L);
      } else if (b.x === a.x - 1) {
        addBits(ia, L);
        addBits(ib, R);
      } else if (b.y === a.y + 1) {
        addBits(ia, D);
        addBits(ib, U);
      } else if (b.y === a.y - 1) {
        addBits(ia, U);
        addBits(ib, D);
      }
    };

    /** Walk a straight run of cells from a to b (must share a row or column). */
    const run = (a: Pt, b: Pt): Pt[] => {
      const cells: Pt[] = [];
      const sx = Math.sign(b.x - a.x);
      const sy = Math.sign(b.y - a.y);
      let { x, y } = a;
      cells.push({ x, y });
      while (x !== b.x || y !== b.y) {
        x += sx;
        y += sy;
        cells.push({ x, y });
      }
      return cells;
    };

    /** An L-shaped route from a to b: along one axis, a right-angle bend, then the other. */
    const route = (a: Pt, b: Pt): Pt[] => {
      const corner: Pt = Math.random() < 0.5 ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
      const first = run(a, corner);
      const second = run(corner, b);
      const cells = first.concat(second.slice(1));
      for (let i = 0; i + 1 < cells.length; i++) link(cells[i]!, cells[i + 1]!);
      return cells;
    };

    const build = () => {
      masks = new Int8Array(cols * rows);
      nodes = new Uint8Array(cols * rows);
      paths = [];

      // Jittered lattice of candidate nodes, then wire some neighbours with L-routes.
      const gx = Math.max(2, Math.floor(cols / PITCH));
      const gy = Math.max(2, Math.floor(rows / PITCH));
      const anchor = (i: number, j: number): Pt => {
        const base = { x: Math.round(((i + 0.5) / gx) * cols), y: Math.round(((j + 0.5) / gy) * rows) };
        const jx = Math.round((Math.random() - 0.5) * (PITCH - 3));
        const jy = Math.round((Math.random() - 0.5) * (PITCH - 3));
        return {
          x: Math.min(cols - 1, Math.max(0, base.x + jx)),
          y: Math.min(rows - 1, Math.max(0, base.y + jy)),
        };
      };
      const grid: Pt[][] = [];
      for (let i = 0; i < gx; i++) {
        grid[i] = [];
        for (let j = 0; j < gy; j++) grid[i]![j] = anchor(i, j);
      }

      const connect = (a: Pt, b: Pt) => {
        const cells = route(a, b);
        if (cells.length > 1) {
          paths.push(cells);
          nodes[idx(a.x, a.y)] = 1;
          nodes[idx(b.x, b.y)] = 1;
        }
      };
      for (let i = 0; i < gx; i++) {
        for (let j = 0; j < gy; j++) {
          const a = grid[i]![j]!;
          if (i + 1 < gx && Math.random() < 0.72) connect(a, grid[i + 1]![j]!);
          if (j + 1 < gy && Math.random() < 0.52) connect(a, grid[i]![j + 1]!);
        }
      }
    };

    const paintStatic = () => {
      octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      octx.clearRect(0, 0, width, height);
      octx.font = FONT;
      octx.textAlign = 'center';
      octx.textBaseline = 'middle';

      // Faint grid field.
      octx.fillStyle = withAlpha(ink, 0.05);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          if (masks[idx(x, y)]) continue;
          octx.fillText(x % 4 === 0 && y % 4 === 0 ? '+' : '·', x * CELL + CELL / 2, y * CELL + CELL / 2);
        }
      }
      // Traces and nodes.
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const m = masks[idx(x, y)];
          if (!m) continue;
          const px = x * CELL + CELL / 2;
          const py = y * CELL + CELL / 2;
          if (nodes[idx(x, y)]) {
            octx.fillStyle = withAlpha(accent, 0.42);
            octx.fillText('◆', px, py);
          } else {
            octx.fillStyle = withAlpha(accent, 0.22);
            octx.fillText(glyphOf(m), px, py);
          }
        }
      }
    };

    // Pulses flow along a trace route, bright head with a fading trail.
    type Pulse = { path: Pt[]; pos: number; speed: number; len: number };
    let pulses: Pulse[] = [];
    const spawn = (): Pulse | null => {
      if (paths.length === 0) return null;
      const path = paths[Math.floor(Math.random() * paths.length)]!;
      return { path, pos: 0, speed: 0.18 + Math.random() * 0.22, len: 6 };
    };

    const drawPulse = (p: Pulse) => {
      ctx.font = FONT;
      const head = Math.floor(p.pos);
      for (let k = 0; k < p.len; k++) {
        const i = head - k;
        if (i < 0 || i >= p.path.length) continue;
        const cell = p.path[i]!;
        const alpha = (1 - k / p.len) * 0.9;
        const x = cell.x * CELL + CELL / 2;
        const y = cell.y * CELL + CELL / 2;
        if (nodes[idx(cell.x, cell.y)]) {
          ctx.fillStyle = withAlpha(accent, Math.min(1, alpha + 0.1));
          ctx.fillText('◆', x, y);
        } else {
          ctx.fillStyle = withAlpha(accent, alpha);
          ctx.fillText(glyphOf(masks[idx(cell.x, cell.y)]!), x, y);
        }
      }
      p.pos += p.speed;
      return p.pos - p.len < p.path.length;
    };

    let raf = 0;
    let last = 0;
    const frame = (now: number) => {
      const dt = Math.min(now - last, 50) / 16.7;
      last = now;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(offscreen, 0, 0, width, height);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      pulses = pulses.filter((p) => drawPulse(p));
      if (pulses.length < 9 && Math.random() < 0.09 * dt) {
        const p = spawn();
        if (p) pulses.push(p);
      }
      raf = requestAnimationFrame(frame);
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.round(rect.width);
      height = Math.round(rect.height);
      if (width === 0 || height === 0) return;
      cols = Math.ceil(width / CELL);
      rows = Math.ceil(height / CELL);
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      offscreen.width = width * dpr;
      offscreen.height = height * dpr;
      ink = read('--ink', '#1f2d27');
      accent = read('--accent-text', '#3d6a4b');
      build();
      paintStatic();
      pulses = [];
      if (reduced) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(offscreen, 0, 0, width, height);
      }
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    if (!reduced) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="home-backdrop" aria-hidden="true" />;
}

/** Turn a hex / rgb colour string into an rgba() with the given alpha. */
function withAlpha(color: string, alpha: number): string {
  const c = color.trim();
  if (c.startsWith('#')) {
    const hex = c.slice(1);
    const full = hex.length === 3 ? hex.split('').map((h) => h + h).join('') : hex;
    const n = parseInt(full, 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (c.startsWith('rgb')) {
    const nums = c.replace(/rgba?\(|\)/g, '').split(',').slice(0, 3).map((v) => v.trim());
    return `rgba(${nums.join(', ')}, ${alpha})`;
  }
  return c;
}
