import { useMemo } from 'react';
import { drawingSvg, type BoardDrawing, type DrawingPart, type DrawingScale } from '@opsis/schema';

export type { DrawingPart };

/**
 * One canvas drawing as SVG, in absolute canvas coordinates. The live canvas, the SVG/PNG export
 * and the preview agents see all paint through the shared `drawingSvg`, so they never disagree.
 * Lines and shapes sit beneath the diagram; words (text drawings and dimension labels) are
 * painted above it so arrows and their outlines never hide them. `halo` is the canvas colour
 * painted behind text so labels stay legible over grid lines and arrows. `scale` is the board's
 * drawing scale, in which unlabelled dimension lines read.
 */
export function DrawingShape({
  drawing,
  halo,
  part = 'all',
  scale,
}: {
  drawing: BoardDrawing;
  halo: string;
  part?: DrawingPart;
  scale?: DrawingScale | undefined;
}) {
  const markup = useMemo(
    () => drawingSvg(drawing, { halo, part, ...(scale ? { scale } : {}) }),
    [drawing, halo, part, scale],
  );
  // Escaped by `drawingSvg`: text is written as text, never markup.
  return markup ? <g dangerouslySetInnerHTML={{ __html: markup }} /> : null;
}
