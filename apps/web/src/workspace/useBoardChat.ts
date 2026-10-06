import { useEffect, useRef, useState } from 'react';
import {
  BoardChatEntrySchema,
  type BoardAgent,
  type BoardChatEntry,
  type BoardChatThread,
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
  async function begin(agent: BoardAgent, model: string, text: string, target = boardId) {
    const thread =
      target === boardId && selected?.agent === agent && selected.model === model ? selected : null;
    if (thread && thread.messages.length > 78)
      throw new Error('This thread is full. Start a new thread.');
    return write(
      {
        id: thread?.id ?? crypto.randomUUID(),
        agent,
        model,
        messages: [...(thread?.messages ?? []), { role: 'user', text }],
      },
      thread?.revision ?? 0,
      target,
    );
  }
  async function finish(thread: BoardChatEntry, text: string, target = boardId) {
    const { revision, id, agent, model, messages } = thread;
    const content = { id, agent, model, messages };
    await write(
      {
        ...content,
        messages: [...content.messages, { role: 'assistant', text: text.slice(0, 4000) }],
      },
      revision,
      target,
    );
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
    remove,
    reload: () => {
      setLoading(true);
      setRefresh((value) => value + 1);
    },
  };
}
