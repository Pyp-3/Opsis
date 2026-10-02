import { useSyncExternalStore } from 'react';

/**
 * Canvas palettes. All are dark so the pastel connection and illustration colours stay legible;
 * each sets the `--bp-*` tokens the canvas, player and exports draw with.
 */
export type CanvasPalette = {
  id: string;
  name: string;
  /** Radial gradient stops, centre to edge. */
  background: [string, string, string];
  /** Solid surface behind labels and edge halos; also the export background. */
  deep: string;
  /** `r g b` of the darkest tone, for translucent overlays and shadows. */
  shade: string;
  panel: string;
  panelHover: string;
  line: string;
  ink: string;
  ink2: string;
  muted: string;
  grid: string;
  gridMajor: string;
  handle: string;
  handleRing: string;
};

export const CANVAS_PALETTES = [
  {
    id: 'blueprint',
    name: 'Blueprint',
    background: ['#224f7e', '#173e69', '#113258'],
    deep: '#153b65',
    shade: '8 26 48',
    panel: 'rgb(14 42 73 / 0.78)',
    panelHover: 'rgb(58 92 128 / 0.7)',
    line: 'rgb(168 198 229 / 0.28)',
    ink: '#e8eff8',
    ink2: '#b3c8e0',
    muted: '#94aecc',
    grid: 'rgb(189 215 246 / 0.13)',
    gridMajor: 'rgb(189 215 246 / 0.18)',
    handle: '#224d78',
    handleRing: '#a8c6e5',
  },
  {
    id: 'midnight',
    name: 'Midnight',
    background: ['#1c2436', '#131a28', '#0b0f19'],
    deep: '#141b2a',
    shade: '9 12 21',
    panel: 'rgb(24 30 45 / 0.8)',
    panelHover: 'rgb(62 72 95 / 0.7)',
    line: 'rgb(170 182 210 / 0.24)',
    ink: '#eceff6',
    ink2: '#b8bfd2',
    muted: '#9199b0',
    grid: 'rgb(190 200 230 / 0.08)',
    gridMajor: 'rgb(190 200 230 / 0.13)',
    handle: '#1e273a',
    handleRing: '#aab6d2',
  },
  {
    id: 'graphite',
    name: 'Graphite',
    background: ['#3b3e43', '#2e3135', '#222427'],
    deep: '#2b2e32',
    shade: '22 24 27',
    panel: 'rgb(46 49 54 / 0.82)',
    panelHover: 'rgb(90 94 101 / 0.7)',
    line: 'rgb(210 214 220 / 0.22)',
    ink: '#f0f1f3',
    ink2: '#c5c9cf',
    muted: '#a2a7af',
    grid: 'rgb(225 228 232 / 0.08)',
    gridMajor: 'rgb(225 228 232 / 0.13)',
    handle: '#363a3f',
    handleRing: '#c5c9cf',
  },
  {
    id: 'forest',
    name: 'Forest',
    background: ['#21503f', '#183f32', '#102d24'],
    deep: '#173a2e',
    shade: '8 28 22',
    panel: 'rgb(17 50 40 / 0.8)',
    panelHover: 'rgb(60 104 87 / 0.7)',
    line: 'rgb(170 214 196 / 0.26)',
    ink: '#eaf5ef',
    ink2: '#b8d5c7',
    muted: '#95b8a8',
    grid: 'rgb(190 232 214 / 0.1)',
    gridMajor: 'rgb(190 232 214 / 0.16)',
    handle: '#1e4b3d',
    handleRing: '#abd4c3',
  },
  {
    id: 'ocean',
    name: 'Ocean',
    background: ['#19535e', '#12414a', '#0b3038'],
    deep: '#113c45',
    shade: '5 30 36',
    panel: 'rgb(14 54 62 / 0.8)',
    panelHover: 'rgb(54 105 115 / 0.7)',
    line: 'rgb(166 214 222 / 0.26)',
    ink: '#e8f6f8',
    ink2: '#b2d8de',
    muted: '#91bac1',
    grid: 'rgb(186 232 240 / 0.1)',
    gridMajor: 'rgb(186 232 240 / 0.16)',
    handle: '#17515b',
    handleRing: '#a8d6de',
  },
  {
    id: 'plum',
    name: 'Plum',
    background: ['#48325f', '#37264c', '#28193a'],
    deep: '#34234a',
    shade: '27 16 40',
    panel: 'rgb(50 34 70 / 0.8)',
    panelHover: 'rgb(98 76 126 / 0.7)',
    line: 'rgb(212 190 236 / 0.26)',
    ink: '#f4eefa',
    ink2: '#d2c3e3',
    muted: '#b29fcd',
    grid: 'rgb(222 204 246 / 0.1)',
    gridMajor: 'rgb(222 204 246 / 0.16)',
    handle: '#412a5b',
    handleRing: '#cfbae7',
  },
  {
    id: 'ember',
    name: 'Ember',
    background: ['#55322b', '#43251f', '#311a16'],
    deep: '#3f241e',
    shade: '33 17 14',
    panel: 'rgb(64 38 32 / 0.8)',
    panelHover: 'rgb(114 78 68 / 0.7)',
    line: 'rgb(236 200 188 / 0.24)',
    ink: '#faf0ec',
    ink2: '#e2c9bf',
    muted: '#c2a398',
    grid: 'rgb(246 214 202 / 0.09)',
    gridMajor: 'rgb(246 214 202 / 0.15)',
    handle: '#4b2b25',
    handleRing: '#e0c4b9',
  },
] as const satisfies readonly CanvasPalette[];

