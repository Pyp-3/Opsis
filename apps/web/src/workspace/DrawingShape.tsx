import { dimensionLabel, type BoardDrawing } from '@opsis/schema';
import { INK_VALUES } from './Illustration';
import { arrowHead, dimensionGeometry, LINE_DASHES, strokePath } from './canvas-drawing';

/**
 * Lines and shapes sit beneath the diagram; words (text drawings and dimension labels) are
 * painted above it so arrows and their outlines never hide them.
 */
export type DrawingPart = 'shape' | 'label' | 'all';

/**
 * One canvas drawing as SVG, in absolute canvas coordinates. The live canvas and the SVG/PNG
 * export both draw through this component so they never disagree. `halo` is the canvas colour
 * painted behind text so labels stay legible over grid lines and arrows.
 */
export function DrawingShape({
  drawing,
  halo,
  part = 'all',
}: {
  drawing: BoardDrawing;
  halo: string;
  part?: DrawingPart;
}) {
  const shape = part !== 'label';
  const label = part !== 'shape';
  const color = INK_VALUES[drawing.ink];
  const stroke = {
    stroke: color,
    strokeWidth: drawing.strokeWidth,
    strokeDasharray: LINE_DASHES[drawing.line],
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  };
  const text = {
    fill: color,
    stroke: halo,
    strokeWidth: 4,
    paintOrder: 'stroke' as const,
    strokeLinejoin: 'round' as const,
    fontFamily: 'Inter, Arial, sans-serif',
  };
  if (drawing.shape === 'text' ? !label : drawing.shape !== 'dimension' && !shape) return null;
  switch (drawing.shape) {
    case 'stroke':
      return <path d={strokePath(drawing.points!)} {...stroke} />;
    case 'line':
      return <path d={strokePath(drawing.points!)} {...stroke} />;
    case 'arrow': {
      const [start, end] = drawing.points as [[number, number], [number, number]];
      return (
        <g>
          <path d={`M${start[0]} ${start[1]}L${end[0]} ${end[1]}`} {...stroke} />
          <path d={arrowHead(start, end, 10 + drawing.strokeWidth * 2)} fill={color} />
        </g>
      );
    }
    case 'rect':
    case 'ellipse': {
      const fill = drawing.fill ? color : 'none';
      const shared = { ...stroke, fill, fillOpacity: drawing.fill ? 0.16 : undefined };
      return drawing.shape === 'rect' ? (
        <rect
          x={drawing.x}
          y={drawing.y}
          width={drawing.width}
          height={drawing.height}
          rx={2}
          {...shared}
        />
      ) : (
        <ellipse
          cx={drawing.x! + drawing.width! / 2}
          cy={drawing.y! + drawing.height! / 2}
          rx={drawing.width! / 2}
          ry={drawing.height! / 2}
          {...shared}
        />
      );
    }
    case 'text': {
      const size = drawing.fontSize ?? 16;
      return (
        <text x={drawing.x} y={drawing.y! + size} fontSize={size} {...text}>
          {drawing.text!.split('\n').map((line, index) => (
            <tspan key={index} x={drawing.x} dy={index ? size * 1.25 : 0}>
              {line || ' '}
            </tspan>
          ))}
        </text>
      );
    }
    case 'dimension': {
      const geometry = dimensionGeometry(
        drawing.points as [[number, number], [number, number]],
        drawing.strokeWidth,
      );
      const { x, y, angle } = geometry.label;
      return (
        <g>
          {shape && (
            <>
              <path d={geometry.line} {...stroke} />
              <path d={geometry.ticks} {...stroke} strokeDasharray={undefined} />
              <path d={geometry.heads} fill={color} />
            </>
          )}
          {label && (
            <text
              x={x}
              y={y}
              fontSize={12}
              textAnchor="middle"
              dominantBaseline="middle"
              transform={`rotate(${angle} ${x} ${y})`}
              {...text}
            >
              {dimensionLabel(drawing)}
            </text>
          )}
        </g>
      );
    }
  }
}
