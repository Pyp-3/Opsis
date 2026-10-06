import { ReportedUsageSchema, type ReportedUsage } from '@opsis/schema';
import { recordReportedUsage } from './reported-usage';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { IllustrateResponseSchema, type BoardAgent, type BoardDocument } from '@opsis/schema';
import type { ModelPreferences } from './model-settings';
import { withoutIllustrations } from './model';
import {
  agentResponse,
  applyProgress,
  startActivity,
  STREAM_ACCEPT,
  type AgentActivity,
} from './agentActivity';

/**
 * Asks an agent to draw animated illustrations for a board's objects. It runs beside playback
 * rather than blocking it: icons evolve into their drawings as soon as they arrive. Objects
 * without a drawing are drawn first; when every object has one, all are redrawn.
 */
export function useIllustrator(
  boardRef: RefObject<BoardDocument | null>,
  /** Applied through the board's setter, so a drawing arriving mid-drag joins that drag's edit. */
  update: (change: (board: BoardDocument | null) => BoardDocument | null) => void,
  /** The board usage is recorded against. */
  boardIdRef?: RefObject<string | undefined>,
) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [activity, setActivity] = useState<AgentActivity>(startActivity);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  const illustrate = useCallback(
    async (agent: BoardAgent, preferences: ModelPreferences) => {
      const board = boardRef.current;
      if (!board?.nodes.length || request.current) return;
      const usages: ReportedUsage[] = [];
      let called = false;
      const controller = new AbortController();
      request.current = controller;
      const missing = board.nodes.filter((node) => !node.illustration);
      const wanted = missing.length ? missing : board.nodes;
      // A drawing depicts an icon; if the reader swaps the icon meanwhile, it no longer fits.
      const icons = new Map(wanted.map((node) => [node.id, node.icon]));
      setBusy(true);
      setElapsed(0);
      setMessage('');
      setActivity(startActivity());
      try {
        called = true;
        const response = await fetch('/v1/boards/illustrate', {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: STREAM_ACCEPT },
          signal: controller.signal,
          body: JSON.stringify({
            agent,
            ...(agent !== 'demo' ? { settings: preferences[agent] } : {}),
            board: withoutIllustrations(board),
            nodeIds: wanted.map((node) => node.id),
          }),
        });
        const { ok, body: payload } = await agentResponse(response, (progress) => {
          if (progress.type === 'usage') {
            const parsed = ReportedUsageSchema.safeParse(progress.usage);
            if (parsed.success) usages.push(parsed.data);
          }
          if (!controller.signal.aborted)
            setActivity((current) => applyProgress(current, progress));
        });
        if (!ok) throw new Error((payload.message as string) ?? 'Could not draw illustrations.');
        const { illustrations, skipped } = IllustrateResponseSchema.parse(payload);
        if (controller.signal.aborted) return;
        let drawn = 0;
        update((latest) => {
          if (!latest) return latest;
          const nodes = latest.nodes.map((node) => {
            const illustration = illustrations[node.id];
            if (!illustration || icons.get(node.id) !== node.icon) return node;
            drawn++;
            return { ...node, illustration };
          });
          return drawn ? { ...latest, nodes } : latest;
        });
        setMessage(
          drawn
            ? `Drew ${drawn} illustration${drawn > 1 ? 's' : ''}${skipped.length ? `; ${skipped.length} kept ${skipped.length > 1 ? 'their icons' : 'its icon'}` : ''}.`
            : 'The agent’s drawings could not be used; the icons are unchanged.',
        );
      } catch (e) {
        if (!controller.signal.aborted)
          setMessage(e instanceof Error ? e.message : 'Could not connect to the agent.');
      } finally {
        if (called && agent !== 'demo')
          recordReportedUsage(
            agent,
            preferences[agent],
            usages,
            'illustration',
            boardIdRef?.current ?? undefined,
          );
        if (request.current === controller) {
          request.current = null;
          setBusy(false);
        }
      }
    },
    [boardRef, update, boardIdRef],
  );
  const cancel = useCallback(() => {
    request.current?.abort();
    request.current = null;
    setBusy(false);
    setMessage('');
  }, []);
  return { busy, message, elapsed, activity, illustrate, cancel };
}