/** Icon tints, all light enough to read on every palette. */
export const ICON_COLORS = [
  { id: 'gold', name: 'Gold', color: '#f4dcaa' },
  { id: 'ivory', name: 'Ivory', color: '#f5f2ea' },
  { id: 'sky', name: 'Sky', color: '#9fd8f5' },
  { id: 'mint', name: 'Mint', color: '#9fe6c0' },
  { id: 'amber', name: 'Amber', color: '#f2cc79' },
  { id: 'coral', name: 'Coral', color: '#ffb59a' },
  { id: 'rose', name: 'Rose', color: '#f8b0cf' },
  { id: 'lilac', name: 'Lilac', color: '#d9bdf8' },
] as const;

export type CanvasLook = {
  canvas: (typeof CANVAS_PALETTES)[number]['id'];
  icon: (typeof ICON_COLORS)[number]['id'];
};
export const DEFAULT_LOOK: CanvasLook = { canvas: 'blueprint', icon: 'gold' };

const KEY = 'opsis:canvas-look:v1';

export const paletteOf = (look: CanvasLook): CanvasPalette =>
  CANVAS_PALETTES.find((palette) => palette.id === look.canvas) ?? CANVAS_PALETTES[0];
export const iconColorOf = (look: CanvasLook): string =>
  (ICON_COLORS.find((icon) => icon.id === look.icon) ?? ICON_COLORS[0]).color;

function read(): CanvasLook {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<CanvasLook> | null;
    return {
      canvas: CANVAS_PALETTES.some((palette) => palette.id === stored?.canvas)
        ? stored!.canvas!
        : DEFAULT_LOOK.canvas,
      icon: ICON_COLORS.some((icon) => icon.id === stored?.icon)
        ? stored!.icon!
        : DEFAULT_LOOK.icon,
    };
  } catch {
    return DEFAULT_LOOK;
  }
}

/** The CSS custom properties a look sets. */
export function lookVariables(look: CanvasLook): Record<string, string> {
  const palette = paletteOf(look);
  return {
    '--bp-bg-1': palette.background[0],
    '--bp-bg-2': palette.background[1],
    '--bp-bg-3': palette.background[2],
    '--bp-deep': palette.deep,
    '--bp-shade': palette.shade,
    '--bp-panel': palette.panel,
    '--bp-panel-hover': palette.panelHover,
    '--bp-line': palette.line,
    '--bp-ink': palette.ink,
    '--bp-ink-2': palette.ink2,
    '--bp-muted': palette.muted,
    '--bp-grid': palette.grid,
    '--bp-grid-major': palette.gridMajor,
    '--bp-handle': palette.handle,
    '--bp-handle-ring': palette.handleRing,
    '--bp-icon': iconColorOf(look),
  };
}

let current: CanvasLook | null = null;
const listeners = new Set<() => void>();

function apply(look: CanvasLook) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const [name, value] of Object.entries(lookVariables(look)))
    root.style.setProperty(name, value);
}

/** The viewer's chosen look. A per-browser preference: it never changes the saved board. */
export function canvasLook(): CanvasLook {
  if (!current) {
    current = read();
    apply(current);
  }
  return current;
}

export function setCanvasLook(next: CanvasLook) {
  current = next;
  apply(next);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Remembering the look is a convenience; it still applies for this visit.
  }
  listeners.forEach((listener) => listener());
}

export function useCanvasLook(): CanvasLook {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    canvasLook,
    () => DEFAULT_LOOK,
  );
}
