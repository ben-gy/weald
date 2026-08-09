// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// See ADDITIONAL-TERMS.md for the section 7(b) attribution requirement.
//
// Weald — one run, whether that is you alone against three bots or six people in a room.
//
// THE WIRE CARRIES RESULTS, NEVER STATE. Every peer deals the identical run from the seed the host
// froze into the round start, so there is nothing to keep in sync and nothing to desync: no
// snapshots, no input relay, no host authority over anything that matters. What crosses is a tiny
// progress ping while you play and your finished grid at each watch end, purely so that everybody's
// summary can show everybody's map. Host transfer is therefore a display concern — the promoted
// peer has nothing to take over, because nobody was holding anything.
//
// Two consequences worth stating because they are usually the hard part elsewhere:
//   - EVERY MESSAGE CARRIES ITS ROUND NUMBER and anything from another round is dropped. Without it
//     a watch-end grid from the previous run lands in the new one and paints a stale map into a
//     live summary.
//   - THE BOTS ARE SOLO-ONLY. A bot that stepped in reaction to the local player's commits would
//     make different moves on every device, and two peers would then show each other different
//     "same" opponents. In a room the other maps are real people, and that is all.

import { Game } from './game';
import { dealRun, type Run } from './deck';
import {
  decodeGrid,
  encodeGrid as encode,
  scoreRun,
  scoreWatch as scoreWatchOf,
  type Board,
  type RunScore,
} from './board';
import { SKILLS, playOut, secondGuessOf, type Skill } from './bots';
import { summarise, type SeatResult, type Summary } from './summary';
import { WATCHES, type ModeId } from './modes';

export interface SeatState {
  id: string;
  name: string;
  you: boolean;
  bot: boolean;
  /** Latest posted grid, per watch. Index 3 is the finished map. */
  grids: Array<string | null>;
  totals: Array<number | null>;
  secondGuess: number;
  /** Wall-clock of the last thing we heard. Used to mark a seat away. */
  heard: number;
  done: boolean;
}

export interface SessionDeps {
  send: (m: unknown) => void;
  onChange: () => void;
  onWatchEnd: (watch: number, s: Summary) => void;
  onEnd: (s: Summary) => void;
}

type Wire =
  | { t: 'p'; r: number; i: number; w: number; s: number }
  | { t: 'w'; r: number; w: number; g: string; s: number; sg: number };

/** A seat is presumed gone after this much silence. Never rely on onPeerLeave alone. */
export const AWAY_MS = 20000;
/** How long a watch summary waits for the stragglers before showing what it has. */
export const WATCH_GATE_MS = 20000;

export class Session {
  readonly run: Run;
  readonly game: Game;
  readonly seats: SeatState[] = [];
  readonly round: number;
  readonly solo: boolean;

  private deps: SessionDeps;
  private skill: Skill;
  private botGames: Array<{ seat: SeatState; game: Game; skill: Skill }> = [];
  private shownWatch = -1;
  private gateOpenedAt = 0;

