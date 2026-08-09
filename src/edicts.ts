// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// See ADDITIONAL-TERMS.md for the section 7(b) attribution requirement.
//
// Weald — the fifteen edicts: three pools of five, one pool per mode.
//
// Every edict is ONE LINE over src/measure.ts, and that is a design rule rather than a coincidence.
// A rule the player cannot hold in their head while looking at the map is a rule they stop playing
// toward, and a rule whose implementation needs its own flood fill is a rule the audit cannot
// independently re-derive. Both problems have the same fix: keep the topology in measure.ts and
// keep the edict a sentence.
//
// A run draws FOUR of a pool's five and assigns them roles alpha/beta/gamma/delta — C(5,4) x 4! =
// 120 configurations per mode, so the player learns five rules and never plays the same run twice.
//
// THE MULTIPLIERS ARE MEASURED, NOT CHOSEN. Every integer below is a named constant, and
// tests/balance.test.ts asserts that each edict's mean contribution sits in a band and that the
// most generous is at most twice the least. They were fitted by running the sim, not by argument —
// this factory has learned the hard way that a confident story about a scoring constant is worth
// nothing next to six hundred seeded runs.

import {
  borderPairs,
  clusters,
  colsWith,
  edgeCount,
  enclosedVoids,
  fullCols,
  fullRows,
  largestCluster,
  longestWrittenRun,
  monoBlocks2x2,
  quadrantsWithAll,
  rowsWith,
  rowsWithExactly,
  sealedCells,
  touchingAny,
  touchingCount,
  type Grid,
} from './measure';
import { CANKER, DRAWABLE, GROVE, MERE, STEADING, TILTH } from './terrain';

/** Every scoring weight in the game, in one block, so the sim can see what it is fitting. */
export const W = {
  spinney: 4,
  deepmere: 1,
  hamlets: 4,
  cloister: 2,
  outland: 1,

  waterline: 3,
  woodsedge: 1,
  crossroads: 2,
  quarantine: 2,
  fenland: 2,

  furrows: 5,
  bastions: 2,
  quarters: 8,
  terraces: 3,
  plumbline: 1,

  /** Paid once at run end for each crag with all four neighbours written. */
  girt: 4,
} as const;

/** Both thresholds were moved by measurement; tests/balance.test.ts pins what they buy. */
export const SPINNEY_MIN = 3;
export const QUARTERS_MIN = 3;

export interface Edict {
  readonly id: string;
  readonly pool: 'C' | 'M' | 'S';
  readonly name: string;
  /** The one sentence printed on the card. The audit re-implements from THIS, not from the code. */
  readonly text: string;
  readonly score: (g: Grid, size: number) => number;
}

