// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
//
// shapes.test.ts — the polyomino geometry, which every other rule in the game stands on.
//
// The orientation list is a WIRE-LEVEL contract even though nothing about it crosses the wire.
// Weald is parallel same-seed: two players are handed the identical shape and their maps are
// compared cell for cell at the end. "Rotate" steps through this list, so if the list were built in
// a different order — or contained a different number of entries — on two devices, two people
// pressing rotate the same number of times would be drawing different shapes and the comparison
// would be meaningless. Hence: fixed order, duplicates dropped, both asserted.

import { describe, expect, it } from 'vitest';
import {
  allPlacements,
  anyFit,
  fits,
  fromSketch,
  heightOf,
  keyOf,
  normalise,
  orientations,
  reflect,
  rotate,
  widthOf,
} from '../src/shapes';

const sk = fromSketch;

describe('normalisation puts every shape in one canonical place', () => {
  it('shifts the bounding box to the origin', () => {
    const n = normalise([
      { x: 5, y: 7 },
      { x: 6, y: 7 },
    ]);
    expect(n).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
  });

  it('sorts row-major, so two orders of the same cells produce one key', () => {
    const a = normalise([
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: 0 },
    ]);
    const b = normalise([
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 0 },
    ]);
    expect(keyOf(a)).toBe(keyOf(b));
  });

  it('is idempotent', () => {
    const once = normalise([
      { x: 3, y: 3 },
      { x: 4, y: 3 },
    ]);
    expect(normalise(once)).toEqual(once);
  });
});

describe('the orientation count is exactly the free-polyomino symmetry count', () => {
  // These are not arbitrary: they are the distinct one-sided-plus-mirror forms of each polyomino,
  // and getting one wrong means the rotate button either repeats itself or skips a real shape.
  const cases: Array<[string, string[], number]> = [
    ['single cell', ['#'], 1],
    ['domino', ['##'], 2],
    ['2x2 square', ['##', '##'], 1],
    ['I-tromino', ['###'], 2],
    ['L-tromino', ['#.', '##'], 4],
    ['I-tetromino', ['####'], 2],
    ['O-tetromino', ['##', '##'], 1],
    ['T-tetromino', ['###', '.#.'], 4],
    ['S-tetromino', ['.##', '##.'], 4],
    ['L-tetromino', ['#.', '#.', '##'], 8],
    ['plus-pentomino', ['.#.', '###', '.#.'], 1],
    ['Z-pentomino', ['##.', '.#.', '.##'], 4],
  ];
  for (const [name, rows, n] of cases) {
    it(`${name} has ${n}`, () => {
      expect(orientations(sk(rows)).length).toBe(n);
    });
  }

  it('and every entry in the list is genuinely distinct', () => {
    for (const [, rows] of cases) {
      const forms = orientations(sk(rows));
      expect(new Set(forms.map(keyOf)).size).toBe(forms.length);
    }
  });

  it('every orientation keeps the same number of cells', () => {
    for (const [, rows] of cases) {
      const base = sk(rows);
      for (const f of orientations(base)) expect(f.length).toBe(base.length);
    }
  });
});

describe('the orientation ORDER is deterministic, which is what keeps two peers drawing alike', () => {
  it('the same shape yields the same key sequence every time it is asked', () => {
    const a = orientations(sk(['#.', '#.', '##'])).map(keyOf);
    const b = orientations(sk(['#.', '#.', '##'])).map(keyOf);
    expect(a).toEqual(b);
  });

  it('and the cells given in a different order still yield the same sequence', () => {
    const straight = orientations([
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]).map(keyOf);
    const shuffled = orientations([
      { x: 1, y: 1 },
      { x: 0, y: 0 },
      { x: 0, y: 1 },
    ]).map(keyOf);
    expect(shuffled).toEqual(straight);
  });

  it('rotating four times returns to the start', () => {
    const base = sk(['#.', '##']);
    expect(keyOf(rotate(rotate(rotate(rotate(base)))))).toBe(keyOf(base));
  });

  it('reflecting twice returns to the start', () => {
    const base = sk(['##.', '.##']);
    expect(keyOf(reflect(reflect(base)))).toBe(keyOf(base));
  });

  it('a rotation swaps width and height', () => {
    const base = sk(['####']);
    expect([widthOf(base), heightOf(base)]).toEqual([4, 1]);
    const r = rotate(base);
    expect([widthOf(r), heightOf(r)]).toEqual([1, 4]);
  });
});