  constructor(opts: {
    mode: ModeId;
    seed: number;
    round: number;
    skill: string;
    selfId: string;
    myName: string;
    peers: Array<{ id: string; name: string }>;
    deps: SessionDeps;
  }) {
    this.run = dealRun(opts.mode, opts.seed);
    this.game = new Game(this.run);
    this.round = opts.round;
    this.deps = opts.deps;
    this.skill = SKILLS[opts.skill] ?? SKILLS.tallow;
    this.solo = opts.peers.length <= 1;

    const blank = (): Array<string | null> => [null, null, null, null];
    // Solo has no roster at all, so the local player would otherwise have no seat and the summary
    // would come out empty — which is exactly what it did the first time this ran in a browser.
    const roster = opts.peers.length > 0 ? opts.peers : [{ id: opts.selfId, name: opts.myName }];
    for (const p of roster) {
      this.seats.push({
        id: p.id,
        name: p.name,
        you: p.id === opts.selfId,
        bot: false,
        grids: blank(),
        totals: [null, null, null, null],
        secondGuess: 0,
        heard: Date.now(),
        done: false,
      });
    }

    // SOLO ONLY. Three rivals draw the identical run beside you, so the summary always has four
    // rows and "what everyone missed" means something with nobody else in the room.
    if (this.solo) {
      for (const id of ['tallow', 'sedge', 'knap']) {
        const skill = SKILLS[id];
        const seat: SeatState = {
          id: `bot:${id}`,
          name: skill.name,
          you: false,
          bot: true,
          grids: blank(),
          totals: [null, null, null, null],
          secondGuess: 0,
          heard: Date.now(),
          done: false,
        };
        this.seats.push(seat);
        this.botGames.push({ seat, game: new Game(this.run), skill });
      }
      // The bots play their whole run immediately: they are a benchmark, not an opponent taking a
      // turn, and running them up front means par is on the score bar from the first placement.
      //
      // Their map is SNAPSHOT AT EVERY WATCH BOUNDARY, not just at the end, because the summary
      // appears after every watch and a row with no map in it is a row that says nothing.
      for (const b of this.botGames) {
        const r = playOut(b.game, b.skill, {
          track: true,
          onWatchEnd: (w, board) => {
            b.seat.grids[w] = encode(board);
          },
        });
        const sc = b.game.score();
        b.seat.secondGuess = Math.round(r.secondGuess);
        b.seat.done = true;
        for (let w = 0; w < WATCHES; w++) {
          b.seat.totals[w] = sc.watches.slice(0, w + 1).reduce((n, x) => n + x.total, 0);
        }
        b.seat.grids[WATCHES - 1] = encode(b.game.board);
      }
    }
  }

  /** Par: what the reference bot managed on this exact run. Null in a room. */
  par(): number | null {
    const t = this.botGames.find((b) => b.skill.id === 'tallow');
    return t ? t.game.score().total : null;
  }

  get me(): SeatState | undefined {
    return this.seats.find((s) => s.you);
  }

  /** Running score, cumulative over the watches already closed plus the live one. */
  liveScore(): number {
    return this.game.watchScores.reduce((n, w) => n + w.total, 0);
  }

  /** Called after every commit. Posts progress, and closes a watch when one ends. */
  afterPlay(): void {
    const w = this.game.watchScores.length - 1;
    this.deps.send({ t: 'p', r: this.round, i: this.game.index, w: this.game.watch, s: this.liveScore() } satisfies Wire);
    if (w >= 0 && w > this.shownWatch) this.closeWatch(w);
    else this.deps.onChange();
  }

  private closeWatch(w: number): void {
    this.shownWatch = w;
    const me = this.me;
    const grid = encode(this.game.board);
    const total = this.liveScore();
    if (me) {
      me.grids[w] = grid;
      me.totals[w] = total;
      me.heard = Date.now();
    }
    this.deps.send({ t: 'w', r: this.round, w, g: grid, s: total, sg: 0 } satisfies Wire);
    this.gateOpenedAt = Date.now();
    if (this.game.over) this.finish();
    else this.maybeShowWatch(w);
  }

  /**
   * A watch summary appears once every seat we can still hear from has posted, or twenty seconds
   * after the first post, whichever is sooner. Late posts fold in when they land. Nobody ever waits
   * on a player who has put their phone down.
   */
  maybeShowWatch(w: number): void {
    if (this.game.over) return;
    const live = this.seats.filter((s) => !s.bot && Date.now() - s.heard < AWAY_MS);
    const posted = live.filter((s) => s.grids[w] !== null).length;
    const timedOut = Date.now() - this.gateOpenedAt > WATCH_GATE_MS;
    if (posted >= live.length || timedOut) this.deps.onWatchEnd(w, this.summary(w));
    else this.deps.onChange();
  }

  /** Ms until the watch gate gives up on the stragglers, or null when it is not waiting. */
  gateIn(): number | null {
    if (this.gateOpenedAt === 0 || this.game.over) return null;
    const left = WATCH_GATE_MS - (Date.now() - this.gateOpenedAt);
    return left > 0 ? left : null;
  }

