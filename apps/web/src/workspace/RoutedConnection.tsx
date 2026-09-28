import { BaseEdge, type Edge, type EdgeProps } from '@xyflow/react';
import type { RoutedEdge } from './routing';

export function RoutedConnection({
  id,
  data,
  markerEnd,
  style,
  selected,
}: EdgeProps<Edge<{ route: RoutedEdge; current?: boolean }>>) {
  const route = data?.route;
  if (!route) return null;
  return (
    <>
      {/* A small knockout at unavoidable crossings makes clear these are not junctions. */}
      <path d={route.path} fill="none" stroke="#153b65" strokeWidth={7} pointerEvents="none" />
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
            fill="#153b65"
            stroke={selected ? '#ffffff' : (style?.stroke ?? '#607e9e')}
            strokeWidth={0.6}
          />
          <text
            x={route.label.x + route.label.width / 2}
            y={route.label.y + 18}
            fill="#e4edfa"
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