describe('placement legality', () => {
  const empty = (): boolean => false;

  it('accepts a shape entirely on the board', () => {
    expect(fits(sk(['##']), 0, 0, 4, empty)).toBe(true);
    expect(fits(sk(['##']), 2, 3, 4, empty)).toBe(true);
  });

  it('rejects one that runs off any edge', () => {
    expect(fits(sk(['##']), 3, 0, 4, empty), 'off the right').toBe(false);
    expect(fits(sk(['#', '#']), 0, 3, 4, empty), 'off the bottom').toBe(false);
    expect(fits(sk(['##']), -1, 0, 4, empty), 'off the left').toBe(false);
    expect(fits(sk(['##']), 0, -1, 4, empty), 'above the top').toBe(false);
  });

  it('rejects one that overlaps anything already drawn', () => {
    const taken = new Set(['1,1']);
    const occ = (x: number, y: number): boolean => taken.has(`${x},${y}`);
    expect(fits(sk(['##']), 0, 1, 4, occ)).toBe(false);
    expect(fits(sk(['##']), 2, 1, 4, occ)).toBe(true);
  });
});

describe('the soft-lock guard', () => {
  it('sees a fit when one exists in ANY orientation, not just the given one', () => {
    // A 1x4 bar on a board with only a vertical 4-cell channel free: no horizontal placement works.
    const size = 4;
    const free = new Set(['3,0', '3,1', '3,2', '3,3']);
    const occ = (x: number, y: number): boolean => !free.has(`${x},${y}`);
    expect(fits(sk(['####']), 0, 0, size, occ), 'as given it cannot fit').toBe(false);
    expect(anyFit(orientations(sk(['####'])), size, occ), 'but rotated it can').toBe(true);
  });

  it('reports no fit on a genuinely full board', () => {
    const occ = (): boolean => true;
    expect(anyFit(orientations(sk(['#'])), 4, occ)).toBe(false);
  });

  it('a single cell always fits while one square is free', () => {
    const free = '2,2';
    const occ = (x: number, y: number): boolean => `${x},${y}` !== free;
    expect(anyFit(orientations(sk(['#'])), 5, occ)).toBe(true);
  });
});

describe('the placement enumerator', () => {
  it('counts every legal position on an empty board', () => {
    // A domino on 4x4: 2 orientations. Horizontal 3x4 = 12, vertical 4x3 = 12.
    const forms = orientations(sk(['##']));
    expect(allPlacements(forms, 4, () => false).length).toBe(24);
  });

  it('and each one it reports really is legal', () => {
    const forms = orientations(sk(['#.', '##']));
    const taken = new Set(['0,0', '3,3']);
    const occ = (x: number, y: number): boolean => taken.has(`${x},${y}`);
    const all = allPlacements(forms, 4, occ);
    expect(all.length).toBeGreaterThan(0);
    for (const p of all) expect(fits(forms[p.form], p.x, p.y, 4, occ)).toBe(true);
  });

  it('and it agrees with anyFit — the cheap guard never disagrees with the full search', () => {
    const forms = orientations(sk(['###']));
    for (const holes of [[], ['1,1'], ['0,0', '1,0', '2,0', '3,0']]) {
      const taken = new Set(holes);
      const occ = (x: number, y: number): boolean => taken.has(`${x},${y}`);
      expect(anyFit(forms, 4, occ)).toBe(allPlacements(forms, 4, occ).length > 0);
    }
  });
});

describe('the ASCII sketch parser', () => {
  it('treats dots and spaces as empty and anything else as filled', () => {
    expect(sk(['#.#'])).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
    ]);
    expect(sk(['# #']).length).toBe(2);
  });

  it('normalises, so a sketch padded with empty columns is the same shape', () => {
    expect(keyOf(sk(['.##.']))).toBe(keyOf(sk(['##'])));
  });
});
