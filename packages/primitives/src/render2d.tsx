import type { ReactNode } from 'react';
import { COMPASS_POINTS } from './anchors';
import type { PrimitiveProps } from './types';

/** Shared 100×100 SVG frame with rounded strokes and an accessible title. */
function Svg({ label, children }: { label: string | undefined; children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 100 100"
      width="100%"
      height="100%"
      role="img"
      aria-label={label}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {label ? <title>{label}</title> : null}
      {children}
    </svg>
  );
}

/** Compass rose; highlighted bearings are drawn longer in the highlight colour. */
export function Compass2D({ color, tone, label, highlightAnchors = [] }: PrimitiveProps) {
  const mark = tone('direction.mark');
  const cardinalLabels = [
    ['N', 50, 12],
    ['E', 88, 54],
    ['S', 50, 94],
    ['W', 12, 54],
  ] as const;
  return (
    <Svg label={label}>
      <circle cx="50" cy="50" r="44" fill={color} stroke={mark} strokeWidth="3" />
      {COMPASS_POINTS.map((point, i) => {
        const on = highlightAnchors.includes(point);
        const r = on ? 42 : i % 2 === 0 ? 36 : 24;
        const a = (i * Math.PI) / 4;
        return (
          <line
            key={point}
            x1="50"
            y1="50"
            x2={50 + Math.sin(a) * r}
            y2={50 - Math.cos(a) * r}
            stroke={on ? tone('ui.highlight') : point === 'N' ? tone('direction.north') : mark}
            strokeWidth={on ? 7 : i % 2 === 0 ? 5 : 3}
          />
        );
      })}
      {cardinalLabels.map(([point, x, y]) => {
        const on = highlightAnchors.includes(point);
        return (
          <text
            key={point}
            x={x}
            y={y}
            textAnchor="middle"
            fontSize={on ? 13 : 10}
            fontWeight={on ? 800 : 650}
            fill={on ? tone('ui.highlight') : mark}
            stroke={color}
            strokeWidth="3"
            paintOrder="stroke"
          >
            {point}
          </text>
        );
      })}
    </Svg>
  );
}

/** Straight arrow pointing right. */
export function Arrow2D({ color, label }: PrimitiveProps) {
  return (
    <Svg label={label}>
      <path d="M10 50 H85 M68 32 L88 50 L68 68" fill="none" stroke={color} strokeWidth="8" />
    </Svg>
  );
}

/** Rising quarter-arc arrow. */
export function CurvedArrow2D({ color, label }: PrimitiveProps) {
  return (
    <Svg label={label}>
      <path
        d="M15 85 A65 65 0 0 1 80 20 M66 8 L82 20 L66 32"
        fill="none"
        stroke={color}
        strokeWidth="8"
      />
    </Svg>
  );
}

/** Horizon line over ground. */
export function Horizon2D({ color, tone, label }: PrimitiveProps) {
  return (
    <Svg label={label}>
      <rect x="0" y="55" width="100" height="45" fill={color} />
      <line x1="0" y1="55" x2="100" y2="55" stroke={tone('nature.leaf')} strokeWidth="6" />
    </Svg>
  );
}

/** Sun disc with rays. */
export function Sun2D({ color, label }: PrimitiveProps) {
  return (
    <Svg label={label}>
      <circle cx="50" cy="50" r="22" fill={color} />
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
        const a = (i * Math.PI) / 4;
        return (
          <line
            key={i}
            x1={50 + Math.cos(a) * 32}
            y1={50 + Math.sin(a) * 32}
            x2={50 + Math.cos(a) * 44}
            y2={50 + Math.sin(a) * 44}
            stroke={color}
            strokeWidth="6"
          />
        );
      })}
    </Svg>
  );
}

/** Full moon with craters. */
export function Moon2D({ color, tone, label }: PrimitiveProps) {
  return (
    <Svg label={label}>
      <circle cx="50" cy="50" r="40" fill={color} />
      <circle cx="62" cy="38" r="7" fill={tone('nature.rock')} />
      <circle cx="40" cy="62" r="9" fill={tone('nature.rock')} />
    </Svg>
  );
}

