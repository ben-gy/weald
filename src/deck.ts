// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// See ADDITIONAL-TERMS.md for the section 7(b) attribution requirement.
//
// Weald — seed in, whole run out. Crag layout, edict roles, every card, every canker carve.
//
// THIS FILE IS THE WHOLE NETCODE. Weald is parallel same-seed: the only thing that crosses the wire
// is the seed the host froze into the round start, plus each player's finished grid for the
// summary. Every peer calls `dealRun(mode, seed)` and gets a byte-identical run. There is no
// snapshot, no input relay, nothing to desync, and host transfer is a display concern. The price of
// that is total determinism here — one `Math.random()` in this file and two players are silently
// scoring different maps while the summary compares them side by side as though they were not.
// tests/rng.test.ts and tests/deck.test.ts both pin it.
//
// THERE IS NO TIME BUDGET, AND THAT IS THE SEED-FAIRNESS MECHANISM. The obvious design gives each
// card a time cost and each watch a budget, which makes "how many cells did I get to write" a
// random variable — and that is precisely the thing that makes one seed feel generous and another
// mean. Instead each watch has typed SLOTS (a 5-cell slot, a 4-cell slot, a 3-cell slot) and the
// seed only chooses WHICH card fills each slot. Total cells written is then a designed constant per
// mode rather than a roll, which is both a tighter fairness guarantee than a budget can give and
// one whole concept removed from a 375px screen: no time track, no cost pips.

import { makeRng, shuffle, type Rng } from '@ben-gy/game-engine/rng';
import { fromSketch, orientations, type Cell, type Form } from './shapes';
import { poolOf, type Edict } from './edicts';
import { MODES, WATCHES, type Mode, type ModeId } from './modes';
import { DRAWABLE, type Terrain } from './terrain';

// ── the shape library ─────────────────────────────────────────────────────────────────────────

export interface Shape {
  readonly id: string;
  readonly cells: readonly Cell[];
  readonly forms: readonly Form[];
  readonly area: number;
}

function shape(id: string, rows: string[]): Shape {
  const cells = fromSketch(rows);
  return { id, cells, forms: orientations(cells), area: cells.length };
}

export const SHAPES: Record<string, Shape> = Object.fromEntries(
  [
    shape('dot', ['#']),
    shape('pair', ['##']),
    shape('bar3', ['###']),
    shape('bend', ['#.', '##']),
    shape('block', ['##', '##']),
    shape('bar4', ['####']),
    shape('tee', ['###', '.#.']),
    shape('ell', ['#.', '#.', '##']),
    shape('zag', ['.##', '##.']),
    shape('plus', ['.#.', '###', '.#.']),
    shape('ell5', ['#.', '#.', '#.', '##']),
    shape('zed5', ['.##', '.#.', '##.']),
    shape('ustub', ['#.#', '###']),
    shape('wstep', ['#..', '##.', '.##']),
    shape('tee5', ['###', '.#.', '.#.']),
  ].map((s) => [s.id, s]),
);

export function shapeOf(id: string | null | undefined): Shape {
  if (typeof id === 'string' && Object.hasOwn(SHAPES, id)) return SHAPES[id];
  return SHAPES.dot;
}

const byArea = (n: number): string[] =>
  Object.values(SHAPES)
    .filter((s) => s.area === n)
    .map((s) => s.id)
    .sort();

export const A3 = byArea(3);
export const A4 = byArea(4);
export const A5 = byArea(5);

// ── crag layouts ──────────────────────────────────────────────────────────────────────────────
//
// Hand-authored rather than generated, because the three constraints a layout must satisfy — no
// crag on the rim (a rim crag can never be girt, so it would be a dead bonus), no two crags within
// Chebyshev distance 2 (adjacent crags wall off a corner), and the writable region staying a single
// connected component — are cheap to check and awkward to search for. tests/deck.test.ts asserts
// all three on every layout, so a hand-authored mistake cannot ship.

export const CRAGS_9: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [
    [2, 2],
    [2, 6],
    [6, 2],
    [6, 6],
  ],
  [
    [1, 4],
    [4, 1],
    [4, 7],
    [7, 4],
  ],
  [
    [2, 3],
    [3, 7],
    [6, 1],
    [7, 5],
  ],
  [
    [1, 1],
    [1, 6],
    [5, 3],
    [7, 7],
  ],
  [
    [3, 2],
    [6, 4],
    [2, 6],
    [7, 1],
  ],
  [
    [4, 4],
    [1, 2],
    [7, 2],
    [4, 7],
  ],
  [
    [2, 1],
    [5, 5],
    [1, 7],
    [7, 3],
  ],
  [
    [3, 5],
    [6, 6],
    [1, 3],
    [6, 1],
  ],
];

