// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// See ADDITIONAL-TERMS.md for the section 7(b) attribution requirement.
//
// Weald — every colour that carries meaning, in one place so it can be MEASURED.
//
// "Screenshot it and look" cannot see an invisible game piece. A square drawn in the right cell, at
// the right size, in nearly the colour of its background passes every geometry check there is, and
// on a moody palette it reads as atmosphere. So the numbers are asserted in tests/contrast.test.ts
// rather than admired.
//
// SIX TERRAINS CAN NEVER BE MUTUALLY 3:1. n colours each 3:1 from the next need a luminance span of
// 3^(n-1) — for six that is 243 — and sRGB's widest possible span is 21. Three is the hard ceiling,
// and three of these six (Grove, Tilth, Steading) additionally collapse toward one another for a
// deuteranope. That is arithmetic, not an excuse, and the contrast test asserts the arithmetic
// rather than pretending the gate was met. What the game does instead: every terrain carries a
// GLYPH, printed in every cell, and the glyph is the primary channel. A greyscale screenshot of a
// finished map still reads correctly, and so does one seen with any of the three dichromacies.
//
// What IS gated, at 3:1 and 4.5:1 respectively: every terrain fill against every surface it can sit
// on, and every glyph against its own fill.

export const PALETTE = {
  ground: '#12160f',
  card: '#1d2419',
  panel: '#1a2016',
  /** The unwritten map square — the surface every terrain is drawn against. */
  sunk: '#0e1209',
  ink: '#0b0e08',
  text: '#edf1e6',
  dim: '#a9b69b',
  edge: '#6f7d61',

  // The six fills are spaced deliberately across the LUMINANCE range, not just around the hue
  // wheel: at 0.0008 apart (the first attempt) Canker and Crag were the same brightness, which is
  // invisible in greyscale and to a monochromat, on the two squares a player most needs to tell
  // apart. Respaced, the smallest gap is 0.080.
  grove: '#9ae7ad',
  mere: '#73bef4',
  tilth: '#edc15c',
  steading: '#fb855e',
  canker: '#ac61d1',
  crag: '#8c96a1',

  gold: '#f2c14e',
  /** The ghost while it cannot be placed. Never the only signal — the cells hatch as well. */
  bad: '#ff5544',
  you: '#a7e0a0',
  them: '#e0a0b8',
} as const;

export type PaletteKey = keyof typeof PALETTE;

/** Every surface a meaningful colour is ever painted on. */
export const SURFACES: PaletteKey[] = ['ground', 'card', 'panel', 'sunk'];

/** The colours that carry meaning on the play surface. */
export const MEANINGFUL: PaletteKey[] = [
  'grove',
  'mere',
  'tilth',
  'steading',
  'canker',
  'crag',
  'gold',
  'bad',
  'text',
  'you',
  'them',
  'edge',
];

/** The six terrain fills, in code order, for the tests that walk them. */
export const TERRAIN_KEYS: PaletteKey[] = ['grove', 'mere', 'tilth', 'steading', 'canker', 'crag'];

export function srgbToLinear(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = srgbToLinear(parseInt(h.slice(0, 2), 16));
  const g = srgbToLinear(parseInt(h.slice(2, 4), 16));
  const b = srgbToLinear(parseInt(h.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
