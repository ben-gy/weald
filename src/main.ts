// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// See ADDITIONAL-TERMS.md for the section 7(b) attribution requirement.
//
// Weald — the bootstrap. Owns the screens and the room, and no game logic whatsoever.
//
// The room is joined ONCE and held until the player goes back to the menu. Every run after the
// first — every "play again" — happens inside it, versioned by rematch.ts. Leaving and re-joining
// to "reset" hands back the room object Trystero is still tearing down, and every player then sits
// in the right room code, alone, drawing on their own.

import '@ben-gy/game-engine/mobile.css';
import { hardenViewport } from '@ben-gy/game-engine/mobile';
import { createNet, roomAppId, setTurnConfig, type Net, type PeerId } from '@ben-gy/game-engine/net';
import { getTurnConfig } from '@ben-gy/game-engine/turn';
import { createRounds, type Rounds } from '@ben-gy/game-engine/rematch';
import {
  clearRoomInUrl,
  createLobby,
  createRoomEntry,
  mintCode,
  normalizeRoomCode,
  setRoomInUrl,
  type Lobby,
} from '@ben-gy/game-engine/lobby';
import { createSfx } from '@ben-gy/game-engine/sound';
import { createStore } from '@ben-gy/game-engine/storage';
import { newSeed } from '@ben-gy/game-engine/rng';
import { DEFAULT_MODE, MODES, MODE_IDS, WATCH_NAMES, modeOf, type ModeId } from './modes';
import { SKILLS, SKILL_IDS } from './bots';
import { runCountdown } from './countdown';
import { Session } from './session';
import { View, type Ghost } from './view';
import { shapeOf } from './deck';
import { revealedIn, type BranchId } from './game';
import { canPlace } from './board';
import { CANKER, TERRAIN, type Terrain } from './terrain';
import { FOOTER_HTML, HOW_HTML, aboutHtml, menuHtml, openPanel, summaryHtml, watchHtml } from './ui';
import type { Summary } from './summary';
import type { Form } from './shapes';
import './styles/main.css';

const SLUG = 'weald';

const app = document.getElementById('app')!;
const store = createStore(SLUG);
const sfx = createSfx({
  muted: store.get<boolean>('muted', false) ?? false,
  patches: {
    tap: { type: 'square', freq: [520, 520], dur: 0.03, gain: 0.1 },
    move: { type: 'sine', freq: [300, 340], dur: 0.02, gain: 0.06 },
    turn: { type: 'triangle', freq: [420, 620], dur: 0.06, gain: 0.14 },
    place: { type: 'triangle', freq: [420, 780], dur: 0.12, gain: 0.2 },
    nope: { type: 'square', freq: [180, 120], dur: 0.14, gain: 0.16 },
    rot: { type: 'sawtooth', freq: [260, 150], dur: 0.22, gain: 0.2 },
    watch: { type: 'sine', freq: [660, 990], dur: 0.3, gain: 0.24 },
    tick: { type: 'triangle', freq: [660, 660], dur: 0.08, gain: 0.18 },
    go: { type: 'triangle', freq: [880, 1320], dur: 0.22, gain: 0.24 },
    over: { type: 'triangle', freq: [560, 320], dur: 0.5, gain: 0.22 },
  },
});
const play = (n: string): void => {
  try {
    sfx.play(n);
  } catch {
    /* audio is decoration; never let it take the game down */
  }
};

interface Settings {
  mode: ModeId;
  skill: string;
}
const settings: Settings = {
  mode: modeOf(store.get<string>('mode', DEFAULT_MODE)).id,
  skill: SKILL_IDS.includes(store.get<string>('skill', 'tallow') ?? '')
    ? (store.get<string>('skill', 'tallow') as string)
    : 'tallow',
};

interface RoundOpts {
  mode: string;
}