export const CRAGS_8: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [
    [2, 2],
    [5, 5],
    [2, 5],
  ],
  [
    [1, 3],
    [4, 1],
    [6, 5],
  ],
  [
    [3, 3],
    [6, 1],
    [1, 6],
  ],
  [
    [2, 6],
    [5, 2],
    [6, 6],
  ],
  [
    [1, 1],
    [4, 4],
    [1, 4],
  ],
  [
    [3, 6],
    [6, 3],
    [3, 1],
  ],
];

// ── the deal ──────────────────────────────────────────────────────────────────────────────────

/** One thing a card lets you do: a shape, and which terrains it may be written in. */
export interface Branch {
  readonly shapeId: string;
  readonly terrains: readonly Terrain[];
}

export interface Card {
  readonly kind: 'card';
  /** Branch A, and branch B when the card forks. Scrawl is implicit and always available. */
  readonly a: Branch;
  readonly b: Branch | null;
}

export interface Carve {
  readonly kind: 'carve';
  readonly shapeId: string;
  readonly anchor: AnchorId;
}

export type Deal = Card | Carve;

export type AnchorId = 'rootward' | 'brackish' | 'fallow' | 'wallward' | 'rimward' | 'cragfall';

export interface Anchor {
  readonly id: AnchorId;
  readonly text: string;
}

export const ANCHORS: Record<AnchorId, Anchor> = {
  rootward: { id: 'rootward', text: 'must touch a Grove square' },
  brackish: { id: 'brackish', text: 'must touch a Mere square' },
  fallow: { id: 'fallow', text: 'must touch a Tilth square' },
  wallward: { id: 'wallward', text: 'must touch a Steading square' },
  rimward: { id: 'rimward', text: 'must include a square on the rim' },
  cragfall: { id: 'cragfall', text: 'must touch a crag' },
};

export const ANCHOR_IDS: readonly AnchorId[] = [
  'rootward',
  'brackish',
  'fallow',
  'wallward',
  'rimward',
  'cragfall',
];

export function anchorOf(id: string | null | undefined): Anchor {
  if (typeof id === 'string' && Object.hasOwn(ANCHORS, id)) return ANCHORS[id as AnchorId];
  return ANCHORS.rimward;
}

export interface Watch {
  /** In order. A carve, when the watch has one, is dealt LAST — except in Dwindle. */
  readonly deals: readonly Deal[];
}

export interface Run {
  readonly mode: Mode;
  readonly seed: number;
  readonly size: number;
  readonly crags: ReadonlyArray<readonly [number, number]>;
  /** The four drawn edicts in role order: alpha, beta, gamma, delta. */
  readonly roles: readonly Edict[];
  readonly watches: readonly Watch[];
}

/** Which watch each role is first visible in. Alpha and beta are face-up from the start. */
export const ROLE_REVEALED_IN: readonly number[] = [0, 0, 1, 2];

/**
 * Which two roles score at each watch end. Every edict scores exactly twice, on a rolling pair, so
 * a rule that has just been revealed immediately matters and an old one gets a second life at the
 * very end. Scoring is CUMULATIVE — always over the whole map as it stands — so early cells compound
 * and a late reveal genuinely re-aims the endgame rather than adding a lap of honour.
 */
export const WATCH_SCORES: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
];

/** The typed slots per watch: each entry is an area, and whether the card forks. */
interface Slot {
  area: number;
  duo: boolean;
}

function slotsFor(mode: Mode, watch: number): Slot[] {
  if (mode.fork === 'pair') {
    // SURVEY: every card offers two shapes of equal area, so `duo` here means "two terrains".
    return [
      [
        { area: 4, duo: true },
        { area: 5, duo: false },
        { area: 3, duo: true },
      ],
      [
        { area: 4, duo: true },
        { area: 4, duo: false },
        { area: 3, duo: true },
      ],
      [
        { area: 3, duo: true },
        { area: 3, duo: false },
      ],
      [
        { area: 3, duo: true },
        { area: 3, duo: false },
      ],
    ][watch];
  }
  // CANOPY / MARCH. THE SHAPES GET SMALLER AS THE MAP FILLS, which is the whole answer to the
  // genre's characteristic failure: a 5-cell shape on a 70%-full map has one legal home and the
  // last few turns become bookkeeping. Five-cell slots exist only in the first two watches.
  return [
    [
      { area: 4, duo: true },
      { area: 5, duo: false },
      { area: 3, duo: true },
      { area: 4, duo: false },
    ],
    [
      { area: 5, duo: false },
      { area: 4, duo: true },
      { area: 3, duo: true },
    ],
    [
      { area: 4, duo: true },
      { area: 3, duo: true },
      { area: 3, duo: false },
    ],
    [
      { area: 3, duo: true },
      { area: 3, duo: false },
    ],
  ][watch];
}

const CARVE_SHAPES: readonly string[][] = [
  ['bend', 'bar3'],
  ['bend', 'bar3'],
  ['zag', 'tee', 'ell', 'block'],
  ['bend', 'bar3'],
];

