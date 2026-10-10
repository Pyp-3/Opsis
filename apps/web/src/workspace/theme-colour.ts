/**
 * Colour arithmetic for the application theme: reading and writing hex colours, mixing, turning
 * hues, and WCAG contrast. Custom accents and accent gradients are derived here so that whatever
 * colour a person picks, text drawn on or in it stays readable.
 */

export type Rgb = readonly [number, number, number];

export const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

export function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  const byte = (channel: number) =>
    Math.round(Math.min(255, Math.max(0, channel)))
      .toString(16)
      .padStart(2, '0');
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours, from 1 to 21. */
export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** `weight` of `a` mixed with the rest of `b`, like CSS `color-mix(in srgb, a weight, b)`. */
export function mix(a: string, b: string, weight: number): string {
  const [x, y] = [hexToRgb(a), hexToRgb(b)];
  return rgbToHex([0, 1, 2].map((i) => x[i]! * weight + y[i]! * (1 - weight)) as unknown as Rgb);
}

type Hsl = [hue: number, saturation: number, lightness: number];

function toHsl(hex: string): Hsl {
  const [r, g, b] = hexToRgb(hex).map((channel) => channel / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];
  const d = max - min;
  const saturation = lightness > 0.5 ? d / (2 - max - min) : d / (max + min);
  const hue =
    max === r
      ? ((g - b) / d + (g < b ? 6 : 0)) * 60
      : max === g
        ? ((b - r) / d + 2) * 60
        : ((r - g) / d + 4) * 60;
  return [hue, saturation, lightness];
}

function fromHsl([hue, saturation, lightness]: Hsl): string {
  const h = (((hue % 360) + 360) % 360) / 360;
  const s = Math.min(1, Math.max(0, saturation));
  const l = Math.min(1, Math.max(0, lightness));
  if (s === 0) return rgbToHex([l * 255, l * 255, l * 255]);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  return rgbToHex([channel(h + 1 / 3) * 255, channel(h) * 255, channel(h - 1 / 3) * 255]);
}

/** Changes lightness by `amount` (−1 to 1), keeping hue and saturation. */
export function shade(hex: string, amount: number): string {
  const [h, s, l] = toHsl(hex);
  return fromHsl([h, s, l + amount]);
}

/** Turns the hue by `degrees`, keeping saturation and lightness. */
export function turnHue(hex: string, degrees: number): string {
  const [h, s, l] = toHsl(hex);
  return fromHsl([h + degrees, s, l]);
}

/**
 * Steps a colour darker (`direction` −1) or lighter (+1) until it reaches `ratio` against every
 * colour in `against`. Black and white are the limits, so the result is the closest colour to
 * the original that passes, or the extreme when nothing does.
 */
export function untilReadable(
  hex: string,
  against: readonly string[],
  ratio: number,
  direction: -1 | 1,
): string {
  let colour = hex;
  for (let step = 0; step < 100; step++) {
    if (against.every((other) => contrast(colour, other) >= ratio)) return colour;
    const next = shade(colour, direction * 0.01);
    // Saturated colours can stall short of black or white; finish by mixing toward the limit.
    colour = next === colour ? mix(direction < 0 ? '#000000' : '#ffffff', colour, 0.05) : next;
  }
  return direction < 0 ? '#000000' : '#ffffff';
}
