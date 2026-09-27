import { useState } from 'react';
import type { BoardDocument } from '@opsis/schema';

/** Roots first, following outgoing paths; cycle/disconnected fallback visits every node once. */
export function walkthroughOrder(board: BoardDocument): string[] {
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    board.edges.filter((edge) => edge.source === id).forEach((edge) => visit(edge.target));
  };
  board.nodes
    .filter((node) => !board.edges.some((edge) => edge.target === node.id))
    .forEach((node) => visit(node.id));
  board.nodes.forEach((node) => visit(node.id));
  return [...visited];
}

export function Walkthrough({
  board,
  onSelect,
  disabled,
}: {
  board: BoardDocument;
  onSelect: (id: string) => void;
  disabled: boolean;
}) {
  const [step, setStep] = useState<number | null>(null);
  const order = walkthroughOrder(board);
  const index = Math.min(step ?? 0, order.length - 1);
  const node = board.nodes.find((item) => item.id === order[index]);
  const go = (next: number) => {
    setStep(next);
    onSelect(order[next]!);
  };
  return (
    <div className="walkthrough" aria-label="Guided walkthrough">
      {step === null ? (
        <button disabled={disabled || !order.length} onClick={() => go(0)}>
          Start walkthrough
        </button>
      ) : (
        <>
          <button disabled={disabled || index === 0} onClick={() => go(index - 1)}>
            Previous concept
          </button>
          <span aria-live="polite">
            {index + 1}/{order.length}: {node?.label}
          </span>
          <button disabled={disabled || index === order.length - 1} onClick={() => go(index + 1)}>
            Next concept
          </button>
          <button onClick={() => setStep(null)}>End walkthrough</button>
        </>
      )}
    </div>
  );
}
