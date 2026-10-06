import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { GitBranch } from 'lucide-react';
import type { CustomIcon, Illustration } from '@opsis/schema';
import { boardIcons, iconMotion } from './icons';
import { NodeIcon } from './NodeIcon';
import { IllustrationView, usePrefersReducedMotion } from './Illustration';
import { PORT_OFFSETS } from './connections';
import { NODE_WIDTH } from './model';
import { wrapLabel } from './geometry';

export type DiagramNode = Node<{
  linkedBoardId?: string | undefined;
  label: string;
  icon: keyof typeof boardIcons;
  customIcon: CustomIcon | undefined;
  kind: string;
  number: number;
  outgoing: number;
  confidence: string | undefined;
  illustration: Illustration | undefined;
  command: string | undefined;
  sample: { input: number; output: number } | undefined;
  /** Where playback is: on this object, past it, or not playing (or not reached). */
  stage: 'current' | 'revealed' | null;
}>;

export function IconNode({ data, selected }: NodeProps<DiagramNode>) {
  const still = usePrefersReducedMotion();
  // During playback an illustrated icon evolves into its drawing, which stays once reached.
  const evolved = data.illustration && data.stage;
  return (
    <div
      className={`blueprint-node ${selected ? 'is-selected' : ''} ${data.kind === 'decision' ? 'is-decision' : ''}`}
      // Staggers the entrance so a new board assembles in reading order.
      style={{ ['--enter-index' as string]: Math.min(data.number - 1, 14) }}
    >
      <div
        className={`node-symbol ${evolved ? 'is-evolved' : ''}`}
        data-motion={
          data.stage === 'current' && !evolved
            ? // A drawn icon draws itself in; library icons move like their subject.
              data.customIcon
              ? 'draw'
              : iconMotion(data.icon)
            : undefined
        }
      >
        <NodeIcon node={data} className="node-icon" size={48} strokeWidth={1.35} />
        {data.linkedBoardId && (
          <span
            className="board-link-marker"
            title="Linked board · double-click to open"
            aria-label="Links to another board"
          >
            ↗
          </span>
        )}
        {data.stage && data.sample && (
          <span
            className="process-row-count"
            aria-label={`${data.sample.input} input lines, ${data.sample.output} output lines`}
          >
            {data.sample.input === data.sample.output
              ? `${data.sample.output} lines`
              : `${data.sample.input} → ${data.sample.output}`}
          </span>
        )}
        {evolved && (
          // Remounted on each visit, so the drawing plays from the start every time.
          <IllustrationView
            key={data.stage}
            illustration={data.illustration!}
            animate={data.stage === 'current' && !still}
          />
        )}
        {(['left', 'right', 'top', 'bottom'] as const).map((side) => (
          <Handle
            key={side}
            id={side}
            type="source"
            position={
              {
                left: Position.Left,
                right: Position.Right,
                top: Position.Top,
                bottom: Position.Bottom,
              }[side]
            }
            title={`${data.label}: ${side} connection`}
            style={{
              left: PORT_OFFSETS[side].x - (NODE_WIDTH - 88) / 2,
              top: PORT_OFFSETS[side].y,
              right: 'auto',
              bottom: 'auto',
              transform: 'translate(-50%, -50%)',
            }}
          />
        ))}
        {data.kind === 'decision' && <span className="decision-label">Decision</span>}
        {data.outgoing > 1 && (
          <span className="branch-count" title={`${data.outgoing} outgoing connections`}>
            <GitBranch size={10} />
            {data.outgoing}
          </span>
        )}
      </div>
      <strong title={data.label}>
        {wrapLabel(data.label).map((line, i) => (
          <span key={i}>{line}</span>
        ))}
      </strong>
      {data.command && (
        <code className="node-command" title={data.command}>
          {wrapLabel(data.command, 26).map((line, i) => (
            <span key={i}>{line}</span>
          ))}
        </code>
      )}
      {data.confidence && data.confidence !== 'normal' && (
        <span className="confidence-badge">{data.confidence}</span>
      )}
    </div>
  );
}
