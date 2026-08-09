// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// See ADDITIONAL-TERMS.md for the section 7(b) attribution requirement.
//
// Weald — what a finished map MEASURES. Pure grid topology, no scoring, no rules, no game.
//
// Every edict is a one-line combination of the primitives here, which is the whole point: the
// edicts stay legible because none of them contains a flood fill. It also gives the mechanism audit
// (tests/mechanism.test.ts) something to re-derive against — the audit walks the same grid with its
// OWN independent implementation and must agree, so a bug in a primitive cannot hide behind the
// edict that uses it.
//
// 4-CONNECTIVITY THROUGHOUT. Diagonal touching is not adjacency here, in any primitive, for any
// terrain. A player who has to hold two different notions of "next to" in their head while planning
// a placement is a player who stops planning, and the fleet has learned that lesson on smaller
// things than this. Where a rule wants diagonals it says so in words on the card, and there is
// currently no such rule.

/** A map is a flat row-major array of terrain codes; 0 is unwritten ground. */
export type Grid = Readonly<Int8Array>;

export const idx = (size: number, x: number, y: number): number => y * size + x;

export const at = (g: Grid, size: number, x: number, y: number): number =>
  x < 0 || y < 0 || x >= size || y >= size ? -1 : g[idx(size, x, y)];

const N4: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

export const NEIGHBOURS4 = N4;

/** How many cells hold this terrain. */
export function countOf(g: Grid, terrain: number): number {
  let n = 0;
  for (let i = 0; i < g.length; i++) if (g[i] === terrain) n++;
  return n;
}

/** How many cells are still unwritten. */
export function emptyCount(g: Grid): number {
  return countOf(g, 0);
}

export interface Cluster {
  terrain: number;
  cells: number[];
  size: number;
  /** True when no cell of the cluster touches the border of the map. */
  interior: boolean;
}

/**
 * Every 4-connected run of the same terrain. Terrain 0 (unwritten) is included, because "an empty
 * pocket completely walled in" is a shape several edicts care about and it is the same search.
 */
export function clusters(g: Grid, size: number): Cluster[] {
  const seen = new Uint8Array(g.length);
  const out: Cluster[] = [];
  const stack: number[] = [];
  for (let start = 0; start < g.length; start++) {
    if (seen[start]) continue;
    const terrain = g[start];
    seen[start] = 1;
    stack.length = 0;
    stack.push(start);
    const cells: number[] = [];
    let interior = true;
    while (stack.length) {
      const i = stack.pop()!;
      cells.push(i);
      const x = i % size;
      const y = (i / size) | 0;
      if (x === 0 || y === 0 || x === size - 1 || y === size - 1) interior = false;
      for (const [dx, dy] of N4) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const j = idx(size, nx, ny);
        if (seen[j] || g[j] !== terrain) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    out.push({ terrain, cells, size: cells.length, interior });
  }
  return out;
}

/** The largest 4-connected run of one terrain, 0 if there is none. */
export function largestCluster(g: Grid, size: number, terrain: number): number {
  let best = 0;
  for (const c of clusters(g, size)) {
    if (c.terrain === terrain && c.size > best) best = c.size;
  }
  return best;
}

/** How many separate runs of one terrain there are. */
export function clusterCount(g: Grid, size: number, terrain: number): number {
  let n = 0;
  for (const c of clusters(g, size)) if (c.terrain === terrain) n++;
  return n;
}

/**
 * Unwritten pockets with no path to the edge — the "enclosed" shape. Returned as sizes so an edict
 * can pay per pocket, per cell, or only for pockets of an exact size.
 */
export function enclosedVoids(g: Grid, size: number): number[] {
  return clusters(g, size)
    .filter((c) => c.terrain === 0 && c.interior)
    .map((c) => c.size);
}

/** Rows with no unwritten cell left. */
export function fullRows(g: Grid, size: number): number[] {
  const out: number[] = [];
  for (let y = 0; y < size; y++) {
    let full = true;
    for (let x = 0; x < size && full; x++) if (g[idx(size, x, y)] === 0) full = false;
    if (full) out.push(y);
  }
  return out;
}

/** Columns with no unwritten cell left. */
export function fullCols(g: Grid, size: number): number[] {
  const out: number[] = [];
  for (let x = 0; x < size; x++) {
    let full = true;
    for (let y = 0; y < size && full; y++) if (g[idx(size, x, y)] === 0) full = false;
    if (full) out.push(x);
  }
  return out;
}

/**
 * Distinct unordered pairs of orthogonally touching cells, one of terrain `a` and one of `b`.
 * Counting PAIRS rather than cells is deliberate: a single lake cell wedged between three forest
 * cells is three units of shoreline, which is what the picture actually shows.
 */
export function borderPairs(g: Grid, size: number, a: number, b: number): number {
  let n = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = g[idx(size, x, y)];
      if (v !== a && v !== b) continue;
      // Only look right and down, so each pair is met exactly once.
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
      ] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= size || ny >= size) continue;
        const w = g[idx(size, nx, ny)];
        if ((v === a && w === b) || (v === b && w === a)) n++;
      }
    }
  }
  return n;
}

