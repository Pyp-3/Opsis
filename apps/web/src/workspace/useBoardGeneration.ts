import { useEffect, useRef, useState } from 'react';
import {
  BoardGraphSchema,
  type BoardAgent,
  type BoardAttachment,
  type BoardDocument,
} from '@opsis/schema';
import { layoutBoard } from './model';
import type { ModelPreferences } from './model-settings';

export function useBoardGeneration(commit: (board: BoardDocument) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [stage, setStage] = useState('');
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
    setStage(
      attachments.length
        ? `Agent is reading ${attachments.length} document${attachments.length > 1 ? 's' : ''}; validating output may include one repair attempt`
        : 'Waiting for agent; validating output may include one repair attempt',
    );
    try {
      const response = await fetch('/v1/boards/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          prompt: text,
          agent,
          ...(agent !== 'demo' ? { settings: preferences[agent] } : {}),
          ...(previous ? { board: previous } : {}),
          ...(selected ? { selectedId: selected } : {}),
          ...(attachments.length ? { attachments } : {}),
        }),
      });
      const payload = await response.json();
      const needsReview = response.status === 409 && previous && payload.candidate;
      if (!response.ok && !needsReview)
        throw new Error(payload.message ?? 'Could not generate a diagram.');
      setStage('Validating and arranging concepts');
      const graph = BoardGraphSchema.parse(needsReview ? payload.candidate : payload);
      const candidate = await layoutBoard(
        graph,
        agent,
        previous ?? undefined,
        document.querySelector('.blueprint')?.clientWidth ?? 900,
      );
      if (controller.signal.aborted) return false;
      if (needsReview) setReview({ candidate, before: previous, changes: payload.changes });
      else commit(candidate);
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
    setStage('');
  };
  return {
    busy,
    setBusy,
    error,
    setError,
    elapsed,
    stage,
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
