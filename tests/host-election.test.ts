// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
//
// host-election.test.ts — live-P2P contract gate #4.
//
// Weald is a PARALLEL SAME-SEED race: every peer derives the identical card sequence from the seed
// the host freezes into the round start and draws on its own map. That makes the host's job small —
// it owns the seed, the roster and the mode, and nothing else — but it does not make it optional.
// Two peers who each believe they are host freeze two different rosters and two different seeds, so
// the players compare edict scores earned on different maps; a room where nobody believes they are
// host never starts at all. So the engine's model is INCUMBENCY WITH TERMS, not re-election
// whenever somebody joins, and this file pins it.
//
// Peer ids are FIXED ('a', 'm', 'z') so the id ORDER is deliberate rather than whatever Trystero
// happened to generate — a test using real random ids passes half the time and proves nothing. Each
// simulated peer also gets its OWN module instance (vi.resetModules + vi.doMock + dynamic import),
// because trystero's selfId and net.ts's join registry are both one-per-page globals and a shared
// instance would quietly test one peer twice.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Net } from '@ben-gy/game-engine/net';

// Only a TYPE is imported above: a value import would load the real net module before
// vi.resetModules can hand each simulated peer its own copy. net-lifecycle.test.ts pins that
// roomAppId('weald') really is this string.
const APP_ID = 'weald@2';

interface Msg {
  from: string;
  to?: string | string[];
  name: string;
  data: unknown;
}

class Node {
  peers = new Set<string>();
  actions = new Map<string, (data: unknown, from: string) => void>();
  onJoin: Array<(id: string) => void> = [];
  onLeave: Array<(id: string) => void> = [];
  constructor(readonly id: string) {}
}

/** A hand-wired mesh: who can see whom, and a queue of messages drained in order. */
class Mesh {
  nodes = new Map<string, Node>();
  queue: Msg[] = [];

  node(id: string): Node {
    let n = this.nodes.get(id);
    if (!n) {
      n = new Node(id);
      this.nodes.set(id, n);
    }
    return n;
  }

  room(id: string): unknown {
    const node = this.node(id);
    return {
      makeAction: (name: string) => [
        (data: unknown, to?: string | string[]) => {
          this.queue.push({ from: id, to, name, data });
        },
        (cb: (data: unknown, from: string) => void) => node.actions.set(name, cb),
      ],
      onPeerJoin: (cb: (p: string) => void) => node.onJoin.push(cb),
      onPeerLeave: (cb: (p: string) => void) => node.onLeave.push(cb),
      getPeers: () => Object.fromEntries([...node.peers].map((p) => [p, {}])),
      leave: () => Promise.resolve(),
    };
  }

  connect(a: string, b: string): void {
    this.node(a).peers.add(b);
    this.node(b).peers.add(a);
    for (const cb of this.node(a).onJoin) cb(b);
    for (const cb of this.node(b).onJoin) cb(a);
  }

  disconnect(a: string, b: string): void {
    this.node(a).peers.delete(b);
    this.node(b).peers.delete(a);
    for (const cb of this.node(a).onLeave) cb(b);
    for (const cb of this.node(b).onLeave) cb(a);
  }

  drop(id: string): void {
    for (const peer of [...this.node(id).peers]) this.disconnect(id, peer);
  }

  flush(): void {
    for (let guard = 0; this.queue.length && guard < 500; guard++) {
      const m = this.queue.shift()!;
      const targets =
        m.to === undefined ? [...this.node(m.from).peers] : Array.isArray(m.to) ? m.to : [m.to];
      for (const t of targets) {
        const node = this.nodes.get(t);
        if (!node || !node.peers.has(m.from)) continue;
        node.actions.get(m.name)?.(JSON.parse(JSON.stringify(m.data)), m.from);
      }
    }
    expect(this.queue.length, 'message storm — the protocol did not converge').toBe(0);
  }
}

let mesh: Mesh;

async function spawn(id: string, claimHost = false): Promise<Net> {
  vi.resetModules();
  vi.doMock('trystero', () => ({ joinRoom: () => mesh.room(id), selfId: id }));
  vi.doMock('trystero/nostr', () => ({ getRelaySockets: () => ({}) }));
  const { createNet } = await import('@ben-gy/game-engine/net');
  return createNet({ appId: APP_ID, roomId: 'ROOM', claimHost });
}

function tick(ms: number): void {
  for (let t = 0; t < ms; t += 250) {
    vi.advanceTimersByTime(250);
    mesh.flush();
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  mesh = new Mesh();
});

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock('trystero');
  vi.doUnmock('trystero/nostr');
});