/** Cells of a terrain that touch the outer border of the map. */
export function edgeCount(g: Grid, size: number, terrain: number): number {
  let n = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (x !== 0 && y !== 0 && x !== size - 1 && y !== size - 1) continue;
      if (g[idx(size, x, y)] === terrain) n++;
    }
  }
  return n;
}

/** Cells of a terrain sitting in one of the four corners. */
export function cornerCount(g: Grid, size: number, terrain: number): number {
  const last = size - 1;
  let n = 0;
  for (const [x, y] of [
    [0, 0],
    [last, 0],
    [0, last],
    [last, last],
  ] as const) {
    if (g[idx(size, x, y)] === terrain) n++;
  }
  return n;
}

/** Cells of a terrain that touch at least one cell of another given terrain. */
export function touchingCount(g: Grid, size: number, terrain: number, other: number): number {
  let n = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (g[idx(size, x, y)] !== terrain) continue;
      for (const [dx, dy] of N4) {
        if (at(g, size, x + dx, y + dy) === other) {
          n++;
          break;
        }
      }
    }
  }
  return n;
}

/** How many rows contain at least one cell of a terrain. */
export function rowsWith(g: Grid, size: number, terrain: number): number {
  let n = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (g[idx(size, x, y)] === terrain) {
        n++;
        break;
      }
    }
  }
  return n;
}

/** How many columns contain at least one cell of a terrain. */
export function colsWith(g: Grid, size: number, terrain: number): number {
  let n = 0;
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      if (g[idx(size, x, y)] === terrain) {
        n++;
        break;
      }
    }
  }
  return n;
}

/** Cells of `t` that touch at least one `a` AND at least one `b`. */
export function touchingBoth(g: Grid, size: number, t: number, a: number, b: number): number {
  let n = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (g[idx(size, x, y)] !== t) continue;
      let hasA = false;
      let hasB = false;
      for (const [dx, dy] of N4) {
        const v = at(g, size, x + dx, y + dy);
        if (v === a) hasA = true;
        if (v === b) hasB = true;
      }
      if (hasA && hasB) n++;
    }
  }
  return n;
}

/** Cells of `t` that touch at least one cell of ANY terrain in `others`. */
export function touchingAny(g: Grid, size: number, t: number, others: readonly number[]): number {
  let n = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (g[idx(size, x, y)] !== t) continue;
      for (const [dx, dy] of N4) {
        if (others.includes(at(g, size, x + dx, y + dy))) {
          n++;
          break;
        }
      }
    }
  }
  return n;
}

/**
 * Clusters of `t` with no unwritten square touching them anywhere — i.e. walled in on every side by
 * something, whether that something is other terrain, a crag, or the rim of the map. This is what
 * "sealed" means to a player looking at the picture, and it is deliberately NOT "surrounded by your
 * own terrain": walling a canker against the map edge is a legitimate and satisfying way to do it.
 */
export function sealedClusters(g: Grid, size: number, t: number): Cluster[] {
  return clusters(g, size).filter((c) => {
    if (c.terrain !== t) return false;
    for (const i of c.cells) {
      const x = i % size;
      const y = (i / size) | 0;
      for (const [dx, dy] of N4) {
        if (at(g, size, x + dx, y + dy) === 0) return false;
      }
    }
    return true;
  });
}

/**
 * Cells of `t` with no unwritten square orthogonally touching them — sealed one square at a time
 * rather than a whole patch at a time.
 *
 * The per-PATCH version measured a mean contribution of 5.4 against a pool mate's 64: on a map that
 * ends ~68% written, a patch almost always has one open square somewhere along its edge, so the
 * rule fired on maybe one run in eight and the mode's own counterplay to its own rot effectively
 * did not exist. Per-cell keeps the identical verb — build up against the rot — and makes partial
 * progress visible, which is also better feedback.
 */
export function sealedCells(g: Grid, size: number, t: number): number {
  let n = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (g[idx(size, x, y)] !== t) continue;
      let sealed = true;
      for (const [dx, dy] of N4) {
        if (at(g, size, x + dx, y + dy) === 0) sealed = false;
      }
      if (sealed) n++;
    }
  }
  return n;
}

