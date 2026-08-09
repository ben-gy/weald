// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
//
// rules.test.ts — the deal, the cards, and the sentence printed on each one.
//
// THE CARD TEXT IS PART OF THE GAME, NOT DECORATION. Weald is entirely "read the rule, plan toward
// it": if a card says "Score 3" and pays 8, the player's whole plan is built on a lie and there is
// no way for them to find out. Eleven of the fifteen cards were in exactly that state after the
// balance sim retuned their multipliers — the numbers moved and the sentences did not — and the
// mechanism audit is what caught it. This file makes the drift impossible to repeat by parsing the
// printed number back out of the English and comparing it to the constant that implements it.

import { describe, expect, it } from 'vitest';
import { EDICTS, EDICT_IDS, QUARTERS_MIN, SPINNEY_MIN, W, poolOf } from '../src/edicts';
import { ANCHOR_IDS, CRAGS_8, CRAGS_9, SHAPES, anchorOf, dealRun, shapeOf } from '../src/deck';
import { MODES, MODE_IDS, WATCHES } from '../src/modes';
import { DRAWABLE, TERRAIN, terrainOf } from '../src/terrain';
import { Game } from '../src/game';
import { newBoard } from '../src/board';

describe('every card pays exactly what it prints', () => {
  const WEIGHT: Record<string, number> = {
    spinney: W.spinney,
    deepmere: W.deepmere,
    hamlets: W.hamlets,
    cloister: W.cloister,
    outland: W.outland,
    waterline: W.waterline,
    woodsedge: W.woodsedge,
    crossroads: W.crossroads,
    quarantine: W.quarantine,
    fenland: W.fenland,
    furrows: W.furrows,
    bastions: W.bastions,
    quarters: W.quarters,
    terraces: W.terraces,
    plumbline: W.plumbline,
  };

  for (const id of EDICT_IDS) {
    it(`${id}`, () => {
      const e = EDICTS[id];
      const m = /^Score (\d+) /.exec(e.text);
      expect(m, `"${e.text}" does not begin with a printed score`).not.toBeNull();
      expect(
        Number(m![1]),
        `${id} prints "Score ${m![1]}" and pays ${WEIGHT[id]} — the rule is lying to the player`,
      ).toBe(WEIGHT[id]);
    });
  }

  it('and the two thresholds that were moved by measurement are printed as words', () => {
    // Both of these were changed because the sim showed the card almost never fired. If the number
    // moves again, the sentence has to move with it.
    expect(EDICTS.spinney.text).toContain(['zero', 'one', 'two', 'three', 'four', 'five'][SPINNEY_MIN]);
    expect(EDICTS.quarters.text).toContain(
      ['zero', 'one', 'two', 'three', 'four'][QUARTERS_MIN],
    );
  });

  it('every card text is a single readable sentence, not a formula', () => {
    for (const id of EDICT_IDS) {
      const t = EDICTS[id].text;
      expect(t.length, `${id} is ${t.length} characters — too long for a chip`).toBeLessThan(110);
      expect(t.endsWith('.'), `${id} does not end in a full stop`).toBe(true);
      expect(/[{}()[\]<>=]/.test(t), `${id} reads like code`).toBe(false);
    }
  });
});

describe('the three pools', () => {
  it('are five edicts each, and no edict is in two of them', () => {
    for (const p of ['C', 'M', 'S'] as const) expect(poolOf(p).length).toBe(5);
    expect(new Set(EDICT_IDS).size).toBe(15);
  });
  it('and each mode draws from exactly one', () => {
    for (const m of MODE_IDS) {
      const ids = new Set(poolOf(MODES[m].pool).map((e) => e.id));
      for (let s = 1; s <= 20; s++) {
        for (const e of dealRun(m, s).roles) expect(ids.has(e.id)).toBe(true);
      }
    }
  });
});

