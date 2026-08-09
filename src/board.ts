// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// See ADDITIONAL-TERMS.md for the section 7(b) attribution requirement.
//
// Weald — one player's map: the grid, what may be written where, and what it is worth.
//
// Deliberately a plain data object plus free functions rather than a class with a renderer bolted
// on. Everything here is pure, so the sim, the bots, the second-guess proxy and the audit can all
// run thousands of maps a second with no DOM anywhere near them — and so a placement can be tried
// speculatively and thrown away, which is what the ghost does on every drag frame.

import { allPlacements, anyFit, fits, widthOf, heightOf, type Form } from './shapes';
import {
  exposedTo,
  girtCount,
  idx,
  at,
  NEIGHBOURS4,
  type Grid,
} from './measure';
import { CANKER, CRAG, GROVE, MERE, STEADING, TILTH, UNWRITTEN, type Terrain } from './terrain';
import { W } from './edicts';
import { anchorOf, shapeOf, WATCH_SCORES, type AnchorId, type Run } from './deck';

export interface Board {
  readonly size: number;
  readonly g: Int8Array;
}

export function newBoard(run: Run): Board {
  const g = new Int8Array(run.size * run.size);
  for (const [x, y] of run.crags) g[idx(run.size, x, y)] = CRAG;
  return { size: run.size, g };
}

export const cloneBoard = (b: Board): Board => ({ size: b.size, g: Int8Array.from(b.g) });

export const isEmpty = (b: Board, x: number, y: number): boolean =>
  b.g[idx(b.size, x, y)] === UNWRITTEN;

/** The occupancy predicate the geometry helpers take. Anything not unwritten blocks a placement. */
export const occupied =
  (b: Board) =>
  (x: number, y: number): boolean =>
    b.g[idx(b.size, x, y)] !== UNWRITTEN;

export interface Placement {
  form: number;
  x: number;
  y: number;
}

export function cellsOf(form: Form, x: number, y: number): Array<[number, number]> {
  return form.map((c) => [x + c.x, y + c.y] as [number, number]);
}

export function canPlace(b: Board, form: Form, x: number, y: number): boolean {
  return fits(form, x, y, b.size, occupied(b));
}

export function write(b: Board, form: Form, x: number, y: number, t: Terrain): void {
  for (const c of form) b.g[idx(b.size, x + c.x, y + c.y)] = t;
}

export const legalPlacements = (b: Board, forms: readonly Form[]): Placement[] =>
  allPlacements(forms, b.size, occupied(b));

export const anyLegal = (b: Board, forms: readonly Form[]): boolean =>
  anyFit(forms, b.size, occupied(b));

/**
 * Is there anywhere at all left to write? Equivalent to `emptyCount > 0`, but expressed through the
 * same geometry path everything else uses, so the two can never drift apart.
 */
export const hasRoom = (b: Board): boolean => b.g.some((v) => v === UNWRITTEN);

// ── anchors ───────────────────────────────────────────────────────────────────────────────────
//
// A carve's anchor says where the rot has to bite. Each is a predicate over the cells a placement
// would occupy, evaluated against the board BEFORE the carve is written.

const touchesTerrain = (b: Board, cells: Array<[number, number]>, t: number): boolean =>
  cells.some(([x, y]) =>
    NEIGHBOURS4.some(([dx, dy]) => at(b.g, b.size, x + dx, y + dy) === t),
  );

export function anchorHolds(b: Board, anchor: AnchorId, cells: Array<[number, number]>): boolean {
  switch (anchor) {
    case 'rootward':
      return touchesTerrain(b, cells, GROVE);
    case 'brackish':
      return touchesTerrain(b, cells, MERE);
    case 'fallow':
      return touchesTerrain(b, cells, TILTH);
    case 'wallward':
      return touchesTerrain(b, cells, STEADING);
    case 'rimward':
      return cells.some(([x, y]) => x === 0 || y === 0 || x === b.size - 1 || y === b.size - 1);
    case 'cragfall':
      return touchesTerrain(b, cells, CRAG);
    default:
      return true;
  }
}

