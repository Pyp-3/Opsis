import { apiFetch as fetch } from '../app-url';
import {
  BoardTurnSchema,
  ReportedUsageSchema,
  applyFocusEdits,
  type BoardTurn,
  type ChatFocus,
  type ChatPriority,
  type ConversationMessage,
  type ReportedUsage,
} from '@opsis/schema';
import { recordReportedUsage } from './reported-usage';
import { useEffect, useRef, useState, type RefObject } from 'react';
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

export function useBoardGeneration(
  commit: (board: BoardDocument) => void,
  /** The board usage is recorded against. */
  boardIdRef?: RefObject<string | undefined>,
) {
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
  const responseText = useRef('');
  /** The chat parts of the latest answer: the agent's reply and its updated notes. */
  const turn = useRef<BoardTurn | null>(null);
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
    chat: {
      conversation?: ConversationMessage[];
      memory?: string | undefined;
      thread?: string;
      focus?: ChatFocus | undefined;
      priority?: ChatPriority;
    } = {},
  ) {
    const conversation = chat.conversation ?? [];
    if (request.current || review) return false;
    const usages: ReportedUsage[] = [];
    let called = false;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    responseText.current = '';
    turn.current = null;
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
          document.querySelector('.blueprint')?.clientWidth || 900,
        );
        if (controller.signal.aborted) return false;
        commit(candidate);
        responseText.current = `${candidate.title}\n${candidate.description}`;
        return 'applied' as const;
      }
      called = true;
      const response = await fetch('/v1/boards/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: STREAM_ACCEPT },
        signal: controller.signal,
        body: JSON.stringify({
          prompt: text,
          ...(conversation.length ? { conversation: conversation.slice(-12) } : {}),
          ...(chat.memory ? { memory: chat.memory } : {}),
          ...(chat.thread ? { thread: chat.thread } : {}),
          ...(chat.focus && previous ? { focus: chat.focus } : {}),
          ...(chat.priority ? { priority: chat.priority } : {}),
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
        if (progress.type === 'usage') {
          const parsed = ReportedUsageSchema.safeParse(progress.usage);
          if (parsed.success) usages.push(parsed.data);
        }
        if (!controller.signal.aborted) setActivity((current) => applyProgress(current, progress));
      });
      const needsReview = status === 409 && previous && payload.candidate;
      if (!ok && !needsReview)
        throw new Error((payload.message as string) ?? 'Could not generate a diagram.');
      setActivity((current) => ({ ...current, phase: 'arranging' }));
      // The chat parts travel beside the diagram.
      const answer = {
        ...((needsReview ? payload.candidate : payload) as Record<string, unknown>),
      };
      const parsedTurn = BoardTurnSchema.safeParse(payload.turn ?? answer.turn);
      delete answer.turn;
      const graph = BoardGraphSchema.parse(answer);
      const laidOut = await layoutBoard(
        graph,
        agent,
        previous ?? undefined,
        document.querySelector('.blueprint')?.clientWidth || 900,
      );
      if (controller.signal.aborted) return false;
      turn.current = parsedTurn.success ? parsedTurn.data : null;
      // Edits to the reader's focused drawings always go through review.
      const focusIds = new Set((chat.focus?.drawings ?? []).map((drawing) => drawing.id));
      const focusEdits = turn.current?.focusEdits;
      const candidate = applyFocusEdits(
        laidOut,
        focusIds,
        focusEdits,
        new Set(laidOut.nodes.map((node) => node.id)),
      );
      const editsFocus =
        !!focusEdits && (focusEdits.update.length > 0 || focusEdits.remove.length > 0);
      const reviewing = !!previous && (previous.nodes.length > 0 || editsFocus);
      // The agent's own reply when it gave one, then where to find the result.
      responseText.current = `${turn.current?.reply ?? `${candidate.title}\n${candidate.description}`}\n${reviewing ? 'A proposal is ready for review on Canvas.' : 'The diagram is ready on Canvas.'}`;
      if (reviewing && previous) {
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
        return 'review' as const;
      }
      commit(candidate);
      return 'applied' as const;
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : 'Could not connect to the agent.');
      return false;
    } finally {
      if (called && agent !== 'demo')
        recordReportedUsage(
          agent,
          preferences[agent],
          usages,
          'diagram',
          boardIdRef?.current ?? undefined,
        );
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
    responseText,
    turn,
    cancel,
    discard: () => setReview(null),
    apply: (accepted: BoardDocument) => {
      if (review) {
        commit(accepted);
        setReview(null);
      }
    },
  };
}
