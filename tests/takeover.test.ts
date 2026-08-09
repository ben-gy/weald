// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
//
// takeover.test.ts — live-P2P contract gate #2, and the honest version of it for this game.
//
// In a host-authoritative game the host owns the simulation and losing it freezes the round, so the
// gate is "can the promoted peer keep the sim running". Weald is parallel same-seed: every peer
// derives the whole run from the frozen seed and plays it locally, and the host owns nothing except
// the right to freeze the next one. So the honest claim is that HOST TRANSFER IS A DISPLAY CONCERN
// — and a claim like that must be TESTED rather than asserted in a comment, because "it cannot
// break" is exactly what gets shipped broken.
//
// What is actually at risk in this shape, and is tested here:
//   1. A run must reach its end with no host at all, on any peer.
//   2. A message from a PREVIOUS round must never paint a stale map into a live summary. Every wire
//      message carries its round number and anything else is dropped.
//   3. A seat that goes silent must be tolerated: its last figures stand, and the watch gate must
//      not wait on it for ever.
//   4. A grid off the wire is untrusted input; a malformed one must not throw or corrupt a summary.

import { describe, expect, it, vi } from 'vitest';
import { Session } from '../src/session';
import { decodeGrid, encodeGrid } from '../src/board';
import { dealRun } from '../src/deck';
import { Game } from '../src/game';
import { SKILLS, bestCarve, bestMove } from '../src/bots';

function play(s: Session): void {
  let guard = 0;
  while (!s.game.over && guard++ < 400) {
    const d = s.game.deal;
    if (!d) break;
    if (d.kind === 'carve') {
      s.game.carve(bestCarve(s.game, SKILLS.tallow));
      s.afterPlay();
      continue;
    }
    const best = bestMove(s.game, SKILLS.tallow);
    if (!best || !s.game.play(best.choice)) break;
    s.afterPlay();
  }
}

function makeSession(peers: Array<{ id: string; name: string }>, sink: unknown[] = []): Session {
  return new Session({
    mode: 'canopy',
    seed: 4242,
    round: 3,
    skill: 'tallow',
    selfId: 'me',
    myName: 'Me',
    peers,
    deps: {
      send: (m) => sink.push(m),
      onChange: () => {},
      onWatchEnd: () => {},
      onEnd: () => {},
    },
  });
}

describe('1. a run finishes with nobody hosting anything', () => {
  it('the whole survey reaches its end and produces a score, host or no host', () => {
    const s = makeSession([
      { id: 'me', name: 'Me' },
      { id: 'them', name: 'Them' },
    ]);
    play(s);
    expect(s.game.over, 'the run did not finish').toBe(true);
    expect(s.game.score().total).toBeGreaterThan(0);
    // Nothing in the session ever asks who the host is; the run is a pure function of the seed.
    expect(s.summary(null).lines.length).toBeGreaterThan(0);
  });

  it('and two peers on the same seed derive the same run without exchanging any of it', () => {
    const a = makeSession([{ id: 'me', name: 'Me' }]);
    const b = makeSession([{ id: 'me', name: 'Me' }]);
    expect(JSON.stringify(a.run.watches)).toBe(JSON.stringify(b.run.watches));
    expect(a.run.roles.map((e) => e.id)).toEqual(b.run.roles.map((e) => e.id));
  });
});

describe('2. a message from another round is dropped', () => {
  const gridFor = (): string => {
    const g = new Game(dealRun('canopy', 4242));
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
    return encodeGrid(g.board);
  };

  it('a watch-end grid from the PREVIOUS survey never lands in this one', () => {
    const s = makeSession([
      { id: 'me', name: 'Me' },
      { id: 'them', name: 'Them' },
    ]);
    const grid = gridFor();
    s.receive({ t: 'w', r: 2, w: 0, g: grid, s: 999, sg: 0 }, 'them');
    const them = s.seats.find((x) => x.id === 'them')!;
    expect(them.grids[0], 'a stale round painted itself into a live summary').toBeNull();
    expect(them.totals[0]).toBeNull();
  });

  it('but the CURRENT round is accepted', () => {
    const s = makeSession([
      { id: 'me', name: 'Me' },
      { id: 'them', name: 'Them' },
    ]);
    s.receive({ t: 'w', r: 3, w: 0, g: gridFor(), s: 42, sg: 7 }, 'them');
    const them = s.seats.find((x) => x.id === 'them')!;
    expect(them.grids[0]).not.toBeNull();
    expect(them.totals[0]).toBe(42);
  });

  it('and a message from a peer who is not in the roster is ignored', () => {
    const s = makeSession([{ id: 'me', name: 'Me' }]);
    expect(() => s.receive({ t: 'w', r: 3, w: 0, g: gridFor(), s: 5, sg: 0 }, 'stranger')).not.toThrow();
  });
});

