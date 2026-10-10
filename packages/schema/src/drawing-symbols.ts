import {
  BoardDrawingSchema,
  translateDrawing,
  type BoardDrawing,
  type DrawingShape,
} from './board-drawings';
import {
  drawingsBox,
  mirrorDrawing,
  rotateDrawingAbout,
  scaleDrawingAbout,
} from './drawing-transform';
import type { IllustrationInk } from './illustration';

/**
 * Ready-made drawing symbols for plans, circuits, process diagrams and general sketches. A
 * symbol is placed as ordinary validated drawings that share a `groupId`, so it moves, turns and
 * is selected as one piece but stays editable part by part. Symbol parts are drawn in their own
 * coordinates (origin top-left, canvas units, one grid square is 24) at their natural size.
 */

type Part = Omit<BoardDrawing, 'id' | 'ink' | 'line' | 'strokeWidth'> &
  Partial<Pick<BoardDrawing, 'line' | 'strokeWidth'>>;

export type DrawingSymbol = {
  name: string;
  category: 'architecture' | 'electrical' | 'process' | 'general';
  description: string;
  width: number;
  height: number;
  parts: readonly Part[];
};

const line = (points: [number, number][], extra: Partial<Part> = {}): Part => ({
  shape: 'line',
  points,
  ...extra,
});
const path = (d: string, extra: Partial<Part> = {}): Part => ({ shape: 'path', d, ...extra });
const rect = (x: number, y: number, width: number, height: number, extra: Partial<Part> = {}) =>
  ({ shape: 'rect', x, y, width, height, ...extra }) as Part;
const ellipse = (cx: number, cy: number, rx: number, ry = rx, extra: Partial<Part> = {}) =>
  ({ shape: 'ellipse', x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2, ...extra }) as Part;
const polygon = (points: [number, number][], extra: Partial<Part> = {}): Part => ({
  shape: 'polygon',
  points,
  ...extra,
});
const arc = (points: [[number, number], [number, number], [number, number]]): Part => ({
  shape: 'arc',
  points,
});
const text = (x: number, y: number, words: string, fontSize = 12): Part => ({
  shape: 'text',
  x,
  y,
  text: words,
  fontSize,
  align: 'middle',
});
const r45 = 48 * Math.SQRT1_2;

