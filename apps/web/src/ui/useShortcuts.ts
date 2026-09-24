import { useEffect } from 'react';
import { useSessionStore } from '../state/context';

/** True when a key event comes from a text field, where shortcuts must not fire. */
export function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) &&
    !(target instanceof HTMLInputElement && /^(checkbox|radio|button)$/.test(target.type))
  );
}

/** The node a key acts on: the focused node control, else the selected node. */
function targetNode(selectedId: string | null): string | null {
  const focused = document.activeElement?.closest<HTMLElement>('[data-node-id]');
  return focused?.dataset.nodeId ?? selectedId;
}

/**
 * Global diagram shortcuts (PROMPT.md §12.2): `E` explode/assemble, `O` open (drill down),
 * Backspace up one breadcrumb, Escape close the panel. Enter / Shift+Enter live on the node
 * controls themselves.
 */
export function useShortcuts(): void {
  const store = useSessionStore();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const state = store.getState();
      if (state.trail.length === 0) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (key === 'e') {
        state.toggleExplode();
      } else if (key === 'o') {
        const nodeId = targetNode(state.selectedId);
        if (nodeId) state.open(nodeId);
      } else if (key === 'Backspace') {
        e.preventDefault();
        state.goUp();
      } else if (key === 'Escape' && state.selectedId) {
        state.select(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store]);
}
