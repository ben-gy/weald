// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
//
// mechanism.test.ts — principle #21. A balance sim measures OUTCOMES, and a broken mechanic just
// moves the outcome, so the curve can never tell you the rules were obeyed. A sibling game shipped
// turrets that shot past a closer target for eight seconds a run with 1,721 rounds in the bank, and
// every one of its 200 seeded runs looked like ordinary difficulty.
//
// THE HARD RULE THIS FILE OBEYS: it consumes the EVENT LOG and the run description, and re-derives
// everything else from code written here, independently. It does NOT import src/edicts.ts,
// src/board.ts's scorer, src/measure.ts or src/game.ts's arithmetic. An audit that imports the
// game's own maths is a tautology — it agrees with a mutated formula just as happily as with a
// correct one, and goes green while the game is wrong. The multipliers below are transcribed from
// the ENGLISH SENTENCE printed on each card, not from the constant that implements it, so a
// multiplier and its card text drifting apart turns this red.
//
// Zero tolerance throughout: these are counts of rule violations, never durations or averages. A
// duration has a grey zone and a threshold to tune; "how many placements broke the rule" does not.

import { describe, expect, it } from 'vitest';
import { dealRun, shapeOf, type Run } from '../src/deck';
import { Game, type PlaceEvent } from '../src/game';
import { SKILLS, bestCarve, bestMove } from '../src/bots';
import { MODE_IDS, type ModeId } from '../src/modes';

// ── the audit's OWN geometry, written from scratch ────────────────────────────────────────────

type Pt = [number, number];
const key = (cells: readonly Pt[]): string =>
  cells
    .map(([x, y]) => [x - Math.min(...cells.map((c) => c[0])), y - Math.min(...cells.map((c) => c[1]))])
    .map(([x, y]) => `${x},${y}`)
    .sort()
    .join(' ');

/** The eight dihedral transforms, spelled out rather than generated, so this cannot share a bug. */
const D4: Array<(p: Pt) => Pt> = [
  ([x, y]) => [x, y],
  ([x, y]) => [-y, x],
  ([x, y]) => [-x, -y],
  ([x, y]) => [y, -x],
  ([x, y]) => [-x, y],
  ([x, y]) => [y, x],
  ([x, y]) => [x, -y],
  ([x, y]) => [-y, -x],
];

/** Is `cells` the declared shape under SOME rotation, reflection and translation? */
function congruent(cells: readonly Pt[], declared: readonly Pt[]): boolean {
  const want = key(cells);
  return D4.some((t) => key(declared.map(t)) === want);
}

function connected4(cells: readonly Pt[]): boolean {
  if (cells.length <= 1) return true;
  const set = new Set(cells.map(([x, y]) => `${x},${y}`));
  const seen = new Set<string>([`${cells[0][0]},${cells[0][1]}`]);
  const stack: Pt[] = [cells[0]];
  while (stack.length) {
    const [x, y] = stack.pop()!;
    for (const [dx, dy] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ] as const) {
      const k = `${x + dx},${y + dy}`;
      if (set.has(k) && !seen.has(k)) {
        seen.add(k);
        stack.push([x + dx, y + dy]);
      }
    }
  }
  return seen.size === cells.length;
}

// ── the audit's OWN board ─────────────────────────────────────────────────────────────────────

const CRAG = 6;
const CANKER = 5;

