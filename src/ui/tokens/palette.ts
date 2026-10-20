/**
 * Raw reference palette — the five supplied reference boards.
 * Components must NOT import this directly; use semantic tokens instead.
 *
 * Hex values printed on the boards are used verbatim. Boards 2 and 3 print no
 * hex codes, so those swatches were sampled from the supplied images.
 */
export const palette = {
  // Board 1 — "iPhone 18 inspired" (printed hex)
  burgundy: '#5A1F2E',
  bronzedWine: '#7A3B49',
  roseBlush: '#D8B8BE',
  cloudWhite: '#F6F2EF',
  graphite: '#3F383D',

  // Board 4 — "Romantic Mauve" (printed hex)
  blushPink: '#F2D7DC',
  dustyRose: '#D49AAE',
  mauveWood: '#A8788E',
  deepPlum: '#6B4A5E',
  mulberry: '#3E2A3A',

  // Board 5 — champagne / rose gold / black cherry (printed hex)
  champagne: '#EFE1CE',
  roseGold: '#B9857C',
  blackCherry: '#721D35',
  blackCherryDark: '#42121F',
  nearBlack: '#1C0B12',

  // Board 2 — "Soft Elegance" (sampled from image)
  vanillaCream: '#E7DAD0',
  warmOat: '#CFBFB2',
  sageLeafSoft: '#817F6C',
  blushPetal: '#C39F93',
  espresso: '#302B28',

  // Board 3 — "Burgundy Bloom" (sampled from image)
  bloomBurgundy: '#37121A',
  roseDust: '#9A5D64',
  softIvory: '#D6C5B5',
  sageLeafDeep: '#626355',
  deepMocha: '#2C2724',
} as const;

/**
 * Functional colours that are NOT on the reference boards. A safety app needs
 * an unmistakable emergency red, and amber/green status colours that stay
 * readable; the boards' burgundies are too close to each other for that.
 * Each is derived from the nearest board hue and tuned to pass WCAG AA.
 */
export const functional = {
  emergencyLight: '#B4173F', // black cherry, lifted for separation from burgundy
  emergencyDark: '#C81E4A',
  dangerTextDark: '#FF7A93',
  successLight: '#3F5E3C', // sage family, darkened
  successDark: '#A9C4A0',
  warningLight: '#7A4F0F', // bronze family
  warningDark: '#E0B15A',
  infoDark: '#C9A3B6',
  surfaceDark: '#2A1019', // near black + ~40% black-cherry dark
  white: '#FFFFFF',
} as const;