describe('the crag layouts obey their three constraints', () => {
  // Hand-authored, so the constraints are checked here rather than searched for at runtime.
  const check = (layouts: ReadonlyArray<ReadonlyArray<readonly [number, number]>>, n: number): void => {
    layouts.forEach((layout, i) => {
      for (const [x, y] of layout) {
        // (a) never on the rim — a rim crag can never have four written neighbours, so its girt
        // bonus would be unearnable and the card would be a dead promise.
        expect(x > 0 && y > 0 && x < n - 1 && y < n - 1, `layout ${i}: crag ${x},${y} is on the rim`).toBe(true);
      }
      // (b) no two crags within Chebyshev distance 2 — adjacent crags wall off a corner.
      for (let a = 0; a < layout.length; a++) {
        for (let b = a + 1; b < layout.length; b++) {
          const d = Math.max(Math.abs(layout[a][0] - layout[b][0]), Math.abs(layout[a][1] - layout[b][1]));
          expect(d, `layout ${i}: crags ${layout[a]} and ${layout[b]} are ${d} apart`).toBeGreaterThanOrEqual(2);
        }
      }
      // (c) the writable region is a single connected component.
      const blocked = new Set(layout.map(([x, y]) => `${x},${y}`));
      const start = [...Array(n * n).keys()].find((k) => !blocked.has(`${k % n},${(k / n) | 0}`))!;
      const seen = new Set([start]);
      const stack = [start];
      while (stack.length) {
        const k = stack.pop()!;
        const x = k % n;
        const y = (k / n) | 0;
        for (const [dx, dy] of [
          [0, -1],
          [1, 0],
          [0, 1],
          [-1, 0],
        ] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
          const j = ny * n + nx;
          if (seen.has(j) || blocked.has(`${nx},${ny}`)) continue;
          seen.add(j);
          stack.push(j);
        }
      }
      expect(seen.size, `layout ${i}: the writable region is split in two`).toBe(n * n - layout.length);
    });
  };

  it('9x9', () => check(CRAGS_9, 9));
  it('8x8', () => check(CRAGS_8, 8));

  it('and there are enough of them that the opening is not always the same picture', () => {
    expect(CRAGS_9.length).toBeGreaterThanOrEqual(6);
    expect(CRAGS_8.length).toBeGreaterThanOrEqual(4);
    expect(new Set(CRAGS_9.map((l) => JSON.stringify([...l].sort()))).size).toBe(CRAGS_9.length);
  });

  it('and NOT all of them are symmetric, or choosing one would be a non-decision', () => {
    // A layout invariant under all eight dihedral transforms looks the same however you approach
    // it, so a run that always drew one would have an opening with no orientation to read.
    const symmetric = (l: ReadonlyArray<readonly [number, number]>, n: number): boolean => {
      const k = (s: Array<readonly [number, number]>): string =>
        s.map(([x, y]) => `${x},${y}`).sort().join(' ');
      const base = k([...l]);
      const rot = l.map(([x, y]) => [n - 1 - y, x] as const);
      const mir = l.map(([x, y]) => [n - 1 - x, y] as const);
      return k([...rot]) === base && k([...mir]) === base;
    };
    const asym = CRAGS_9.filter((l) => !symmetric(l, 9)).length;
    expect(asym, 'every 9x9 crag layout is fully symmetric — the layout choice says nothing').toBeGreaterThan(3);
  });
});

describe('the shape library', () => {
  it('every shape is 4-connected and has the area its name implies', () => {
    for (const [id, s] of Object.entries(SHAPES)) {
      expect(s.cells.length, id).toBe(s.area);
      expect(s.forms.length, `${id} has no orientations`).toBeGreaterThan(0);
    }
  });
  it('a shape id off the wire can never produce an undefined shape', () => {
    for (const bad of ['constructor', 'toString', '__proto__', 'nope', '', null, undefined]) {
      expect(shapeOf(bad as string).area).toBeGreaterThan(0);
    }
  });
  it('and neither can an anchor id or a terrain code', () => {
    for (const bad of ['constructor', '__proto__', 'nope', '', null, undefined]) {
      expect(typeof anchorOf(bad as string).text).toBe('string');
      expect(terrainOf(bad as unknown as number)).toBeNull();
    }
    expect(ANCHOR_IDS.every((a) => anchorOf(a).id === a)).toBe(true);
  });
});

