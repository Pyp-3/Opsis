import { useEffect, useRef, useState } from 'react';
import {
  BoardGraphSchema,
  boardChanges,
  terminalExampleFor,
  type BoardAgent,
  type BoardAttachment,
  type BoardDocument,
} from '@opsis/schema';
import { layoutBoard, withoutIllustrations } from './model';
import type { ModelPreferences } from './model-settings';
import {
  agentResponse,
  applyProgress,
  startActivity,
  STREAM_ACCEPT,
  type AgentActivity,
} from './agentActivity';

export function useBoardGeneration(commit: (board: BoardDocument) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [activity, setActivity] = useState<AgentActivity>(startActivity);
  const [review, setReview] = useState<{
    candidate: BoardDocument;
    before: BoardDocument;
    changes: string[];
  } | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  async function generate(
    text: string,
    agent: BoardAgent,
    preferences: ModelPreferences,
    previous: BoardDocument | null,
    selected: string | null,
    attachments: BoardAttachment[] = [],
  ) {
    if (request.current || review) return false;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    setElapsed(0);
    setActivity(startActivity());
    try {
      const example = terminalExampleFor(text, previous, attachments.length > 0);
      if (example) {
        setActivity((current) => ({ ...current, phase: 'arranging' }));
        const candidate = await layoutBoard(
          BoardGraphSchema.parse(example),
          agent,
          previous ?? undefined,
          document.querySelector('.blueprint')?.clientWidth ?? 900,
        );
        if (controller.signal.aborted) return false;
        commit(candidate);
        return true;
      }
      const response = await fetch('/v1/boards/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: STREAM_ACCEPT },
        signal: controller.signal,
        body: JSON.stringify({
          prompt: text,
          agent,
          ...(agent !== 'demo' ? { settings: preferences[agent] } : {}),
          ...(previous ? { board: withoutIllustrations(previous) } : {}),
          ...(selected ? { selectedId: selected } : {}),
          ...(attachments.length ? { attachments } : {}),
        }),
      });
      const {
        ok,
        status,
        body: payload,
      } = await agentResponse(response, (progress) => {
        if (!controller.signal.aborted) setActivity((current) => applyProgress(current, progress));
      });
      const needsReview = status === 409 && previous && payload.candidate;
      if (!ok && !needsReview)
        throw new Error((payload.message as string) ?? 'Could not generate a diagram.');
      setActivity((current) => ({ ...current, phase: 'arranging' }));
      const graph = BoardGraphSchema.parse(needsReview ? payload.candidate : payload);
      const candidate = await layoutBoard(
        graph,
        agent,
        previous ?? undefined,
        document.querySelector('.blueprint')?.clientWidth ?? 900,
      );
      if (controller.signal.aborted) return false;
      if (previous?.nodes.length) {
        const changes = boardChanges(previous, candidate);
        for (const node of graph.nodes) {
          if (!previous.nodes.some((item) => item.id === node.id))
            changes.push(`Add concept: ${node.label}`);
        }
        for (const edge of graph.edges) {
          if (!previous.edges.some((item) => item.id === edge.id))
            changes.push(`Add connection: ${edge.label || edge.id}`);
        }
        setReview({ candidate, before: previous, changes });
      } else commit(candidate);
      return true;
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : 'Could not connect to the agent.');
      return false;
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }
  const cancel = () => {
    request.current?.abort();
    request.current = null;
    setBusy(false);
  };
  return {
    busy,
    setBusy,
    error,
    setError,
    elapsed,
    activity,
    review,
    generate,
    cancel,
    discard: () => setReview(null),
    apply: () => {
      if (review) {
        commit(review.candidate);
        setReview(null);
      }
    },
  };
}