describe('3. a seat that goes quiet is tolerated, never waited on for ever', () => {
  it('the watch gate has a horizon rather than blocking on a silent peer', () => {
    vi.useFakeTimers();
    const s = makeSession([
      { id: 'me', name: 'Me' },
      { id: 'ghost', name: 'Ghost' },
    ]);
    // Drive to the first watch end; the other seat never posts anything.
    let guard = 0;
    while (!s.game.over && s.game.watchScores.length === 0 && guard++ < 100) {
      const d = s.game.deal;
      if (!d) break;
      if (d.kind === 'carve') {
        s.game.carve(bestCarve(s.game, SKILLS.tallow));
        s.afterPlay();
        continue;
      }
      const best = bestMove(s.game, SKILLS.tallow);
      if (!best || !s.game.play(best.choice)) break;
      s.afterPlay();
    }
    const left = s.gateIn();
    expect(left, 'a wait with no horizon is indistinguishable from a hang').not.toBeNull();
    expect(left!).toBeGreaterThan(0);
    expect(left!).toBeLessThanOrEqual(20000);
    vi.useRealTimers();
  });

  it('a departed seat still gets a row, with whatever it last posted', () => {
    const s = makeSession([
      { id: 'me', name: 'Me' },
      { id: 'them', name: 'Them' },
    ]);
    const g = new Game(dealRun('canopy', 4242));
    const best = bestMove(g, SKILLS.tallow)!;
    g.play(best.choice);
    s.receive({ t: 'w', r: 3, w: 0, g: encodeGrid(g.board), s: 11, sg: 0 }, 'them');
    s.peerLeft('them');
    play(s);
    const names = s.summary(null).lines.map((l) => l.name);
    expect(names, 'a player who left was dropped from the comparison').toContain('Them');
  });
});

describe('4. a grid off the wire is untrusted input', () => {
  it('a malformed grid is refused rather than throwing or corrupting the summary', () => {
    const s = makeSession([
      { id: 'me', name: 'Me' },
      { id: 'them', name: 'Them' },
    ]);
    const them = s.seats.find((x) => x.id === 'them')!;
    for (const bad of ['', 'xyz', '.'.repeat(80), '.'.repeat(82), '?'.repeat(81), null, 42, {}]) {
      expect(() => s.receive({ t: 'w', r: 3, w: 0, g: bad, s: 1, sg: 0 }, 'them')).not.toThrow();
    }
    expect(them.grids[0], 'a malformed grid was accepted').toBeNull();
    expect(() => s.summary(null)).not.toThrow();
  });

  it('a watch index off the end is refused', () => {
    const s = makeSession([
      { id: 'me', name: 'Me' },
      { id: 'them', name: 'Them' },
    ]);
    const g = encodeGrid(new Game(dealRun('canopy', 4242)).board);
    for (const w of [-1, 4, 99, NaN]) {
      expect(() => s.receive({ t: 'w', r: 3, w, g, s: 1, sg: 0 }, 'them')).not.toThrow();
    }
    expect(s.seats.find((x) => x.id === 'them')!.grids.every((x) => x === null)).toBe(true);
  });

  it('and a grid round-trips exactly, so a rival s map is drawn as they drew it', () => {
    const g = new Game(dealRun('canopy', 4242));
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
    const wire = encodeGrid(g.board);
    const back = decodeGrid(wire, g.board.size)!;
    expect(back).not.toBeNull();
    expect([...back.g]).toEqual([...g.board.g]);
    expect(wire.length, 'the whole map is one short string on the wire').toBe(81);
  });
});

describe('solo is the same code path with nobody in the room', () => {
  it('three rivals appear, the summary has four rows, and par exists', () => {
    const s = makeSession([]);
    expect(s.solo).toBe(true);
    expect(s.seats.length, 'a dead lobby must never be a dead page').toBe(4);
    expect(s.seats.filter((x) => x.bot).length).toBe(3);
    expect(s.me, 'the local player had no seat at all').toBeDefined();
    expect(s.par(), 'par is what the reference bot managed on this exact run').toBeGreaterThan(0);
    play(s);
    const sum = s.summary(null);
    expect(sum.lines.length).toBe(4);
    expect(sum.lines.every((l) => l.grid.length === 81), 'a row had no map').toBe(true);
    expect(sum.lines.some((l) => l.you)).toBe(true);
  });

  it('and every seat gets an edict-by-edict breakdown, not just a total', () => {
    const s = makeSession([]);
    play(s);
    for (const l of s.summary(null).lines) {
      expect(l.perEdict.length, `${l.name} has no breakdown`).toBe(4);
      expect(l.perEdict.every((e) => typeof e.value === 'number')).toBe(true);
    }
  });

  it('and the bots post a map at every watch, so the between-watch sheet is never empty', () => {
    const s = makeSession([]);
    for (const b of s.seats.filter((x) => x.bot)) {
      expect(b.grids.filter((g) => g !== null).length, `${b.name} only posted at the end`).toBe(4);
    }
  });
});
