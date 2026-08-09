// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
//
// rng.test.ts — THE P2P-SYNC INVARIANT, and for this game it is the entire netcode.
//
// Weald sends no game state at all. Every peer deals its own run from the seed the host froze into
// the round start, and the summary then puts everybody's maps side by side as though they had faced
// the same shapes — because they did. That claim rests on one thing: the same seed producing the
// same run, byte for byte, on every device. One `Math.random()` in the generator and two people are
// comparing scores earned on different games, with nothing anywhere to tell them.
//
// So this file is not a nicety. It is the test that makes the multiplayer claim true.

import { describe, expect, it } from 'vitest';
import { hashSeed, makeRng, pick, shuffle } from '@ben-gy/game-engine/rng';
import { dealRun } from '../src/deck';
import { Game } from '../src/game';
import { SKILLS, bestCarve, bestMove } from '../src/bots';
import { encodeGrid } from '../src/board';
import { MODE_IDS } from '../src/modes';

describe('the engine PRNG is deterministic', () => {
  it('the same seed gives the same stream', () => {
    const a = Array.from({ length: 20 }, makeRng(1234));
    const b = Array.from({ length: 20 }, makeRng(1234));
    expect(a).toEqual(b);
  });
  it('different seeds give different streams', () => {
    expect(Array.from({ length: 8 }, makeRng(1))).not.toEqual(Array.from({ length: 8 }, makeRng(2)));
  });
  it('a string seed hashes stably', () => {
    expect(hashSeed('weald|canopy|7')).toBe(hashSeed('weald|canopy|7'));
    expect(hashSeed('a')).not.toBe(hashSeed('b'));
  });
  it('shuffle and pick are pure functions of the stream', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(shuffle(makeRng(9), arr)).toEqual(shuffle(makeRng(9), arr));
    expect(pick(makeRng(9), arr)).toBe(pick(makeRng(9), arr));
    expect(arr, 'shuffle mutated its input — a shared array would desync every later draw').toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });
});

describe('two peers deal the identical run from one seed', () => {
  for (const m of MODE_IDS) {
    it(`${m}: crags, edict roles, every card and every carve`, () => {
      for (const seed of [1, 42, 99991, 2 ** 31 - 1]) {
        const a = dealRun(m, seed);
        const b = dealRun(m, seed);
        expect(JSON.stringify(a.crags)).toBe(JSON.stringify(b.crags));
        expect(a.roles.map((e) => e.id)).toEqual(b.roles.map((e) => e.id));
        expect(JSON.stringify(a.watches)).toBe(JSON.stringify(b.watches));
      }
    });
  }

  it('and the whole run is reproducible move for move, not just the deal', () => {
    // The stronger claim: two peers who make the same decisions end with byte-identical maps. If
    // this held for the deal but not the play, the summary would still be comparing different
    // games — it would just be harder to notice.
    for (const m of MODE_IDS) {
      const play = (): string => {
        const g = new Game(dealRun(m, 777));
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
        return `${encodeGrid(g.board)}|${g.score().total}`;
      };
      expect(play(), `${m} is not reproducible`).toBe(play());
    }
  });

  it('a neighbouring seed deals a genuinely different run', () => {
    const a = JSON.stringify(dealRun('canopy', 1000).watches);
    const b = JSON.stringify(dealRun('canopy', 1001).watches);
    expect(a).not.toBe(b);
  });

  it('and the mode is part of the seed, so two modes never share a deal', () => {
    expect(JSON.stringify(dealRun('canopy', 5).watches)).not.toBe(
      JSON.stringify(dealRun('march', 5).watches),
    );
  });
});

describe('nothing in the generator reaches for the clock or the global RNG', () => {
  it('dealing the same seed a hundred calls apart is still identical', () => {
    const first = JSON.stringify(dealRun('canopy', 31337));
    for (let i = 0; i < 100; i++) dealRun('march', i);
    expect(JSON.stringify(dealRun('canopy', 31337))).toBe(first);
  });
});
