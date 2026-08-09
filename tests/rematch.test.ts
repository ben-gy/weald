// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
//
// rematch.test.ts — live-P2P contract gate #3: a session is a LOOP, not a one-way trip.
//
// lobby -> survey -> results -> survey -> results. Every one of those transitions happens inside the
// living room; the Net is never touched. What has to be true each time is that exactly one round
// starts, that every peer gets the identical seed and the identical FROZEN roster (so the summary
// is comparing the same people in the same order on every screen), and that the host's mode travels
// with the start rather than being read locally by each peer — which for THIS game is not a
// cosmetic detail, because the mode decides the board size and the edict pool. Two peers
// disagreeing about the mode would be drawing different-sized maps and scoring against different
// rules, then comparing the totals as if they meant something.
//
// The fake bus sits ABOVE Trystero's room cache, so it structurally cannot contain the leave/rejoin
// defect — net-lifecycle.test.ts guards that — and this file is only about the protocol decisions.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRounds, type RoundInfo, type Rounds } from '@ben-gy/game-engine/rematch';
import { Bus } from './helpers/bus';
import { modeOf } from '../src/modes';
import { dealRun } from '../src/deck';

interface Opts {
  mode: string;
}

let bus: Bus;

function seat(id: string, name: string, mode = 'canopy'): { rounds: Rounds<Opts>; got: RoundInfo<Opts>[] } {
  const net = bus.join(id);
  const got: RoundInfo<Opts>[] = [];
  const rounds = createRounds<Opts>({
    net,
    playerName: name,
    minPlayers: 2,
    roundOpts: () => ({ mode }),
    onRound: (info) => got.push(info),
  });
  return { rounds, got };
}

const settle = (ms = 6000): void => {
  for (let t = 0; t < ms; t += 250) {
    vi.advanceTimersByTime(250);
    bus.flush();
  }
};

beforeEach(() => {
  vi.useFakeTimers();
  bus = new Bus();
});

describe('a first survey', () => {
  it('starts once, with an identical seed and frozen roster on every peer', () => {
    const a = seat('a', 'Ada', 'march');
    const b = seat('b', 'Bo');
    const c = seat('c', 'Cy');
    settle();
    a.rounds.vote();
    b.rounds.vote();
    c.rounds.vote();
    settle();

    for (const s of [a, b, c]) expect(s.got.length, 'exactly one start per peer').toBe(1);
    expect(new Set([a, b, c].map((s) => s.got[0].seed)).size, 'the seeds differ').toBe(1);
    expect(a.got[0].round).toBe(1);
    expect(b.got[0].players.map((p) => p.id)).toEqual(a.got[0].players.map((p) => p.id));
    expect(a.got[0].players.map((p) => p.name)).toEqual(['Ada', 'Bo', 'Cy']);
    expect([a.got[0].isHost, b.got[0].isHost, c.got[0].isHost], 'exactly one host').toEqual([
      true,
      false,
      false,
    ]);
    expect([a, b, c].every((s) => s.got[0].seated)).toBe(true);
  });

  it("the HOST's survey travels with the start — and it decides the BOARD SIZE", () => {
    const a = seat('a', 'Ada', 'survey'); // 8x8
    const b = seat('b', 'Bo', 'canopy'); // 9x9
    settle();
    a.rounds.vote();
    b.rounds.vote();
    settle();
    expect(modeOf(a.got[0].opts?.mode).id).toBe('survey');
    expect(modeOf(b.got[0].opts?.mode).id, 'the guest drew its own mode').toBe('survey');
    // The consequence, spelled out: a disagreement here is two different games on one seed.
    const ra = dealRun(modeOf(a.got[0].opts?.mode).id, a.got[0].seed);
    const rb = dealRun(modeOf(b.got[0].opts?.mode).id, b.got[0].seed);
    expect(rb.size).toBe(ra.size);
    expect(JSON.stringify(rb.watches)).toBe(JSON.stringify(ra.watches));
    expect(rb.roles.map((e) => e.id)).toEqual(ra.roles.map((e) => e.id));
  });

  it('and a guest sees the host s choice before the survey begins, not its own', () => {
    const a = seat('a', 'Ada', 'march');
    const b = seat('b', 'Bo', 'canopy');
    settle();
    // Rendering your own pick and labelling it the host's is a confident lie, and it has shipped.
    expect(modeOf(b.rounds.state().hostOpts?.mode).id).toBe('march');
  });

  it('an unknown mode off the wire falls back rather than reaching the generator as undefined', () => {
    for (const bad of ['constructor', '__proto__', 'nope', '']) {
      expect(modeOf(bad).id).toBe('canopy');
      expect(() => dealRun(modeOf(bad).id, 1)).not.toThrow();
    }
  });
});

