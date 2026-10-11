import { BookOpen, MessagesSquare, Workflow } from 'lucide-react';
import type { KeyboardEvent } from 'react';

export type CanvasTab = 'canvas' | 'chat' | 'info';
const TABS: readonly CanvasTab[] = ['canvas', 'chat', 'info'];

/**
 * The board's Canvas / Chat / Info switch, kept in the header so no row is taken from the
 * canvas. Canvas shows when an agent is drawing or a proposal awaits review; Chat shows a reply
 * that arrived while it was out of view. Info reads the open page as a page of a book.
 */
export function WorkspaceTabs({
  tab,
  onSelect,
  canvasStatus,
  chatUnread,
}: {
  tab: CanvasTab;
  onSelect(tab: CanvasTab): void;
  canvasStatus: 'generating' | 'review' | null;
  chatUnread: boolean;
}) {
  const move = (event: KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const at = TABS.indexOf(tab);
    const next: CanvasTab =
      event.key === 'Home'
        ? TABS[0]!
        : event.key === 'End'
          ? TABS[TABS.length - 1]!
          : TABS[(at + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]!;
    onSelect(next);
    document.getElementById(`${next}-tab`)?.focus();
  };
  return (
    <div
      className="workspace-tabs"
      role="tablist"
      aria-label="Board workspace tabs"
      onKeyDown={move}
    >
      <button
        id="canvas-tab"
        role="tab"
        aria-selected={tab === 'canvas'}
        tabIndex={tab === 'canvas' ? 0 : -1}
        aria-controls="canvas-panel"
        onClick={() => onSelect('canvas')}
      >
        <Workflow size={15} aria-hidden />
        <span className="tab-label">Canvas</span>
        {canvasStatus === 'generating' && (
          <span className="tab-status is-working">
            <span className="sr-only"> · Generating</span>
          </span>
        )}
        {canvasStatus === 'review' && (
          <span className="tab-status is-review">
            <span className="sr-only"> · </span>Review<span className="sr-only"> ready</span>
          </span>
        )}
      </button>
      <button
        id="chat-tab"
        role="tab"
        aria-selected={tab === 'chat'}
        tabIndex={tab === 'chat' ? 0 : -1}
        aria-controls="chat-panel"
        title={chatUnread ? 'New reply in chat' : undefined}
        onClick={() => onSelect('chat')}
      >
        <MessagesSquare size={15} aria-hidden />
        <span className="tab-label">Chat</span>
        {chatUnread && <span className="tab-status is-unread" aria-hidden />}
      </button>
      <button
        id="info-tab"
        role="tab"
        aria-selected={tab === 'info'}
        tabIndex={tab === 'info' ? 0 : -1}
        aria-controls="info-panel"
        title="Read this page like a book"
        onClick={() => onSelect('info')}
      >
        <BookOpen size={15} aria-hidden />
        <span className="tab-label">Info</span>
      </button>
    </div>
  );
}