let net: Net | null = null;
let rounds: Rounds<RoundOpts> | null = null;
let lobby: Lobby | null = null;
let session: Session | null = null;
let view: View | null = null;
let roomCode = '';
let iMintedIt = false;
let beat: ReturnType<typeof setInterval> | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;
let countdown: { cancel: () => void } | null = null;
let deepLinkUsed = false;
let sendWire: (m: unknown) => void = () => {};

// ── the live placement, which is UI state and nothing else ────────────────────────────────────

interface Pending {
  branch: BranchId;
  form: number;
  x: number;
  y: number;
  terrain: Terrain;
}
let pending: Pending | null = null;
/** The last committed placement, so Place can become Undo. One deep, never further. */
let undoable: { cells: Array<[number, number]>; before: Int8Array } | null = null;
let fresh: Array<[number, number]> = [];

const setPlaying = (on: boolean): void => {
  document.body.classList.toggle('playing', on);
};

function clearScreen(): void {
  countdown?.cancel();
  countdown = null;
  view?.destroy();
  view = null;
  if (ticker) clearInterval(ticker);
  ticker = null;
  document.removeEventListener('keydown', onKey);
  app.replaceChildren();
}

function onKey(e: KeyboardEvent): void {
  if (!view) return;
  if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
  if (view.handleKey(e)) e.preventDefault();
}

// ── screens ───────────────────────────────────────────────────────────────────────────────────

function showMenu(): void {
  clearScreen();
  setPlaying(false);
  const best = store.get<number>(`best:${settings.mode}`, 0) ?? 0;
  app.innerHTML = menuHtml(settings.mode, settings.skill, sfx.muted(), best);

  app.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) =>
    b.addEventListener('click', () => {
      settings.mode = modeOf(b.dataset.mode).id;
      store.set('mode', settings.mode);
      showMenu();
    }),
  );
  app.querySelectorAll<HTMLButtonElement>('[data-skill]').forEach((b) =>
    b.addEventListener('click', () => {
      const id = b.dataset.skill ?? 'tallow';
      settings.skill = Object.hasOwn(SKILLS, id) ? id : 'tallow';
      store.set('skill', settings.skill);
      showMenu();
    }),
  );
  app.querySelector('#playSolo')!.addEventListener('click', () => {
    sfx.unlock();
    play('tap');
    startSolo();
  });
  app.querySelector('#playFriends')!.addEventListener('click', () => {
    sfx.unlock();
    play('tap');
    showRoomEntry();
  });
  app.querySelector('#howBtn')!.addEventListener('click', () => openPanel(app, HOW_HTML));
  app.querySelector('#aboutBtn')!.addEventListener('click', () => openPanel(app, aboutHtml()));
  const mute = app.querySelector<HTMLButtonElement>('#muteBtn')!;
  mute.addEventListener('click', () => {
    sfx.setMuted(!sfx.muted());
    store.set('muted', sfx.muted());
    mute.textContent = sfx.muted() ? 'Sound off' : 'Sound on';
    mute.setAttribute('aria-pressed', String(sfx.muted()));
  });

  if (!store.get<boolean>('seenHow', false)) {
    store.set('seenHow', true);
    openPanel(app, HOW_HTML);
  }
}

function startSolo(): void {
  buildSession({ mode: settings.mode, seed: newSeed(), round: 1, peers: [], selfId: 'you', myName: 'You' });
}

// ── the room ──────────────────────────────────────────────────────────────────────────────────

function showRoomEntry(): void {
  clearScreen();
  setPlaying(false);
  const host = document.createElement('div');
  host.className = 'main-content';
  app.append(host);
  createRoomEntry({
    container: host,
    title: 'Play with friends',
    subtitle: 'Start a room and send the link — or scan the code, or type it in.',
    onSubmit: (code, created) => {
      roomCode = normalizeRoomCode(code);
      iMintedIt = created;
      enterRoom();
    },
    onCancel: () => showMenu(),
  });
  app.insertAdjacentHTML('beforeend', FOOTER_HTML);
}