const pickOne = <T>(rng: Rng, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length) % arr.length];

function pickTerrains(rng: Rng, duo: boolean): Terrain[] {
  const order = shuffle(rng, DRAWABLE);
  return duo ? [order[0], order[1]] : [order[0]];
}

function buildWatches(mode: Mode, rng: Rng): Watch[] {
  const out: Watch[] = [];
  for (let w = 0; w < WATCHES; w++) {
    const deals: Deal[] = [];
    const slots = slotsFor(mode, w);

    // THE DWINDLE CARVE IS DEALT FIRST, not last. The final two placements are then repairs against
    // damage you have just taken — seal it, girt a crag, close a row — so the last cells of the run
    // always have a reason to care where they go, even when edict gain is thin.
    const carveFirst = w === WATCHES - 1;
    const hasCarve = mode.cankerWatches.includes(w);
    const carve = (): Carve => ({
      kind: 'carve',
      shapeId: pickOne(rng, CARVE_SHAPES[w]),
      anchor: pickOne(rng, ANCHOR_IDS),
    });

    if (hasCarve && carveFirst) deals.push(carve());

    for (const slot of slots) {
      const pool = slot.area === 5 ? A5 : slot.area === 4 ? A4 : A3;
      const aShape = pickOne(rng, pool);
      if (mode.fork === 'pair') {
        // Two DIFFERENT shapes of the same area — shape agency instead of a size/flexibility fork.
        const others = pool.filter((s) => s !== aShape);
        const bShape = others.length ? pickOne(rng, others) : aShape;
        const terrains = pickTerrains(rng, slot.duo);
        deals.push({ kind: 'card', a: { shapeId: aShape, terrains }, b: { shapeId: bShape, terrains } });
      } else if (slot.area === 5) {
        // The genuine fork: the big shape in ONE terrain, or a smaller one with a choice of two.
        const small = pickOne(rng, A3);
        deals.push({
          kind: 'card',
          a: { shapeId: aShape, terrains: pickTerrains(rng, false) },
          b: { shapeId: small, terrains: pickTerrains(rng, true) },
        });
      } else {
        deals.push({ kind: 'card', a: { shapeId: aShape, terrains: pickTerrains(rng, slot.duo) }, b: null });
      }
    }

    if (hasCarve && !carveFirst) deals.push(carve());
    out.push({ deals });
  }
  return out;
}

/** Every terrain a watch's cards can legally be written in. */
function terrainsIn(w: Watch): Set<number> {
  const s = new Set<number>();
  for (const d of w.deals) {
    if (d.kind !== 'card') continue;
    for (const t of d.a.terrains) s.add(t);
    if (d.b) for (const t of d.b.terrains) s.add(t);
  }
  return s;
}

/**
 * Deal a whole run from a seed. Pure, deterministic, and identical on every peer.
 *
 * The reject-and-resample loop is the one piece of insurance the stratified slots cannot give by
 * themselves: slots fix HOW MANY cells you write, but a seed could still hand a whole run in which
 * Tilth never appears, which silently zeroes an edict that scores Tilth. Resampling from the same
 * stream keeps determinism while guaranteeing every drawable terrain is reachable in every watch.
 */
export function dealRun(modeId: ModeId, seed: number): Run {
  const mode = MODES[modeId] ?? MODES.canopy;
  const rng = makeRng(`weald|${modeId}|${seed}`);

  const layouts = mode.size === 9 ? CRAGS_9 : CRAGS_8;
  const crags = pickOne(rng, layouts);
  const roles = shuffle(rng, poolOf(mode.pool)).slice(0, 4);

  let watches = buildWatches(mode, rng);
  for (let tries = 0; tries < 40; tries++) {
    const ok = watches.every((w) => {
      const t = terrainsIn(w);
      // Every watch must offer at least three of the four, and the run as a whole all four.
      return t.size >= 3;
    });
    const all = new Set<number>();
    for (const w of watches) for (const t of terrainsIn(w)) all.add(t);
    if (ok && all.size === DRAWABLE.length) break;
    watches = buildWatches(mode, rng);
  }

  return { mode, seed, size: mode.size, crags, roles, watches };
}

/**
 * The most cells a run can ever put on the map: the larger branch of every card, plus every carve.
 * The carves are the part that is easy to forget and they are not optional — the rot is written
 * whether the player likes it or not, so a bound that omits them is simply wrong.
 */
export function maxShapeCells(run: Run): number {
  let n = 0;
  for (const w of run.watches) {
    for (const d of w.deals) {
      if (d.kind === 'card') n += Math.max(shapeOf(d.a.shapeId).area, d.b ? shapeOf(d.b.shapeId).area : 0);
      else n += shapeOf(d.shapeId).area;
    }
  }
  return n;
}

/** How many placements a run asks for, carves included. */
export function placementCount(run: Run): number {
  return run.watches.reduce((n, w) => n + w.deals.length, 0);
}