  private finish(): void {
    const me = this.me;
    if (me) {
      // The second-guess replays the log against a fresh board, so nothing had to be stored while
      // the run was being played.
      me.secondGuess = secondGuessOf(new Game(this.run), this.game.log, this.skill);
      me.done = true;
    }
    this.deps.onEnd(this.summary(null));
  }

  receive(raw: unknown, from: string): void {
    const m = raw as Wire;
    if (!m || typeof m !== 'object') return;
    // Anything from another round is a message from a run that is over. Dropping it is what stops a
    // stale grid painting itself into a live summary.
    if (typeof m.r !== 'number' || m.r !== this.round) return;
    const seat = this.seats.find((s) => s.id === from);
    if (!seat) return;
    seat.heard = Date.now();
    if (m.t === 'p') {
      this.deps.onChange();
      return;
    }
    if (m.t === 'w' && typeof m.w === 'number' && m.w >= 0 && m.w < WATCHES && typeof m.g === 'string') {
      if (decodeGrid(m.g, this.run.size) === null) return;
      seat.grids[m.w] = m.g;
      seat.totals[m.w] = typeof m.s === 'number' ? m.s : 0;
      seat.secondGuess = typeof m.sg === 'number' ? m.sg : seat.secondGuess;
      if (m.w === WATCHES - 1) seat.done = true;
      this.maybeShowWatch(m.w);
    }
  }

  /** Beat the heartbeat so a quiet seat can be told apart from one that has gone. */
  beat(): void {
    this.deps.send({ t: 'p', r: this.round, i: this.game.index, w: this.game.watch, s: this.liveScore() } satisfies Wire);
  }

  peerLeft(id: string): void {
    const s = this.seats.find((x) => x.id === id);
    if (s) s.heard = 0;
    this.deps.onChange();
  }

  /**
   * Build the table. A seat that never posted a grid still gets a row, with the last figures it did
   * post — a player who left mid-run is shown as they were, never dropped from the comparison.
   */
  summary(watch: number | null): Summary {
    const w = watch ?? WATCHES - 1;
    const results: SeatResult[] = [];
    for (const s of this.seats) {
      const gridStr = s.you ? encode(this.game.board) : lastGrid(s, w);
      const board = gridStr ? decodeGrid(gridStr, this.run.size) : null;
      if (!board) continue;
      const score = s.you
        ? scoreRun(this.run, this.game.watchScores, this.game.board)
        : rescore(this.run, board, s, w);
      results.push({
        name: s.name,
        you: s.you,
        bot: s.bot,
        board,
        score,
        secondGuess: s.secondGuess,
        complete: s.done,
      });
    }
    return summarise(results, this.run.size, watch === null ? null : watchNameOf(watch));
  }

  destroy(): void {
    this.botGames = [];
  }
}

/**
 * Re-derive a rival's breakdown from the grid they sent, rather than trusting a number.
 *
 * This is not an anti-cheat measure and must never be presented as one — it is how the summary can
 * show an edict-by-edict line for somebody whose per-edict figures were never transmitted, and it
 * keeps the wire at one string per watch instead of a structure that would have to stay in step
 * with the scoring code. If it ever disagreed with a transmitted total, the honest reading is that
 * the two peers are running different builds.
 */
function rescore(run: Run, board: Board, seat: SeatState, w: number): RunScore {
  const watches = [];
  for (let i = 0; i <= w; i++) {
    watches.push(scoreWatchOf(run, board, i));
  }
  const s = scoreRun(run, watches, board);
  // The transmitted running total is what the player actually earned watch by watch; the re-derived
  // one is over the FINAL map, so it is only equal at the end. Prefer theirs when we have it.
  const told = seat.totals[w];
  if (typeof told === 'number' && w < WATCHES - 1) {
    return { ...s, total: told };
  }
  return s;
}

function lastGrid(s: SeatState, w: number): string | null {
  for (let i = w; i >= 0; i--) if (s.grids[i]) return s.grids[i];
  return null;
}

const watchNameOf = (w: number): string => ['Quickening', 'Highsun', 'Waning', 'Dwindle'][w] ?? '';