class AuditBoard {
  g: number[];
  constructor(readonly n: number, crags: ReadonlyArray<readonly [number, number]>) {
    this.g = new Array(n * n).fill(0);
    for (const [x, y] of crags) this.g[y * n + x] = CRAG;
  }
  at(x: number, y: number): number {
    return x < 0 || y < 0 || x >= this.n || y >= this.n ? -1 : this.g[y * this.n + x];
  }
  set(x: number, y: number, v: number): void {
    this.g[y * this.n + x] = v;
  }
  /** Could this shape have been placed anywhere at all, in any orientation? */
  anyFit(declared: readonly Pt[]): boolean {
    for (const t of D4) {
      const f = declared.map(t);
      const minX = Math.min(...f.map((c) => c[0]));
      const minY = Math.min(...f.map((c) => c[1]));
      const norm = f.map(([x, y]) => [x - minX, y - minY] as Pt);
      const w = Math.max(...norm.map((c) => c[0])) + 1;
      const h = Math.max(...norm.map((c) => c[1])) + 1;
      for (let oy = 0; oy + h <= this.n; oy++) {
        for (let ox = 0; ox + w <= this.n; ox++) {
          if (norm.every(([x, y]) => this.at(ox + x, oy + y) === 0)) return true;
        }
      }
    }
    return false;
  }
  /** Every placement of the shape whose cells satisfy `ok`. */
  anyFitWhere(declared: readonly Pt[], ok: (cells: Pt[]) => boolean): boolean {
    for (const t of D4) {
      const f = declared.map(t);
      const minX = Math.min(...f.map((c) => c[0]));
      const minY = Math.min(...f.map((c) => c[1]));
      const norm = f.map(([x, y]) => [x - minX, y - minY] as Pt);
      const w = Math.max(...norm.map((c) => c[0])) + 1;
      const h = Math.max(...norm.map((c) => c[1])) + 1;
      for (let oy = 0; oy + h <= this.n; oy++) {
        for (let ox = 0; ox + w <= this.n; ox++) {
          const cells = norm.map(([x, y]) => [ox + x, oy + y] as Pt);
          if (cells.every(([x, y]) => this.at(x, y) === 0) && ok(cells)) return true;
        }
      }
    }
    return false;
  }
}

/** The anchor predicates, re-implemented from the one-sentence English on the card. */
const ANCHOR: Record<string, (b: AuditBoard, cells: Pt[]) => boolean> = {
  rootward: (b, c) => touches(b, c, 1),
  brackish: (b, c) => touches(b, c, 2),
  fallow: (b, c) => touches(b, c, 3),
  wallward: (b, c) => touches(b, c, 4),
  rimward: (b, c) => c.some(([x, y]) => x === 0 || y === 0 || x === b.n - 1 || y === b.n - 1),
  cragfall: (b, c) => touches(b, c, CRAG),
};
const touches = (b: AuditBoard, cells: Pt[], t: number): boolean =>
  cells.some(([x, y]) =>
    [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ].some(([dx, dy]) => b.at(x + dx, y + dy) === t),
  );

// ── the audit's OWN scoring, written from the printed card text ───────────────────────────────

function regions(b: AuditBoard, terrain: number): Pt[][] {
  const seen = new Set<number>();
  const out: Pt[][] = [];
  for (let i = 0; i < b.g.length; i++) {
    if (b.g[i] !== terrain || seen.has(i)) continue;
    const cells: Pt[] = [];
    const stack = [i];
    seen.add(i);
    while (stack.length) {
      const j = stack.pop()!;
      const x = j % b.n;
      const y = (j / b.n) | 0;
      cells.push([x, y]);
      for (const [dx, dy] of [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= b.n || ny >= b.n) continue;
        const k = ny * b.n + nx;
        if (!seen.has(k) && b.g[k] === terrain) {
          seen.add(k);
          stack.push(k);
        }
      }
    }
    out.push(cells);
  }
  return out;
}

/**
 * Each entry is transcribed from the sentence printed on the card, deliberately not from the
 * implementation. If a multiplier in src/edicts.ts moves without its card text moving with it, the
 * two disagree here and this file goes red — which is the point.
 */
