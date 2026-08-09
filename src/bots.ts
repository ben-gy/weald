// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// See ADDITIONAL-TERMS.md for the section 7(b) attribution requirement.
//
// Weald — three surveyors who are not you.
//
// ONE IMPLEMENTATION, FOUR USES: the solo opponents, the par tick on the score bar, the balance
// sim, and the end-of-run "second-guess" figure are all this greedy. That is deliberate. If par
// came from different code than the opponents, a change to one would silently stop meaning what the
// other claimed, and the summary would be comparing the player against a bot that no longer exists.
//
// The three differ only in a weight vector, and those differences are the personalities:
//
//   TALLOW  the reference, and what par means. Scores the revealed edicts, hedges a little against
//           the rules not yet turned face-up, avoids leaving squares next to the rot, and nudges
//           toward walling crags in. Solid, unspectacular, hard to embarrass.
//   SEDGE   scores only what is face-up, right now, with no hedge and no thought for the canker.
//           Leads early and comes apart in the last watch — which is exactly what a player who has
//           not yet noticed the reveal schedule does.
//   KNAP    half its attention on score and half on keeping the map open, so it wins the cramped
//           seeds and loses the generous ones.
//
// A one-ply greedy is honest about what it is. It is not a solver — an exact optimum here is
// NP-hard — and nothing in the UI ever calls it one.

import { Game, type BranchId, type Choice } from './game';
import { girtCount, exposedTo, type Grid } from './measure';
import { cloneBoard, write } from './board';
import { CANKER, CRAG, type Terrain } from './terrain';
import { shapeOf } from './deck';
import { anyFit } from './shapes';
import { occupied } from './board';

export interface Skill {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  /** Weight on the edicts not yet revealed — hedging against what is coming. */
  readonly hedge: number;
  /** Weight on NOT leaving unwritten squares next to canker. */
  readonly hygiene: number;
  /** Weight on walling crags in for the end-of-run bonus. */
  readonly girt: number;
  /** Weight on keeping the map open for future shapes. */
  readonly openness: number;
}

export const SKILLS: Record<string, Skill> = {
  tallow: {
    id: 'tallow',
    name: 'Tallow',
    blurb: 'Steady. Plays the rules on the table and keeps half an eye on the ones that are not.',
    hedge: 0.35,
    hygiene: 0.25,
    girt: 0.15,
    openness: 0,
  },
  sedge: {
    id: 'sedge',
    name: 'Sedge',
    blurb: 'Plays only what is face-up. Leads early, and the last watch tends to catch it out.',
    hedge: 0,
    hygiene: 0,
    girt: 0,
    openness: 0,
  },
  knap: {
    id: 'knap',
    name: 'Knap',
    blurb: 'Hoards room. Wins the cramped maps and gives away the generous ones.',
    hedge: 0.2,
    hygiene: 0.2,
    girt: 0.1,
    openness: 0.5,
  },
};

export const SKILL_IDS: readonly string[] = ['tallow', 'sedge', 'knap'];

export function skillOf(id: string | null | undefined): Skill {
  if (typeof id === 'string' && Object.hasOwn(SKILLS, id)) return SKILLS[id];
  return SKILLS.tallow;
}

/** A probe shape used to ask "how open is this map still?" — the biggest thing that ever arrives. */
const PROBE = shapeOf('ell5').forms;

/**
 * Value a hypothetical board. Only ever called on a scratch copy.
 *
 * `blind` is the negative-gap control arm: when true the evaluator cannot see the shape's
 * orientation freedom (the caller restricts it to a single form), which is how the sim proves free
 * rotation is load-bearing rather than decoration.
 */
function valueOf(g: Game, board: ReturnType<typeof cloneBoard>, skill: Skill): number {
  const revealed = new Set(g.revealedRoles());
  let v = 0;
  for (let role = 0; role < g.run.roles.length; role++) {
    const e = g.run.roles[role];
    const s = e.score(board.g as Grid, board.size);
    v += revealed.has(role) ? s : skill.hedge * s;
  }
  v -= skill.hygiene * g.run.mode.cankerP * exposedTo(board.g as Grid, board.size, CANKER);
  v += skill.girt * 4 * girtCount(board.g as Grid, board.size, CRAG);
  if (skill.openness > 0) {
    // A cheap proxy for "can a big shape still land here", worth a few points of value.
    v += skill.openness * (anyFit(PROBE, board.size, occupied(board)) ? 6 : 0);
  }
  return v;
}

export interface Candidate {
  choice: Choice;
  value: number;
}

/**
 * Every move the greedy will consider for the current deal, scored. `fixedForm` restricts each
 * branch to a single orientation — the control arm for the free-rotation gap test.
 */
export function candidates(g: Game, skill: Skill, fixedForm = false): Candidate[] {
  const out: Candidate[] = [];
  const branches = g.playable();
  for (const branch of branches as BranchId[]) {
    const forms = g.formsFor(branch);
    const terrains = g.terrainsFor(branch);
    for (const p of g.legalFor(branch)) {
      if (fixedForm && p.form !== 0) continue;
      for (const t of terrains) {
        const scratch = cloneBoard(g.board);
        write(scratch, forms[p.form], p.x, p.y, t as Terrain);
        out.push({ choice: { branch, form: p.form, x: p.x, y: p.y, terrain: t }, value: valueOf(g, scratch, skill) });
      }
    }
  }
  return out;
}

