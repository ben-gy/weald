// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
//
// measure.test.ts — the grid primitives every edict is built from.
//
// These are tested on hand-drawn maps with the answer counted by eye, rather than against another
// implementation, because that is the only way the assertion is independent of the code. A test
// that re-derives `largestCluster` with a second flood fill written by the same author on the same
// afternoon proves the two agree, not that either is right.

import { describe, expect, it } from 'vitest';
import {
  borderPairs,
  clusterCount,
  colsWith,
  cornerCount,
  edgeCount,
  emptyCount,
  enclosedVoids,
  fullCols,
  fullRows,
  largestCluster,
  rowsWith,
  spansTopToBottom,
  touchingCount,
} from '../src/measure';

/** Draw a map: '.' is unwritten, digits are terrain codes. */
function draw(rows: string[]): { g: Int8Array; size: number } {
  const size = rows.length;
  const g = new Int8Array(size * size);
  for (let y = 0; y < size; y++) {
    expect(rows[y].length, `row ${y} is not ${size} wide`).toBe(size);
    for (let x = 0; x < size; x++) {
      const c = rows[y][x];
      g[y * size + x] = c === '.' ? 0 : Number(c);
    }
  }
  return { g, size };
}

describe('clusters are 4-connected, never diagonal', () => {
  it('two cells touching only at a corner are two clusters', () => {
    const { g, size } = draw(['1...', '.1..', '....', '....']);
    expect(clusterCount(g, size, 1)).toBe(2);
    expect(largestCluster(g, size, 1)).toBe(1);
  });

  it('an L of the same terrain is one cluster', () => {
    const { g, size } = draw(['1...', '1...', '11..', '....']);
    expect(clusterCount(g, size, 1)).toBe(1);
    expect(largestCluster(g, size, 1)).toBe(4);
  });

  it('two terrains sharing a border are still separate clusters', () => {
    const { g, size } = draw(['1122', '1122', '....', '....']);
    expect(clusterCount(g, size, 1)).toBe(1);
    expect(clusterCount(g, size, 2)).toBe(1);
    expect(largestCluster(g, size, 1)).toBe(4);
  });

  it('a terrain that is not on the map has no clusters and a largest of 0', () => {
    const { g, size } = draw(['1...', '....', '....', '....']);
    expect(clusterCount(g, size, 3)).toBe(0);
    expect(largestCluster(g, size, 3)).toBe(0);
  });
});

describe('enclosed voids', () => {
  it('an unwritten square walled in on all four sides counts', () => {
    const { g, size } = draw(['1111', '1.11', '1111', '1111']);
    expect(enclosedVoids(g, size)).toEqual([1]);
  });

  it('a pocket that reaches the map edge does NOT count', () => {
    const { g, size } = draw(['1111', '1..1', '1111', '111.']);
    // The 2-cell pocket in row 1 is enclosed; the corner cell at (3,3) touches the border.
    expect(enclosedVoids(g, size)).toEqual([2]);
  });

  it('a hole that leaks out through a diagonal gap is still enclosed — diagonals are not paths', () => {
    const { g, size } = draw(['1111', '1.11', '11.1', '1111']);
    expect(enclosedVoids(g, size).sort()).toEqual([1, 1]);
  });

  it('an empty map has no enclosed voids at all', () => {
    const { g, size } = draw(['....', '....', '....', '....']);
    expect(enclosedVoids(g, size)).toEqual([]);
    expect(emptyCount(g)).toBe(16);
  });

  it('two separate pockets are two entries, not one of the combined size', () => {
    const { g, size } = draw(['11111', '1.111', '11111', '111.1', '11111']);
    expect(enclosedVoids(g, size)).toEqual([1, 1]);
  });
});