const AUDIT_EDICT: Record<string, (b: AuditBoard) => number> = {
  // "Score 4 for each wood of three or more joined Grove squares."
  spinney: (b) => 4 * regions(b, 1).filter((r) => r.length >= 3).length,
  // "Score 1 for every square in your single largest lake."
  deepmere: (b) => 1 * Math.max(0, ...regions(b, 2).map((r) => r.length)),
  // "Score 4 for each settlement of exactly three or four joined Steading squares."
  hamlets: (b) => 4 * regions(b, 4).filter((r) => r.length >= 3 && r.length <= 4).length,
  // "Score 2 for each unwritten pocket completely walled in."
  cloister: (b) =>
    2 *
    regions(b, 0).filter((r) => r.every(([x, y]) => x > 0 && y > 0 && x < b.n - 1 && y < b.n - 1))
      .length,
  // "Score 1 for each row and each column holding at least one Tilth square."
  outland: (b) => {
    let n = 0;
    for (let y = 0; y < b.n; y++) for (let x = 0; x < b.n; x++) if (b.at(x, y) === 3) { n++; break; }
    for (let x = 0; x < b.n; x++) for (let y = 0; y < b.n; y++) if (b.at(x, y) === 3) { n++; break; }
    return 1 * n;
  },
  // "Score 3 for each Tilth square touching a Mere square."
  waterline: (b) => 3 * countCells(b, 3, (bb, x, y) => neigh(bb, x, y).includes(2)),
  // "Score 1 for each Grove square on the rim of the map."
  woodsedge: (b) =>
    1 * countCells(b, 1, (bb, x, y) => x === 0 || y === 0 || x === bb.n - 1 || y === bb.n - 1),
  // "Score 2 for each Steading square touching a Grove or a Tilth square."
  crossroads: (b) =>
    2 * countCells(b, 4, (bb, x, y) => neigh(bb, x, y).some((v) => v === 1 || v === 3)),
  // "Score 2 for each cankered square in a patch that no unwritten square touches."
  quarantine: (b) => 2 * countCells(b, CANKER, (bb, x, y) => !neigh(bb, x, y).includes(0)),
  // "Score 2 for each place a Mere square touches a Grove square."
  fenland: (b) => {
    let n = 0;
    for (let y = 0; y < b.n; y++) {
      for (let x = 0; x < b.n; x++) {
        if (b.at(x, y) === 2 && b.at(x + 1, y) === 1) n++;
        if (b.at(x, y) === 1 && b.at(x + 1, y) === 2) n++;
        if (b.at(x, y) === 2 && b.at(x, y + 1) === 1) n++;
        if (b.at(x, y) === 1 && b.at(x, y + 1) === 2) n++;
      }
    }
    return 2 * n;
  },
  // "Score 5 for each row and each column with no unwritten square left."
  furrows: (b) => {
    let n = 0;
    for (let y = 0; y < b.n; y++) {
      let full = true;
      for (let x = 0; x < b.n; x++) if (b.at(x, y) === 0) full = false;
      if (full) n++;
    }
    for (let x = 0; x < b.n; x++) {
      let full = true;
      for (let y = 0; y < b.n; y++) if (b.at(x, y) === 0) full = false;
      if (full) n++;
    }
    return 5 * n;
  },
  // "Score 2 for each 2x2 block of a single terrain. Canker and crag never count."
  bastions: (b) => {
    let n = 0;
    for (let y = 0; y + 1 < b.n; y++) {
      for (let x = 0; x + 1 < b.n; x++) {
        const v = b.at(x, y);
        if (v < 1 || v > 4) continue;
        if (b.at(x + 1, y) === v && b.at(x, y + 1) === v && b.at(x + 1, y + 1) === v) n++;
      }
    }
    return 2 * n;
  },
  // "Score 8 for each corner quarter of the map holding at least three different terrains."
  quarters: (b) => {
    const h = Math.floor(b.n / 2);
    let n = 0;
    for (const [ox, oy] of [
      [0, 0],
      [b.n - h, 0],
      [0, b.n - h],
      [b.n - h, b.n - h],
    ] as const) {
      const seen = new Set<number>();
      for (let y = oy; y < oy + h; y++) for (let x = ox; x < ox + h; x++) seen.add(b.at(x, y));
      if ([1, 2, 3, 4].filter((t) => seen.has(t)).length >= 3) n++;
    }
    return 8 * n;
  },
  // "Score 3 for each row holding exactly one Mere square."
  terraces: (b) => {
    let n = 0;
    for (let y = 0; y < b.n; y++) {
      let c = 0;
      for (let x = 0; x < b.n; x++) if (b.at(x, y) === 2) c++;
      if (c === 1) n++;
    }
    return 3 * n;
  },
  // "Score 1 for each square in your longest unbroken line of written squares."
  plumbline: (b) => {
    let best = 0;
    for (let y = 0; y < b.n; y++) {
      let run = 0;
      for (let x = 0; x < b.n; x++) {
        run = b.at(x, y) === 0 ? 0 : run + 1;
        best = Math.max(best, run);
      }
    }
    for (let x = 0; x < b.n; x++) {
      let run = 0;
      for (let y = 0; y < b.n; y++) {
        run = b.at(x, y) === 0 ? 0 : run + 1;
        best = Math.max(best, run);
      }
    }
    return 1 * best;
  },
};

