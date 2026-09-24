/**
 * Design tokens (PROMPT.md §9 style, §12.2). Two palettes share one token vocabulary:
 * `default` is the friendly flat palette; `colorBlindSafe` maps every token onto the
 * Okabe–Ito set so hue pairs stay distinguishable under protan/deutan/tritan vision.
 * Colour is never the only carrier of meaning: labels, badges and outlines carry it too.
 */
export const COLOR_TOKENS = [
  'celestial.sun',
  'celestial.moon',
  'celestial.earth',
  'nature.sky',
  'nature.water',
  'nature.leaf',
  'nature.wood',
  'nature.rock',
  'nature.ground',
  'nature.cloud',
  'food.bread',
  'food.crust',
  'food.ham',
  'food.tomato',
  'food.fruit',
  'food.generic',
  'struct.container',
  'struct.frame',
  'struct.layer',
  'people.skin',
  'people.cloth',
  'flow.arrow',
  'flow.ring',
  'measure.bar',
  'measure.metal',
  'direction.dial',
  'direction.north',
  'direction.mark',
  'ui.card',
  'ui.cardText',
  'ui.accent',
  'ui.highlight',
  'ui.outline',
  'ui.optional',
  'ui.background',
  'ui.surface',
  'ui.text',
  'ui.textMuted',
] as const;

/** A semantic colour name, e.g. `food.tomato`. */
export type ColorToken = (typeof COLOR_TOKENS)[number];

/** A complete token → hex colour mapping. */
export type Palette = Readonly<Record<ColorToken, string>>;

/** Identifier of a shipped palette. */
export type PaletteId = 'default' | 'colorBlindSafe';

/** Okabe–Ito reference colours (Okabe & Ito 2008), public-domain values. */
export const OKABE_ITO = {
  black: '#000000',
  orange: '#E69F00',
  skyBlue: '#56B4E9',
  bluishGreen: '#009E73',
  yellow: '#F0E442',
  blue: '#0072B2',
  vermillion: '#D55E00',
  reddishPurple: '#CC79A7',
} as const;

const shared = {
  'ui.card': '#FFFFFF',
  'ui.cardText': '#1B1F24',
  'ui.background': '#F4F1EA',
  'ui.surface': '#FFFFFF',
  'ui.text': '#1B1F24',
  'ui.textMuted': '#4A5360',
  'ui.outline': '#2B3440',
  'nature.cloud': '#F7F7F7',
  'measure.metal': '#8A96A3',
  'direction.dial': '#EDE6D6',
} as const satisfies Partial<Record<ColorToken, string>>;

const defaultPalette: Palette = {
  ...shared,
  'celestial.sun': '#F5B82E',
  'celestial.moon': '#D9DCE3',
  'celestial.earth': '#3F7FBF',
  'nature.sky': '#9CCBEA',
  'nature.water': '#3F8FD0',
  'nature.leaf': '#4E9A55',
  'nature.wood': '#8A5A3B',
  'nature.rock': '#8C8F94',
  'nature.ground': '#B89B6E',
  'food.bread': '#E9C27D',
  'food.crust': '#B97A3C',
  'food.ham': '#E89AA6',
  'food.tomato': '#D9402B',
  'food.fruit': '#E0662F',
  'food.generic': '#C9B38A',
  'struct.container': '#7FA7C9',
  'struct.frame': '#5E6B7A',
  'struct.layer': '#A9B8C8',
  'people.skin': '#C8A07E',
  'people.cloth': '#4F7CAC',
  'flow.arrow': '#2F6DB5',
  'flow.ring': '#6C8EBF',
  'measure.bar': '#3E8E9B',
  'direction.north': '#C8412F',
  'direction.mark': '#3A4450',
  'ui.accent': '#1F6FD1',
  'ui.highlight': '#E69F00',
  'ui.optional': '#6B4FA0',
};

const colorBlindSafePalette: Palette = {
  ...shared,
  'celestial.sun': OKABE_ITO.yellow,
  'celestial.moon': '#D9DCE3',
  'celestial.earth': OKABE_ITO.blue,
  'nature.sky': OKABE_ITO.skyBlue,
  'nature.water': OKABE_ITO.blue,
  'nature.leaf': OKABE_ITO.bluishGreen,
  'nature.wood': '#7A5230',
  'nature.rock': '#8C8F94',
  'nature.ground': '#B89B6E',
  'food.bread': '#F2D39A',
  'food.crust': OKABE_ITO.orange,
  'food.ham': OKABE_ITO.reddishPurple,
  'food.tomato': OKABE_ITO.vermillion,
  'food.fruit': OKABE_ITO.orange,
  'food.generic': '#C9B38A',
  'struct.container': OKABE_ITO.skyBlue,
  'struct.frame': '#5E6B7A',
  'struct.layer': '#A9B8C8',
  'people.skin': '#C8A07E',
  'people.cloth': OKABE_ITO.blue,
  'flow.arrow': OKABE_ITO.blue,
  'flow.ring': OKABE_ITO.skyBlue,
  'measure.bar': OKABE_ITO.bluishGreen,
  'direction.north': OKABE_ITO.vermillion,
  'direction.mark': '#3A4450',
  'ui.accent': OKABE_ITO.blue,
  'ui.highlight': OKABE_ITO.orange,
  'ui.optional': OKABE_ITO.reddishPurple,
};

/** All shipped palettes by id. */
export const PALETTES: Readonly<Record<PaletteId, Palette>> = {
  default: defaultPalette,
  colorBlindSafe: colorBlindSafePalette,
};

/** Narrows an arbitrary string (e.g. an OSG `style.colorToken`) to a known token. */
export function isColorToken(value: string): value is ColorToken {
  return (COLOR_TOKENS as readonly string[]).includes(value);
}

/** Resolves a token (or unknown string, falling back to `fallback`) to a hex colour. */
export function resolveColor(
  token: string | undefined,
  fallback: ColorToken,
  paletteId: PaletteId = 'default',
): string {
  const palette = PALETTES[paletteId];
  return token !== undefined && isColorToken(token) ? palette[token] : palette[fallback];
}

/** Emits the palette as CSS custom properties, e.g. `--opsis-food-tomato`. */
export function cssVariables(paletteId: PaletteId = 'default'): Record<string, string> {
  const palette = PALETTES[paletteId];
  return Object.fromEntries(
    COLOR_TOKENS.map((token) => [`--opsis-${token.replace('.', '-')}`, palette[token]]),
  );
}