/** Earth: ocean disc with land blobs. */
export function Earth2D({ color, tone, label }: PrimitiveProps) {
  return (
    <Svg label={label}>
      <circle cx="50" cy="50" r="40" fill={color} />
      <path
        d="M30 30 q15 -8 22 6 q-6 14 -20 8 z M55 58 q14 -4 18 10 q-10 12 -22 2 z"
        fill={tone('nature.leaf')}
      />
    </Svg>
  );
}

/** Cloud of three lobes. */
export function Cloud2D({ color, tone, label }: PrimitiveProps) {
  return (
    <Svg label={label}>
      <path
        d="M22 70 a16 16 0 0 1 4 -31 a22 22 0 0 1 42 -4 a17 17 0 0 1 10 35 z"
        fill={color}
        stroke={tone('direction.mark')}
        strokeWidth="3"
      />
    </Svg>
  );
}

/** Teardrop. */
export function Raindrop2D({ color, label }: PrimitiveProps) {
  return (
    <Svg label={label}>
      <path d="M50 8 C50 8 22 48 22 64 a28 28 0 0 0 56 0 C78 48 50 8 50 8 z" fill={color} />
    </Svg>
  );
}

/** Tree: trunk and triangular crown. */
export function Tree2D({ color, tone, label }: PrimitiveProps) {
  return (
    <Svg label={label}>
      <rect x="44" y="70" width="12" height="24" rx="3" fill={tone('nature.wood')} />
      <path d="M50 6 L84 74 H16 z" fill={color} />
    </Svg>
  );
}

/** Leaf with midrib. */
export function Leaf2D({ color, tone, label }: PrimitiveProps) {
  return (
    <Svg label={label}>
      <path d="M20 80 C20 30 50 12 84 16 C86 52 64 82 20 80 z" fill={color} />
      <path d="M20 80 L70 30" stroke={tone('nature.wood')} strokeWidth="3" fill="none" />
    </Svg>
  );
}

/** Water with ripples. */
export function Water2D({ color, tone, label }: PrimitiveProps) {
  return (
    <Svg label={label}>
      <rect x="4" y="30" width="92" height="64" rx="8" fill={color} />
      <path
        d="M14 48 q9 -8 18 0 t18 0 t18 0 t18 0"
        stroke={tone('nature.sky')}
        strokeWidth="4"
        fill="none"
      />
    </Svg>
  );
}

/** Mountain with snow cap. */
export function Mountain2D({ color, tone, label }: PrimitiveProps) {
  return (
    <Svg label={label}>
      <path d="M6 90 L50 12 L94 90 z" fill={color} />
      <path d="M38 33 L50 12 L62 33 L56 30 L50 36 L44 30 z" fill={tone('nature.cloud')} />
    </Svg>
  );
}

/** Plain rounded box. */
export function Box2D({ color, tone, label }: PrimitiveProps) {
  return (
    <Svg label={label}>
      <rect x="12" y="22" width="76" height="68" rx="6" fill={color} />
      <rect x="8" y="14" width="84" height="14" rx="5" fill={tone('struct.frame')} />
    </Svg>
  );
}

/** A single horizontal layer. */
export function Layer2D({ color, label }: PrimitiveProps) {
  return (
    <Svg label={label}>
      <rect x="6" y="38" width="88" height="24" rx="10" fill={color} />
    </Svg>
  );
}

/** Bread slice outline with crust. */
export function BreadSlice2D({ color, tone, label }: PrimitiveProps) {
  return (
    <Svg label={label}>
      <path
        d="M16 90 V40 C4 26 20 8 50 8 C80 8 96 26 84 40 V90 z"
        fill={color}
        stroke={tone('food.crust')}
        strokeWidth="7"
      />
    </Svg>
  );
}

