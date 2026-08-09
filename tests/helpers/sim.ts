// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
//
// sim.ts — run many seeded runs and collect the shape of the outcome.
//
// Deliberately thin: it plays runs and records numbers, and it makes NO judgement about them. Every
// threshold lives in balance.test.ts where it can be read next to the reason for it.

import { dealRun } from '../../src/deck';
import { Game } from '../../src/game';
import { SKILLS, bestCarve, bestMove, playOut, type Skill } from '../../src/bots';
import { emptyCount } from '../../src/measure';
import type { ModeId } from '../../src/modes';

export interface RunStats {
  score: number;
  watchTotals: number[];
  canker: number;
  girt: number;
  fill: number;
  /** Legal (branch x orientation x position x terrain) options at each card. */
  options: number[];
  lastOptions: number;
  forcedScrawls: number;
  voluntaryScrawls: number;
  placements: number;
  perEdict: Record<string, number>;
  cells: number;
  log: Game['log'];
  game: Game;
}

/** Play one run with one skill, instrumenting every decision point on the way through. */
export function runOne(mode: ModeId, seed: number, skill: Skill = SKILLS.tallow): RunStats {
  const run = dealRun(mode, seed);
  const g = new Game(run);
  const options: number[] = [];
  let lastOptions = 0;
  let guard = 0;
  while (!g.over && guard++ < 400) {
    const d = g.deal;
    if (!d) break;
    if (d.kind === 'carve') {
      g.carve(bestCarve(g, skill));
      continue;
    }
    const n = g.optionCount();
    options.push(n);
    if (g.index === g.total - 1) lastOptions = n;
    const best = bestMove(g, skill);
    if (!best || !g.play(best.choice)) break;
  }
  const sc = g.score();
  const perEdict: Record<string, number> = {};
  for (const e of sc.perEdict) perEdict[e.name] = e.value;
  return {
    score: sc.total,
    watchTotals: sc.watches.map((w) => w.total),
    canker: sc.watches.reduce((n, w) => n + w.canker, 0),
    girt: sc.girt,
    fill: 1 - emptyCount(g.board.g) / (run.size * run.size),
    options,
    lastOptions,
    forcedScrawls: g.log.filter((e) => e.fallback && e.kind === 'card').length,
    voluntaryScrawls: g.log.filter((e) => e.voluntary).length,
    placements: g.log.length,
    perEdict,
    cells: g.log.reduce((n, e) => n + e.cells.length, 0),
    log: g.log,
    game: g,
  };
}

export function sweep(mode: ModeId, n: number, skill: Skill = SKILLS.tallow, from = 1): RunStats[] {
  const out: RunStats[] = [];
  for (let s = from; s < from + n; s++) out.push(runOne(mode, s, skill));
  return out;
}

/** Score only, for the control arms where the instrumentation is not needed. */
export function scoreOnly(mode: ModeId, seed: number, skill: Skill, fixedForm = false): number {
  return playOut(new Game(dealRun(mode, seed)), skill, { fixedForm }).score;
}

export const mean = (a: readonly number[]): number => a.reduce((x, y) => x + y, 0) / (a.length || 1);
export const sd = (a: readonly number[]): number => {
  const m = mean(a);
  return Math.sqrt(mean(a.map((v) => (v - m) ** 2)));
};
export const pct = (a: readonly number[], p: number): number => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(s.length * p)))];
};
export const median = (a: readonly number[]): number => pct(a, 0.5);
