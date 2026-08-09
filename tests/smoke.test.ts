// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
//
// smoke.test.ts — the first question to answer about any generated game, and the one this factory
// has learned to ask before trusting a single balance number: CAN THE OBJECTIVE BE COMPLETED AT
// ALL? A sim whose bot times out on every run is not measuring imbalance, it is measuring a broken
// loop, and every statistic downstream of it is noise dressed as evidence.

import { describe, expect, it } from 'vitest';
import { dealRun, placementCount } from '../src/deck';
import { Game } from '../src/game';
import { SKILLS, playOut } from '../src/bots';
import { MODE_IDS, MODES } from '../src/modes';
import { emptyCount } from '../src/measure';

describe('every mode deals a run that a bot can finish', () => {
  for (const id of MODE_IDS) {
    it(`${id}`, () => {
      for (let seed = 1; seed <= 8; seed++) {
        const run = dealRun(id, seed);
        const g = new Game(run);
        const r = playOut(g, SKILLS.tallow);
        expect(g.over, `seed ${seed} did not finish`).toBe(true);
        expect(g.log.length, `seed ${seed} placed nothing`).toBeGreaterThan(0);
        expect(r.score, `seed ${seed} scored nothing at all`).toBeGreaterThan(0);
      }
    });
  }
});

describe('the deal is the shape the modes promise', () => {
  for (const id of MODE_IDS) {
    it(`${id} deals a constant number of placements whatever the seed`, () => {
      const counts = new Set<number>();
      for (let seed = 1; seed <= 30; seed++) counts.add(placementCount(dealRun(id, seed)));
      // Stratified slots exist precisely so this is a designed constant rather than a roll: it is
      // what stops one seed from being more generous than another.
      expect(counts.size, `placement count varies by seed: ${[...counts].join(', ')}`).toBe(1);
    });

    it(`${id} carves the canker in exactly the watches its mode declares`, () => {
      const mode = MODES[id];
      for (let seed = 1; seed <= 10; seed++) {
        const run = dealRun(id, seed);
        const got: number[] = [];
        run.watches.forEach((w, i) => {
          if (w.deals.some((d) => d.kind === 'carve')) got.push(i);
        });
        expect(got).toEqual([...mode.cankerWatches]);
      }
    });

    it(`${id} draws four distinct edicts, all from its own pool`, () => {
      const mode = MODES[id];
      for (let seed = 1; seed <= 20; seed++) {
        const run = dealRun(id, seed);
        expect(run.roles.length).toBe(4);
        expect(new Set(run.roles.map((e) => e.id)).size, 'an edict was drawn twice').toBe(4);
        for (const e of run.roles) expect(e.pool).toBe(mode.pool);
      }
    });
  }
});

describe('the same seed deals the same run on every peer', () => {
  it('two independent deals of one seed are byte-identical', () => {
    for (const id of MODE_IDS) {
      const a = JSON.stringify(dealRun(id, 12345).watches);
      const b = JSON.stringify(dealRun(id, 12345).watches);
      expect(b, `${id} is not deterministic`).toBe(a);
      expect(dealRun(id, 12345).crags).toEqual(dealRun(id, 12345).crags);
      expect(dealRun(id, 12345).roles.map((e) => e.id)).toEqual(
        dealRun(id, 12345).roles.map((e) => e.id),
      );
    }
  });

  it('and different seeds deal different runs', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) seen.add(JSON.stringify(dealRun('canopy', seed).watches));
    expect(seen.size, 'the seed is not reaching the generator').toBeGreaterThan(15);
  });
});

describe('a run leaves the map partly unwritten, on purpose', () => {
  it('so the last placements still have somewhere to go', () => {
    for (const id of MODE_IDS) {
      for (let seed = 1; seed <= 6; seed++) {
        const g = new Game(dealRun(id, seed));
        playOut(g, SKILLS.tallow);
        const left = emptyCount(g.board.g);
        expect(left, `${id} seed ${seed} filled the whole map`).toBeGreaterThan(0);
      }
    }
  });
});
