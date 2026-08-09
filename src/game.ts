// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// See ADDITIONAL-TERMS.md for the section 7(b) attribution requirement.
//
// Weald — one player's run: the deal pointer, the map, and the log of what they did.
//
// THE EVENT LOG IS THE PRODUCT, not a debugging aid. tests/mechanism.test.ts consumes it and
// nothing else — no import of this file, no import of edicts.ts or deck.ts — and re-derives the
// whole run from independently written code: that every cell was in bounds and unwritten, that the
// placed cells really are the declared shape under some rotation or reflection, that a forced
// scrawl was genuinely forced, that a dropped anchor genuinely had nowhere to go, and that the
// score is the integer the game claimed. An audit that imports the game's own maths is a tautology
// that stays green on a mutated formula, so it gets the log and its own arithmetic, nothing more.

import { cloneBoard, newBoard, scoreRun, scoreWatch, write, type Board, type RunScore, type WatchScore } from './board';
import { anyLegal, canPlace, cellsOf, legalPlacements, planCarve } from './board';
import { shapeOf, type Branch, type Card, type Carve, type Deal, type Run } from './deck';
import { WATCHES } from './modes';
import { CANKER, type Terrain } from './terrain';
import type { Form } from './shapes';

export type BranchId = 'a' | 'b' | 'scrawl';

export interface PlaceEvent {
  watch: number;
  /** Index of the deal within the whole run, 0-based. */
  i: number;
  kind: 'card' | 'carve';
  shapeId: string;
  branch: BranchId;
  terrain: Terrain;
  cells: Array<[number, number]>;
  /** A scrawl the player chose while a bigger branch was still legal. */
  voluntary?: true;
  /** A scrawl taken because nothing else fitted, or a carve scattered as single cells. */
  fallback?: true;
  /** A carve whose anchor could not be met anywhere on the map. */
  anchorDropped?: true;
}

export interface Choice {
  branch: BranchId;
  /** Index into the chosen shape's deduped orientation list. */
  form: number;
  x: number;
  y: number;
  terrain: Terrain;
}

export class Game {
  readonly run: Run;
  readonly board: Board;
  readonly log: PlaceEvent[] = [];
  readonly watchScores: WatchScore[] = [];

  /** Index of the current deal within the whole run. */
  private cursor = 0;
  private flat: Array<{ watch: number; deal: Deal }> = [];
  private finished = false;

  constructor(run: Run) {
    this.run = run;
    this.board = newBoard(run);
    for (let w = 0; w < WATCHES; w++) {
      for (const deal of run.watches[w].deals) this.flat.push({ watch: w, deal });
    }
  }

  get over(): boolean {
    return this.finished;
  }
  get index(): number {
    return this.cursor;
  }
  get total(): number {
    return this.flat.length;
  }
  get watch(): number {
    return this.flat[Math.min(this.cursor, this.flat.length - 1)]?.watch ?? WATCHES - 1;
  }
  get deal(): Deal | null {
    return this.flat[this.cursor]?.deal ?? null;
  }

  /** How many deals remain in the current watch, this one included. */
  get dealsLeftInWatch(): number {
    const w = this.watch;
    let n = 0;
    for (let i = this.cursor; i < this.flat.length && this.flat[i].watch === w; i++) n++;
    return n;
  }

  /** Which roles are face-up right now. */
  revealedRoles(): number[] {
    const w = this.watch;
    const out: number[] = [];
    for (let r = 0; r < 4; r++) if (revealedIn(r) <= w) out.push(r);
    return out;
  }

  branchOf(id: BranchId): Branch | null {
    const d = this.deal;
    if (!d || d.kind !== 'card') return null;
    if (id === 'a') return d.a;
    if (id === 'b') return d.b;
    return null;
  }

  /** The orientation list for a branch of the current deal. Scrawl is always a single cell. */
  formsFor(id: BranchId): readonly Form[] {
    const d = this.deal;
    if (!d) return shapeOf('dot').forms;
    if (d.kind === 'carve') return shapeOf(d.shapeId).forms;
    if (id === 'scrawl') return shapeOf('dot').forms;
    const br = id === 'a' ? d.a : d.b;
    return shapeOf(br ? br.shapeId : 'dot').forms;
  }