function enterRoom(): void {
  clearScreen();
  setRoomInUrl(roomCode);
  net = createNet(
    { appId: roomAppId(SLUG), roomId: roomCode, claimHost: iMintedIt },
    {
      onPeers: () => {
        // Never navigate from here: this fires in the lobby AND just after a run ends.
        lobby?.repaint();
      },
      onPeerLeave: (id: PeerId) => {
        session?.peerLeft(id);
        lobby?.repaint();
        repaint();
      },
      onHostChange: () => {
        lobby?.repaint();
        repaint();
      },
    },
  );

  const wire = net.channel<unknown>('wld', (m, from) => session?.receive(m, from));
  sendWire = (m) => wire(m);

  rounds = createRounds<RoundOpts>({
    net,
    playerName: store.get<string>('name', '') || `Surveyor ${Math.floor(Math.random() * 90 + 10)}`,
    minPlayers: 2,
    roundOpts: () => ({ mode: settings.mode }),
    onRound: (info) => {
      // The HOST's pick is what the room draws, frozen inside the start, so two peers can never be
      // working different maps.
      const mode = modeOf(info.opts?.mode).id;
      if (!info.seated) {
        showSpectator();
        return;
      }
      startRound({
        mode,
        seed: info.seed,
        round: info.round,
        peers: info.players.map((p) => ({ id: p.id, name: p.name })),
        selfId: net!.selfId,
        myName: info.players.find((p) => p.id === net!.selfId)?.name ?? 'You',
      });
    },
    onChange: () => lobby?.repaint(),
  });

  showLobby();
}

function showLobby(): void {
  clearScreen();
  setPlaying(false);
  const host = document.createElement('div');
  host.className = 'main-content';
  app.append(host);
  lobby = createLobby({
    container: host,
    net: net!,
    rounds: rounds!,
    roomCode,
    minPlayers: 2,
    maxPlayers: 6,
    modeSlot: () => {
      const st = rounds!.state();
      const chosen = st.isHost ? settings.mode : modeOf(st.hostOpts?.mode).id;
      return `<div class="modeslot"><span class="modeslot-label">Survey</span>
        <div class="segmented small">${MODE_IDS.map(
          (id) =>
            `<button type="button" class="seg${id === chosen ? ' on' : ''}" data-lmode="${id}"${st.isHost ? '' : ' disabled'}>${MODES[id].name}</button>`,
        ).join('')}</div>
        <p class="fine">${st.isHost ? MODES[settings.mode].blurb : 'The host picks the survey.'}</p></div>`;
    },
    onModeMount: () => {
      host.querySelectorAll<HTMLButtonElement>('[data-lmode]').forEach((b) =>
        b.addEventListener('click', () => {
          settings.mode = modeOf(b.dataset.lmode).id;
          store.set('mode', settings.mode);
          lobby?.repaint();
        }),
      );
    },
    onCancel: () => leaveRoom(),
  });
  app.insertAdjacentHTML('beforeend', FOOTER_HTML);
}

function showSpectator(): void {
  clearScreen();
  setPlaying(false);
  app.innerHTML = `<div class="main-content"><h2>A survey is already under way</h2>
    <p class="fine">You are in the next one. Hang on — it will start on its own.</p></div>${FOOTER_HTML}`;
}

/**
 * Leaving is the ONLY place the room is torn down, and it clears `?room=` on the way out. Leave it
 * in the URL and a reload — or reopening from a home-screen icon — silently drags the player back
 * into a room they left, with no way to start a new one.
 */
function leaveRoom(): void {
  if (beat) clearInterval(beat);
  beat = null;
  session?.destroy();
  session = null;
  rounds?.destroy();
  rounds = null;
  lobby?.destroy();
  lobby = null;
  void net?.leave();
  net = null;
  clearRoomInUrl();
  deepLinkUsed = true;
  showMenu();
}

// ── a run ─────────────────────────────────────────────────────────────────────────────────────