const neigh = (b: AuditBoard, x: number, y: number): number[] => [
  b.at(x, y - 1),
  b.at(x + 1, y),
  b.at(x, y + 1),
  b.at(x - 1, y),
];
function countCells(b: AuditBoard, t: number, ok: (b: AuditBoard, x: number, y: number) => boolean): number {
  let n = 0;
  for (let y = 0; y < b.n; y++) for (let x = 0; x < b.n; x++) if (b.at(x, y) === t && ok(b, x, y)) n++;
  return n;
}

/**
 * Which deal within its watch an event refers to. The log records a run-wide index; the audit
 * re-derives the offset itself rather than trusting one, so a bug in the game's cursor arithmetic
 * cannot hide behind the audit reading the same number.
 */
function dealIndexWithin(run: Run, ev: PlaceEvent): number {
  let seen = 0;
  for (let w = 0; w < ev.watch; w++) seen += run.watches[w].deals.length;
  return ev.i - seen;
}

/** The canker bill, from the rule as written: per exposed unwritten square, at every watch end. */
const exposure = (b: AuditBoard): number =>
  countCells(b, 0, (bb, x, y) => neigh(bb, x, y).includes(CANKER));

/** "Score 4 for each crag with all four neighbours written." Off the map is not written. */
const girt = (b: AuditBoard): number =>
  4 * countCells(b, CRAG, (bb, x, y) => neigh(bb, x, y).every((v) => v > 0));

// ── the audit ─────────────────────────────────────────────────────────────────────────────────

interface Findings {
  outOfBounds: number;
  onOccupied: number;
  notCongruent: number;
  disconnected: number;
  bogusFallback: number;
  bogusAnchorDrop: number;
  anchorViolated: number;
  scoreMismatch: number;
  watchesChecked: number;
  placements: number;
}

/**
 * Replay a run from its log alone, on the audit's own board, checking every rule as it goes and
 * re-deriving the final score from scratch.
 */
