// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// See ADDITIONAL-TERMS.md for the section 7(b) attribution requirement.
//
// Weald — the moment everyone compares, which is the one moment the whole design is pointed at.
//
// EVERY PLAYER'S BREAKDOWN, EVERY TIME. A summary that reflects only you back at yourself wastes
// the one screen where people talk to each other, and it is the reason this game is parallel
// same-seed in the first place: because every seat faced the IDENTICAL sequence of shapes from a
// different board state, the comparison is exact in a way almost nothing else can manage. Everyone
// gets a map thumbnail, an edict-by-edict line with a flag on whoever did best at each, their
// canker bill, and their second-guess.
//
// AND IT IS HONEST ABOUT WHAT IT CANNOT KNOW. The "second-guess" figure is a one-move-ahead
// comparison against the rules that were face up at the time. Finding the true optimum here is
// NP-hard and we do not pretend otherwise — the label says so on screen, in words, every time. A
// number quietly presented as "perfect play" would be a lie the game cannot back up.

import type { Board } from './board';
import { encodeGrid } from './board';
import type { RunScore } from './board';

export interface SeatResult {
  name: string;
  you: boolean;
  bot: boolean;
  board: Board;
  score: RunScore;
  secondGuess: number;
  /** False when the seat went quiet before the end; their last posted figures stand. */
  complete: boolean;
}

export interface SummaryLine {
  name: string;
  you: boolean;
  bot: boolean;
  grid: string;
  total: number;
  canker: number;
  girt: number;
  secondGuess: number;
  won: boolean;
  perEdict: Array<{ name: string; value: number; best: boolean }>;
}

export interface Summary {
  size: number;
  headline: string;
  sub: string;
  missed: string;
  lines: SummaryLine[];
}

export function summarise(seats: readonly SeatResult[], size: number, watchName: string | null): Summary {
  const sorted = [...seats].sort((a, b) => b.score.total - a.score.total);
  const top = sorted[0]?.score.total ?? 0;

  // "Table best" per edict, so every row can show who read each rule best rather than only who won.
  const bestPer = new Map<string, number>();
  for (const s of seats) {
    for (const e of s.score.perEdict) {
      bestPer.set(e.name, Math.max(bestPer.get(e.name) ?? -Infinity, e.value));
    }
  }

  const lines: SummaryLine[] = sorted.map((s) => ({
    name: s.name,
    you: s.you,
    bot: s.bot,
    grid: encodeGrid(s.board),
    total: s.score.total,
    canker: s.score.watches.reduce((n, w) => n + w.canker, 0),
    girt: s.score.girt,
    secondGuess: s.secondGuess,
    won: s.score.total === top,
    perEdict: s.score.perEdict.map((e) => ({
      name: e.name,
      value: e.value,
      best: e.value === bestPer.get(e.name) && seats.length > 1,
    })),
  }));

  const me = lines.find((l) => l.you);
  const iWon = me?.won ?? false;
  const headline = watchName
    ? `${watchName} ends`
    : iWon
      ? 'Your map takes it.'
      : `${sorted[0]?.name ?? 'Somebody else'} drew the better map.`;

  const spread = top - (sorted[sorted.length - 1]?.score.total ?? 0);
  const sub = watchName
    ? `${sorted.length} maps, ${spread} between best and worst so far.`
    : `${sorted.length} maps from the identical run of shapes — ${spread} between the best and the worst.`;

  // "What everyone missed", stated as what it actually is.
  const worst = Math.max(...lines.map((l) => l.secondGuess), 0);
  const missed = me
    ? `You left ${me.secondGuess} on the table against a move-by-move greedy line; the biggest miss at the table was ${worst}. That comparison looks one move ahead and only at the rules that were face up at the time — it is not a perfect line, and nobody here played one.`
    : 'Nobody was seated for this run.';

  return { size, headline, sub, missed, lines };
}