interface StartArgs {
  mode: ModeId;
  seed: number;
  round: number;
  peers: Array<{ id: string; name: string }>;
  selfId: string;
  myName: string;
}

function startRound(args: StartArgs): void {
  clearScreen();
  setPlaying(true);
  const holder = document.createElement('div');
  holder.className = 'countwrap';
  app.append(holder);
  countdown = runCountdown({
    container: holder,
    sfx: play,
    onDone: () => {
      holder.remove();
      buildSession(args);
    },
  });
}

function buildSession(args: StartArgs): void {
  clearScreen();
  setPlaying(true);
  pending = null;
  undoable = null;
  fresh = [];

  session = new Session({
    mode: args.mode,
    seed: args.seed,
    round: args.round,
    skill: settings.skill,
    selfId: args.selfId,
    myName: args.myName,
    peers: args.peers,
    deps: {
      send: (m) => sendWire(m),
      onChange: () => repaint(),
      onWatchEnd: (w, s) => showWatch(w, s),
      onEnd: (s) => showResults(s),
    },
  });

  view = new View(session.run.size, {
    onMove: (x, y) => moveGhost(x, y),
    onNudge: (dx, dy) => nudge(dx, dy),
    onRotate: () => cycleForm(1),
    onFlip: () => flipForm(),
    onBranch: (id) => selectBranch(id as BranchId),
    onTerrain: (t) => {
      if (!pending) return;
      pending.terrain = t;
      play('tap');
      repaint();
    },
    onCommit: () => (undoable ? undo() : commit()),
    onUndo: () => undo(),
    onHelp: () => openPanel(app, HOW_HTML),
    onQuit: () => {
      // Back to the lobby, never out of the room — and rounds.finish() FIRST, because the engine
      // lobby paints nothing at all while the round is still 'playing' and this seat is seated.
      if (net) {
        rounds?.finish();
        showLobby();
      } else showMenu();
    },
  });
  app.append(view.root);
  document.addEventListener('keydown', onKey);

  autoSelect();

  if (beat) clearInterval(beat);
  // setInterval, never rAF: a backgrounded tab must keep its heartbeat alive, or a peer who tabs
  // away is indistinguishable from one who closed the lid.
  beat = setInterval(() => session?.beat(), 4000);
  ticker = setInterval(() => {
    if (session?.gateIn() !== null) repaint();
  }, 500);
  repaint();
}

// ── choosing a placement ──────────────────────────────────────────────────────────────────────

/** Pick a sensible branch and drop the ghost somewhere legal, so a turn never starts empty. */
function autoSelect(): void {
  const s = session;
  if (!s || s.game.over) return;
  const d = s.game.deal;
  if (!d) return;
  if (d.kind === 'carve') {
    const plan = s.game.plan();
    const pool = plan ? (plan.anchored.length ? plan.anchored : plan.loose) : [];
    const p = pool[0];
    pending = p ? { branch: 'a', form: p.form, x: p.x, y: p.y, terrain: CANKER } : null;
    repaint();
    return;
  }
  const playable = s.game.playable();
  const branch = (playable.find((b) => b === 'a') ?? playable[0] ?? 'scrawl') as BranchId;
  selectBranch(branch);
}

function selectBranch(branch: BranchId): void {
  const s = session;
  if (!s || s.game.over) return;
  const spots = s.game.legalFor(branch);
  const terrains = s.game.terrainsFor(branch);
  const keep = pending && spots.find((p) => p.x === pending!.x && p.y === pending!.y && p.form === pending!.form);
  const spot = keep ?? spots[0];
  if (!spot) return;
  pending = {
    branch,
    form: spot.form,
    x: spot.x,
    y: spot.y,
    terrain: (pending && terrains.includes(pending.terrain) ? pending.terrain : terrains[0]) as Terrain,
  };
  play('tap');
  repaint();
}

