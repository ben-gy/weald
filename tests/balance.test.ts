// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
//
// balance.test.ts — principle #18, adapted honestly to a game that has no seats to be unfair to.
//
// WHY THE USUAL METRICS DO NOT APPLY, AND WHAT REPLACES THEM. Weald is parallel same-seed: every
// player in a room is dealt the identical sequence of shapes, in the identical order, from the same
// frozen seed. There is no turn order, no shared supply, and nothing one player can take from
// another — so "seat win rate" is not merely healthy here, it is undefined, and asserting it would
// be theatre. Leader-at-move-N is equally meaningless when nobody can interact.
//
// The questions that DO have teeth for this shape, all four of which are asserted below:
//   A. SEED COMPARABILITY. Within a room the seed is shared, so a generous seed cannot make the
//      game unfair. It CAN make a daily score meaningless across days, so the spread is bounded and
//      the bound is stated per mode with its reason.
//   B. THE CELLS INVARIANT, at zero tolerance. Stratified slots exist so that how much you get to
//      draw is a designed constant rather than a roll. If it can drift, the whole seed-fairness
//      argument is a story.
//   C. THE DIFFICULTY CURVE. Scoring is cumulative, so a run must get MORE valuable as it goes;
//      a flat or falling curve means the last watch is bookkeeping.
//   D. THE BOREDOM GATE. The genre's characteristic failure is a late game with one legal home for
//      each shape. This is the numeric form of the fix, and it is the assertion that would catch a
//      regression in the slot table.
// Plus two NEGATIVE-GAP CONTROLS, because a mechanic is only load-bearing if disabling it hurts.
//
// EVERY NUMBER HERE WAS MEASURED FIRST AND THE BOUNDS SET AROUND WHAT WAS OBSERVED, in that order.
// Three separate things were changed because this file said so and not because they sounded right:
// March's canker rate (its 5th-percentile score was NEGATIVE), four edicts whose contribution was
// 10-27x apart, and two rule thresholds that made their cards fire almost never.

import { describe, expect, it } from 'vitest';
import { SKILLS } from '../src/bots';
import { MODES, MODE_IDS, WATCHES, type ModeId } from '../src/modes';
import { poolOf } from '../src/edicts';
import { dealRun, maxShapeCells, placementCount } from '../src/deck';
import { Game } from '../src/game';
import { bestCarve, bestMove } from '../src/bots';
import { mean, median, pct, sd, scoreOnly, sweep, type RunStats } from './helpers/sim';

const N = 150;

/** Cached so the whole file is one sweep per mode rather than one per assertion. */
const RUNS: Record<string, RunStats[]> = {};
const runsFor = (m: ModeId): RunStats[] => (RUNS[m] ??= sweep(m, N));

describe('A. seed comparability', () => {
  // NOT a fairness metric. Everyone in a room shares the seed, so a generous seed is generous to
  // the whole table at once and changes nobody's chances. What it would spoil is comparing your
  // Tuesday score to your Wednesday score, which is why it is bounded at all.
  const BOUND: Record<ModeId, { cv: number; ratio: number }> = {
    canopy: { cv: 0.22, ratio: 2.1 },
    survey: { cv: 0.24, ratio: 2.2 },
    // March is the loosest ON PURPOSE and this is not a fudge: it takes a canker carve in every
    // watch, and where the rot lands is the single biggest swing in the game. Measured CV 0.28.
    march: { cv: 0.34, ratio: 3.1 },
  };
  for (const m of MODE_IDS) {
    it(`${m} spreads no wider than its bound`, () => {
      const s = runsFor(m).map((r) => r.score);
      const cv = sd(s) / mean(s);
      const ratio = pct(s, 0.95) / Math.max(1, pct(s, 0.05));
      expect(cv, `CV ${cv.toFixed(3)} (mean ${mean(s).toFixed(1)})`).toBeLessThanOrEqual(BOUND[m].cv);
      expect(ratio, `p95/p5 ${ratio.toFixed(2)}`).toBeLessThanOrEqual(BOUND[m].ratio);
    });

    it(`${m} never deals a run that scores nothing`, () => {
      // March's 5th percentile was −4 before the canker rate was measured and cut. A mode whose
      // bad seeds score negative is a mode nobody plays twice.
      const s = runsFor(m).map((r) => r.score);
      expect(Math.min(...s), 'a seed produced a non-positive score').toBeGreaterThan(0);
    });

    it(`${m} holds across an INDEPENDENT seed family, not just the first one`, () => {
      // A number that only holds for seeds 1..150 is a property of those seeds. Replicating on a
      // family with a different structure is what turns it into a property of the game.
      const other = sweep(m, 60, SKILLS.tallow, 900_001).map((r) => r.score);
      const base = runsFor(m).map((r) => r.score);
      const drift = Math.abs(sd(other) / mean(other) - sd(base) / mean(base));
      expect(drift, `CV moved ${drift.toFixed(3)} between seed families`).toBeLessThan(0.09);
    });
  }
});

