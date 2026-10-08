import {
  PROVIDER_LABELS,
  type BoardAgent,
  type BoardChatEntry,
  type ChatOutcome,
} from '@opsis/schema';
import {
  Brain,
  ChevronDown,
  CircleAlert,
  Eye,
  Lock,
  Maximize2,
  MessagesSquare,
  PanelRightOpen,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type { useBoardChat } from './useBoardChat';

const agentLabel = (agent: BoardAgent) => (agent === 'demo' ? 'Demo' : PROVIDER_LABELS[agent]);
const threadTitle = (thread: BoardChatEntry) =>
  thread.messages[0]?.text.split('\n')[0]?.slice(0, 80) ?? 'Untitled thread';
function since(time: number) {
  const minutes = Math.round((Date.now() - time) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const OUTCOME_LABELS: Partial<Record<ChatOutcome, string>> = {
  applied: 'Applied',
  review: 'Awaiting review',
  partial: 'Partly applied',
  discarded: 'Discarded',
};

/**
 * The agent's notes for this thread. They carry the conversation's context forward, including
 * messages condensed out of a long thread, and the reader can clear them.
 */
function ThreadMemory({
  thread,
  busy,
  onForget,
}: {
  thread: BoardChatEntry;
  busy: boolean;
  onForget(): void;
}) {
  if (!thread.memory && !thread.condensed) return null;
  return (
    <details className="chat-memory">
      <summary>
        <Brain size={13} aria-hidden /> Thread notes
        {thread.condensed ? (
          <small>
            {' '}
            · {thread.condensed} earlier {thread.condensed === 1 ? 'message' : 'messages'} condensed
          </small>
        ) : null}
      </summary>
      <div className="chat-memory-body">
        <p className="chat-muted">
          The agent rewrites these notes each turn and reads them before answering, so the thread
          keeps its context as it grows.
        </p>
        {thread.memory ? <pre>{thread.memory}</pre> : <p className="chat-muted">No notes yet.</p>}
        {thread.memory && (
          <button type="button" className="chat-link" disabled={busy} onClick={onForget}>
            Clear notes
          </button>
        )}
      </div>
    </details>
  );
}

const CHAT_WIDTH_KEY = 'opsis:chat-width';
const CHAT_MIN = 320;
const CHAT_MAX = 640;
const setChatWidth = (width: number) => {
  const clamped = Math.round(Math.min(CHAT_MAX, Math.max(CHAT_MIN, width)));
  document.documentElement.style.setProperty('--chat-w', `${clamped}px`);
  return clamped;
};
const rememberChatWidth = (width: number) => {
  try {
    localStorage.setItem(CHAT_WIDTH_KEY, String(width));
  } catch {
    // A remembered width is a convenience only.
  }
};
/** Restores the docked chat's remembered width. */
function useSavedChatWidth() {
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(CHAT_WIDTH_KEY));
      if (saved >= CHAT_MIN && saved <= CHAT_MAX) setChatWidth(saved);
    } catch {
      // A remembered width is a convenience only.
    }
  }, []);
}

/** A drag handle on the docked chat's left edge, trading canvas room for chat room. */
function ChatResizer() {
  const currentWidth = (element: Element | null) =>
    element?.closest('#chat-panel')?.getBoundingClientRect().width ?? 400;
  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const right = event.currentTarget.closest('#chat-panel')?.getBoundingClientRect().right ?? 0;
    let width = currentWidth(event.currentTarget);
    const move = (e: PointerEvent) => {
      width = setChatWidth(right - e.clientX);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('is-resizing-chat');
      rememberChatWidth(width);
    };
    document.body.classList.add('is-resizing-chat');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const width = setChatWidth(
      currentWidth(event.currentTarget) + (event.key === 'ArrowLeft' ? 24 : -24),
    );
    rememberChatWidth(width);
  };
  return (
    <button
      type="button"
      className="chat-resize"
      aria-label="Resize chat"
      title="Drag to resize"
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  );
}

