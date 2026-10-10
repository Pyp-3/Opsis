import { z } from 'zod';
import {
  AgentDrawingSchema,
  DrawingIdSchema,
  MAX_AGENT_DRAWINGS,
  type AgentDrawing,
} from './board-drawings';

/**
 * Changes to a chat agent's own sketch, so a follow-up sends only what changed instead of the
 * whole sketch again. `put` adds a drawing or replaces the one with its id; `remove` deletes by
 * id. The host applies them to the sketch the agent was shown and reviews the resulting sketch
 * exactly as if the agent had returned it whole.
 */
export const SketchEditsSchema = z
  .object({
    put: z
      .array(AgentDrawingSchema)
      .max(MAX_AGENT_DRAWINGS)
      .describe('Drawings to add, or to replace complete by their id.'),
    remove: z
      .array(DrawingIdSchema)
      .max(MAX_AGENT_DRAWINGS)
      .describe('Ids of your sketch drawings to delete.'),
  })
  .strict();
export type SketchEdits = z.infer<typeof SketchEditsSchema>;

/** Applies edits in order: replacements keep their place, new drawings go last. */
export function applySketchEdits(
  current: readonly AgentDrawing[],
  edits: SketchEdits,
): { drawings: AgentDrawing[]; problems: [] } | { drawings: null; problems: string[] } {
  const problems: string[] = [];
  const existing = new Set(current.map((drawing) => drawing.id));
  const put = new Map<string, AgentDrawing>();
  for (const drawing of edits.put) {
    if (put.has(drawing.id)) problems.push(`sketchEdits.put names ${drawing.id} twice.`);
    put.set(drawing.id, drawing);
  }
  const removed = new Set(edits.remove);
  const unknown = edits.remove.filter((id) => !existing.has(id));
  if (unknown.length)
    problems.push(
      `sketchEdits.remove may only name drawings in your sketch; ${unknown.slice(0, 5).join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not in it.`,
    );
  const both = [...removed].filter((id) => put.has(id));
  if (both.length)
    problems.push(`sketchEdits cannot both put and remove ${both.slice(0, 5).join(', ')}.`);
  const drawings = [
    ...current.flatMap((drawing) =>
      removed.has(drawing.id) ? [] : [put.get(drawing.id) ?? drawing],
    ),
    ...[...put.values()].filter((drawing) => !existing.has(drawing.id)),
  ];
  if (drawings.length > MAX_AGENT_DRAWINGS)
    problems.push(
      `A sketch holds at most ${MAX_AGENT_DRAWINGS} drawings; these edits make ${drawings.length}.`,
    );
  return problems.length ? { drawings: null, problems } : { drawings, problems: [] };
}