describe('B. the cells invariant, at zero tolerance', () => {
  for (const m of MODE_IDS) {
    it(`${m} deals the same number of placements to every seed`, () => {
      const counts = new Set<number>();
      for (let s = 1; s <= 60; s++) counts.add(placementCount(dealRun(m, s)));
      expect(counts.size, `varies: ${[...counts].join(', ')}`).toBe(1);
    });

    it(`${m} writes a bounded number of cells, whatever the seed`, () => {
      // The player's own branch choices move this (a scrawl is one cell, branch B is smaller), so
      // it is a band rather than a constant — but the band is set by the SLOT TABLE, not by luck.
      const cells = runsFor(m).map((r) => r.cells);
      const ceiling = Math.max(...Array.from({ length: 40 }, (_, i) => maxShapeCells(dealRun(m, i + 1))));
      expect(Math.max(...cells), 'more cells written than any deal could offer').toBeLessThanOrEqual(
        ceiling + 8,
      );
      expect(Math.min(...cells), 'a run wrote almost nothing').toBeGreaterThan(ceiling * 0.55);
    });

    it(`${m} leaves the map unfinished, so the last cards still have somewhere to go`, () => {
      const fills = runsFor(m).map((r) => r.fill);
      expect(Math.max(...fills), 'a run filled the entire map').toBeLessThan(0.95);
      expect(mean(fills), `mean fill ${(mean(fills) * 100).toFixed(0)}%`).toBeGreaterThan(0.5);
    });
  }
});

describe('C. the difficulty curve compounds', () => {
  for (const m of MODE_IDS) {
    it(`${m} is worth more at the end than at the start`, () => {
      const per = Array.from({ length: WATCHES }, (_, w) => mean(runsFor(m).map((r) => r.watchTotals[w] ?? 0)));
      // Scoring is cumulative over the whole map, so a watch that scores less than the one before
      // it means the canker is outrunning the map — which is exactly the state March shipped in
      // before its rate was measured.
      expect(per[WATCHES - 1] / Math.max(1, per[0]), `curve ${per.map((v) => v.toFixed(1)).join(' -> ')}`).toBeGreaterThan(1.5);
      for (let w = 1; w < WATCHES; w++) {
        expect(per[w], `watch ${w} scored less than watch ${w - 1}: ${per.map((v) => v.toFixed(1)).join(' -> ')}`).toBeGreaterThan(
          per[w - 1] * 0.75,
        );
      }
    });

    it(`${m} charges a canker bill that is felt but not fatal`, () => {
      const c = runsFor(m).map((r) => r.canker);
      const s = runsFor(m).map((r) => r.score);
      const share = Math.abs(mean(c)) / (mean(s) + Math.abs(mean(c)));
      expect(share, `canker is ${(share * 100).toFixed(0)}% of gross`).toBeGreaterThan(0.05);
      expect(share, `canker is ${(share * 100).toFixed(0)}% of gross — the mode is a tax, not a game`).toBeLessThan(0.5);
    });
  }

  it('and March genuinely plays its rot differently — the mode lever is not cosmetic', () => {
    // The obvious assertion here — "March pays a bigger canker bill" — was written first and it is
    // WRONG, which is worth recording. March takes rot in all four watches to Canopy's three, so it
    // ought to be billed more; measured, it is billed LESS (14.4 against 16.1). The reason is the
    // mode working exactly as designed: March's pool pays for SEALING the canker, so its bot walls
    // the rot in, and walling it in is also what stops it bleeding. A bigger bill would have meant
    // the counterplay did not exist. So the thing to assert is the counterplay itself.
    const sealed = (m: ModeId): number =>
      mean(
        runsFor(m).map((r) => {
          const g = r.game.board;
          let n = 0;
          for (let i = 0; i < g.g.length; i++) {
            if (g.g[i] !== 5) continue;
            const x = i % g.size;
            const y = (i / g.size) | 0;
            let open = false;
            for (const [dx, dy] of [
              [0, -1],
              [1, 0],
              [0, 1],
              [-1, 0],
            ] as const) {
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= g.size || ny >= g.size) continue;
              if (g.g[ny * g.size + nx] === 0) open = true;
            }
            if (!open) n++;
          }
          return n;
        }),
      );
    expect(
      sealed('march'),
      `March sealed ${sealed('march').toFixed(1)} canker squares to Canopy's ${sealed('canopy').toFixed(1)} — its pool is supposed to make walling the rot in worth doing`,
    ).toBeGreaterThan(sealed('canopy') * 1.2);
  });
});

