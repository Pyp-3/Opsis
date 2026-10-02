import type { BoardIcon, CustomIcon, CustomIconLayer } from '@opsis/schema';
import { boardIcons } from './icons';

type IconSource = { icon: BoardIcon; customIcon?: CustomIcon | undefined };

function Shape({ layer }: { layer: CustomIconLayer }) {
  const fill = layer.fill ? 'currentColor' : undefined;
  switch (layer.shape) {
    case 'path':
      return <path d={layer.d} fill={fill} />;
    case 'circle':
      return <circle cx={layer.cx} cy={layer.cy} r={layer.r} fill={fill} />;
    case 'ellipse':
      return <ellipse cx={layer.cx} cy={layer.cy} rx={layer.rx} ry={layer.ry} fill={fill} />;
    case 'rect':
      return (
        <rect
          x={layer.x}
          y={layer.y}
          width={layer.width}
          height={layer.height}
          rx={layer.rx}
          fill={fill}
        />
      );
    case 'line':
      return <line x1={layer.x1} y1={layer.y1} x2={layer.x2} y2={layer.y2} />;
  }
}

/**
 * An object's icon: the agent's own drawing when it made one, otherwise the library icon.
 * Custom icons are drawn exactly like library icons, so styles and motions apply to both.
 */
export function NodeIcon({
  node,
  size = 24,
  strokeWidth = 2,
  className,
}: {
  node: IconSource;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  if (!node.customIcon) {
    const Icon = boardIcons[node.icon] ?? boardIcons.box;
    return <Icon size={size} strokeWidth={strokeWidth} className={className} />;
  }
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={['lucide', 'custom-icon', className].filter(Boolean).join(' ')}
      data-custom-icon={node.customIcon.name}
      aria-hidden="true"
    >
      {node.customIcon.layers.map((layer, index) => (
        <Shape key={index} layer={layer} />
      ))}
    </svg>
  );
}