function audit(run: Run, log: readonly PlaceEvent[], claimed: { watches: number[]; girt: number }): Findings {
  const f: Findings = {
    outOfBounds: 0,
    onOccupied: 0,
    notCongruent: 0,
    disconnected: 0,
    bogusFallback: 0,
    bogusAnchorDrop: 0,
    anchorViolated: 0,
    scoreMismatch: 0,
    watchesChecked: 0,
    placements: 0,
  };
  const b = new AuditBoard(run.size, run.crags);
  const cankerP = run.mode.cankerP;
  const WATCH_PAIRS: Array<[number, number]> = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
  ];
  let watch = 0;
  let derived: number[] = [];

  const closeWatch = (): void => {
    const [ra, rb] = WATCH_PAIRS[watch];
    const total =
      AUDIT_EDICT[run.roles[ra].id](b) + AUDIT_EDICT[run.roles[rb].id](b) - cankerP * exposure(b);
    derived.push(total);
    f.watchesChecked++;
    watch++;
  };

  for (let i = 0; i < log.length; i++) {
    const ev = log[i];
    f.placements++;
    while (ev.watch > watch) closeWatch();

    const cells = ev.cells as Pt[];

    // 1. DISJOINTNESS AND BOUNDS.
    for (const [x, y] of cells) {
      if (x < 0 || y < 0 || x >= run.size || y >= run.size) f.outOfBounds++;
      else if (b.at(x, y) !== 0) f.onOccupied++;
    }

    const declared = shapeOf(ev.shapeId).cells.map((c) => [c.x, c.y] as Pt);

    if (ev.fallback) {
      // 4. FALLBACK LEGITIMACY. A forced scrawl is a CLAIM ABOUT THE BOARD — "nothing bigger fitted"
      // — so the audit runs its own search and checks it, rather than believing the tag.
      //
      // The obvious version of this check is wrong and was written first: a forced scrawl logs its
      // shape as the single cell it actually wrote, and a single cell fits wherever the map is not
      // full, so searching for THAT always succeeds and the check fires on every legitimate
      // fallback. The claim being made is about the CARD's branches, so those are what get
      // searched — which means the audit has to go back to the deal, not just read the event.
      if (ev.kind === 'card') {
        const deal = run.watches[ev.watch].deals[dealIndexWithin(run, ev)];
        if (deal && deal.kind === 'card') {
          const branches = [deal.a, deal.b].filter(Boolean) as Array<{ shapeId: string }>;
          const anyBranchFits = branches.some((br) =>
            b.anyFit(shapeOf(br.shapeId).cells.map((c) => [c.x, c.y] as Pt)),
          );
          if (anyBranchFits) f.bogusFallback++;
        }
      }
    } else {
      // 2. SHAPE FIDELITY, under the audit's own dihedral group and its own normaliser.
      if (!congruent(cells, declared)) f.notCongruent++;
      // 3. CONNECTIVITY.
      if (!connected4(cells)) f.disconnected++;
    }

    // 5. AMBUSH ANCHOR.
    if (ev.kind === 'carve') {
      const deal = run.watches[ev.watch].deals.find((d) => d.kind === 'carve');
      const anchorId = deal && deal.kind === 'carve' ? deal.anchor : 'rimward';
      const pred = ANCHOR[anchorId];
      if (ev.anchorDropped || ev.fallback) {
        // Dropping the anchor is only legitimate if no anchored placement existed at all.
        if (b.anyFitWhere(declared, (c) => pred(b, c))) f.bogusAnchorDrop++;
      } else if (!pred(b, cells)) {
        f.anchorViolated++;
      }
    }

    for (const [x, y] of cells) {
      if (x >= 0 && y >= 0 && x < run.size && y < run.size) b.set(x, y, ev.terrain);
    }
  }
  while (watch < 4) closeWatch();

  // 7. SCORE RE-DERIVATION, to an exact integer.
  for (let w = 0; w < claimed.watches.length; w++) {
    if (derived[w] !== claimed.watches[w]) f.scoreMismatch++;
  }
  if (girt(b) !== claimed.girt) f.scoreMismatch++;
  return f;
}

function playAndAudit(mode: ModeId, seed: number): Findings {
  const run = dealRun(mode, seed);
  const g = new Game(run);
  let guard = 0;
  while (!g.over && guard++ < 400) {
    const d = g.deal;
    if (!d) break;
    if (d.kind === 'carve') {
      g.carve(bestCarve(g, SKILLS.tallow));
      continue;
    }
    const best = bestMove(g, SKILLS.tallow);
    if (!best || !g.play(best.choice)) break;
  }
  const sc = g.score();
  return audit(run, g.log, { watches: sc.watches.map((w) => w.total), girt: sc.girt });
}

describe('the audit re-derives every run from the log alone, and agrees exactly', () => {
  for (const m of MODE_IDS) {
    it(`${m}: 40 runs, zero rule violations and zero score disagreements`, () => {
      const totals: Findings = {
        outOfBounds: 0,
        onOccupied: 0,
        notCongruent: 0,
        disconnected: 0,
        bogusFallback: 0,
        bogusAnchorDrop: 0,
        anchorViolated: 0,
        scoreMismatch: 0,
        watchesChecked: 0,
        placements: 0,
      };
      for (let s = 1; s <= 40; s++) {
        const f = playAndAudit(m, s);
        for (const k of Object.keys(totals) as Array<keyof Findings>) totals[k] += f[k];
      }
      expect(totals.placements, 'nothing was audited').toBeGreaterThan(400);
      expect(totals.watchesChecked).toBe(160);
      // Zero tolerance on every one of these. They are counts of rule violations, not averages.
      expect(totals.outOfBounds, 'a placement left the map').toBe(0);
      expect(totals.onOccupied, 'a placement overwrote a written square').toBe(0);
      expect(totals.notCongruent, 'the cells written were not the declared shape').toBe(0);
      expect(totals.disconnected, 'a placement was not one connected piece').toBe(0);
      expect(totals.bogusFallback, 'a scrawl claimed nothing fitted, and something did').toBe(0);
      expect(totals.bogusAnchorDrop, 'a carve dropped its anchor while an anchored spot existed').toBe(0);
      expect(totals.anchorViolated, 'a carve ignored its anchor').toBe(0);
      expect(totals.scoreMismatch, 'the game and the audit disagree on the score').toBe(0);
    });
  }
});