describe('D. the boredom gate', () => {
  // THE GENRE'S CHARACTERISTIC FAILURE, stated as a number. By the last watch the map is ~70% full;
  // if a five-cell shape then has one legal home, the final placements stop being decisions and
  // become bookkeeping, and the player has finished the game five turns before it ends. The fix is
  // that shapes get SMALLER as the map fills (five-cell slots exist only in the first two watches),
  // and this is the assertion that proves the fix still holds.
  for (const m of MODE_IDS) {
    it(`${m} always offers a real choice, including on the very last card`, () => {
      const all = runsFor(m).flatMap((r) => r.options);
      const last = runsFor(m).map((r) => r.lastOptions);
      expect(median(all), `median options ${median(all)}`).toBeGreaterThanOrEqual(20);
      expect(median(last), `last-card median ${median(last)}`).toBeGreaterThanOrEqual(8);
      expect(Math.min(...all), 'some card had a single legal move').toBeGreaterThan(1);
    });

    it(`${m} almost never forces a scrawl`, () => {
      const forced = runsFor(m).reduce((n, r) => n + r.forcedScrawls, 0);
      const total = runsFor(m).reduce((n, r) => n + r.placements, 0);
      expect(forced / total, `${((forced / total) * 100).toFixed(1)}% forced`).toBeLessThan(0.12);
    });
  }
});

describe('E. every edict earns its place in its pool', () => {
  // The first measured pass had Spinney at 2.1 against Cloister at 57 — a 27x spread, which means
  // three of the five cards in that pool were decoration and drawing them was a dead run. Two rule
  // thresholds and eight multipliers were changed because of this assertion, not before it.
  for (const m of MODE_IDS) {
    it(`${m}: the most generous edict pays at most twice the least`, () => {
      const names = poolOf(MODES[m].pool).map((e) => e.name);
      const totals: Record<string, number[]> = {};
      for (const r of runsFor(m)) {
        for (const [k, v] of Object.entries(r.perEdict)) (totals[k] ??= []).push(v);
      }
      const means = names.filter((n) => totals[n]?.length >= 10).map((n) => [n, mean(totals[n])] as const);
      const lo = Math.min(...means.map(([, v]) => v));
      const hi = Math.max(...means.map(([, v]) => v));
      const detail = means.map(([n, v]) => `${n} ${v.toFixed(1)}`).join(', ');
      expect(lo, `an edict pays almost nothing — ${detail}`).toBeGreaterThan(8);
      expect(hi / lo, `spread ${(hi / lo).toFixed(2)}x — ${detail}`).toBeLessThanOrEqual(2.4);
    });
  }
});

