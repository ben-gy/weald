// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// See ADDITIONAL-TERMS.md for the section 7(b) attribution requirement.
//
// Weald — the six things a square can be, and how each one is told apart.
//
// COLOUR IS NEVER THE ONLY CHANNEL. Six mutually-3:1 colours are arithmetically impossible in sRGB
// (n colours each 3:1 from the next need a luminance span of 3^(n-1); the widest sRGB offers is 21,
// so three is the hard ceiling) and three of these six — Grove, Tilth, Steading — collapse toward
// each other for a deuteranope anyway. So every terrain carries a GLYPH, and the glyph is the
// primary channel: a greyscale screenshot of a finished map still reads correctly. What IS gated in
// tests/contrast.test.ts: each fill clears 3:1 against the map surface, and each glyph clears 4.5:1
// against its own fill.

export const UNWRITTEN = 0;
export const GROVE = 1;
export const MERE = 2;
export const TILTH = 3;
export const STEADING = 4;
export const CANKER = 5;
export const CRAG = 6;

export type Terrain = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** The four terrains a player can actually draw. Canker is inflicted; crag is pre-printed. */
export const DRAWABLE: readonly Terrain[] = [GROVE, MERE, TILTH, STEADING];

export interface TerrainInfo {
  readonly code: Terrain;
  readonly key: string;
  readonly name: string;
  readonly glyph: string;
}

export const TERRAIN: Record<number, TerrainInfo> = {
  [GROVE]: { code: GROVE, key: 'grove', name: 'Grove', glyph: '▲' },
  [MERE]: { code: MERE, key: 'mere', name: 'Mere', glyph: '≈' },
  [TILTH]: { code: TILTH, key: 'tilth', name: 'Tilth', glyph: '☰' },
  [STEADING]: { code: STEADING, key: 'steading', name: 'Steading', glyph: '▢' },
  [CANKER]: { code: CANKER, key: 'canker', name: 'Canker', glyph: '✕' },
  [CRAG]: { code: CRAG, key: 'crag', name: 'Crag', glyph: '◆' },
};

/** Guarded lookup for anything that ever came off the wire or out of storage. */
export function terrainOf(code: number | null | undefined): TerrainInfo | null {
  if (typeof code !== 'number' || !Object.hasOwn(TERRAIN, code)) return null;
  return TERRAIN[code];
}

export const nameOf = (code: number): string => terrainOf(code)?.name ?? 'Unwritten';
export const glyphOf = (code: number): string => terrainOf(code)?.glyph ?? '';
export const keyOfTerrain = (code: number): string => terrainOf(code)?.key ?? 'unwritten';
