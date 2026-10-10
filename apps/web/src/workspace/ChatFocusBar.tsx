import type { ReactNode } from 'react';
import type { ChatFocus, ChatPriority, ChatPriorityReason } from '@opsis/schema';
import { PencilRuler, Shapes, X } from 'lucide-react';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

const REASONS: Record<ChatPriorityReason, string> = {
  focus: 'because drawings are in focus',
  tool: 'because a drawing tool is in hand',
  request: 'because your request is about a drawing',
  none: '',
};

/**
 * What the next chat message is about. Drawings in focus are sent to the agent, which may
 * propose changes to them for review; "Drawing first" makes the sketch the main result. Both
 * follow the canvas selection, and the reader can drop the focus or switch the priority.
 */
export function ChatFocusBar({
  focus,
  source,
  excluded,
  onExclude,
  priority,
  reason,
  overridden,
  onPriority,
  disabled,
  children,
}: {
  focus: ChatFocus | undefined;
  /** The concept whose attached drawings are in focus, when none were selected directly. */
  source: string | null;
  excluded: boolean;
  onExclude(excluded: boolean): void;
  priority: ChatPriority;
  reason: ChatPriorityReason;
  overridden: boolean;
  onPriority(priority: ChatPriority | null): void;
  disabled: boolean;
  /** Further request options shown in the same row, such as answering on a new page. */
  children?: ReactNode;
}) {
  const readerCount = focus?.drawings.length ?? 0;
  const sketchCount = focus?.sketchIds?.length ?? 0;
  if (!focus && priority === 'diagram' && !overridden && !children) return null;
  const drawingFirst = priority === 'drawing';
  const parts = [
    readerCount ? plural(readerCount, 'drawing') : '',
    sketchCount ? `${plural(sketchCount, 'agent sketch part')}` : '',
  ].filter(Boolean);
  return (
    <div className="chat-focus" role="group" aria-label="Request focus">
      {focus && !excluded && (
        <span className="chat-focus-chip">
          <Shapes size={13} aria-hidden />
          <span>
            Focus: {parts.join(' and ')}
            {source ? ` on ${source}` : ' selected'}
          </span>
          <button
            type="button"
            aria-label="Remove drawings from focus"
            title="Keep these drawings private for this message"
            disabled={disabled}
            onClick={() => onExclude(true)}
          >
            <X size={12} />
          </button>
        </span>
      )}
      {focus && excluded && (
        <button
          type="button"
          className="chat-focus-restore"
          disabled={disabled}
          onClick={() => onExclude(false)}
        >
          <Shapes size={13} aria-hidden /> Include {parts.join(' and ')}
        </button>
      )}
      <button
        type="button"
        className="chat-focus-priority"
        aria-pressed={drawingFirst}
        disabled={disabled}
        title={
          drawingFirst
            ? `The agent works on the sketch first${overridden ? '' : ` ${REASONS[reason]}`}. Click to put the diagram first.`
            : 'The agent works on the diagram first. Click to make the drawing the main result.'
        }
        onClick={() => onPriority(drawingFirst ? 'diagram' : 'drawing')}
      >
        <PencilRuler size={13} aria-hidden /> Drawing first
      </button>
      {overridden && (
        <button
          type="button"
          className="chat-link"
          disabled={disabled}
          onClick={() => onPriority(null)}
        >
          Automatic
        </button>
      )}
      {children}
    </div>
  );
}