  /** Terrains a branch may be written in. A carve is always canker. */
  terrainsFor(id: BranchId): readonly Terrain[] {
    const d = this.deal;
    if (!d) return [];
    if (d.kind === 'carve') return [CANKER];
    // A scrawl may be any terrain the card permits at all, across both branches.
    if (id === 'scrawl') {
      const s = new Set<Terrain>(d.a.terrains);
      if (d.b) for (const t of d.b.terrains) s.add(t);
      return [...s];
    }
    const br = id === 'a' ? d.a : d.b;
    return br ? br.terrains : [];
  }

  /** Which branches of the current deal can legally be placed anywhere at all. */
  playable(): BranchId[] {
    const d = this.deal;
    if (!d || d.kind === 'carve') return [];
    const out: BranchId[] = [];
    if (anyLegal(this.board, this.formsFor('a'))) out.push('a');
    if (d.b && anyLegal(this.board, this.formsFor('b'))) out.push('b');
    if (anyLegal(this.board, shapeOf('dot').forms)) out.push('scrawl');
    return out;
  }

  legalFor(id: BranchId) {
    return legalPlacements(this.board, this.formsFor(id));
  }

  /**
   * Every distinct thing the player could do with the current deal — the number the boredom gate in
   * tests/balance.test.ts holds to a floor. Counting (branch x orientation x position x terrain)
   * rather than positions alone is the honest measure: two terrains really are two different moves,
   * because they feed different edicts.
   */
  optionCount(): number {
    const d = this.deal;
    if (!d) return 0;
    if (d.kind === 'carve') return this.legalFor('a').length;
    let n = 0;
    for (const id of this.playable()) {
      n += this.legalFor(id).length * Math.max(1, this.terrainsFor(id).length);
    }
    return n;
  }

  /** Apply a chosen placement. Returns false and changes nothing if it is not legal. */
  play(choice: Choice): boolean {
    const d = this.deal;
    if (!d || this.finished) return false;
    if (d.kind === 'carve') return false;

    const forms = this.formsFor(choice.branch);
    const form = forms[choice.form];
    if (!form) return false;
    if (!canPlace(this.board, form, choice.x, choice.y)) return false;
    if (!this.terrainsFor(choice.branch).includes(choice.terrain)) return false;

    const bigger = this.playable().filter((b) => b !== 'scrawl');
    write(this.board, form, choice.x, choice.y, choice.terrain);
    const ev: PlaceEvent = {
      watch: this.watch,
      i: this.cursor,
      kind: 'card',
      shapeId: choice.branch === 'scrawl' ? 'dot' : (this.branchOf(choice.branch)?.shapeId ?? 'dot'),
      branch: choice.branch,
      terrain: choice.terrain,
      cells: cellsOf(form, choice.x, choice.y),
    };
    if (choice.branch === 'scrawl') {
      // The distinction the audit checks at zero tolerance: a scrawl taken while something bigger
      // was still legal is a DECISION (sometimes the right one — one clean cell can preserve a full
      // row that five bad ones would ruin); a scrawl taken with nothing else legal is the escape
      // hatch. Tagging them differently is what lets the audit prove the escape was real.
      if (bigger.length > 0) ev.voluntary = true;
      else ev.fallback = true;
    }
    this.log.push(ev);
    this.advance();
    return true;
  }

