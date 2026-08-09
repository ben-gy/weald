// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// See ADDITIONAL-TERMS.md for the section 7(b) attribution requirement.
//
// Weald — the three modes.
//
// A mode has to change how the game PLAYS, not just a number, so each of these swaps the EDICT POOL
// — the language a good placement is written in — *and* one structural lever:
//
//   CANOPY   mass and voids     Score for big joined masses, one large lake, and unwritten pockets
//                               you have walled in. You extend blobs, and breaking a lake in two is
//                               the mistake you are trying not to make.
//
//   MARCH    contact and rim    The exact inverse: score for terrain types TOUCHING each other, for
//                               Grove on the rim, and for walling the canker in. Blobbing is
//                               actively punished, you interleave instead, and the canker bleeds at
//                               double rate — so it is denser, meaner and one placement longer.
//
//   SURVEY   completion         A smaller board, so full rows and columns are actually reachable and
//                               one wasted square is visible. Every card offers two DIFFERENT shapes
//                               of equal area rather than a big/small fork, which is the most shape
//                               agency in the game and the least chaos. The tight one.
//
// tests/balance.test.ts proves the spread is real rather than cosmetic with a cross-play matrix: a
// bot optimising one mode's pool while playing another must lose a large chunk of its score. If it
// does not, the modes are a re-skin and this comment is a lie.
//
// The HOST's pick travels frozen inside rematch.ts's round start. `modeOf` guards an id off the
// wire with Object.hasOwn — a bare `MODES[id] || DEFAULT` lets 'constructor' through as a Mode of
// undefined fields, which reaches the generator as `undefined` and deals a run nobody can play.

export type ModeId = 'canopy' | 'march' | 'survey';

export interface Mode {
  readonly id: ModeId;
  readonly name: string;
  readonly blurb: string;
  /** Board edge length in cells. */
  readonly size: number;
  /** How many pre-printed crags the layout carries. */
  readonly crags: number;
  /** Which pool of five edicts this mode draws its four from. */
  readonly pool: 'C' | 'M' | 'S';
  /** Canker penalty per exposed unwritten square, charged at EVERY watch end. */
  readonly cankerP: number;
  /**
   * Which watches carry a canker carve. MARCH takes one in all four; SURVEY only in the last two,
   * which is most of why SURVEY is the gentle one.
   */
  readonly cankerWatches: readonly number[];
  /**
   * 'split'  — the 5-cell slot forks into (big, one terrain) vs (small, two terrains).
   * 'pair'   — every card offers two different shapes of EQUAL area instead.
   */
  readonly fork: 'split' | 'pair';
}

export const MODES: Record<ModeId, Mode> = {
  canopy: {
    id: 'canopy',
    name: 'Canopy',
    blurb:
      'Score for big joined masses, your single largest lake, and unwritten pockets you have walled in. Extend what you have — and try not to cut a lake in half.',
    size: 9,
    crags: 4,
    pool: 'C',
    cankerP: 1,
    cankerWatches: [1, 2, 3],
    fork: 'split',
  },
  march: {
    id: 'march',
    name: 'March',
    blurb:
      'The inverse: score where terrains touch, for Grove along the rim, and for walling the canker in. Blobbing is punished, the rot arrives in every watch, and it runs one placement longer.',
    size: 9,
    crags: 4,
    pool: 'M',
    // MEASURED, NOT CHOSEN. At 2 per exposed square this cost a mean of 49.5 a run against Canopy's
    // 15.3, the fifth-percentile score was NEGATIVE, and the mode's own counterplay (Quarantine)
    // could not pay it back — "denser and meaner" had become "unplayable". March keeps its identity
    // through a carve in EVERY watch and a pool that rewards sealing, not through a doubled bleed.
    cankerP: 1,
    cankerWatches: [0, 1, 2, 3],
    fork: 'split',
  },
  survey: {
    id: 'survey',
    name: 'Survey',
    blurb:
      'A smaller map, where finishing a whole row is possible and one wasted square shows. Every card offers two different shapes of the same size, so you choose the shape as well as the spot.',
    size: 8,
    crags: 3,
    pool: 'S',
    cankerP: 1,
    cankerWatches: [2, 3],
    fork: 'pair',
  },
};

export const MODE_IDS: readonly ModeId[] = ['canopy', 'march', 'survey'];
export const DEFAULT_MODE: ModeId = 'canopy';

export function modeOf(id: string | null | undefined): Mode {
  if (typeof id === 'string' && Object.hasOwn(MODES, id)) return MODES[id as ModeId];
  return MODES[DEFAULT_MODE];
}

/** The four watches. Named rather than numbered so the summary can say where you are. */
export const WATCH_NAMES: readonly string[] = ['Quickening', 'Highsun', 'Waning', 'Dwindle'];
export const WATCHES = 4;