describe('the audit is not a rubber stamp — it goes red when the rules are broken', () => {
  // A test that only ever passes proves nothing. Each of these MUTATES the log or the board the
  // way a real bug would and asserts the audit notices. Without this section, the block above is
  // indistinguishable from `expect(0).toBe(0)`.
  const base = (): { run: Run; log: PlaceEvent[]; claimed: { watches: number[]; girt: number } } => {
    const run = dealRun('canopy', 7);
    const g = new Game(run);
    let guard = 0;
    while (!g.over && guard++ < 400) {
      const d = g.deal;
      if (!d) break;
      if (d.kind === 'carve') {
        g.carve(bestCarve(g, SKILLS.tallow));
        continue;
      }
      const best = bestMove(g, SKILLS.tallow);
      if (!best || !g.play(best.choice)) break;
    }
    const sc = g.score();
    return {
      run,
      log: g.log.map((e) => ({ ...e, cells: e.cells.map((c) => [...c] as [number, number]) })),
      claimed: { watches: sc.watches.map((w) => w.total), girt: sc.girt },
    };
  };

  it('a clean run is clean, so the mutations below mean something', () => {
    const { run, log, claimed } = base();
    const f = audit(run, log, claimed);
    expect(f.outOfBounds + f.onOccupied + f.notCongruent + f.disconnected + f.scoreMismatch).toBe(0);
  });

  it('catches a cell shifted off the declared shape', () => {
    const { run, log, claimed } = base();
    const victim = log.findIndex((e) => e.cells.length > 2);
    log[victim].cells[0] = [log[victim].cells[0][0], log[victim].cells[0][1] + 3];
    expect(audit(run, log, claimed).notCongruent).toBeGreaterThan(0);
  });

  it('catches a placement that runs off the map', () => {
    const { run, log, claimed } = base();
    log[2].cells[0] = [run.size + 2, 0];
    expect(audit(run, log, claimed).outOfBounds).toBeGreaterThan(0);
  });

  it('catches two placements written on the same square', () => {
    const { run, log, claimed } = base();
    log[5].cells = [...log[1].cells.map((c) => [...c] as [number, number])];
    const f = audit(run, log, claimed);
    expect(f.onOccupied).toBeGreaterThan(0);
  });

  it('catches a scrawl that claimed nothing fitted when something did', () => {
    const { run, log, claimed } = base();
    const i = log.findIndex((e) => e.kind === 'card' && e.cells.length >= 3);
    log[i] = { ...log[i], shapeId: 'bar3', branch: 'scrawl', fallback: true, cells: [log[i].cells[0]] };
    expect(audit(run, log, claimed).bogusFallback).toBeGreaterThan(0);
  });

  it('catches a carve that ignored its anchor', () => {
    const { run, log, claimed } = base();
    const i = log.findIndex((e) => e.kind === 'carve');
    expect(i, 'this seed had no carve to mutate').toBeGreaterThanOrEqual(0);
    // Move the rot into a corner it could not legally have reached under most anchors.
    log[i] = { ...log[i], cells: log[i].cells.map((_, k) => [k, 0] as [number, number]) };
    const f = audit(run, log, claimed);
    expect(f.anchorViolated + f.notCongruent + f.onOccupied).toBeGreaterThan(0);
  });

  it('catches a score that is one point out — which is what a changed multiplier looks like', () => {
    const { run, log, claimed } = base();
    const bumped = { ...claimed, watches: claimed.watches.map((v, i) => (i === 0 ? v + 1 : v)) };
    expect(audit(run, log, bumped).scoreMismatch).toBeGreaterThan(0);
  });

  it('catches a girt bonus that counts something it should not', () => {
    const { run, log, claimed } = base();
    expect(audit(run, log, { ...claimed, girt: claimed.girt + 4 }).scoreMismatch).toBeGreaterThan(0);
  });
});