export const DRAWING_SYMBOLS: readonly DrawingSymbol[] = [
  // Architecture, in plan view.
  {
    name: 'door',
    category: 'architecture',
    description: 'Hinged door in plan: leaf and swing; the opening runs along the bottom edge.',
    width: 48,
    height: 48,
    parts: [
      line(
        [
          [0, 48],
          [0, 0],
        ],
        { strokeWidth: 3 },
      ),
      arc([
        [48, 48],
        [r45, 48 - r45],
        [0, 0],
      ]),
    ],
  },
  {
    name: 'double-door',
    category: 'architecture',
    description: 'Pair of hinged doors in plan, opening along the bottom edge.',
    width: 96,
    height: 48,
    parts: [
      line(
        [
          [0, 48],
          [0, 0],
        ],
        { strokeWidth: 3 },
      ),
      arc([
        [48, 48],
        [r45, 48 - r45],
        [0, 0],
      ]),
      line(
        [
          [96, 48],
          [96, 0],
        ],
        { strokeWidth: 3 },
      ),
      arc([
        [48, 48],
        [96 - r45, 48 - r45],
        [96, 0],
      ]),
    ],
  },
  {
    name: 'sliding-door',
    category: 'architecture',
    description: 'Sliding door in plan: two overlapping panels in a wall opening.',
    width: 72,
    height: 12,
    parts: [rect(0, 0, 42, 5, { fill: true }), rect(30, 7, 42, 5, { fill: true })],
  },
  {
    name: 'window',
    category: 'architecture',
    description: 'Window in a wall, in plan: frame with the glazing line.',
    width: 48,
    height: 12,
    parts: [
      rect(0, 0, 48, 12),
      line(
        [
          [0, 6],
          [48, 6],
        ],
        { strokeWidth: 1 },
      ),
    ],
  },
  {
    name: 'stairs',
    category: 'architecture',
    description: 'Straight stair in plan with treads and an arrow pointing up the flight.',
    width: 48,
    height: 96,
    parts: [
      rect(0, 0, 48, 96),
      ...[12, 24, 36, 48, 60, 72, 84].map((y) =>
        line(
          [
            [0, y],
            [48, y],
          ],
          { strokeWidth: 1 },
        ),
      ),
      line(
        [
          [24, 90],
          [24, 8],
        ],
        { startMarker: 'dot', endMarker: 'arrow', strokeWidth: 1.5 },
      ),
    ],
  },
  {
    name: 'column',
    category: 'architecture',
    description: 'Structural column in plan, hatched.',
    width: 24,
    height: 24,
    parts: [rect(0, 0, 24, 24, { hatch: 'cross' })],
  },
  {
    name: 'toilet',
    category: 'architecture',
    description: 'WC in plan: cistern against the wall (top) and bowl.',
    width: 28,
    height: 40,
    parts: [rect(0, 0, 28, 9), ellipse(14, 24, 11, 15)],
  },
  {
    name: 'sink',
    category: 'architecture',
    description: 'Basin in plan, wall along the top.',
    width: 32,
    height: 24,
    parts: [rect(0, 0, 32, 24), ellipse(16, 13, 11, 8), ellipse(16, 5, 1.5)],
  },
  {
    name: 'bed',
    category: 'architecture',
    description: 'Double bed in plan, headboard along the top.',
    width: 64,
    height: 84,
    parts: [
      rect(0, 0, 64, 84),
      rect(6, 6, 24, 14),
      rect(34, 6, 24, 14),
      line([
        [0, 28],
        [64, 28],
      ]),
    ],
  },
  {
    name: 'table',
    category: 'architecture',
    description: 'Round table with four chairs, in plan.',
    width: 72,
    height: 72,
    parts: [
      ellipse(36, 36, 20),
      rect(28, 0, 16, 10),
      rect(28, 62, 16, 10),
      rect(0, 28, 10, 16),
      rect(62, 28, 10, 16),
    ],
  },
  {
    name: 'north-arrow',
    category: 'architecture',
    description: 'North point for plans and site maps.',
    width: 32,
    height: 52,
    parts: [
      polygon(
        [
          [16, 16],
          [26, 48],
          [16, 40],
          [6, 48],
        ],
        { fill: true },
      ),
      text(16, 0, 'N', 14),
    ],
  },
  {
    name: 'tree',
    category: 'architecture',
    description: 'Tree in plan (site plans and landscaping).',
    width: 48,
    height: 48,
    parts: [
      path('M24 2C36 2 46 10 46 22C46 36 36 46 24 46C10 46 2 36 2 24C2 12 12 2 24 2Z', {
        fill: true,
      }),
      line(
        [
          [18, 24],
          [30, 24],
        ],
        { strokeWidth: 1 },
      ),
      line(
        [
          [24, 18],
          [24, 30],
        ],
        { strokeWidth: 1 },
      ),
    ],
  },
  // Electrical schematics; connections leave at the middle of the left and right edges.
  {
    name: 'resistor',
    category: 'electrical',
    description: 'Resistor (zigzag); leads at the left and right middle.',
    width: 72,
    height: 24,
    parts: [path('M0 12H14L18 4L26 20L34 4L42 20L50 4L54 12H72')],
  },
  {
    name: 'capacitor',
    category: 'electrical',
    description: 'Capacitor (two plates); leads at the left and right middle.',
    width: 48,
    height: 32,
    parts: [
      line([
        [0, 16],
        [20, 16],
      ]),
      line(
        [
          [20, 2],
          [20, 30],
        ],
        { strokeWidth: 3 },
      ),
      line(
        [
          [28, 2],
          [28, 30],
        ],
        { strokeWidth: 3 },
      ),
      line([
        [28, 16],
        [48, 16],
      ]),
    ],
  },
  {
    name: 'inductor',
    category: 'electrical',
    description: 'Inductor (coil); leads at the left and right middle.',
    width: 72,
    height: 24,
    parts: [path('M0 16H12A6 6 0 0 1 24 16A6 6 0 0 1 36 16A6 6 0 0 1 48 16A6 6 0 0 1 60 16H72')],
  },
  {
    name: 'battery',
    category: 'electrical',
    description: 'Battery: long plate positive (left), short plate negative.',
    width: 48,
    height: 32,
    parts: [
      line([
        [0, 16],
        [20, 16],
      ]),
      line(
        [
          [20, 2],
          [20, 30],
        ],
        { strokeWidth: 2 },
      ),
      line(
        [
          [28, 9],
          [28, 23],
        ],
        { strokeWidth: 4 },
      ),
      line([
        [28, 16],
        [48, 16],
      ]),
      text(12, 0, '+', 10),
    ],
  },
  {
    name: 'voltage-source',
    category: 'electrical',
    description: 'Independent voltage source (circle with + and −); leads left and right.',
    width: 72,
    height: 40,
    parts: [
      line([
        [0, 20],
        [16, 20],
      ]),
      ellipse(36, 20, 20),
      line([
        [56, 20],
        [72, 20],
      ]),
      text(28, 12, '+', 12),
      text(45, 12, '−', 12),
    ],
  },
  {
    name: 'ground',
    category: 'electrical',
    description: 'Earth/ground; the lead enters at the top middle.',
    width: 32,
    height: 30,
    parts: [
      line([
        [16, 0],
        [16, 14],
      ]),
      line([
        [2, 14],
        [30, 14],
      ]),
      line([
        [7, 21],
        [25, 21],
      ]),
      line([
        [12, 28],
        [20, 28],
      ]),
    ],
  },
  {
    name: 'switch',
    category: 'electrical',
    description: 'Single-pole switch, shown open; leads left and right.',
    width: 64,
    height: 24,
    parts: [
      line(
        [
          [0, 18],
          [18, 18],
        ],
        { endMarker: 'dot' },
      ),
      line([
        [18, 18],
        [44, 4],
      ]),
      line(
        [
          [46, 18],
          [64, 18],
        ],
        { startMarker: 'dot' },
      ),
    ],
  },
  {
    name: 'lamp',
    category: 'electrical',
    description: 'Lamp or light (circle with a cross); leads left and right.',
    width: 72,
    height: 40,
    parts: [
      line([
        [0, 20],
        [16, 20],
      ]),
      ellipse(36, 20, 20),
      line([
        [22, 6],
        [50, 34],
      ]),
      line([
        [50, 6],
        [22, 34],
      ]),
      line([
        [56, 20],
        [72, 20],
      ]),
    ],
  },
  {
    name: 'diode',
    category: 'electrical',
    description: 'Diode: current flows left to right (anode left, cathode bar right).',
    width: 64,
    height: 32,
    parts: [
      line([
        [0, 16],
        [20, 16],
      ]),
      polygon(
        [
          [20, 2],
          [20, 30],
          [42, 16],
        ],
        { fill: true },
      ),
      line(
        [
          [42, 2],
          [42, 30],
        ],
        { strokeWidth: 3 },
      ),
      line([
        [42, 16],
        [64, 16],
      ]),
    ],
  },
  {
    name: 'motor',
    category: 'electrical',
    description: 'Motor (circle with M); leads left and right.',
    width: 72,
    height: 40,
    parts: [
      line([
        [0, 20],
        [16, 20],
      ]),
      ellipse(36, 20, 20),
      text(36, 11, 'M', 16),
      line([
        [56, 20],
        [72, 20],
      ]),
    ],
  },
  // Process and piping (P&ID); pipes join at the middle of the left and right edges.
  {
    name: 'valve',
    category: 'process',
    description: 'Gate valve (bow tie); pipe joins left and right.',
    width: 48,
    height: 24,
    parts: [
      polygon([
        [0, 0],
        [24, 12],
        [0, 24],
      ]),
      polygon([
        [48, 0],
        [24, 12],
        [48, 24],
      ]),
    ],
  },
  {
    name: 'check-valve',
    category: 'process',
    description: 'Non-return valve: flow passes left to right only.',
    width: 48,
    height: 24,
    parts: [
      polygon(
        [
          [0, 0],
          [24, 12],
          [0, 24],
        ],
        { fill: true },
      ),
      line(
        [
          [24, 0],
          [24, 24],
        ],
        { strokeWidth: 3 },
      ),
      line([
        [24, 12],
        [48, 12],
      ]),
    ],
  },
  {
    name: 'control-valve',
    category: 'process',
    description: 'Control valve with its actuator on top; pipe joins left and right.',
    width: 48,
    height: 44,
    parts: [
      polygon([
        [0, 20],
        [24, 32],
        [0, 44],
      ]),
      polygon([
        [48, 20],
        [24, 32],
        [48, 44],
      ]),
      line([
        [24, 32],
        [24, 10],
      ]),
      path('M10 10A14 10 0 0 1 38 10Z'),
    ],
  },
  {
    name: 'pump',
    category: 'process',
    description: 'Centrifugal pump: suction enters left middle, discharge leaves at the top right.',
    width: 56,
    height: 48,
    parts: [
      ellipse(24, 24, 22),
      line([
        [24, 2],
        [56, 2],
      ]),
      line([
        [0, 24],
        [2, 24],
      ]),
      polygon([
        [14, 12],
        [38, 24],
        [14, 36],
      ]),
    ],
  },
  {
    name: 'tank',
    category: 'process',
    description: 'Vertical vessel or tank with dished ends.',
    width: 48,
    height: 96,
    parts: [path('M0 16A24 14 0 0 1 48 16V80A24 14 0 0 1 0 80Z')],
  },
  {
    name: 'heat-exchanger',
    category: 'process',
    description: 'Heat exchanger: the coil passes through the shell left to right.',
    width: 56,
    height: 48,
    parts: [ellipse(28, 24, 22), path('M0 24H10L18 12L28 36L38 12L46 24H56')],
  },
  {
    name: 'instrument',
    category: 'process',
    description: 'Field instrument bubble; put its tag (such as "PT 101") in the label.',
    width: 40,
    height: 40,
    parts: [ellipse(20, 20, 19)],
  },
  {
    name: 'compressor',
    category: 'process',
    description: 'Compressor: wide inlet left, narrow outlet right.',
    width: 56,
    height: 48,
    parts: [
      ellipse(28, 24, 22),
      line([
        [10, 9],
        [46, 15],
      ]),
      line([
        [10, 39],
        [46, 33],
      ]),
    ],
  },
  // General diagrams.
  {
    name: 'person',
    category: 'general',
    description: 'A person or user.',
    width: 32,
    height: 52,
    parts: [ellipse(16, 9, 8), path('M2 52V34C2 24 8 20 16 20C24 20 30 24 30 34V52')],
  },
  {
    name: 'cloud',
    category: 'general',
    description: 'A cloud (internet, external service or weather).',
    width: 72,
    height: 44,
    parts: [
      path(
        'M18 42C8 42 2 36 2 29C2 22 8 17 15 17C17 8 25 2 34 2C44 2 51 9 52 17C61 17 70 22 70 30C70 37 64 42 56 42Z',
      ),
    ],
  },
  {
    name: 'database',
    category: 'general',
    description: 'A database (cylinder).',
    width: 44,
    height: 56,
    parts: [
      path('M0 8A22 8 0 0 1 44 8V48A22 8 0 0 1 0 48Z'),
      path('M0 8A22 8 0 0 0 44 8', { strokeWidth: 1.5 }),
      path('M0 21A22 8 0 0 0 44 21', { strokeWidth: 1 }),
    ],
  },
  {
    name: 'server',
    category: 'general',
    description: 'A server or computer rack.',
    width: 40,
    height: 56,
    parts: [
      rect(0, 0, 40, 56),
      line(
        [
          [0, 18],
          [40, 18],
        ],
        { strokeWidth: 1 },
      ),
      line(
        [
          [0, 36],
          [40, 36],
        ],
        { strokeWidth: 1 },
      ),
      ellipse(32, 9, 2, 2, { fill: true, fillOpacity: 1 }),
      ellipse(32, 27, 2, 2, { fill: true, fillOpacity: 1 }),
      ellipse(32, 45, 2, 2, { fill: true, fillOpacity: 1 }),
    ],
  },
  {
    name: 'document',
    category: 'general',
    description: 'A document or file with a folded corner.',
    width: 40,
    height: 52,
    parts: [
      path('M0 0H28L40 12V52H0Z'),
      path('M28 0V12H40', { strokeWidth: 1.5 }),
      ...[22, 30, 38].map((y) =>
        line(
          [
            [8, y],
            [32, y],
          ],
          { strokeWidth: 1 },
        ),
      ),
    ],
  },
];

