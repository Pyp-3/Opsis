import { z } from 'zod';

/**
 * Illustrations are small animated drawings an agent makes for an object, which the process
 * player shows in place of its icon: the icon "evolves" into a picture of the thing happening
 * (wind streaming past, a seed sprouting). They are declarative data, never raw SVG, so a
 * model cannot inject markup or scripts; the app draws them on a 100 × 100 canvas.
 *
 * A layer's own attributes are its resting picture, shown when motion is off or reduced.
 * Motions animate around that picture.
 */

/** Named inks that read on the blueprint; the app maps them to exact colours. */
export const ILLUSTRATION_INKS = [
  'ink',
  'gold',
  'sky',
  'amber',
  'violet',
  'coral',
  'mint',
  'rose',
  'ice',
] as const;
export type IllustrationInk = (typeof ILLUSTRATION_INKS)[number];

export const MAX_ILLUSTRATION_LAYERS = 14;
export const MAX_LAYER_MOTIONS = 3;

/** Absolute or relative SVG path commands and numbers only, starting with a move. */
const PATH_DATA = /^\s*[Mm][MmLlHhVvCcSsQqTtAaZz0-9.,\s-]*$/u;
const pathData = z.string().max(700).regex(PATH_DATA, 'Use SVG path commands and numbers only.');
/** The command letters of a path; morphing only works between paths that share them. */
export const pathSignature = (d: string) => d.replace(/[^A-Za-z]/gu, '');

const coordinate = z.number().finite().min(-50).max(150);
const size = z.number().finite().min(0).max(200);

export const IllustrationMotionSchema = z
  .object({
    /**
     * draw: the stroke draws itself in. move: offsets by [dx, dy] keyframes. rotate: degrees
     * about `origin`. scale: factors about `origin`. fade: opacity keyframes. along: travels
     * `path` (relative to where the layer rests). morph: path keyframes with the same commands.
     */
    type: z.enum(['draw', 'move', 'rotate', 'scale', 'fade', 'along', 'morph']),
    /** Seconds for one pass. */
    duration: z.number().finite().min(0.2).max(12),
    /** Seconds after the object appears before this motion starts. */
    delay: z.number().finite().min(0).max(12).optional(),
    repeat: z.enum(['once', 'loop']),
    easing: z.enum(['linear', 'smooth']).optional(),
    /** Numbers for rotate, scale and fade; [dx, dy] pairs for move. */
    values: z
      .array(z.union([z.number().finite().min(-720).max(720), z.tuple([coordinate, coordinate])]))
      .min(2)
      .max(8)
      .optional(),
    origin: z.tuple([coordinate, coordinate]).optional(),
    path: pathData.optional(),
    shapes: z.array(pathData).min(2).max(6).optional(),
  })
  .strict();

export const IllustrationLayerSchema = z
  .object({
    shape: z.enum(['path', 'circle', 'ellipse', 'rect', 'line']),
    d: pathData.optional(),
    cx: coordinate.optional(),
    cy: coordinate.optional(),
    r: size.optional(),
    rx: size.optional(),
    ry: size.optional(),
    x: coordinate.optional(),
    y: coordinate.optional(),
    width: size.optional(),
    height: size.optional(),
    x1: coordinate.optional(),
    y1: coordinate.optional(),
    x2: coordinate.optional(),
    y2: coordinate.optional(),
    stroke: z.enum([...ILLUSTRATION_INKS, 'none']),
    fill: z.enum([...ILLUSTRATION_INKS, 'none']),
    strokeWidth: z.number().finite().min(0).max(8).optional(),
    opacity: z.number().finite().min(0).max(1).optional(),
    motions: z.array(IllustrationMotionSchema).max(MAX_LAYER_MOTIONS).optional(),
  })
  .strict();

const REQUIRED: Record<z.infer<typeof IllustrationLayerSchema>['shape'], readonly string[]> = {
  path: ['d'],
  circle: ['cx', 'cy', 'r'],
  ellipse: ['cx', 'cy', 'rx', 'ry'],
  rect: ['x', 'y', 'width', 'height'],
  line: ['x1', 'y1', 'x2', 'y2'],
};

type Layer = z.infer<typeof IllustrationLayerSchema>;
type Motion = z.infer<typeof IllustrationMotionSchema>;

function motionProblem(layer: Layer, motion: Motion): string | null {
  const numbers = motion.values?.every((value) => typeof value === 'number');
  const pairs = motion.values?.every((value) => Array.isArray(value));
  switch (motion.type) {
    case 'draw':
      return layer.stroke === 'none' ? 'A draw motion needs a stroked layer.' : null;
    case 'move':
      return pairs ? null : 'A move motion needs [dx, dy] values.';
    case 'rotate':
    case 'scale':
      if (!numbers) return `A ${motion.type} motion needs number values.`;
      if (!motion.origin) return `A ${motion.type} motion needs an origin.`;
      return motion.type === 'scale' && motion.values!.some((value) => (value as number) < 0)
        ? 'Scale values cannot be negative.'
        : null;
    case 'fade':
      return numbers &&
        motion.values!.every((value) => (value as number) >= 0 && (value as number) <= 1)
        ? null
        : 'A fade motion needs opacities between 0 and 1.';
    case 'along':
      return motion.path ? null : 'An along motion needs a path.';
    case 'morph':
      if (layer.shape !== 'path' || !layer.d || !motion.shapes)
        return 'A morph motion needs a path layer and shapes.';
      return motion.shapes.every((shape) => pathSignature(shape) === pathSignature(layer.d!))
        ? null
        : 'Morph shapes must use the same path commands, in the same order, as the layer.';
  }
}

export const IllustrationSchema = z
  .object({
    layers: z.array(IllustrationLayerSchema).min(1).max(MAX_ILLUSTRATION_LAYERS),
  })
  .strict()
  .superRefine((illustration, context) => {
    illustration.layers.forEach((layer, index) => {
      const missing = REQUIRED[layer.shape].filter(
        (key) => layer[key as keyof Layer] === undefined,
      );
      if (missing.length)
        context.addIssue({
          code: 'custom',
          path: ['layers', index],
          message: `A ${layer.shape} needs ${missing.join(', ')}.`,
        });
      for (const motion of layer.motions ?? []) {
        const problem = motionProblem(layer, motion);
        if (problem)
          context.addIssue({ code: 'custom', path: ['layers', index], message: problem });
      }
    });
  });
export type Illustration = z.infer<typeof IllustrationSchema>;
export type IllustrationLayer = Layer;
export type IllustrationMotion = Motion;
