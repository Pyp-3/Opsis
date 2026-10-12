/** Private library containers, separate from groups inside a canvas document. */
export type CollectionNode = { id: string; name: string; parentId?: string | null | undefined };

/** Ancestors first, including the selected collection; tolerates stale UI metadata. */
export function collectionPath(collections: readonly CollectionNode[], id: string) {
  const path: CollectionNode[] = [];
  const seen = new Set<string>();
  let current = collections.find((item) => item.id === id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = collections.find((item) => item.id === current!.parentId);
  }
  return path;
}

export function collectionPathLabel(collections: readonly CollectionNode[], id: string) {
  return collectionPath(collections, id)
    .map((item) => item.name)
    .join(' / ');
}

/** SQL NOCASE folds ASCII only; keep name checks identical on both API hosts. */
const nameKey = (name: string) => name.replace(/[A-Z]/g, (char) => char.toLowerCase());

/** The caller supplies only the authenticated owner's collections, inside its transaction. */
export function collectionPlacement(
  collections: readonly CollectionNode[],
  candidate: CollectionNode,
): 'missing' | 'cycle' | 'duplicate' | null {
  const parent = candidate.parentId ?? null;
  if (parent && !collections.some((item) => item.id === parent)) return 'missing';
  if (
    parent === candidate.id ||
    (parent && collectionPath(collections, parent).some((item) => item.id === candidate.id))
  )
    return 'cycle';
  if (
    collections.some(
      (item) =>
        item.id !== candidate.id &&
        (item.parentId ?? null) === parent &&
        nameKey(item.name) === nameKey(candidate.name),
    )
  )
    return 'duplicate';
  return null;
}

/** Children survive deletion beside their former parent. Name conflicts require an explicit move. */
export function collectionDeletion(collections: readonly CollectionNode[], id: string) {
  const removed = collections.find((item) => item.id === id);
  if (!removed) return 'missing' as const;
  const remaining = collections
    .filter((item) => item.id !== id)
    .map((item) => (item.parentId === id ? { ...item, parentId: removed.parentId ?? null } : item));
  return remaining.some((item) => collectionPlacement(remaining, item) === 'duplicate')
    ? ('duplicate' as const)
    : null;
}