/** Every saved thread for this board and account, newest first. */
function ThreadList({
  chat,
  busy,
  onPick,
}: {
  chat: ReturnType<typeof useBoardChat>;
  busy: boolean;
  onPick(thread: BoardChatEntry | null): void;
}) {
  return (
    <div className="chat-thread-list">
      <div className="chat-thread-list-head">
        <span>Threads</span>
        <button
          className="chat-icon-button"
          aria-label="Reload threads"
          title="Reload threads"
          disabled={busy}
          onClick={chat.reload}
        >
          <RefreshCw size={14} />
        </button>
      </div>
      <ul aria-label="Chat threads">
        <li>
          <button
            className="chat-thread-item is-new"
            aria-current={!chat.selected || undefined}
            disabled={busy}
            onClick={() => onPick(null)}
          >
            <Plus size={14} aria-hidden />
            <span className="chat-thread-title">New thread</span>
          </button>
        </li>
        {chat.threads.map((thread) => (
          <li key={thread.id}>
            <button
              className="chat-thread-item"
              aria-current={thread.id === chat.selectedId || undefined}
              disabled={busy}
              onClick={() => onPick(thread)}
            >
              <span className="chat-thread-title">{threadTitle(thread)}</span>
              <small>
                {agentLabel(thread.agent)} · {thread.model} · {since(thread.updatedAt)}
              </small>
            </button>
          </li>
        ))}
      </ul>
      {chat.loading && <p className="chat-muted">Loading threads…</p>}
    </div>
  );
}

/**
 * The board's private chat. Docked beside the canvas on wide screens, so changes appear while
 * the conversation continues; otherwise a full page with its threads listed alongside.
 */
