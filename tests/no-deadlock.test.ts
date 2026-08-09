// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
//
// no-deadlock.test.ts — live-P2P contract gate #5: a waiting state must have a reason, a horizon and
// an escape.
//
// The failure this prevents is quiet rather than loud. One player is still reading the summary, or
// has put the phone down, or has closed the tab without Trystero noticing — and everybody else sits
// on a screen that says "waiting" for ever, with nothing to look at and nothing to press. So:
// quorum starts a VISIBLE countdown, the countdown starts the survey without the straggler,
// unanimity starts it instantly, and losing quorum cancels the countdown rather than firing it into
// an empty room.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRounds, type RoundInfo, type Rounds } from '@ben-gy/game-engine/rematch';
import { Bus } from './helpers/bus';

let bus: Bus;

function seat(id: string, name: string): { rounds: Rounds; got: RoundInfo[] } {
  const net = bus.join(id);
  const got: RoundInfo[] = [];
  const rounds = createRounds({ net, playerName: name, minPlayers: 2, onRound: (i) => got.push(i) });
  return { rounds, got };
}

const tick = (ms: number): void => {
  for (let t = 0; t < ms; t += 200) {
    vi.advanceTimersByTime(200);
    bus.flush();
  }
};

beforeEach(() => {
  vi.useFakeTimers();
  bus = new Bus();
});

describe('the countdown', () => {
  it('is exposed in ms, so a silent wait is never indistinguishable from a hang', () => {
    const a = seat('a', 'Ada');
    const b = seat('b', 'Bo');
    const c = seat('c', 'Cy');
    tick(6000);

    a.rounds.vote();
    b.rounds.vote();
    tick(1000);

    const st = a.rounds.state();
    expect(st.votes.length, 'quorum is two').toBe(2);
    expect(st.present.length).toBe(3);
    expect(st.startsInMs, 'the UI has nothing to render').not.toBeNull();
    expect(st.startsInMs!).toBeGreaterThan(0);
    expect(a.got.length, 'it must not have started yet — the third peer gets a moment').toBe(0);
    void c;
  });

  it('starts the survey WITHOUT the straggler when it runs out', () => {
    const a = seat('a', 'Ada');
    const b = seat('b', 'Bo');
    const c = seat('c', 'Cy');
    tick(6000);
    a.rounds.vote();
    b.rounds.vote();
    tick(12000);

    expect(a.got.length, 'one player who never taps must not hold the room').toBe(1);
    expect(a.got[0].players.map((p) => p.name)).toEqual(['Ada', 'Bo']);
    expect(c.got.length, 'the straggler is told a survey is under way').toBe(1);
    expect(c.got[0].seated, 'and is NOT seated in it').toBe(false);
  });

  it('but unanimity starts it at once, with no countdown at all', () => {
    const a = seat('a', 'Ada');
    const b = seat('b', 'Bo');
    tick(6000);
    a.rounds.vote();
    b.rounds.vote();
    tick(500);
    expect(a.got.length, 'both players tapped; there is nobody left to wait for').toBe(1);
  });

  it('and losing quorum cancels it rather than firing into an empty room', () => {
    const a = seat('a', 'Ada');
    const b = seat('b', 'Bo');
    const c = seat('c', 'Cy');
    tick(6000);
    a.rounds.vote();
    b.rounds.vote();
    tick(1000);
    expect(a.rounds.state().startsInMs).not.toBeNull();

    b.rounds.unvote();
    tick(1000);
    expect(a.rounds.state().startsInMs, 'the countdown outlived its quorum').toBeNull();
    tick(15000);
    expect(a.got.length).toBe(0);
    void c;
  });
});

describe('the host can always force it', () => {
  it('go() starts with whoever has voted, at once', () => {
    const a = seat('a', 'Ada');
    const b = seat('b', 'Bo');
    const c = seat('c', 'Cy');
    tick(6000);
    a.rounds.vote();
    b.rounds.vote();
    bus.flush();
    a.rounds.go();
    bus.flush();
    expect(a.got.length).toBe(1);
    expect(a.got[0].players.length).toBe(2);
    void c;
  });
});

describe('a peer that closes its tab mid-wait', () => {
  it('is simply gone, and the survey starts without it', () => {
    const a = seat('a', 'Ada');
    const b = seat('b', 'Bo');
    const c = seat('c', 'Cy');
    tick(6000);
    a.rounds.vote();
    b.rounds.vote();
    c.rounds.destroy();
    bus.leave('c');
    tick(6000);
    expect(a.got.length).toBe(1);
    expect(a.got[0].players.map((p) => p.name)).toEqual(['Ada', 'Bo']);
  });
});

describe('a peer that connects mid-survey', () => {
  it('is told, is unseated, and is in the next one', () => {
    const a = seat('a', 'Ada');
    const b = seat('b', 'Bo');
    tick(6000);
    a.rounds.vote();
    b.rounds.vote();
    tick(2000);
    expect(a.got.length).toBe(1);

    const c = seat('c', 'Cy');
    tick(6000);
    expect(c.got.length, 'a mid-survey joiner must be told a survey is running').toBe(1);
    expect(c.got[0].seated).toBe(false);

    a.rounds.finish();
    b.rounds.finish();
    c.rounds.finish();
    tick(6000);
    a.rounds.vote();
    b.rounds.vote();
    c.rounds.vote();
    tick(6000);
    expect(c.got.length).toBe(2);
    expect(c.got[1].seated, 'and IS seated in the next one').toBe(true);
  });
});
