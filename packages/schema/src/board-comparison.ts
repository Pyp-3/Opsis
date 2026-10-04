import type { BoardDocument } from './board';
export type BoardDifference = { label: string; before: string; after: string };
/** Compare saved documents, including layout and source metadata; never modify either side. */
export function compareBoards(
  before: BoardDocument | null,
  after: BoardDocument | null,
): BoardDifference[] {
  const differences: BoardDifference[] = [];
  const show = (value: unknown) =>
    value === undefined
      ? '(absent)'
      : typeof value === 'string'
        ? value
        : JSON.stringify(value, null, 2);
  function add(label: string, left: unknown, right: unknown) {
    if (JSON.stringify(left) !== JSON.stringify(right))
      differences.push({ label, before: show(left), after: show(right) });
  }
  for (const field of ['title', 'description', 'groups', 'look', 'pinnedNodeIds'] as const)
    add(field, before?.[field], after?.[field]);
  for (const collection of ['nodes', 'edges'] as const) {
    const left = before?.[collection] ?? [];
    const right = after?.[collection] ?? [];
    for (const id of new Set([...left.map((item) => item.id), ...right.map((item) => item.id)])) {
      add(
        `${collection === 'nodes' ? 'Concept' : 'Connection'} ${id}`,
        left.find((item) => item.id === id),
        right.find((item) => item.id === id),
      );
      if (collection === 'nodes')
        add(`Position ${id}`, before?.positions[id], after?.positions[id]);
      else add(`Ports ${id}`, before?.edgePorts?.[id], after?.edgePorts?.[id]);
    }
  }
  return differences;
}
