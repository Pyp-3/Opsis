import { useEffect, useRef } from 'react';

/**
 * The landing backdrop: the Opsis eye drawn in monospace grid characters, with light pulses
 * that trace along the grid lines and around the eye's lids. The static field (grid + eye) is
 * painted once to an offscreen canvas and blitted each frame; only the tracers animate, so the
 * whole thing stays cheap. Honours prefers-reduced-motion by drawing a single still frame.
 *
 * Colours are read from the live theme (CSS custom properties) so it follows light/dark.
 */
export function HomeBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const CELL = 15; // px per character cell
    const FONT = `12px ${getComputedStyle(document.body).getPropertyValue('--font-mono') ||
      'ui-monospace, SFMono-Regular, Menlo, monospace'}`;

    // Theme colours, resolved to concrete values for canvas fillStyle.
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

    // The eye bounding box in grid cells, centred, recomputed on resize.
    let eye = { cx: 0, cy: 0, rx: 0, ry: 0 };

    /** Pick a line glyph from a slope angle (radians), using light box-drawing characters. */
    const slopeGlyph = (angle: number) => {
      const a = ((angle % Math.PI) + Math.PI) % Math.PI; // 0..π
      if (a < Math.PI / 8 || a > (7 * Math.PI) / 8) return '─';
      if (a < (3 * Math.PI) / 8) return '╱';
      if (a < (5 * Math.PI) / 8) return '│';
      return '╲';
    };

    type Cell = { ch: string; eye: boolean };
    let field: Cell[] = [];
    const at = (c: number, r: number) => field[r * cols + c];

    const buildField = () => {
      field = new Array(cols * rows);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          // Faint grid: a dot everywhere, a cross at every 4th intersection.
          const cross = c % 4 === 0 && r % 4 === 0;
          field[r * cols + c] = { ch: cross ? '+' : '·', eye: false };
        }
      }

      eye.cx = (cols - 1) / 2;
      eye.cy = (rows - 1) / 2;
      eye.rx = Math.min(cols * 0.32, 26);
      eye.ry = eye.rx * 0.46;
      const { cx, cy, rx, ry } = eye;

      const plot = (c: number, r: number, ch: string) => {
        const cc = Math.round(c);
        const rr = Math.round(r);
        if (cc < 0 || cc >= cols || rr < 0 || rr >= rows) return;
        field[rr * cols + cc] = { ch, eye: true };
      };

      // Two almond lids: upper and lower half-ellipses meeting at the corners (ports).
      const steps = Math.max(48, Math.floor(rx * 6));
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * Math.PI; // 0..π traces one lid from corner to corner
        const ux = Math.cos(t) * rx;
        const slopeU = Math.atan2(ry * Math.cos(t), rx * Math.sin(t));
        plot(cx + ux, cy - Math.sin(t) * ry, slopeGlyph(slopeU));
        plot(cx + ux, cy + Math.sin(t) * ry, slopeGlyph(-slopeU));
      }

      // Corner ports (the eye's connection points).
      plot(cx - rx, cy, 'o');
      plot(cx + rx, cy, 'o');

      // Pupil: a small ring with a node at the centre.
      const pr = Math.max(2, Math.round(ry * 0.5));
      const ringSteps = Math.max(16, pr * 8);
      for (let i = 0; i < ringSteps; i++) {
        const t = (i / ringSteps) * Math.PI * 2;
        plot(cx + Math.cos(t) * pr * 1.3, cy + Math.sin(t) * pr * 0.8, '◦');
      }
      plot(cx, cy, '●');

      // The little gaze arrow riding the upper lid, echoing the brand mark.
      plot(cx + rx * 0.62, cy - ry * 0.86, '▲');
    };

    const paintStatic = () => {
      octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      octx.clearRect(0, 0, width, height);
      octx.font = FONT;
      octx.textAlign = 'center';
      octx.textBaseline = 'middle';
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const cell = at(c, r);
          if (!cell) continue;
          const x = c * CELL + CELL / 2;
          const y = r * CELL + CELL / 2;
          if (cell.eye) {
            octx.fillStyle = withAlpha(accent, 0.5);
          } else {
            octx.fillStyle = withAlpha(ink, cell.ch === '+' ? 0.07 : 0.05);
          }
          octx.fillText(cell.ch, x, y);
        }
      }
    };

    // Tracers: bright pulses travelling along a grid row/column, or around the eye lids.
    type Tracer =
      | { kind: 'row' | 'col'; index: number; pos: number; speed: number; len: number }
      | { kind: 'lid'; lid: 1 | -1; pos: number; speed: number; len: number };
    let tracers: Tracer[] = [];

    const spawn = (): Tracer => {
      const roll = Math.random();
      if (roll < 0.35) {
        return { kind: 'lid', lid: Math.random() < 0.5 ? 1 : -1, pos: 0, speed: 0.006 + Math.random() * 0.006, len: 10 };
      }
      if (roll < 0.68) {
        return { kind: 'row', index: Math.floor(Math.random() * rows), pos: -8, speed: 0.4 + Math.random() * 0.5, len: 7 + Math.random() * 6 };
      }
      return { kind: 'col', index: Math.floor(Math.random() * cols), pos: -8, speed: 0.3 + Math.random() * 0.4, len: 7 + Math.random() * 6 };
    };

    const drawGlyph = (c: number, r: number, ch: string, alpha: number) => {
      const cc = Math.round(c);
      const rr = Math.round(r);
      if (cc < 0 || cc >= cols || rr < 0 || rr >= rows) return;
      ctx.fillStyle = withAlpha(accent, alpha);
      ctx.fillText(ch, cc * CELL + CELL / 2, rr * CELL + CELL / 2);
    };

    const stepTracer = (t: Tracer) => {
      ctx.font = FONT;
      if (t.kind === 'lid') {
        // Travel 0..1 along one lid, head bright, trailing fade.
        for (let k = 0; k < t.len; k++) {
          const p = t.pos - k * 0.03;
          if (p < 0 || p > 1) continue;
          const ang = p * Math.PI;
          const x = eye.cx + Math.cos(ang) * eye.rx;
          const y = eye.cy + t.lid * -Math.sin(ang) * eye.ry;
          const slope = Math.atan2(eye.ry * Math.cos(ang), eye.rx * Math.sin(ang));
          const glyph = slopeGlyph(t.lid > 0 ? slope : -slope);
          drawGlyph(x, y, glyph, (1 - k / t.len) * 0.85);
        }
        t.pos += t.speed;
        return t.pos <= 1.1;
      }
      for (let k = 0; k < t.len; k++) {
        const p = t.pos - k;
        const alpha = (1 - k / t.len) * 0.7;
        if (t.kind === 'row') {
          const cell = at(Math.round(p), t.index);
          drawGlyph(p, t.index, cell?.eye ? cell.ch : k === 0 ? '━' : '─', alpha);
        } else {
          const cell = at(t.index, Math.round(p));
          drawGlyph(t.index, p, cell?.eye ? cell.ch : k === 0 ? '┃' : '│', alpha);
        }
      }
      t.pos += t.speed;
      const limit = t.kind === 'row' ? cols : rows;
      return t.pos - t.len <= limit + 2;
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
      tracers = tracers.filter((t) => stepTracer(t));
      if (tracers.length < 7 && Math.random() < 0.08 * dt) tracers.push(spawn());
      raf = requestAnimationFrame(frame);
    };

    const resize = () => {
      // Measure the canvas's own rendered box: CSS makes it full-bleed, wider than the host.
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
      buildField();
      paintStatic();
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