/** Whole round fruit. */
export function RoundFruit2D({ color, tone, label }: PrimitiveProps) {
  return (
    <Svg label={label}>
      <circle cx="50" cy="56" r="36" fill={color} />
      <path
        d="M50 22 V10 M50 16 q14 -10 22 -2"
        stroke={tone('nature.leaf')}
        strokeWidth="5"
        fill="none"
      />
    </Svg>
  );
}

/** Cross-section slice with seeds. */
export function Slice2D({ color, tone, label }: PrimitiveProps) {
  return (
    <Svg label={label}>
      <circle cx="50" cy="50" r="42" fill={color} />
      <circle cx="50" cy="50" r="16" fill={tone('food.fruit')} />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <circle
          key={i}
          cx={50 + Math.cos((i * Math.PI) / 3) * 28}
          cy={50 + Math.sin((i * Math.PI) / 3) * 28}
          r="3.5"
          fill={tone('food.bread')}
        />
      ))}
    </Svg>
  );
}

/** Neutral person figure. */
export function Person2D({ color, tone, label }: PrimitiveProps) {
  return (
    <Svg label={label}>
      <circle cx="50" cy="24" r="14" fill={tone('people.skin')} />
      <path d="M24 94 V66 a26 26 0 0 1 52 0 V94 z" fill={color} />
    </Svg>
  );
}

/** Ring with clockwise arrowheads. */
export function CycleRing2D({ color, label }: PrimitiveProps) {
  return (
    <Svg label={label}>
      <circle cx="50" cy="50" r="36" fill="none" stroke={color} strokeWidth="6" />
      <path
        d="M44 6 L56 14 L44 22 M88 56 L80 68 L72 56 M20 74 L12 62 L28 62"
        fill="none"
        stroke={color}
        strokeWidth="6"
      />
    </Svg>
  );
}

/** Time axis with ticks. */
export function TimelineAxis2D({ color, label }: PrimitiveProps) {
  return (
    <Svg label={label}>
      <path d="M6 50 H90 M80 40 L92 50 L80 60" fill="none" stroke={color} strokeWidth="5" />
      {[18, 38, 58].map((x) => (
        <circle key={x} cx={x} cy="50" r="5" fill={color} />
      ))}
    </Svg>
  );
}

/** Bar-chart column. */
export function Bar2D({ color, tone, label }: PrimitiveProps) {
  return (
    <Svg label={label}>
      <rect x="30" y="14" width="40" height="76" rx="4" fill={color} />
      <line x1="10" y1="92" x2="90" y2="92" stroke={tone('struct.frame')} strokeWidth="4" />
    </Svg>
  );
}

/** Row of countable dots. */
export function CounterDots2D({ color, label }: PrimitiveProps) {
  return (
    <Svg label={label}>
      {[14, 32, 50, 68, 86].map((x) => (
        <circle key={x} cx={x} cy="50" r="7" fill={color} />
      ))}
    </Svg>
  );
}

/** Dashed grouping frame. */
export function GroupFrame2D({ color, label }: PrimitiveProps) {
  return (
    <Svg label={label}>
      <rect
        x="6"
        y="6"
        width="88"
        height="88"
        rx="10"
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeDasharray="8 6"
      />
    </Svg>
  );
}

/** Fallback card showing the label text. */
export function LabeledCard2D({ color, tone, label, emphasis = false }: PrimitiveProps) {
  return (
    <Svg label={label}>
      <rect
        x="4"
        y="24"
        width="92"
        height="52"
        rx="8"
        fill={color}
        stroke={tone('ui.outline')}
        strokeWidth="2"
      />
      <rect
        x="4"
        y="24"
        width="8"
        height="52"
        rx="3"
        fill={emphasis ? tone('ui.highlight') : tone('ui.accent')}
      />
      <text x="54" y="56" textAnchor="middle" fontSize="14" fill={tone('ui.cardText')}>
        {label ?? '?'}
      </text>
    </Svg>
  );
}
