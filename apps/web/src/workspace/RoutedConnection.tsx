import { BaseEdge, type Edge, type EdgeProps } from '@xyflow/react';
import { footnoteMarkLabel } from '@opsis/schema';
import type { RoutedEdge } from './routing';

export function RoutedConnection({
  id,
  data,
  markerEnd,
  style,
  selected,
}: EdgeProps<Edge<{ route: RoutedEdge; current?: boolean; footnotes?: number[] | undefined }>>) {
  const route = data?.route;
  if (!route) return null;
  return (
    <>
      {/* A small knockout at unavoidable crossings makes clear these are not junctions. */}
      <path
        d={route.path}
        fill="none"
        style={{ stroke: 'var(--bp-deep)' }}
        strokeWidth={7}
        pointerEvents="none"
      />
      <BaseEdge
        id={id}
        path={route.path}
        {...(markerEnd ? { markerEnd } : {})}
        style={style}
        interactionWidth={24}
      />
      {data.current && (
        // Keyed by path so the draw-in and travelling packet restart for every step.
        <g key={route.path} className="edge-motion" pointerEvents="none" aria-hidden="true">
          <path
            className="edge-motion-trace"
            d={route.path}
            pathLength={1}
            fill="none"
            stroke={style?.stroke ?? '#e8d4a3'}
          />
          <circle
            className="edge-motion-packet"
            r={5}
            fill={style?.stroke ?? '#e8d4a3'}
            style={{ offsetPath: `path('${route.path}')` }}
          />
        </g>
      )}
      {data.footnotes && <ConnectionFootnotes route={route} numbers={data.footnotes} />}
      {route.label && (
        <g className="connection-label" aria-label={route.lines.join(' ')}>
          {route.callout && (
            <path
              d={route.callout}
              fill="none"
              stroke={style?.stroke ?? '#b9d1ef'}
              strokeWidth={1}
              strokeDasharray="2 5"
              opacity={0.7}
              pointerEvents="none"
            />
          )}
          <rect
            {...route.label}
            rx={5}
            style={{ fill: 'var(--bp-deep)' }}
            stroke={selected ? '#ffffff' : (style?.stroke ?? '#607e9e')}
            strokeWidth={0.6}
          />
          <text
            x={route.label.x + route.label.width / 2}
            y={route.label.y + 18}
            style={{ fill: 'var(--bp-ink)' }}
            fontSize={12}
            fontFamily="monospace"
            textAnchor="middle"
          >
            {route.lines.map((line, i) => (
              <tspan key={i} x={route.label!.x + route.label!.width / 2} dy={i ? 16 : 0}>
                {line}
              </tspan>
            ))}
          </text>
        </g>
      )}
    </>
  );
}

/** Footnote numbers on a connection: beside its label, or at the middle of an unlabelled one. */
function ConnectionFootnotes({ route, numbers }: { route: RoutedEdge; numbers: number[] }) {
  const middle = route.points[Math.floor(route.points.length / 2)];
  const at = route.label
    ? { x: route.label.x + route.label.width, y: route.label.y }
    : middle
      ? { x: middle.x + 10, y: middle.y - 10 }
      : null;
  if (!at) return null;
  const text = numbers.join(',');
  const width = 10 + text.length * 7;
  return (
    <g className="footnote-mark" transform={`translate(${at.x} ${at.y})`} pointerEvents="none">
      <title>{footnoteMarkLabel(numbers)}</title>
      <rect x={-width / 2} y={-10} width={width} height={20} rx={10} />
      <text y={4} textAnchor="middle">
        {text}
      </text>
    </g>
  );
}