/** 2x2 blocks that are entirely one terrain, and that terrain is in `allowed`. */
export function monoBlocks2x2(g: Grid, size: number, allowed: readonly number[]): number {
  let n = 0;
  for (let y = 0; y + 1 < size; y++) {
    for (let x = 0; x + 1 < size; x++) {
      const v = g[idx(size, x, y)];
      if (!allowed.includes(v)) continue;
      if (
        g[idx(size, x + 1, y)] === v &&
        g[idx(size, x, y + 1)] === v &&
        g[idx(size, x + 1, y + 1)] === v
      ) {
        n++;
      }
    }
  }
  return n;
}

/**
 * How many of the four corner quadrants hold at least one of every terrain in `wanted`.
 *
 * On an odd board the quadrants are the four floor(size/2)-square corner blocks and the middle
 * cross belongs to none of them — which is the honest reading of "a quarter of the map" and is
 * stated in the edict's own text so nobody has to guess.
 */
export function quadrantsWithAll(
  g: Grid,
  size: number,
  wanted: readonly number[],
  atLeast = wanted.length,
): number {
  const h = Math.floor(size / 2);
  const origins: Array<[number, number]> = [
    [0, 0],
    [size - h, 0],
    [0, size - h],
    [size - h, size - h],
  ];
  let n = 0;
  for (const [ox, oy] of origins) {
    const seen = new Set<number>();
    for (let y = oy; y < oy + h; y++) {
      for (let x = ox; x < ox + h; x++) seen.add(g[idx(size, x, y)]);
    }
    if (wanted.filter((w) => seen.has(w)).length >= atLeast) n++;
  }
  return n;
}

/** Rows holding exactly `k` cells of a terrain. */
export function rowsWithExactly(g: Grid, size: number, terrain: number, k: number): number {
  let n = 0;
  for (let y = 0; y < size; y++) {
    let c = 0;
    for (let x = 0; x < size; x++) if (g[idx(size, x, y)] === terrain) c++;
    if (c === k) n++;
  }
  return n;
}

/** The longest unbroken horizontal or vertical run of WRITTEN squares, of any terrain. */
export function longestWrittenRun(g: Grid, size: number): number {
  let best = 0;
  for (let y = 0; y < size; y++) {
    let run = 0;
    for (let x = 0; x < size; x++) {
      run = g[idx(size, x, y)] === 0 ? 0 : run + 1;
      if (run > best) best = run;
    }
  }
  for (let x = 0; x < size; x++) {
    let run = 0;
    for (let y = 0; y < size; y++) {
      run = g[idx(size, x, y)] === 0 ? 0 : run + 1;
      if (run > best) best = run;
    }
  }
  return best;
}

/** Cells of a terrain whose four orthogonal neighbours are ALL written (off-map does not count). */
export function girtCount(g: Grid, size: number, terrain: number): number {
  let n = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (g[idx(size, x, y)] !== terrain) continue;
      let girt = true;
      for (const [dx, dy] of N4) {
        const v = at(g, size, x + dx, y + dy);
        // Off the map is not "written": a rim crag can never be girt, which is why no crag layout
        // is allowed to touch the rim in the first place.
        if (v === 0 || v === -1) girt = false;
      }
      if (girt) n++;
    }
  }
  return n;
}

/** Unwritten cells orthogonally adjacent to at least one cell of `terrain`. The canker bleed. */
export function exposedTo(g: Grid, size: number, terrain: number): number {
  let n = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (g[idx(size, x, y)] !== 0) continue;
      for (const [dx, dy] of N4) {
        if (at(g, size, x + dx, y + dy) === terrain) {
          n++;
          break;
        }
      }
    }
  }
  return n;
}

/**
 * The longest run of one terrain reachable by stepping only DOWN or SIDEWAYS from a top-row cell —
 * a "road/river reaches the far side" measure that is cheap and, crucially, legible: the player can
 * trace it with a finger. A full graph distance would be neither.
 */
export function spansTopToBottom(g: Grid, size: number, terrain: number): boolean {
  const seen = new Uint8Array(g.length);
  const stack: number[] = [];
  for (let x = 0; x < size; x++) {
    const i = idx(size, x, 0);
    if (g[i] === terrain && !seen[i]) {
      seen[i] = 1;
      stack.push(i);
    }
  }
  while (stack.length) {
    const i = stack.pop()!;
    const y = (i / size) | 0;
    if (y === size - 1) return true;
    const x = i % size;
    for (const [dx, dy] of N4) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const j = idx(size, nx, ny);
      if (seen[j] || g[j] !== terrain) continue;
      seen[j] = 1;
      stack.push(j);
    }
  }
  return false;
}
