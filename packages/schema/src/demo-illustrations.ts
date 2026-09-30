import type { Illustration } from './illustration';

/**
 * Hand-drawn illustrations for the email demo, so the demo agent can show icons evolving into
 * animated pictures without a model call. Keyed by the demo's node IDs.
 */
export const EMAIL_DEMO_ILLUSTRATIONS: Record<string, Illustration> = {
  // A person writes: lines of text appear on the page one after another.
  sender: {
    layers: [
      {
        shape: 'circle',
        cx: 34,
        cy: 34,
        r: 11,
        stroke: 'gold',
        fill: 'none',
        motions: [{ type: 'draw', duration: 0.8, repeat: 'once' }],
      },
      {
        shape: 'path',
        d: 'M14 76 C14 56 54 56 54 76',
        stroke: 'gold',
        fill: 'none',
        motions: [{ type: 'draw', duration: 0.8, delay: 0.2, repeat: 'once' }],
      },
      {
        shape: 'rect',
        x: 58,
        y: 36,
        width: 30,
        height: 42,
        stroke: 'ice',
        fill: 'none',
        motions: [{ type: 'draw', duration: 0.8, delay: 0.4, repeat: 'once' }],
      },
      ...[48, 56, 64].map((y, i) => ({
        shape: 'line' as const,
        x1: 63,
        y1: y,
        x2: 83 - i * 4,
        y2: y,
        stroke: 'sky' as const,
        fill: 'none' as const,
        motions: [
          { type: 'draw' as const, duration: 2.4, delay: 0.9 + i * 0.5, repeat: 'loop' as const },
        ],
      })),
    ],
  },
  // The envelope's flap opens as the letter rises out, ready to send.
  app: {
    layers: [
      {
        shape: 'rect',
        x: 30,
        y: 38,
        width: 40,
        height: 26,
        stroke: 'ice',
        fill: 'none',
        opacity: 0.9,
        motions: [
          {
            type: 'move',
            duration: 2.4,
            repeat: 'loop',
            easing: 'smooth',
            values: [
              [0, 0],
              [0, -16],
              [0, 0],
            ],
          },
        ],
      },
      {
        shape: 'rect',
        x: 20,
        y: 40,
        width: 60,
        height: 40,
        stroke: 'gold',
        fill: 'none',
        motions: [{ type: 'draw', duration: 0.9, repeat: 'once' }],
      },
      {
        shape: 'path',
        d: 'M20 40 L50 62 L80 40',
        stroke: 'gold',
        fill: 'none',
        motions: [
          {
            type: 'morph',
            duration: 2.4,
            repeat: 'loop',
            easing: 'smooth',
            shapes: ['M20 40 L50 62 L80 40', 'M20 40 L50 20 L80 40', 'M20 40 L50 62 L80 40'],
          },
        ],
      },
    ],
  },
  // A rack of servers blinks while a message leaves for the recipient's domain.
  outgoing: {
    layers: [
      ...[20, 42, 64].map((y, i) => ({
        shape: 'rect' as const,
        x: 18,
        y,
        width: 46,
        height: 17,
        stroke: 'ice' as const,
        fill: 'none' as const,
        motions: [
          { type: 'draw' as const, duration: 0.7, delay: i * 0.2, repeat: 'once' as const },
        ],
      })),
      ...[28.5, 50.5, 72.5].map((cy, i) => ({
        shape: 'circle' as const,
        cx: 27,
        cy,
        r: 2.4,
        stroke: 'none' as const,
        fill: 'mint' as const,
        motions: [
          {
            type: 'fade' as const,
            duration: 1.2,
            delay: 0.6 + i * 0.3,
            repeat: 'loop' as const,
            values: [1, 0.2, 1],
          },
        ],
      })),
      {
        shape: 'circle',
        cx: 66,
        cy: 50,
        r: 3.5,
        stroke: 'none',
        fill: 'gold',
        motions: [
          { type: 'along', duration: 1.6, delay: 0.8, repeat: 'loop', path: 'M0 0 L24 0' },
          { type: 'fade', duration: 1.6, delay: 0.8, repeat: 'loop', values: [0, 1, 1, 0] },
        ],
      },
    ],
  },
  // A shield scans the message, then a tick confirms it is accepted.
  incoming: {
    layers: [
      {
        shape: 'path',
        d: 'M50 14 L78 24 L78 48 C78 66 64 78 50 86 C36 78 22 66 22 48 L22 24 Z',
        stroke: 'gold',
        fill: 'none',
        motions: [{ type: 'draw', duration: 1, repeat: 'once' }],
      },
      {
        shape: 'line',
        x1: 30,
        y1: 30,
        x2: 70,
        y2: 30,
        stroke: 'sky',
        fill: 'none',
        opacity: 0.8,
        motions: [
          {
            type: 'move',
            duration: 2.2,
            repeat: 'loop',
            easing: 'smooth',
            values: [
              [0, 0],
              [0, 38],
              [0, 0],
            ],
          },
        ],
      },
      {
        shape: 'path',
        d: 'M37 50 L46 59 L64 40',
        stroke: 'mint',
        fill: 'none',
        strokeWidth: 4,
        motions: [{ type: 'draw', duration: 0.6, delay: 1.3, repeat: 'once' }],
      },
    ],
  },
  // The letter drops into the inbox tray and a notification appears.
  recipient: {
    layers: [
      {
        shape: 'rect',
        x: 38,
        y: 28,
        width: 24,
        height: 16,
        stroke: 'ice',
        fill: 'none',
        motions: [
          {
            type: 'move',
            duration: 2.6,
            repeat: 'loop',
            easing: 'smooth',
            values: [
              [0, -22],
              [0, 20],
              [0, 20],
            ],
          },
          { type: 'fade', duration: 2.6, repeat: 'loop', values: [0, 1, 1, 0] },
        ],
      },
      {
        shape: 'path',
        d: 'M14 58 L28 32 L72 32 L86 58 L86 80 L14 80 Z',
        stroke: 'gold',
        fill: 'none',
        motions: [{ type: 'draw', duration: 0.9, repeat: 'once' }],
      },
      {
        shape: 'path',
        d: 'M14 58 L36 58 L42 66 L58 66 L64 58 L86 58',
        stroke: 'gold',
        fill: 'none',
        motions: [{ type: 'draw', duration: 0.7, delay: 0.4, repeat: 'once' }],
      },
      {
        shape: 'circle',
        cx: 82,
        cy: 28,
        r: 6,
        stroke: 'none',
        fill: 'coral',
        motions: [
          {
            type: 'scale',
            duration: 0.5,
            delay: 1.4,
            repeat: 'once',
            easing: 'smooth',
            values: [0, 1.3, 1],
            origin: [82, 28],
          },
        ],
      },
    ],
  },
};