export const DRAWING_SYMBOL_NAMES = DRAWING_SYMBOLS.map((symbol) => symbol.name) as [
  string,
  ...string[],
];

export type SymbolPlacement = {
  /** Where the symbol's centre goes, in canvas coordinates. */
  x: number;
  y: number;
  /** Width to draw it at; the height keeps the symbol's proportions. */
  width?: number;
  /** Degrees clockwise. */
  rotation?: number;
  mirror?: boolean;
  ink?: IllustrationInk;
  strokeWidth?: number;
  /** Words written under the symbol, as part of its group. */
  label?: string;
};

/**
 * A symbol as validated, absolute drawings sharing `groupId`. Parts are named `<idPrefix>-1`,
 * `-2` and so on; the label, when given, is the last part. Throws for an unknown symbol.
 */
export function placeSymbol(
  name: string,
  placement: SymbolPlacement,
  ids: { groupId: string; idPrefix: string },
): BoardDrawing[] {
  const symbol = DRAWING_SYMBOLS.find((item) => item.name === name);
  if (!symbol)
    throw new Error(`Unknown symbol "${name}". Known: ${DRAWING_SYMBOL_NAMES.join(', ')}.`);
  const factor = placement.width ? placement.width / symbol.width : 1;
  const weight = placement.strokeWidth ?? 2;
  const centre: [number, number] = [placement.x, placement.y];
  let drawings = symbol.parts.map((part, index): BoardDrawing => {
    let drawing: BoardDrawing = {
      ...part,
      id: `${ids.idPrefix}-${index + 1}`,
      ink: placement.ink ?? 'ink',
      line: part.line ?? 'solid',
      strokeWidth: Math.min(16, Math.max(0.5, (part.strokeWidth ?? 2) * (weight / 2))),
      groupId: ids.groupId,
    } as BoardDrawing;
    // Natural size centred on the origin, then scaled, mirrored, turned and moved into place.
    drawing = translateDrawing(drawing, -symbol.width / 2, -symbol.height / 2);
    if (factor !== 1) drawing = scaleDrawingAbout(drawing, factor, factor, [0, 0]);
    if (placement.mirror) drawing = mirrorDrawing(drawing, 'horizontal', [0, 0]);
    if (placement.rotation) drawing = rotateDrawingAbout(drawing, placement.rotation, [0, 0]);
    return translateDrawing(drawing, centre[0], centre[1]);
  });
  if (placement.label?.trim()) {
    const box = drawingsBox(drawings);
    drawings = [
      ...drawings,
      {
        id: `${ids.idPrefix}-${drawings.length + 1}`,
        shape: 'text' as DrawingShape,
        x: Math.round((box.x + box.width / 2) * 10) / 10,
        y: Math.round((box.y + box.height + 6) * 10) / 10,
        text: placement.label.trim().slice(0, 500),
        fontSize: 12,
        align: 'middle',
        ink: placement.ink ?? 'ink',
        line: 'solid',
        strokeWidth: 1,
        groupId: ids.groupId,
      },
    ];
  }
  return drawings.map((drawing) => BoardDrawingSchema.parse(drawing));
}
