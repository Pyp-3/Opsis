import { PROVIDER_LABELS, type BoardAgent } from '@opsis/schema';
import type { ReactNode } from 'react';
import type { useBoardChat } from './useBoardChat';

export function BoardChat({
  chat,
  busy,
  onSelect,
  children,
}: {
  chat: ReturnType<typeof useBoardChat>;
  busy: boolean;
  onSelect(agent: BoardAgent, model: string): void;
  children: ReactNode;
}) {
  return (
    <section className="board-chat" aria-label="Private board chat">
      <header>
        <h2>Chat</h2>
        <p>
          Private to your account. Each thread keeps its provider and model. Requests create or
          update this canvas.
        </p>
      </header>
      <div className="chat-thread-controls">
        <label>
          Thread
          <select
            aria-label="Chat thread"
            disabled={busy || chat.loading}
            value={chat.selectedId ?? ''}
            onChange={(event) => {
              chat.setSelectedId(event.target.value || null);
              const thread = chat.threads.find((item) => item.id === event.target.value);
              if (thread) onSelect(thread.agent, thread.model);
            }}
          >
            <option value="">New thread</option>
            {chat.threads.map((thread) => (
              <option key={thread.id} value={thread.id}>
                {thread.agent === 'demo' ? 'Demo' : PROVIDER_LABELS[thread.agent]} · {thread.model}{' '}
                · {thread.messages[0]?.text.slice(0, 60)}
              </option>
            ))}
          </select>
        </label>
        <button disabled={busy || !chat.selected} onClick={() => chat.setSelectedId(null)}>
          New thread
        </button>
        <button disabled={busy || !chat.selected} onClick={() => void chat.remove()}>
          Delete thread
        </button>
        <button disabled={busy} onClick={chat.reload}>
          Reload threads
        </button>
      </div>
      {chat.error && <p role="alert">{chat.error}</p>}
      <div className="chat-messages" role="log" aria-label="Thread messages">
        {chat.selected?.messages.map((message, index) => (
          <article key={index} className={`chat-message ${message.role}`}>
            <strong>{message.role === 'user' ? 'You' : 'Canvas response'}</strong>
            <p>{message.text}</p>
          </article>
        ))}
        {!chat.selected && <p>Start a conversation about this canvas.</p>}
      </div>
      <div className="chat-composer">{children}</div>
    </section>
  );
}