describe('a rematch', () => {
  it('is a new round number and a NEW seed, in the same room', () => {
    const a = seat('a', 'Ada');
    const b = seat('b', 'Bo');
    settle();
    a.rounds.vote();
    b.rounds.vote();
    settle();

    a.rounds.finish();
    b.rounds.finish();
    settle();
    a.rounds.vote();
    b.rounds.vote();
    settle();

    expect(a.got.length).toBe(2);
    expect(b.got.length).toBe(2);
    expect(a.got[1].round).toBe(2);
    expect(a.got[1].seed).toBe(b.got[1].seed);
    expect(a.got[1].seed, 'a rematch that redeals the same run is not a rematch').not.toBe(a.got[0].seed);
    expect(a.got[1].players.map((p) => p.id)).toEqual(b.got[1].players.map((p) => p.id));
  });

  it('and the new run really is a different map, not the same one relabelled', () => {
    const a = seat('a', 'Ada');
    const b = seat('b', 'Bo');
    settle();
    a.rounds.vote();
    b.rounds.vote();
    settle();
    a.rounds.finish();
    b.rounds.finish();
    settle();
    a.rounds.vote();
    b.rounds.vote();
    settle();
    const one = dealRun('canopy', a.got[0].seed);
    const two = dealRun('canopy', a.got[1].seed);
    expect(JSON.stringify(two.watches)).not.toBe(JSON.stringify(one.watches));
  });

  it('a promoted host can run one, and inherits no tally of its own', () => {
    const a = seat('a', 'Ada');
    const b = seat('b', 'Bo');
    const c = seat('c', 'Cy');
    settle();
    a.rounds.vote();
    b.rounds.vote();
    c.rounds.vote();
    settle();
    expect(a.got.length).toBe(1);

    // The host walks out between surveys.
    a.rounds.destroy();
    bus.leave('a');
    bus.setHost('b');
    settle();

    b.rounds.finish();
    c.rounds.finish();
    settle();
    b.rounds.vote();
    c.rounds.vote();
    settle();

    expect(b.got.length, 'the promoted peer could not start a survey').toBe(2);
    expect(b.got[1].isHost).toBe(true);
    expect(b.got[1].players.map((p) => p.name)).toEqual(['Bo', 'Cy']);
  });
});

describe('a peer that leaves', () => {
  it('is dropped from the roster rather than deadlocking it', () => {
    const a = seat('a', 'Ada');
    const b = seat('b', 'Bo');
    const c = seat('c', 'Cy');
    settle();
    a.rounds.vote();
    b.rounds.vote();
    c.rounds.vote();
    settle();
    expect(a.got[0].players.length).toBe(3);

    a.rounds.finish();
    b.rounds.finish();
    c.rounds.finish();
    settle();

    c.rounds.destroy();
    bus.leave('c');
    settle();

    a.rounds.vote();
    b.rounds.vote();
    settle();
    expect(a.got.length).toBe(2);
    expect(a.got[1].players.map((p) => p.name)).toEqual(['Ada', 'Bo']);
  });
});

describe('a duplicated or stale start is ignored', () => {
  it('the same round never fires twice on a peer', () => {
    const a = seat('a', 'Ada');
    const b = seat('b', 'Bo');
    settle();
    a.rounds.vote();
    b.rounds.vote();
    settle();
    const n = b.got.length;
    // The host re-broadcasts the current start for anyone who connected mid-round; a peer that
    // already has it must not start over.
    settle(10000);
    expect(b.got.length, 'a re-broadcast restarted the survey').toBe(n);
  });
});