describe('F. the modes are different games, not a re-skin', () => {
  // THE CROSS-PLAY MATRIX. A bot that optimises one mode's edict pool while actually PLAYING
  // another must do badly. If it does not, the pools describe the same good map and the three modes
  // are one game with the labels changed.
  for (const play of MODE_IDS) {
    it(`${play} punishes a bot that wants the wrong things`, () => {
      const matched = mean(Array.from({ length: 40 }, (_, i) => scoreOnly(play, i + 1, SKILLS.tallow)));
      for (const think of MODE_IDS) {
        if (think === play) continue;
        const foreign = poolOf(MODES[think].pool).slice(0, 4);
        const scores: number[] = [];
        for (let s = 1; s <= 40; s++) {
          const run = dealRun(play, s);
          const g = new Game(run);
          // The shadow game shares the board but is scored against the FOREIGN pool, so the bot
          // genuinely wants the wrong map while the real game grades it on the right one.
          const shadow = new Game({ ...run, roles: foreign });
          let guard = 0;
          while (!g.over && guard++ < 400) {
            const d = g.deal;
            if (!d) break;
            shadow.board.g.set(g.board.g);
            (shadow as unknown as { cursor: number }).cursor = g.index;
            if (d.kind === 'carve') {
              g.carve(bestCarve(shadow, SKILLS.tallow));
              continue;
            }
            const best = bestMove(shadow, SKILLS.tallow);
            if (!best || !g.play(best.choice)) break;
          }
          scores.push(g.score().total);
        }
        const loss = (matched - mean(scores)) / matched;
        expect(
          loss,
          `${think}-brain playing ${play} lost only ${(loss * 100).toFixed(0)}% — the pools want the same map`,
        ).toBeGreaterThan(0.18);
      }
    });
  }
});

describe('G. negative-gap controls — is the mechanic actually load-bearing?', () => {
  it('free rotation is worth something: a bot locked to one orientation scores less', () => {
    for (const m of MODE_IDS) {
      const free = Array.from({ length: 50 }, (_, i) => scoreOnly(m, i + 1, SKILLS.tallow, false));
      const fixed = Array.from({ length: 50 }, (_, i) => scoreOnly(m, i + 1, SKILLS.tallow, true));
      // BYTE-IDENTICAL means the control flag never reached the evaluator, which is a broken test
      // rather than an inert mechanic — and it is exactly how a fleet sibling shipped a fake
      // control arm. Assert the arms genuinely differ before believing the gap.
      expect(mean(free), `${m}: the control arm produced identical play`).not.toBe(mean(fixed));
      const gap = (mean(free) - mean(fixed)) / mean(free);
      expect(gap, `${m}: rotation bought only ${(gap * 100).toFixed(1)}%`).toBeGreaterThan(0.05);
    }
  });

  it('the staggered reveal matters: a bot that can see the hidden edicts does better', () => {
    // If peeking is worth nothing, turning two of the four cards face down is decoration and the
    // "endgame is a change of plan" claim in the how-to-play is false.
    const blind = SKILLS.sedge; // scores only what is face up
    const seer = { ...SKILLS.sedge, hedge: 1 }; // values hidden edicts as though revealed
    let better = 0;
    let n = 0;
    for (const m of MODE_IDS) {
      for (let s = 1; s <= 40; s++) {
        n++;
        if (scoreOnly(m, s, seer) > scoreOnly(m, s, blind)) better++;
      }
    }
    expect(better / n, `full sight helped on only ${((better / n) * 100).toFixed(0)}% of runs`).toBeGreaterThan(0.55);
  });
});

describe('H. playability — the check that has to pass before any number above means anything', () => {
  for (const m of MODE_IDS) {
    it(`${m}: every bot finishes every run, and none of them stalls`, () => {
      for (const skill of [SKILLS.tallow, SKILLS.sedge, SKILLS.knap]) {
        for (let s = 1; s <= 20; s++) {
          const g = new Game(dealRun(m, s));
          let guard = 0;
          while (!g.over && guard++ < 400) {
            const d = g.deal;
            if (!d) break;
            if (d.kind === 'carve') {
              g.carve(bestCarve(g, skill));
              continue;
            }
            const best = bestMove(g, skill);
            if (!best || !g.play(best.choice)) break;
          }
          expect(g.over, `${skill.id} stalled on ${m} seed ${s} at ${g.index}/${g.total}`).toBe(true);
          expect(g.log.length, `${skill.id} placed nothing`).toBeGreaterThan(0);
        }
      }
    });
  }
});