function currentForms(): readonly Form[] {
  const s = session;
  if (!s || !pending) return [];
  const d = s.game.deal;
  if (d && d.kind === 'carve') return shapeOf(d.shapeId).forms;
  return s.game.formsFor(pending.branch);
}

function moveGhost(x: number, y: number): void {
  const s = session;
  if (!s || !pending) return;
  const forms = currentForms();
  const f = forms[pending.form];
  if (!f) return;
  const w = Math.max(...f.map((c) => c.x)) + 1;
  const h = Math.max(...f.map((c) => c.y)) + 1;
  const nx = Math.max(0, Math.min(x, s.run.size - w));
  const ny = Math.max(0, Math.min(y, s.run.size - h));
  if (nx === pending.x && ny === pending.y) return;
  pending.x = nx;
  pending.y = ny;
  play('move');
  repaint();
}

const nudge = (dx: number, dy: number): void => {
  if (pending) moveGhost(pending.x + dx, pending.y + dy);
};

function cycleForm(step: number): void {
  const s = session;
  if (!s || !pending) return;
  const forms = currentForms();
  if (forms.length <= 1) return;
  pending.form = (pending.form + step + forms.length) % forms.length;
  // Keep the shape on the board after a turn that changed its bounding box.
  moveGhost(pending.x, pending.y);
  play('turn');
  repaint();
}

/**
 * Flip jumps to the mirror of the current orientation within the same deduped list. For an achiral
 * shape the mirror IS one of the rotations, so the button is hidden rather than left to do nothing
 * — a visibly dead control reads as a bug.
 */
function flipForm(): void {
  const s = session;
  if (!s || !pending) return;
  const forms = currentForms();
  const cur = forms[pending.form];
  if (!cur) return;
  const w = Math.max(...cur.map((c) => c.x)) + 1;
  const key = cur.map((c) => `${w - 1 - c.x},${c.y}`).sort().join(' ');
  const idx = forms.findIndex((f) => [...f].map((c) => `${c.x},${c.y}`).sort().join(' ') === key);
  if (idx >= 0 && idx !== pending.form) {
    pending.form = idx;
    moveGhost(pending.x, pending.y);
    play('turn');
    repaint();
  }
}

function ghostLegal(): boolean {
  const s = session;
  if (!s || !pending) return false;
  const f = currentForms()[pending.form];
  return !!f && canPlace(s.game.board, f, pending.x, pending.y);
}

function commit(): void {
  const s = session;
  if (!s || !pending || s.game.over) return;
  const d = s.game.deal;
  if (!ghostLegal()) {
    play('nope');
    return;
  }
  const before = Int8Array.from(s.game.board.g);
  const ok =
    d && d.kind === 'carve'
      ? s.game.carve({ form: pending.form, x: pending.x, y: pending.y })
      : s.game.play({ branch: pending.branch, form: pending.form, x: pending.x, y: pending.y, terrain: pending.terrain });
  if (!ok) {
    play('nope');
    return;
  }
  const last = s.game.log[s.game.log.length - 1];
  fresh = last ? last.cells : [];
  undoable = last ? { cells: last.cells, before } : null;
  play(d && d.kind === 'carve' ? 'rot' : 'place');
  pending = null;
  s.afterPlay();
  if (!s.game.over) autoSelect();
}

/**
 * One-deep undo of the last placement, and it is deliberately local-only: the wire ping is a
 * progress figure rather than a move, so there is nothing to retract. Choosing a new branch commits
 * you — otherwise "undo" would have to mean unwinding a watch score too.
 */
function undo(): void {
  const s = session;
  if (!s || !undoable) return;
  s.game.rollback(undoable.before);
  undoable = null;
  fresh = [];
  play('tap');
  autoSelect();
  repaint();
}

// ── painting ──────────────────────────────────────────────────────────────────────────────────

