// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
//
// net-lifecycle.test.ts — live-P2P contract gate: ONE ROOM PER SESSION. This is the most valuable
// trivial test in the suite, and its triviality is exactly the point.
//
// A rematch here versions SURVEYS inside the living room: the mode, the roster and the seed are
// frozen once by the host and travel in the start message. Leaving and rejoining to start the next
// survey hands back a room object that is still tearing down, Trystero's deferred leave then races
// the fresh join, and every peer ends up hosting its own private room — a table of people all
// tapping "play again" and all drawing alone. The engine makes that trap THROW rather than silently
// half-work; this file pins the throw and the one-join invariant. No transport required, which is
// precisely why a fake-bus protocol test can never stand in for it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const joinRoom = vi.fn();
let openRooms = 0;

vi.mock('trystero', () => {
  interface FakeRoom {
    makeAction: (name: string) => [ReturnType<typeof vi.fn>, (cb: unknown) => void];
    onPeerJoin: (cb: unknown) => void;
    onPeerLeave: (cb: unknown) => void;
    getPeers: () => Record<string, unknown>;
    leave: () => Promise<void>;
  }
  const make = (): FakeRoom => {
    openRooms++;
    return {
      makeAction: () => [vi.fn(), () => {}],
      onPeerJoin: () => {},
      onPeerLeave: () => {},
      getPeers: () => ({}),
      leave: () => new Promise<void>((res) => setTimeout(res, 0)),
    };
  };
  return {
    joinRoom: (...args: unknown[]) => {
      joinRoom(...args);
      return make();
    },
    selfId: 'self-peer',
  };
});

vi.mock('trystero/nostr', () => ({ getRelaySockets: () => ({}) }));

import { createNet, netStats, resetNetStats, roomAppId } from '@ben-gy/game-engine/net';

const CFG = { appId: roomAppId('weald'), roomId: 'K7QM' };

describe('one join per session', () => {
  beforeEach(() => {
    resetNetStats();
    joinRoom.mockClear();
    openRooms = 0;
  });

  it('a whole multi-survey session joins exactly once', async () => {
    const net = createNet(CFG);
    // The progress channel and the roster subscription both sit on the living room; not one of them
    // may reach for the transport again.
    net.channel('wp', () => {});
    net.onPeersChange(() => {});
    net.channel('wp', () => {});

    expect(netStats().joins, 'a rematch must version surveys INSIDE the room').toBe(1);
    expect(joinRoom).toHaveBeenCalledTimes(1);
    expect(openRooms, 'one transport room, however many channels sit on it').toBe(1);

    await net.leave();
    expect(netStats().active).toEqual([]);
  });

  it('leaving and coming back later is one join each, not a leak', async () => {
    const a = createNet(CFG);
    await a.leave();
    const b = createNet(CFG);
    expect(netStats().joins).toBe(2);
    await b.leave();
    expect(netStats().active).toEqual([]);
  });
});

describe('the leave/rejoin trap fails loudly', () => {
  beforeEach(() => {
    resetNetStats();
    joinRoom.mockClear();
  });

  it('throws when the same room is rejoined while still tearing down', async () => {
    const net = createNet(CFG);
    const pending = net.leave();
    expect(() => createNet(CFG)).toThrow(/tearing down/i);
    await pending;
    const again = createNet(CFG);
    expect(netStats().joins).toBe(2);
    await again.leave();
  });

  it('throws when the same room is joined twice concurrently', async () => {
    const net = createNet(CFG);
    expect(() => createNet(CFG)).toThrow(/already joined/i);
    expect(netStats().joins).toBe(1);
    await net.leave();
  });

  it('a DIFFERENT room on the same page is not blocked', async () => {
    const a = createNet(CFG);
    const b = createNet({ ...CFG, roomId: 'ZZ99' });
    expect(netStats().joins).toBe(2);
    await Promise.all([a.leave(), b.leave()]);
    expect(netStats().active).toEqual([]);
  });
});

describe('the wire revision is stamped into the app id', () => {
  afterEach(() => resetNetStats());
  it('so a cached old build partitions cleanly instead of half-connecting', () => {
    resetNetStats();
    createNet(CFG);
    expect(netStats().active).toEqual(['weald@2/K7QM']);
  });
});
