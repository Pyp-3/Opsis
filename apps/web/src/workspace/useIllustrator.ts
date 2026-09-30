import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { IllustrateResponseSchema, type BoardAgent, type BoardDocument } from '@opsis/schema';
import type { ModelPreferences } from './model-settings';
import { withoutIllustrations } from './model';

/**
 * Asks an agent to draw animated illustrations for a board's objects. It runs beside playback
 * rather than blocking it: icons evolve into their drawings as soon as they arrive. Objects
 * without a drawing are drawn first; when every object has one, all are redrawn.
 */
export function useIllustrator(
  boardRef: RefObject<BoardDocument | null>,
  /** Applied through the board's setter, so a drawing arriving mid-drag joins that drag's edit. */
  update: (change: (board: BoardDocument | null) => BoardDocument | null) => void,
) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [elapsed, setElapsed] = useState(0);
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
      const controller = new AbortController();
      request.current = controller;
      const missing = board.nodes.filter((node) => !node.illustration);
      const wanted = missing.length ? missing : board.nodes;
      // A drawing depicts an icon; if the reader swaps the icon meanwhile, it no longer fits.
      const icons = new Map(wanted.map((node) => [node.id, node.icon]));
      setBusy(true);
      setElapsed(0);
      setMessage('');
      try {
        const response = await fetch('/v1/boards/illustrate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            agent,
            ...(agent !== 'demo' ? { settings: preferences[agent] } : {}),
            board: withoutIllustrations(board),
            nodeIds: wanted.map((node) => node.id),
          }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message ?? 'Could not draw illustrations.');
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
        if (request.current === controller) {
          request.current = null;
          setBusy(false);
        }
      }
    },
    [boardRef, update],
  );
  const cancel = useCallback(() => {
    request.current?.abort();
    request.current = null;
    setBusy(false);
    setMessage('');
  }, []);
  return { busy, message, elapsed, illustrate, cancel };
}