/** The best move the greedy sees, or null when the deal is a carve or the map is full. */
export function bestMove(g: Game, skill: Skill, fixedForm = false): Candidate | null {
  let best: Candidate | null = null;
  for (const c of candidates(g, skill, fixedForm)) {
    if (!best || c.value > best.value) best = c;
  }
  return best;
}

/** Where the greedy would take a carve: least damage by its own lights. */
export function bestCarve(g: Game, skill: Skill): { form: number; x: number; y: number } | null {
  const plan = g.plan();
  const d = g.deal;
  if (!plan || !d || d.kind !== 'carve') return null;
  const pool = plan.anchored.length > 0 ? plan.anchored : plan.loose;
  if (pool.length === 0) return null;
  const forms = shapeOf(d.shapeId).forms;
  let best: { p: (typeof pool)[number]; v: number } | null = null;
  for (const p of pool) {
    const scratch = cloneBoard(g.board);
    write(scratch, forms[p.form], p.x, p.y, CANKER);
    const v = valueOf(g, scratch, skill);
    if (!best || v > best.v) best = { p, v };
  }
  return best ? { form: best.p.form, x: best.p.x, y: best.p.y } : null;
}

export interface RunResult {
  score: number;
  /** Sum over placements of (best one-ply value the greedy saw − the value actually taken). */
  secondGuess: number;
  game: Game;
}

/**
 * Play a whole run with one skill. `fixedForm` is the control arm; `track` records the one-ply
 * regret so the same pass produces the "second-guess" figure the summary shows.
 */
export function playOut(
  g: Game,
  skill: Skill,
  opts: {
    fixedForm?: boolean;
    track?: boolean;
    /** Fires as each watch closes, with the map as it stood — for the per-watch summary rows. */
    onWatchEnd?: (watch: number, board: ReturnType<typeof cloneBoard>) => void;
  } = {},
): RunResult {
  let secondGuess = 0;
  let guard = 0;
  let closed = g.watchScores.length;
  const checkWatch = (): void => {
    while (opts.onWatchEnd && g.watchScores.length > closed) {
      opts.onWatchEnd(g.watchScores[closed].watch, cloneBoard(g.board));
      closed++;
    }
  };
  while (!g.over && guard++ < 400) {
    const d = g.deal;
    if (!d) break;
    if (d.kind === 'carve') {
      g.carve(bestCarve(g, skill));
      checkWatch();
      continue;
    }
    const best = bestMove(g, skill, opts.fixedForm);
    if (!best) break;
    if (opts.track) {
      const unrestricted = bestMove(g, skill, false);
      if (unrestricted) secondGuess += Math.max(0, unrestricted.value - best.value);
    }
    if (!g.play(best.choice)) break;
    checkWatch();
  }
  checkWatch();
  return { score: g.score().total, secondGuess, game: g };
}

/**
 * The player's own second-guess: for each of their placements, how much one-ply value the greedy
 * would have found that they did not. Replays their log against a fresh board so it costs one pass
 * and needs nothing stored during play.
 *
 * The label in the UI is fixed and never says "optimal": this is a one-ply comparison against
 * revealed rules only, and calling it a perfect line would be a lie the game cannot back up.
 */
export function secondGuessOf(fresh: Game, log: readonly { branch: BranchId; form?: number; cells: Array<[number, number]>; terrain: number; kind: string }[], skill: Skill): number {
  let regret = 0;
  let k = 0;
  let guard = 0;
  while (!fresh.over && k < log.length && guard++ < 400) {
    const ev = log[k++];
    const d = fresh.deal;
    if (!d) break;
    if (d.kind === 'carve' || ev.kind === 'carve') {
      const match = matchPlacement(fresh, ev.cells, 'a');
      fresh.carve(match ? { form: match.form, x: match.x, y: match.y } : null);
      continue;
    }
    const best = bestMove(fresh, skill, false);
    const match = matchPlacement(fresh, ev.cells, ev.branch);
    if (!match) break;
    const mine = valueAfter(fresh, ev.branch, match, ev.terrain as Terrain, skill);
    if (best) regret += Math.max(0, best.value - mine);
    if (!fresh.play({ branch: ev.branch, form: match.form, x: match.x, y: match.y, terrain: ev.terrain as Terrain })) break;
  }
  return Math.round(regret);
}

function valueAfter(g: Game, branch: BranchId, p: { form: number; x: number; y: number }, t: Terrain, skill: Skill): number {
  const scratch = cloneBoard(g.board);
  write(scratch, g.formsFor(branch)[p.form], p.x, p.y, t);
  return valueOf(g, scratch, skill);
}

/** Find which (orientation, origin) of a branch produces exactly this cell set. */
function matchPlacement(
  g: Game,
  cells: Array<[number, number]>,
  branch: BranchId,
): { form: number; x: number; y: number } | null {
  const want = new Set(cells.map(([x, y]) => `${x},${y}`));
  const forms = g.formsFor(branch);
  for (let f = 0; f < forms.length; f++) {
    for (const p of g.legalFor(branch)) {
      if (p.form !== f) continue;
      const got = forms[f].map((c) => `${p.x + c.x},${p.y + c.y}`);
      if (got.length === want.size && got.every((s) => want.has(s))) return { form: f, x: p.x, y: p.y };
    }
  }
  return null;
}