const list: Edict[] = [
  // ── CANOPY: mass, and the pockets you wall in ──────────────────────────────────────────────
  {
    id: 'spinney',
    pool: 'C',
    name: 'Spinney',
    text: 'Score 4 for each wood of three or more joined Grove squares.',
    // Measured at "five or more" this paid a mean of 2.1 against a pool mate's 57 — the rule almost
    // never fired, so the card was decoration. Four is the threshold at which massing Grove is a
    // plan rather than a fluke.
    score: (g, n) =>
      W.spinney * clusters(g, n).filter((c) => c.terrain === GROVE && c.size >= SPINNEY_MIN).length,
  },
  {
    id: 'deepmere',
    pool: 'C',
    name: 'Deepmere',
    text: 'Score 1 for every square in your single largest lake.',
    score: (g, n) => W.deepmere * largestCluster(g, n, MERE),
  },
  {
    id: 'hamlets',
    pool: 'C',
    name: 'Hamlets',
    text: 'Score 4 for each settlement of three or four joined Steading squares.',
    score: (g, n) =>
      W.hamlets *
      clusters(g, n).filter((c) => c.terrain === STEADING && c.size >= 3 && c.size <= 4).length,
  },
  {
    id: 'cloister',
    pool: 'C',
    name: 'Cloister',
    text: 'Score 2 for each unwritten pocket completely walled in, however large.',
    score: (g, n) => W.cloister * enclosedVoids(g, n).length,
  },
  {
    id: 'outland',
    pool: 'C',
    name: 'Outland',
    text: 'Score 1 for each row and each column holding at least one Tilth square.',
    score: (g, n) => W.outland * (rowsWith(g, n, TILTH) + colsWith(g, n, TILTH)),
  },

  // ── MARCH: contact, the rim, and sealing the rot in ────────────────────────────────────────
  {
    id: 'waterline',
    pool: 'M',
    name: 'Waterline',
    text: 'Score 3 for each Tilth square touching a Mere square.',
    score: (g, n) => W.waterline * touchingCount(g, n, TILTH, MERE),
  },
  {
    id: 'woodsedge',
    pool: 'M',
    name: 'Woodsedge',
    text: 'Score 1 for each Grove square on the rim of the map.',
    score: (g, n) => W.woodsedge * edgeCount(g, n, GROVE),
  },
  {
    id: 'crossroads',
    pool: 'M',
    name: 'Crossroads',
    text: 'Score 2 for each Steading square touching a Grove or a Tilth square.',
    // "Both at once" measured a mean of 3.3 against a pool mate's 64: it demanded a three-terrain
    // junction the board rarely offers, so the card was unplayable rather than hard.
    score: (g, n) => W.crossroads * touchingAny(g, n, STEADING, [GROVE, TILTH]),
  },
  {
    id: 'quarantine',
    pool: 'M',
    name: 'Quarantine',
    text: 'Score 2 for each cankered square in a patch that no unwritten square touches.',
    // Paying per PATCH measured 5.4 — sealing a whole patch is a big ask at 70% fill, so the mode's
    // intended counterplay to its own rot barely existed. Paying per sealed square keeps the same
    // verb and makes partial progress visible.
    score: (g, n) => W.quarantine * sealedCells(g, n, CANKER),
  },
  {
    id: 'fenland',
    pool: 'M',
    name: 'Fenland',
    text: 'Score 2 for each place a Mere square touches a Grove square.',
    score: (g, n) => W.fenland * borderPairs(g, n, MERE, GROVE),
  },

  // ── SURVEY: finishing things ───────────────────────────────────────────────────────────────
  {
    id: 'furrows',
    pool: 'S',
    name: 'Furrows',
    text: 'Score 5 for each row and each column with no unwritten square left.',
    score: (g, n) => W.furrows * (fullRows(g, n).length + fullCols(g, n).length),
  },
  {
    id: 'bastions',
    pool: 'S',
    name: 'Bastions',
    text: 'Score 2 for each 2×2 block of a single terrain. Canker and crag never count.',
    score: (g, n) => W.bastions * monoBlocks2x2(g, n, DRAWABLE),
  },
  {
    id: 'quarters',
    pool: 'S',
    name: 'Quarters',
    text: 'Score 8 for each corner quarter of the map holding at least three different terrains.',
    // All four in one quarter measured 4.2: with four terrains competing for sixteen squares it
    // was a lottery, not a plan. Three of four is reachable by intent.
    score: (g, n) => W.quarters * quadrantsWithAll(g, n, DRAWABLE, QUARTERS_MIN),
  },
  {
    id: 'terraces',
    pool: 'S',
    name: 'Terraces',
    text: 'Score 3 for each row holding exactly one Mere square.',
    score: (g, n) => W.terraces * rowsWithExactly(g, n, MERE, 1),
  },
  {
    id: 'plumbline',
    pool: 'S',
    name: 'Plumbline',
    text: 'Score 1 for each square in your longest unbroken line of written squares.',
    score: (g, n) => W.plumbline * longestWrittenRun(g, n),
  },
];

export const EDICTS: Record<string, Edict> = Object.fromEntries(list.map((e) => [e.id, e]));
export const EDICT_IDS: readonly string[] = list.map((e) => e.id);

export function poolOf(pool: 'C' | 'M' | 'S'): Edict[] {
  return list.filter((e) => e.pool === pool);
}

/** Guarded lookup — an id that arrived off the wire must never produce an Edict of undefined. */
export function edictOf(id: string | null | undefined): Edict | null {
  if (typeof id === 'string' && Object.hasOwn(EDICTS, id)) return EDICTS[id];
  return null;
}