describe('full rows and columns', () => {
  it('a row is full only when nothing in it is unwritten, whatever the terrains are', () => {
    const { g, size } = draw(['1231', '11.1', '2222', '...1']);
    expect(fullRows(g, size)).toEqual([0, 2]);
  });

  it('columns are counted the same way, and a single gap disqualifies one', () => {
    // Column 0 is solid; column 2 is filled for three rows and empty on the fourth.
    const { g, size } = draw(['1.1.', '1.1.', '1.1.', '1..1']);
    expect(fullCols(g, size)).toEqual([0]);
  });

  it('a completely full map is every row and every column', () => {
    const { g, size } = draw(['1111', '1111', '1111', '1111']);
    expect(fullRows(g, size).length).toBe(4);
    expect(fullCols(g, size).length).toBe(4);
  });
});

describe('borders are counted as PAIRS of touching cells', () => {
  it('one cell wedged between three others is three units of border', () => {
    const { g, size } = draw(['.2..', '21..', '.2..', '....']);
    expect(borderPairs(g, size, 1, 2)).toBe(3);
  });

  it('and a cell surrounded on all four sides is four, not one', () => {
    const { g, size } = draw(['.2..', '212.', '.2..', '....']);
    expect(borderPairs(g, size, 1, 2)).toBe(4);
  });

  it('the count does not depend on the order the two terrains are given', () => {
    const { g, size } = draw(['1122', '1122', '....', '....']);
    expect(borderPairs(g, size, 1, 2)).toBe(borderPairs(g, size, 2, 1));
    expect(borderPairs(g, size, 1, 2)).toBe(2);
  });

  it('touching diagonally is not a border', () => {
    const { g, size } = draw(['1...', '.2..', '....', '....']);
    expect(borderPairs(g, size, 1, 2)).toBe(0);
  });

  it('and the per-CELL count is different from the per-pair count, deliberately', () => {
    const { g, size } = draw(['.2..', '21..', '.2..', '....']);
    expect(touchingCount(g, size, 1, 2), 'one lake cell touches water').toBe(1);
    expect(borderPairs(g, size, 1, 2), 'but the shoreline is three long').toBe(3);
  });
});

describe('edges and corners', () => {
  it('the border ring of a 4x4 is twelve cells', () => {
    const { g, size } = draw(['1111', '1111', '1111', '1111']);
    expect(edgeCount(g, size, 1)).toBe(12);
  });

  it('the middle of the map is not an edge', () => {
    const { g, size } = draw(['....', '.11.', '.11.', '....']);
    expect(edgeCount(g, size, 1)).toBe(0);
  });

  it('corners are the four extreme cells only', () => {
    const { g, size } = draw(['1..1', '....', '....', '1..2']);
    expect(cornerCount(g, size, 1)).toBe(3);
    expect(cornerCount(g, size, 2)).toBe(1);
  });
});

describe('spread across rows and columns', () => {
  it('counts rows and columns that hold at least one cell', () => {
    const { g, size } = draw(['1...', '...1', '....', '1...']);
    expect(rowsWith(g, size, 1)).toBe(3);
    expect(colsWith(g, size, 1)).toBe(2);
  });

  it('a single cell is one row and one column', () => {
    const { g, size } = draw(['....', '..1.', '....', '....']);
    expect(rowsWith(g, size, 1)).toBe(1);
    expect(colsWith(g, size, 1)).toBe(1);
  });
});

describe('a terrain spanning the map top to bottom', () => {
  it('recognises a winding but connected path', () => {
    const { g, size } = draw(['1...', '1...', '111.', '..1.']);
    expect(spansTopToBottom(g, size, 1)).toBe(true);
  });

  it('rejects a path broken by one cell', () => {
    const { g, size } = draw(['1...', '1...', '.1..', '..1.']);
    expect(spansTopToBottom(g, size, 1), 'diagonal steps are not connections').toBe(false);
  });

  it('rejects a path that never reaches the top row', () => {
    const { g, size } = draw(['....', '1...', '1...', '1...']);
    expect(spansTopToBottom(g, size, 1)).toBe(false);
  });

  it('a single column of the terrain spans', () => {
    const { g, size } = draw(['.1..', '.1..', '.1..', '.1..']);
    expect(spansTopToBottom(g, size, 1)).toBe(true);
  });
});
