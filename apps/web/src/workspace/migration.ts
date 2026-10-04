import { BoardDocumentSchema, importLegacyBoard, type BoardDocument } from '@opsis/schema';
import { layoutBoard } from './model';

/** Explicit file import, never overwrites or deletes the legacy source. */
export async function importBoard(value: unknown): Promise<BoardDocument> {
  const current = BoardDocumentSchema.safeParse(value);
  if (current.success)
    return current.data.nodes.some((node) => !current.data.positions[node.id])
      ? layoutBoard(current.data, current.data.agent, current.data)
      : current.data;
  return importLegacyBoard(value);
}