function repaint(): void {
  const s = session;
  if (!view || !s) return;
  const g = s.game;
  const d = g.deal;
  const legal = ghostLegal();
  const forms = currentForms();
  const ghost: Ghost | null =
    pending && forms[pending.form]
      ? { form: forms[pending.form], x: pending.x, y: pending.y, terrain: pending.terrain, legal }
      : null;

  const branches = [] as Array<{ id: string; label: string; cells: Form; terrains: readonly Terrain[]; on: boolean; enabled: boolean }>;
  if (d && d.kind === 'card') {
    const playable = g.playable();
    const add = (id: BranchId, label: string): void => {
      const f = g.formsFor(id)[0];
      if (!f) return;
      branches.push({
        id,
        label,
        cells: f,
        terrains: g.terrainsFor(id),
        on: pending?.branch === id,
        enabled: playable.includes(id),
      });
    };
    add('a', terrainLabel(g.terrainsFor('a')));
    if (d.b) add('b', terrainLabel(g.terrainsFor('b')));
    add('scrawl', 'one square');
  }

  const plan = d && d.kind === 'carve' ? g.plan() : null;
  const gate = s.gateIn();

  view.render({
    board: g.board,
    ghost,
    fresh,
    watch: g.watch,
    watchName: WATCH_NAMES[g.watch] ?? '',
    dealNo: Math.min(g.index + 1, g.total),
    dealTotal: g.total,
    score: s.liveScore(),
    par: s.par(),
    edicts: s.run.roles.map((e, role) => ({
      name: e.name,
      text: e.text,
      value: e.score(g.board.g, g.board.size),
      hidden: revealedIn(role) > g.watch,
    })),
    branches,
    terrains: pending ? g.terrainsFor(pending.branch) : [],
    terrain: pending?.terrain ?? CANKER,
    canRotate: forms.length > 1,
    canFlip: hasMirror(forms, pending?.form ?? 0),
    canCommit: legal && !g.over,
    commitLabel: d && d.kind === 'carve' ? 'Carve' : 'Place',
    reason: legal ? '' : pending ? 'That does not fit here — drag it somewhere clear.' : 'Pick a shape.',
    canUndo: undoable !== null,
    note:
      gate !== null
        ? `Waiting for the others — showing the watch in ${Math.ceil(gate / 1000)}s.`
        : noteFor(s),
    carve: plan
      ? {
          anchor: carveText(d && d.kind === 'carve' ? d.anchor : 'rimward'),
          dropped: plan.anchorDropped || plan.forced,
        }
      : null,
  });
  fresh = [];
}

function noteFor(s: Session): string {
  const g = s.game;
  const p = g.playable();
  if (p.length === 1 && p[0] === 'scrawl') return 'Nothing larger fits — take a single square.';
  return `${WATCH_NAMES[g.watch]} · ${g.dealsLeftInWatch} to draw`;
}

const carveText = (a: string): string =>
  ({
    rootward: 'it must touch a Grove',
    brackish: 'it must touch a Mere',
    fallow: 'it must touch a Tilth',
    wallward: 'it must touch a Steading',
    rimward: 'it must reach the rim',
    cragfall: 'it must touch a crag',
  })[a] ?? 'place it anywhere';

const terrainLabel = (ts: readonly Terrain[]): string =>
  ts.map((t) => TERRAIN[t]?.name ?? '').join(' / ');

function hasMirror(forms: readonly Form[], i: number): boolean {
  const cur = forms[i];
  if (!cur) return false;
  const w = Math.max(...cur.map((c) => c.x)) + 1;
  const key = cur.map((c) => `${w - 1 - c.x},${c.y}`).sort().join(' ');
  const j = forms.findIndex((f) => [...f].map((c) => `${c.x},${c.y}`).sort().join(' ') === key);
  return j >= 0 && j !== i;
}

// ── between watches, and the end ──────────────────────────────────────────────────────────────