describe('(a) an incumbent keeps its room', () => {
  it('a joiner with a LOWER id does not take a live room', async () => {
    const z = await spawn('z', true);
    const a = await spawn('a');
    mesh.connect('z', 'a');
    mesh.flush();

    expect(z.isHost(), 'the incumbent must keep hosting').toBe(true);
    expect(a.isHost(), 'a lower id is not a claim to a room someone is already hosting').toBe(false);
    expect(a.host()).toBe('z');
    expect(a.hostSettled()).toBe(true);

    tick(15000);
    expect(z.isHost(), 'the incumbent was deposed by a late joiner').toBe(true);
    expect(a.isHost()).toBe(false);
  });
});

describe('(b) silence is not a mandate', () => {
  it('a peer that has heard nothing is not host, and knows it has not settled', async () => {
    const a = await spawn('a');
    tick(20000);
    expect(a.hostSettled(), 'an empty room must not pretend to be settled').toBe(false);
    expect(a.isHost()).toBe(false);
    expect(a.host()).toBeNull();
  });

  it('two peers who cannot see each other are BOTH non-host', async () => {
    const a = await spawn('a');
    const z = await spawn('z');
    tick(20000);
    expect(a.isHost(), 'a peer alone in the dark must not freeze a roster').toBe(false);
    expect(z.isHost()).toBe(false);
  });

  it('but a room with peers present and nobody claiming elects at the LOWEST term', async () => {
    const a = await spawn('a');
    const z = await spawn('z');
    mesh.connect('a', 'z');
    mesh.flush();
    tick(20000);
    expect(a.isHost()).toBe(true);
    expect(z.isHost()).toBe(false);
    expect(z.host()).toBe('a');
    expect(a.hostEpoch()).toBe(1);
    expect([a.hostSettled(), z.hostSettled()]).toEqual([true, true]);
  });
});

describe('(c) a host leaving promotes exactly one survivor', () => {
  it('every survivor agrees who took over, at a higher term', async () => {
    const a = await spawn('a', true);
    const m = await spawn('m');
    const z = await spawn('z');
    mesh.connect('a', 'm');
    mesh.connect('a', 'z');
    mesh.connect('m', 'z');
    mesh.flush();
    tick(1000);

    expect([a.isHost(), m.isHost(), z.isHost()]).toEqual([true, false, false]);
    const before = a.hostEpoch();

    mesh.drop('a');
    mesh.flush();
    tick(1000);

    const hosts = [m.host(), z.host()];
    expect(new Set(hosts).size, `survivors disagree: ${hosts.join(' vs ')}`).toBe(1);
    expect(hosts[0], 'min-id among the survivors').toBe('m');
    expect([m.isHost(), z.isHost()], 'exactly one survivor may hold the room').toEqual([true, false]);
    expect(m.hostEpoch(), 'a transfer must mint a strictly higher term').toBe(before + 1);
    expect(z.hostEpoch()).toBe(before + 1);
  });
});

describe('(d) a non-host leaving changes nothing', () => {
  it('the incumbent keeps the room at the same term', async () => {
    const a = await spawn('a', true);
    const m = await spawn('m');
    const z = await spawn('z');
    mesh.connect('a', 'm');
    mesh.connect('a', 'z');
    mesh.connect('m', 'z');
    mesh.flush();
    tick(1000);
    expect(z.isHost(), 'the guest about to leave was never the host').toBe(false);

    const epoch = a.hostEpoch();
    mesh.drop('z');
    mesh.flush();
    tick(3000);

    expect(a.isHost()).toBe(true);
    expect(m.host()).toBe('a');
    expect(a.hostEpoch(), 'a departing guest must not cost the room a term').toBe(epoch);
  });
});

describe('(e) two genuine claims converge', () => {
  it('both peers created the room in the same instant; min-id breaks the tie', async () => {
    const a = await spawn('a', true);
    const z = await spawn('z', true);
    expect(a.isHost()).toBe(true);
    expect(z.isHost()).toBe(true);

    mesh.connect('a', 'z');
    mesh.flush();
    tick(6000);

    expect(a.host()).toBe(z.host());
    expect(a.host()).toBe('a');
    expect([a.isHost(), z.isHost()], 'two hosts freeze two different seeds').toEqual([true, false]);
  });

  it('a stale claimant capitulates instead of splitting the room', async () => {
    const a = await spawn('a', true);
    const z = await spawn('z', true);
    mesh.connect('a', 'z');
    mesh.flush();
    tick(3000);

    a.takeover();
    mesh.flush();
    tick(3000);

    expect(a.isHost()).toBe(true);
    expect(z.isHost()).toBe(false);
    expect(z.host()).toBe('a');
  });
});
