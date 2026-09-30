import { useSyncExternalStore, type ReactNode } from 'react';
import type {
  Illustration,
  IllustrationInk,
  IllustrationLayer,
  IllustrationMotion,
} from '@opsis/schema';

/** Inks on the blueprint; gold matches the icons, the rest match the arrow colours. */
export const INK_VALUES: Record<IllustrationInk, string> = {
  ink: '#e4edfa',
  gold: '#f4dcaa',
  sky: '#75d9f3',
  amber: '#f2cc79',
  violet: '#d6b0fa',
  coral: '#ffad8f',
  mint: '#8fe3b4',
  rose: '#f6a3c7',
  ice: '#c4d7ed',
};
const SMOOTH = '0.45 0 0.55 1';

const REDUCED = '(prefers-reduced-motion: reduce)';
/** SVG animations ignore CSS, so drawings check the reader's motion preference themselves. */
export function usePrefersReducedMotion() {
  return useSyncExternalStore(
    (listener) => {
      const media = window.matchMedia?.(REDUCED);
      media?.addEventListener('change', listener);
      return () => media?.removeEventListener('change', listener);
    },
    () => window.matchMedia?.(REDUCED).matches === true,
  );
}

type Frame = string;
const frame = (value: number | readonly [number, number]): Frame =>
  typeof value === 'number' ? String(value) : `${value[0]} ${value[1]}`;

/** Timing shared by every animation element, from one motion. */
function timing(motion: IllustrationMotion, frames: number) {
  const smooth = motion.easing === 'smooth' && frames > 1;
  return {
    dur: `${motion.duration}s`,
    begin: `${motion.delay ?? 0}s`,
    repeatCount: motion.repeat === 'loop' ? 'indefinite' : undefined,
    fill: 'freeze' as const,
    ...(smooth
      ? {
          calcMode: 'spline' as const,
          keyTimes: Array.from({ length: frames }, (_, i) => i / (frames - 1)).join(';'),
          keySplines: Array.from({ length: frames - 1 }, () => SMOOTH).join(';'),
        }
      : {}),
  };
}

/**
 * Before a delayed motion starts, its layer holds the motion's first frame (a line that will
 * draw in stays hidden). SMIL gives the later-starting animation priority, so the hold hands
 * over cleanly.
 */
const holdTiming = (motion: IllustrationMotion) => ({
  dur: `${motion.delay}s`,
  begin: '0s',
  fill: 'freeze' as const,
});

function transformMotion(motion: IllustrationMotion, key: number, child: ReactNode): ReactNode {
  if (motion.type === 'along')
    return (
      <g key={key}>
        <animateMotion
          path={motion.path}
          {...timing(motion, 2)}
          {...(motion.easing === 'smooth'
            ? { keyPoints: '0;1', keyTimes: '0;1', calcMode: 'spline', keySplines: SMOOTH }
            : {})}
        />
        {child}
      </g>
    );
  const [ox, oy] = motion.origin ?? [50, 50];
  const type = motion.type === 'move' ? 'translate' : motion.type;
  const frames = (motion.values ?? []).map((value) =>
    motion.type === 'rotate' ? `${frame(value)} ${ox} ${oy}` : frame(value),
  );
  const animated = (
    <g key={key}>
      {motion.delay ? (
        <animateTransform
          attributeName="transform"
          type={type}
          values={`${frames[0]};${frames[0]}`}
          {...holdTiming(motion)}
        />
      ) : null}
      <animateTransform
        attributeName="transform"
        type={type}
        values={frames.join(';')}
        {...timing(motion, frames.length)}
      />
      {/* SVG scales about (0, 0), so a scaled layer is moved there and back around it. */}
      {motion.type === 'scale' ? <g transform={`translate(${-ox} ${-oy})`}>{child}</g> : child}
    </g>
  );
  return motion.type === 'scale' ? (
    <g key={key} transform={`translate(${ox} ${oy})`}>
      {animated}
    </g>
  ) : (
    animated
  );
}

/** Animations that change the shape itself, rather than moving it. */
function shapeMotions(layer: IllustrationLayer, motions: IllustrationMotion[]) {
  return motions.flatMap((motion, i) => {
    const [attribute, frames]: [string, string[]] =
      motion.type === 'draw'
        ? ['stroke-dashoffset', ['1', '0']]
        : motion.type === 'fade'
          ? ['opacity', (motion.values ?? []).map(frame)]
          : ['d', motion.shapes ?? [layer.d ?? '']];
    return [
      motion.delay ? (
        <animate
          key={`${i}-hold`}
          attributeName={attribute}
          values={`${frames[0]};${frames[0]}`}
          {...holdTiming(motion)}
        />
      ) : null,
      <animate
        key={i}
        attributeName={attribute}
        values={frames.join(';')}
        {...timing(motion, frames.length)}
      />,
    ];
  });
}

function Layer({ layer, animate }: { layer: IllustrationLayer; animate: boolean }) {
  const motions = animate ? (layer.motions ?? []) : [];
  const own = motions.filter((motion) => ['draw', 'fade', 'morph'].includes(motion.type));
  const draws = own.some((motion) => motion.type === 'draw');
  const paint = {
    stroke: layer.stroke === 'none' ? 'none' : INK_VALUES[layer.stroke],
    fill: layer.fill === 'none' ? 'none' : INK_VALUES[layer.fill],
    strokeWidth: layer.strokeWidth ?? 3,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    opacity: layer.opacity,
    // A unit path length lets any stroke draw itself in with the same two numbers.
    ...(draws ? { pathLength: 1, strokeDasharray: 1 } : {}),
  };
  const children = shapeMotions(layer, own);
  let shape: ReactNode;
  switch (layer.shape) {
    case 'path':
      shape = (
        <path d={layer.d} {...paint}>
          {children}
        </path>
      );
      break;
    case 'circle':
      shape = (
        <circle cx={layer.cx} cy={layer.cy} r={layer.r} {...paint}>
          {children}
        </circle>
      );
      break;
    case 'ellipse':
      shape = (
        <ellipse cx={layer.cx} cy={layer.cy} rx={layer.rx} ry={layer.ry} {...paint}>
          {children}
        </ellipse>
      );
      break;
    case 'rect':
      shape = (
        <rect x={layer.x} y={layer.y} width={layer.width} height={layer.height} {...paint}>
          {children}
        </rect>
      );
      break;
    case 'line':
      shape = (
        <line x1={layer.x1} y1={layer.y1} x2={layer.x2} y2={layer.y2} {...paint}>
          {children}
        </line>
      );
  }
  // Each movement wraps the shape in its own group, so several movements combine.
  return motions
    .filter((motion) => !own.includes(motion))
    .reduceRight<ReactNode>((child, motion, i) => transformMotion(motion, i, child), shape);
}

/**
 * Draws an agent's illustration. Animated, it plays from the moment it is inserted, so callers
 * remount it (with a key) to replay it; still, it shows each layer's resting picture.
 */
export function IllustrationView({
  illustration,
  animate,
  size = 88,
}: {
  illustration: Illustration;
  animate: boolean;
  size?: number;
}) {
  return (
    <svg
      className="illustration"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      {illustration.layers.map((layer, i) => (
        <Layer key={i} layer={layer} animate={animate} />
      ))}
    </svg>
  );
}
