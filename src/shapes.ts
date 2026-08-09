// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// See ADDITIONAL-TERMS.md for the section 7(b) attribution requirement.
//
// Weald — polyomino geometry. Pure, allocation-light, and completely ignorant of the game.
//
// A shape is a sorted list of {x,y} offsets normalised so its bounding box starts at (0,0). That
// normal form is what makes an ORIENTATION KEY possible: rotate/reflect, re-normalise, sort, join —
// two orientations that draw the same cells produce the same string and are deduplicated. Without
// that, a square would offer the player eight identical "rotations" and the rotate button would
// look broken; with it, a square offers one, an S offers two, an L offers eight.
//
// Everything here is deterministic and side-effect free, so the same shape id yields the same
// orientation list on every peer. That matters more than it looks: this is a parallel same-seed
// game, and the summary compares two players' maps cell for cell. If one peer's rotate order
// differed from another's, two people pressing "rotate twice" would be drawing different shapes.

export interface Cell {
  x: number;
  y: number;
}

/** A normalised orientation: offsets with min-x and min-y both 0, in row-major order. */
export type Form = readonly Cell[];

export function normalise(cells: readonly Cell[]): Cell[] {
  let minX = Infinity;
  let minY = Infinity;
  for (const c of cells) {
    if (c.x < minX) minX = c.x;
    if (c.y < minY) minY = c.y;
  }
  return cells
    .map((c) => ({ x: c.x - minX, y: c.y - minY }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

export const keyOf = (form: Form): string => form.map((c) => `${c.x},${c.y}`).join(' ');

export const rotate = (cells: readonly Cell[]): Cell[] =>
  normalise(cells.map((c) => ({ x: -c.y, y: c.x })));

export const reflect = (cells: readonly Cell[]): Cell[] =>
  normalise(cells.map((c) => ({ x: -c.x, y: c.y })));

export const widthOf = (form: Form): number => Math.max(...form.map((c) => c.x)) + 1;
export const heightOf = (form: Form): number => Math.max(...form.map((c) => c.y)) + 1;

/**
 * Every DISTINCT orientation, in a fixed order: the four rotations of the shape as given, then the
 * four rotations of its mirror, with duplicates dropped as they are met.
 *
 * The order is part of the contract — "rotate" steps through this list, so it must be the same list
 * on every device. Dropping duplicates is what stops a 2x2 block from having eight identical
 * "rotations", which reads to a player as a dead button.
 */
export function orientations(cells: readonly Cell[]): Form[] {
  const out: Form[] = [];
  const seen = new Set<string>();
  let cur = normalise(cells);
  for (let mirror = 0; mirror < 2; mirror++) {
    for (let r = 0; r < 4; r++) {
      const k = keyOf(cur);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(cur);
      }
      cur = rotate(cur);
    }
    cur = reflect(cur);
  }
  return out;
}

/** True when every cell of `form`, offset to (ox,oy), is on the board and unoccupied. */
export function fits(
  form: Form,
  ox: number,
  oy: number,
  size: number,
  occupied: (x: number, y: number) => boolean,
): boolean {
  for (const c of form) {
    const x = ox + c.x;
    const y = oy + c.y;
    if (x < 0 || y < 0 || x >= size || y >= size) return false;
    if (occupied(x, y)) return false;
  }
  return true;
}

/**
 * Is there ANY legal placement of ANY orientation? This is the soft-lock guard, and it is the
 * reason the fallback rule exists at all — as a map fills, a five-cell shape stops fitting long
 * before the map is full, and a game that simply refuses the placement at that point is a game the
 * player cannot finish.
 */
export function anyFit(
  forms: readonly Form[],
  size: number,
  occupied: (x: number, y: number) => boolean,
): boolean {
  for (const f of forms) {
    const w = widthOf(f);
    const h = heightOf(f);
    for (let y = 0; y <= size - h; y++) {
      for (let x = 0; x <= size - w; x++) {
        if (fits(f, x, y, size, occupied)) return true;
      }
    }
  }
  return false;
}

/** Every legal (form index, x, y) triple. Used by the bot, the sim and the "you missed" proxy. */
export function allPlacements(
  forms: readonly Form[],
  size: number,
  occupied: (x: number, y: number) => boolean,
): Array<{ form: number; x: number; y: number }> {
  const out: Array<{ form: number; x: number; y: number }> = [];
  for (let i = 0; i < forms.length; i++) {
    const f = forms[i];
    const w = widthOf(f);
    const h = heightOf(f);
    for (let y = 0; y <= size - h; y++) {
      for (let x = 0; x <= size - w; x++) {
        if (fits(f, x, y, size, occupied)) out.push({ form: i, x, y });
      }
    }
  }
  return out;
}

/** Parse a shape from an ASCII sketch — how every shape in the deck is declared. */
export function fromSketch(rows: readonly string[]): Cell[] {
  const cells: Cell[] = [];
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      if (rows[y][x] !== '.' && rows[y][x] !== ' ') cells.push({ x, y });
    }
  }
  return normalise(cells);
}