export function BoardChat({
  chat,
  busy,
  layout,
  onLayout,
  onClose,
  onSelect,
  progress,
  review,
  onReview,
  onShowCanvas,
  error,
  onDismissError,
  sessionNote,
  children,
}: {
  chat: ReturnType<typeof useBoardChat>;
  busy: boolean;
  /** `docked` sits beside the canvas; `full` takes the page; `narrow` cannot dock. */
  layout: 'docked' | 'full' | 'narrow';
  onLayout(docked: boolean): void;
  onClose(): void;
  onSelect(agent: BoardAgent, model: string): void;
  /** Live generation progress, shown as the reply in progress. */
  progress?: ReactNode;
  review: boolean;
  onReview(): void;
  onShowCanvas(): void;
  error: string;
  onDismissError(): void;
  /** Says when a CLI agent resumes its own saved session for the thread. */
  sessionNote?: string | undefined;
  children: ReactNode;
}) {
  useSavedChatWidth();
  const menu = useRef<HTMLDetailsElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const selected = chat.selected;
  const pick = (thread: BoardChatEntry | null) => {
    chat.setSelectedId(thread?.id ?? null);
    if (thread) onSelect(thread.agent, thread.model);
    if (menu.current) menu.current.open = false;
  };
  // The thread menu closes on an outside press or Escape, like the header menus.
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (menu.current?.open && !menu.current.contains(event.target as globalThis.Node))
        menu.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !menu.current?.open) return;
      menu.current.open = false;
      menu.current.querySelector('summary')?.focus();
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  // Keep the newest message in view as the conversation grows.
  const count = selected?.messages.length ?? 0;
  const working = !!progress;
  useLayoutEffect(() => {
    const element = log.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [count, selected?.id, working, review, error]);

  const sidebar = layout === 'full';
  const lastAssistant = selected
    ? selected.messages.map((message) => message.role).lastIndexOf('assistant')
    : -1;
  return (
    <section className={`board-chat is-${layout}`} aria-label="Private board chat">
      {layout === 'docked' && <ChatResizer />}
      {sidebar && <ThreadList chat={chat} busy={busy} onPick={pick} />}
      <div className="chat-main">
        <header className="chat-head">
          {sidebar ? (
            <div className="chat-head-title">
              <strong>{selected ? threadTitle(selected) : 'New thread'}</strong>
              {selected && (
                <small>
                  {agentLabel(selected.agent)} · {selected.model}
                </small>
              )}
            </div>
          ) : (
            <details className="chat-thread-menu" ref={menu}>
              <summary
                aria-label="Chat threads"
                aria-disabled={busy || undefined}
                onClick={(event) => {
                  // Threads cannot change while a reply is being written.
                  if (busy) event.preventDefault();
                }}
              >
                <MessagesSquare size={15} aria-hidden />
                <span className="chat-head-title">
                  <strong>{selected ? threadTitle(selected) : 'New thread'}</strong>
                  <small>
                    {selected
                      ? `${agentLabel(selected.agent)} · ${selected.model}`
                      : `${chat.threads.length} saved ${chat.threads.length === 1 ? 'thread' : 'threads'}`}
                  </small>
                </span>
                <ChevronDown className="chevron" size={14} aria-hidden />
              </summary>
              <div className="chat-thread-menu-panel">
                <ThreadList chat={chat} busy={busy} onPick={pick} />
              </div>
            </details>
          )}
          <div className="chat-head-actions">
            <button
              className="chat-icon-button"
              aria-label="New thread"
              title="New thread"
              disabled={busy || !selected}
              onClick={() => pick(null)}
            >
              <Plus size={16} />
            </button>
            <button
              className="chat-icon-button"
              aria-label="Delete thread"
              title="Delete thread"
              disabled={busy || !selected}
              onClick={() => void chat.remove()}
            >
              <Trash2 size={15} />
            </button>
            {layout === 'docked' && (
              <button
                className="chat-icon-button"
                aria-label="Expand chat"
                title="Expand chat to the full page"
                onClick={() => onLayout(false)}
              >
                <Maximize2 size={15} />
              </button>
            )}
            {layout === 'full' && (
              <button
                className="chat-icon-button"
                aria-label="Chat beside canvas"
                title="Show the chat beside the canvas"
                onClick={() => onLayout(true)}
              >
                <PanelRightOpen size={16} />
              </button>
            )}
            {layout === 'docked' && (
              <button
                className="chat-icon-button"
                aria-label="Close chat"
                title="Close chat"
                onClick={onClose}
              >
                <X size={16} />
              </button>
            )}
          </div>
        </header>
        {chat.error && (
          <p className="chat-notice is-error" role="alert">
            <CircleAlert size={15} aria-hidden /> {chat.error}
          </p>
        )}
        {selected && (
          <ThreadMemory thread={selected} busy={busy} onForget={() => void chat.forget()} />
        )}
        {/* Focusable so a long thread can be scrolled from the keyboard. */}
        <div
          className="chat-messages"
          role="log"
          aria-label="Thread messages"
          tabIndex={0}
          ref={log}
        >
          {!selected && !progress && (
            <div className="chat-empty">
              <span className="chat-empty-mark" aria-hidden>
                <MessagesSquare size={22} />
              </span>
              <h2>Ask about this canvas</h2>
              <p>
                Explain something new, or ask for a change. Replies arrive here; diagrams and
                proposals appear on the canvas.
              </p>
            </div>
          )}
          {selected?.messages.map((message, index) => (
            <article key={index} className={`chat-message is-${message.role}`}>
              {message.role === 'user' ? (
                <span className="sr-only">You:</span>
              ) : (
                <header>
                  <span className="chat-avatar" aria-hidden>
                    {agentLabel(selected.agent).slice(0, 1)}
                  </span>
                  <strong>{agentLabel(selected.agent)}</strong>
                  <small>{selected.model}</small>
                </header>
              )}
              <p>{message.text}</p>
              {message.outcome && OUTCOME_LABELS[message.outcome] && (
                <small className={`chat-outcome is-${message.outcome}`}>
                  {OUTCOME_LABELS[message.outcome]}
                </small>
              )}
              {index === lastAssistant && layout !== 'docked' && !review && !progress && (
                <button className="chat-link" onClick={onShowCanvas}>
                  <Eye size={13} aria-hidden /> View on canvas
                </button>
              )}
            </article>
          ))}
          {progress && <div className="chat-message is-assistant is-working">{progress}</div>}
          {review && (
            <div className="chat-card" role="status">
              <div>
                <strong>Proposal ready</strong>
                <p>A proposal is ready for review on Canvas. Nothing changes until you apply it.</p>
              </div>
              <button className="chat-primary" onClick={onReview}>
                Review on canvas
              </button>
            </div>
          )}
          {error && (
            <div className="chat-notice is-error" role="alert">
              <CircleAlert size={15} aria-hidden />
              <p>{error}</p>
              <button
                className="chat-icon-button"
                aria-label="Dismiss error"
                onClick={onDismissError}
              >
                <X size={14} />
              </button>
            </div>
          )}
        </div>
        <div className="chat-composer">
          {children}
          <p className="chat-privacy">
            <Lock size={11} aria-hidden /> Private to your account · each thread keeps its provider
            and model{sessionNote ? ` · ${sessionNote}` : ''}
          </p>
        </div>
      </div>
    </section>
  );
}