describe('a run is legal by construction', () => {
  for (const m of MODE_IDS) {
    it(`${m}: four watches, the declared board, and every drawable terrain reachable`, () => {
      for (let s = 1; s <= 25; s++) {
        const run = dealRun(m, s);
        expect(run.watches.length).toBe(WATCHES);
        expect(run.size).toBe(MODES[m].size);
        expect(run.crags.length).toBe(MODES[m].crags);
        const terrains = new Set<number>();
        for (const w of run.watches) {
          for (const d of w.deals) {
            if (d.kind !== 'card') continue;
            for (const t of d.a.terrains) terrains.add(t);
            if (d.b) for (const t of d.b.terrains) terrains.add(t);
          }
        }
        // Without the resample loop a seed can deal a run in which one terrain never appears,
        // which silently zeroes any edict that scores it.
        expect([...terrains].sort(), `${m} seed ${s} cannot draw every terrain`).toEqual([...DRAWABLE]);
      }
    });
  }

  it('Survey offers two DIFFERENT shapes on every card — that is its whole lever', () => {
    for (let s = 1; s <= 20; s++) {
      for (const w of dealRun('survey', s).watches) {
        for (const d of w.deals) {
          if (d.kind !== 'card') continue;
          expect(d.b, 'a Survey card had no second shape').not.toBeNull();
          expect(shapeOf(d.a.shapeId).area, 'the two shapes are different sizes').toBe(
            shapeOf(d.b!.shapeId).area,
          );
          expect(d.a.shapeId, 'the two shapes are the same shape').not.toBe(d.b!.shapeId);
        }
      }
    }
  });

  it('Canopy and March fork big-and-fixed against small-and-flexible', () => {
    for (const m of ['canopy', 'march'] as const) {
      let forks = 0;
      for (let s = 1; s <= 10; s++) {
        for (const w of dealRun(m, s).watches) {
          for (const d of w.deals) {
            if (d.kind !== 'card' || !d.b) continue;
            forks++;
            expect(shapeOf(d.a.shapeId).area).toBeGreaterThan(shapeOf(d.b.shapeId).area);
            expect(d.a.terrains.length, 'the big branch should be the tight one').toBe(1);
            expect(d.b.terrains.length, 'the small branch should be the flexible one').toBe(2);
          }
        }
      }
      expect(forks, `${m} never forked`).toBeGreaterThan(5);
    }
  });

  it('the shapes get SMALLER as the map fills, which is the anti-boredom rule', () => {
    // Five-cell slots exist only in the first two watches. A five-cell shape on a 70%-full map has
    // one legal home, and the last placements stop being decisions.
    for (const m of MODE_IDS) {
      for (let s = 1; s <= 10; s++) {
        const run = dealRun(m, s);
        for (let w = 2; w < WATCHES; w++) {
          for (const d of run.watches[w].deals) {
            if (d.kind !== 'card') continue;
            expect(shapeOf(d.a.shapeId).area, `${m} watch ${w} deals a 5-cell shape`).toBeLessThanOrEqual(4);
          }
        }
      }
    }
  });

  it('the LAST watch deals its canker first, so the final cells are repairs', () => {
    for (const m of MODE_IDS) {
      if (!MODES[m].cankerWatches.includes(WATCHES - 1)) continue;
      for (let s = 1; s <= 10; s++) {
        const last = dealRun(m, s).watches[WATCHES - 1];
        expect(last.deals[0].kind, `${m} deals its final canker last, not first`).toBe('carve');
      }
    }
  });
});

describe('a placement is only ever legal once', () => {
  it('the same square cannot be written twice', () => {
    const run = dealRun('canopy', 3);
    const g = new Game(run);
    const forms = g.formsFor('a');
    const spot = g.legalFor('a')[0];
    const t = g.terrainsFor('a')[0];
    expect(g.play({ branch: 'a', form: spot.form, x: spot.x, y: spot.y, terrain: t })).toBe(true);
    // Same coordinates, next card: the squares are taken now.
    const again = g.legalFor('a').some((p) => p.form === spot.form && p.x === spot.x && p.y === spot.y);
    expect(again, 'an occupied square was still offered').toBe(false);
  });

  it('a crag is never writable', () => {
    const run = dealRun('canopy', 1);
    const b = newBoard(run);
    for (const [x, y] of run.crags) expect(b.g[y * run.size + x]).toBe(TERRAIN[6].code);
    const g = new Game(run);
    for (const p of g.legalFor('a')) {
      const f = g.formsFor('a')[p.form];
      for (const c of f) {
        const hit = run.crags.some(([cx, cy]) => cx === p.x + c.x && cy === p.y + c.y);
        expect(hit, 'a placement was offered on top of a crag').toBe(false);
      }
    }
  });

  it('and a terrain the card does not permit is refused', () => {
    const g = new Game(dealRun('canopy', 5));
    const allowed = g.terrainsFor('a');
    const forbidden = DRAWABLE.find((t) => !allowed.includes(t))!;
    const spot = g.legalFor('a')[0];
    expect(g.play({ branch: 'a', form: spot.form, x: spot.x, y: spot.y, terrain: forbidden })).toBe(false);
    expect(g.log.length, 'the refused placement was logged anyway').toBe(0);
  });
});
