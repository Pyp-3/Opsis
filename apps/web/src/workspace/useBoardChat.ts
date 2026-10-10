import { apiFetch as fetch } from '../app-url';
import { useEffect, useRef, useState } from 'react';
import {
  BoardChatEntrySchema,
  appendChatMessage,
  withChatOutcome,
  type BoardAgent,
  type BoardChatEntry,
  type BoardChatThread,
  type ChatOutcome,
} from '@opsis/schema';
import { z } from 'zod';

export function useBoardChat(boardId: string) {
  const [threads, setThreads] = useState<BoardChatEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [loadedBoard, setLoadedBoard] = useState('');
  const writes = useRef(0);
  const scope = useRef(boardId);
  useEffect(() => {
    scope.current = boardId;
    const abort = new AbortController();
    const version = writes.current;
    fetch(`/v1/boards/${boardId}/chat`, { signal: abort.signal })
      .then(async (response) => {
        // A fresh canvas is not persisted until its first save.
        if (response.status === 404) return [];
        if (!response.ok) throw new Error('Could not load private chat threads.');
        return z.array(BoardChatEntrySchema).parse(await response.json());
      })
      .then((entries) => {
        if (abort.signal.aborted || version !== writes.current) return;
        setThreads(entries);
        setSelectedId(null);
        setError('');
        setLoading(false);
        setLoadedBoard(boardId);
      })
      .catch((reason: Error) => {
        if (!abort.signal.aborted) {
          setError(reason.message);
          setLoading(false);
        }
      });
    return () => abort.abort();
  }, [boardId, refresh]);
  const visibleThreads = loadedBoard === boardId ? threads : [];
  const selected = visibleThreads.find((thread) => thread.id === selectedId);
  async function write(thread: BoardChatThread, revision: number, id = boardId) {
    writes.current++;
    const response = await fetch(`/v1/boards/${id}/chat`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ thread, revision }),
    });
    if (!response.ok) {
      const message =
        ((await response.json()) as { message?: string }).message ?? 'Could not save this thread.';
      if (scope.current === id) setError(message);
      throw new Error(message);
    }
    const saved = BoardChatEntrySchema.parse(await response.json());
    if (scope.current === id) {
      setThreads((before) => [
        saved,
        ...(loadedBoard === id ? before : []).filter((item) => item.id !== saved.id),
      ]);
      setSelectedId(saved.id);
      setError('');
      setLoadedBoard(id);
      setLoading(false);
    }
    return saved;
  }
  /** The thread's saved content, without its storage metadata. */
  const content = (thread: BoardChatEntry): BoardChatThread => {
    const copy: Partial<BoardChatEntry> = { ...thread };
    delete copy.revision;
    delete copy.updatedAt;
    return copy as BoardChatThread;
  };
  /**
   * Adds the reader's message to the selected thread, or starts one. A full thread condenses its
   * oldest messages into the thread's notes and continues.
   */
  async function begin(agent: BoardAgent, model: string, text: string, target = boardId) {
    const thread =
      target === boardId && selected?.agent === agent && selected.model === model ? selected : null;
    const next: BoardChatThread = thread
      ? appendChatMessage(content(thread), { role: 'user', text })
      : { id: crypto.randomUUID(), agent, model, messages: [{ role: 'user', text }] };
    return write(next, thread?.revision ?? 0, target);
  }
  /** Saves the agent's reply, what happened to its answer and its updated notes. */
  async function finish(
    thread: BoardChatEntry,
    reply: { text: string; outcome: ChatOutcome; memory?: string | undefined },
    target = boardId,
  ) {
    const next = appendChatMessage(content(thread), {
      role: 'assistant',
      text: reply.text.slice(0, 4000),
      outcome: reply.outcome,
    });
    return write(
      reply.memory !== undefined ? { ...next, memory: reply.memory } : next,
      thread.revision,
      target,
    );
  }
  /** Records what the reader did with the thread's latest proposal. */
  async function settle(thread: BoardChatEntry, outcome: ChatOutcome, target = boardId) {
    return write(withChatOutcome(content(thread), outcome), thread.revision, target);
  }
  /** Forgets the thread's notes; its messages stay. */
  async function forget() {
    if (!selected) return;
    const next = content(selected);
    delete next.memory;
    try {
      await write(next, selected.revision);
    } catch {
      // `write` already reported the problem.
    }
  }
  async function remove() {
    if (!selected) return;
    try {
      const response = await fetch(`/v1/boards/${boardId}/chat/${selected.id}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Could not delete this thread.');
      if (scope.current !== boardId) return;
      writes.current++;
      setThreads((before) => before.filter((item) => item.id !== selected.id));
      setSelectedId(null);
      setError('');
    } catch {
      if (scope.current === boardId) setError('Could not delete this thread.');
    }
  }
  return {
    threads: visibleThreads,
    selected,
    selectedId: selected?.id ?? null,
    setSelectedId,
    error,
    loading: loading || loadedBoard !== boardId,
    begin,
    finish,
    settle,
    forget,
    remove,
    reload: () => {
      setLoading(true);
      setRefresh((value) => value + 1);
    },
  };
}