function showWatch(w: number, s: Summary): void {
  play('watch');
  const back = document.createElement('div');
  back.className = 'backdrop';
  back.innerHTML = `<div class="sheet">${watchHtml(s, w)}</div>`;
  app.append(back);
  back.querySelector('#onwardBtn')!.addEventListener('click', () => {
    back.remove();
    repaint();
  });
}

function showResults(s: Summary): void {
  play('over');
  setPlaying(false);
  const sess = session;
  if (sess && !net) {
    const mine = s.lines.find((l) => l.you);
    const best = store.get<number>(`best:${sess.run.mode.id}`, 0) ?? 0;
    if (mine && mine.total > best) store.set(`best:${sess.run.mode.id}`, mine.total);
  }
  clearScreen();
  app.innerHTML = summaryHtml(s, net !== null);

  const again = app.querySelector<HTMLButtonElement>('#againBtn')!;
  const toLobby = app.querySelector<HTMLButtonElement>('#lobbyBtn')!;
  const wait = app.querySelector<HTMLElement>('#resWait')!;

  if (net && rounds) {
    rounds.finish();
    toLobby.hidden = false;
    toLobby.addEventListener('click', () => showLobby());
    again.addEventListener('click', () => {
      rounds!.vote();
      again.disabled = true;
      again.textContent = 'Waiting for the others…';
    });
    // A visible reason and a horizon. One player still reading the summary must not hold the room.
    ticker = setInterval(() => {
      const st = rounds?.state();
      if (!st) return;
      wait.hidden = false;
      wait.textContent =
        st.startsInMs !== null
          ? `Next survey in ${Math.ceil(st.startsInMs / 1000)}s…`
          : `${st.votes.length} of ${st.present.length} ready.`;
    }, 400);
  } else {
    again.addEventListener('click', () => {
      play('tap');
      startSolo();
    });
  }
  app.querySelector('#menuBtn')!.addEventListener('click', () => (net ? leaveRoom() : showMenu()));
  app
    .querySelector('.results-feedback')!
    .addEventListener('click', (e) => window.feedback?.open({ returnFocusTo: e.currentTarget as HTMLElement }));
}

// ── boot ──────────────────────────────────────────────────────────────────────────────────────

async function boot(): Promise<void> {
  hardenViewport();
  // ONCE, before any mesh exists. Trystero builds one global connection pool from the first room's
  // config, so a later call leaves the initiating half of every pair STUN-only.
  try {
    setTurnConfig(await getTurnConfig());
  } catch {
    /* fails open — TURN is an upgrade, never a dependency */
  }

  // A `?room=` is honoured ONCE. After that, "play with friends" always offers create-or-join, so a
  // reload can never drag somebody back into a room they have left.
  const deep = new URL(location.href).searchParams.get('room');
  if (deep && !deepLinkUsed) {
    deepLinkUsed = true;
    roomCode = normalizeRoomCode(deep);
    iMintedIt = false;
    enterRoom();
    return;
  }
  showMenu();
}

window.addEventListener('beforeunload', () => void net?.leave());
void boot();

// Exposed for the browser verification pass: drives a run synchronously in a tab where rAF and real
// timers are throttled. Never used by the game itself.
(window as unknown as Record<string, unknown>).__weald = {
  state: () => session && { i: session.game.index, n: session.game.total, over: session.game.over, score: session.liveScore(), watch: session.game.watch },
  board: () => session?.game.board.g,
  options: () => session?.game.optionCount(),
  pending: () => pending,
  move: (x: number, y: number) => moveGhost(x, y),
  rotate: () => cycleForm(1),
  branch: (b: string) => selectBranch(b as BranchId),
  commit: () => commit(),
  /** Play the rest of the run by tapping Place wherever the ghost already sits. */
  auto: (n = 100) => {
    for (let k = 0; k < n && session && !session.game.over; k++) {
      if (!ghostLegal()) autoSelect();
      commit();
    }
    return session?.game.over;
  },
  mint: () => mintCode(),
  modes: MODE_IDS,
};
