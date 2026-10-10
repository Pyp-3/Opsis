import type { BoardDocument } from './board';
import { boardPage, boardPages } from './board-pages';
export type BoardDifference = { label: string; before: string; after: string };
/**
 * Compare saved documents, including layout and source metadata; never modify either side.
 * Pages are matched by id; a board without pages is compared as the other side's first page.
 */
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
  for (const field of ['title', 'description', 'look'] as const)
    add(field, before?.[field], after?.[field]);
  if (!before?.pages && !after?.pages) {
    comparePage('', before, after, add);
    return differences;
  }
  const firstId = (after?.pages ?? before?.pages)![0]!.id;
  const list = (board: BoardDocument | null) =>
    !board
      ? []
      : board.pages
        ? boardPages(board)
        : [{ id: firstId, title: 'Page 1', hidden: false }];
  const left = list(before);
  const right = list(after);
  const ids = [...new Set([...right.map((page) => page.id), ...left.map((page) => page.id)])];
  for (const id of ids) {
    const was = left.findIndex((page) => page.id === id);
    const is = right.findIndex((page) => page.id === id);
    const name = right[is]?.title ?? left[was]!.title;
    const label = `Page ${(is === -1 ? was : is) + 1} (${name})`;
    const meta = (index: number, pages: typeof left) =>
      index === -1
        ? undefined
        : { number: index + 1, title: pages[index]!.title, hidden: pages[index]!.hidden };
    add(label, meta(was, left), meta(is, right));
    comparePage(
      `${label} · `,
      was === -1 ? null : boardPage(before!, id),
      is === -1 ? null : boardPage(after!, id),
      add,
    );
  }
  return differences;
}

function comparePage(
  prefix: string,
  before: BoardDocument | null | undefined,
  after: BoardDocument | null | undefined,
  add: (label: string, left: unknown, right: unknown) => void,
) {
  for (const field of ['groups', 'pinnedNodeIds'] as const)
    add(`${prefix}${field}`, before?.[field], after?.[field]);
  for (const collection of ['nodes', 'edges'] as const) {
    const left = before?.[collection] ?? [];
    const right = after?.[collection] ?? [];
    for (const id of new Set([...left.map((item) => item.id), ...right.map((item) => item.id)])) {
      add(
        `${prefix}${collection === 'nodes' ? 'Concept' : 'Connection'} ${id}`,
        left.find((item) => item.id === id),
        right.find((item) => item.id === id),
      );
      if (collection === 'nodes')
        add(`${prefix}Position ${id}`, before?.positions[id], after?.positions[id]);
      else add(`${prefix}Ports ${id}`, before?.edgePorts?.[id], after?.edgePorts?.[id]);
    }
  }
}