export interface CarvePlan {
  /** Anchored placements; empty when the anchor cannot be met anywhere. */
  anchored: Placement[];
  /** Every legal placement, anchor ignored. */
  loose: Placement[];
  /** True when the anchor had to be dropped for the carve to happen at all. */
  anchorDropped: boolean;
  /** True when not even an unanchored placement fits and the rot lands as single cells. */
  forced: boolean;
}

/**
 * THE RESOLUTION LADDER, and the reason a carve can never soft-lock a run: try anchored, then drop
 * the anchor and say so, then scatter the rot one cell at a time, then — only on a completely full
 * map — discard it. Every rung is visible to the player and recorded in the event log, so the audit
 * can prove a dropped anchor really had nowhere to go rather than taking the game's word for it.
 */
export function planCarve(b: Board, shapeId: string, anchor: AnchorId): CarvePlan {
  const forms = shapeOf(shapeId).forms;
  const loose = legalPlacements(b, forms);
  const anchored = loose.filter((p) => anchorHolds(b, anchor, cellsOf(forms[p.form], p.x, p.y)));
  return {
    anchored,
    loose,
    anchorDropped: anchored.length === 0 && loose.length > 0,
    forced: loose.length === 0,
  };
}

export const anchorText = (id: AnchorId): string => anchorOf(id).text;

// ── scoring ───────────────────────────────────────────────────────────────────────────────────

export interface WatchScore {
  readonly watch: number;
  /** The two edicts that scored, in role order, with their cumulative values. */
  readonly parts: ReadonlyArray<{ role: number; id: string; name: string; value: number }>;
  /** Negative. Charged at EVERY watch end, so early rot is billed again and again. */
  readonly canker: number;
  readonly total: number;
}

/**
 * Score one watch end over the WHOLE map as it stands. Cumulative by design: a cell written in the
 * first watch keeps paying, which is what makes an early commitment feel like a commitment.
 */
export function scoreWatch(run: Run, b: Board, watch: number): WatchScore {
  const [ra, rb] = WATCH_SCORES[watch];
  const parts = [ra, rb].map((role) => {
    const e = run.roles[role];
    return { role, id: e.id, name: e.name, value: e.score(b.g as Grid, b.size) };
  });
  const canker = -run.mode.cankerP * exposedTo(b.g as Grid, b.size, CANKER);
  return { watch, parts, canker, total: parts.reduce((n, p) => n + p.value, 0) + canker };
}

/** Paid once, at the very end: every crag with all four neighbours written. */
export const girtBonus = (b: Board): number => W.girt * girtCount(b.g as Grid, b.size, CRAG);

export interface RunScore {
  readonly watches: readonly WatchScore[];
  /** Per-edict totals across both of its scoring occasions, in role order. */
  readonly perEdict: ReadonlyArray<{ id: string; name: string; value: number }>;
  readonly girt: number;
  readonly total: number;
}

export function scoreRun(run: Run, watches: readonly WatchScore[], b: Board): RunScore {
  const perEdict = run.roles.map((e, role) => ({
    id: e.id,
    name: e.name,
    value: watches
      .flatMap((w) => w.parts)
      .filter((p) => p.role === role)
      .reduce((n, p) => n + p.value, 0),
  }));
  const girt = girtBonus(b);
  return {
    watches,
    perEdict,
    girt,
    total: watches.reduce((n, w) => n + w.total, 0) + girt,
  };
}

// ── serialisation ─────────────────────────────────────────────────────────────────────────────
//
// A finished grid crosses the wire once per watch so every seat's summary can show every other
// seat's map. One character per cell: ~81 bytes, and human-readable in a debug log.

const CHARS = '.GMTSKR';

export function encodeGrid(b: Board): string {
  let s = '';
  for (let i = 0; i < b.g.length; i++) s += CHARS[b.g[i]] ?? '.';
  return s;
}

export function decodeGrid(s: string, size: number): Board | null {
  if (typeof s !== 'string' || s.length !== size * size) return null;
  const g = new Int8Array(size * size);
  for (let i = 0; i < s.length; i++) {
    const v = CHARS.indexOf(s[i]);
    if (v < 0) return null;
    g[i] = v;
  }
  return { size, g };
}

export { widthOf, heightOf };