  /**
   * Resolve the carve at the cursor. The caller supplies the player's chosen placement among the
   * legal ones; `null` means "you decide", which is what the bots and the forced path use.
   */
  carve(choice: { form: number; x: number; y: number } | null): boolean {
    const d = this.deal;
    if (!d || this.finished || d.kind !== 'carve') return false;
    const plan = this.plan();
    if (!plan) return false;

    if (plan.forced) {
      // Nothing of the shape fits anywhere. The rot lands as loose cells instead of stalling the
      // run — and the audit re-runs its own search to prove there was genuinely nothing.
      const area = shapeOf(d.shapeId).area;
      const cells: Array<[number, number]> = [];
      for (let k = 0; k < area; k++) {
        const spot = legalPlacements(this.board, shapeOf('dot').forms)[0];
        if (!spot) break;
        write(this.board, shapeOf('dot').forms[spot.form], spot.x, spot.y, CANKER);
        cells.push([spot.x, spot.y]);
      }
      this.log.push({
        watch: this.watch,
        i: this.cursor,
        kind: 'carve',
        shapeId: d.shapeId,
        branch: 'scrawl',
        terrain: CANKER,
        cells,
        fallback: true,
      });
      this.advance();
      return true;
    }

    const pool = plan.anchored.length > 0 ? plan.anchored : plan.loose;
    const pick = choice ?? pool[0];
    const forms = shapeOf(d.shapeId).forms;
    const form = forms[pick.form];
    if (!form || !canPlace(this.board, form, pick.x, pick.y)) return false;
    if (plan.anchored.length > 0 && !plan.anchored.some((p) => p.form === pick.form && p.x === pick.x && p.y === pick.y)) {
      return false;
    }
    write(this.board, form, pick.x, pick.y, CANKER);
    const ev: PlaceEvent = {
      watch: this.watch,
      i: this.cursor,
      kind: 'carve',
      shapeId: d.shapeId,
      branch: 'a',
      terrain: CANKER,
      cells: cellsOf(form, pick.x, pick.y),
    };
    if (plan.anchorDropped) ev.anchorDropped = true;
    this.log.push(ev);
    this.advance();
    return true;
  }

  /** The carve resolution ladder for the deal at the cursor, or null if it is not a carve. */
  plan() {
    const d = this.deal;
    if (!d || d.kind !== 'carve') return null;
    return planCarve(this.board, d.shapeId, d.anchor);
  }

  private advance(): void {
    const before = this.watch;
    this.cursor++;
    const after = this.flat[this.cursor]?.watch;
    if (this.cursor >= this.flat.length) {
      this.watchScores.push(scoreWatch(this.run, this.board, before));
      this.finished = true;
      return;
    }
    if (after !== before) this.watchScores.push(scoreWatch(this.run, this.board, before));

    // A map with no unwritten square left ends the run early rather than dealing cards nobody can
    // play. The sim asserts this never happens before the last deal.
    if (!this.board.g.some((v) => v === 0)) {
      for (let w = before + (after !== before ? 1 : 0); w < WATCHES; w++) {
        this.watchScores.push(scoreWatch(this.run, this.board, w));
      }
      this.cursor = this.flat.length;
      this.finished = true;
    }
  }

  /**
   * Undo exactly one placement, by restoring the grid as it was and rewinding the cursor.
   *
   * ONE DEEP, AND ONLY WITHIN A WATCH. The caller offers this until the next branch is chosen; it
   * refuses once a watch has closed, because a closed watch has already been scored and posted to
   * the other players, and quietly unwinding somebody else's summary is worse than not offering an
   * undo at all.
   */
  rollback(before: Int8Array): boolean {
    if (this.finished || this.log.length === 0) return false;
    const last = this.log[this.log.length - 1];
    // A watch closed on that placement — the score is banked and the grid is already on the wire.
    if (this.watchScores.length > 0 && this.flat[this.cursor - 1]?.watch !== this.flat[this.cursor]?.watch) {
      return false;
    }
    this.board.g.set(before);
    this.log.pop();
    this.cursor = last.i;
    return true;
  }

  score(): RunScore {
    return scoreRun(this.run, this.watchScores, this.board);
  }

  snapshot(): Board {
    return cloneBoard(this.board);
  }
}

/** Which watch a role becomes visible in. Alpha and beta are face-up from the start. */
export const revealedIn = (role: number): number => [0, 0, 1, 2][role] ?? 0;

/** A card can always be scrawled; this is the label the tray shows when nothing bigger fits. */
export const scrawlOnly = (g: Game): boolean => {
  const p = g.playable();
  return p.length === 1 && p[0] === 'scrawl';
};

export type { Card, Carve, Deal };
