// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// See ADDITIONAL-TERMS.md for the section 7(b) attribution requirement.
//
// Weald — the play surface: the map, the ghost you are pushing around it, the tray and the bar.
//
// THE GRID CELL IS NEVER THE COMMIT TARGET, and everything about this file follows from that. A
// 9x9 map at 375px gives a 39px cell; a fingertip is about 45px and covers the thing it is aiming
// at. So a tap or a drag on the board only ever MOVES the ghost — free, reversible, and correctable
// as many times as you like — and the only control that actually writes anything is a 56px button
// down where the thumb already is. Get the drag wrong and you drag again; there is no state in
// which a fat finger costs you a placement.
//
// Two fleet lessons are wired in rather than commented at:
//   - Hit-testing is computed from getBoundingClientRect at POINTERDOWN, never inside a rAF draw.
//     Geometry computed in the draw loop silently drops every tap before the first frame.
//   - The pointer position comes from clientX/clientY minus the rect, never offsetX/offsetY, which
//     scales oddly under devicePixelRatio and page zoom.

import { CANKER, TERRAIN, UNWRITTEN, glyphOf, keyOfTerrain, nameOf, type Terrain } from './terrain';
import { idx } from './measure';
import { MIN_CELL, MAX_CELL } from './layout';
import type { Form } from './shapes';
import type { Board } from './board';

export interface Ghost {
  form: Form;
  /** Top-left of the shape's bounding box, in cells. */
  x: number;
  y: number;
  terrain: Terrain;
  legal: boolean;
}

export interface ViewDeps {
  onMove: (x: number, y: number) => void;
  onNudge: (dx: number, dy: number) => void;
  onRotate: () => void;
  onFlip: () => void;
  onBranch: (id: string) => void;
  onTerrain: (t: Terrain) => void;
  onCommit: () => void;
  onUndo: () => void;
  onHelp: () => void;
  onQuit: () => void;
}

export interface Paint {
  board: Board;
  ghost: Ghost | null;
  /** Cells written by the most recent placement, for the settle animation. */
  fresh: ReadonlyArray<[number, number]>;
  watch: number;
  watchName: string;
  dealNo: number;
  dealTotal: number;
  score: number;
  par: number | null;
  /** Face-up edicts: name, text, and this player's current value. */
  edicts: ReadonlyArray<{ name: string; text: string; value: number; hidden: boolean }>;
  branches: ReadonlyArray<{ id: string; label: string; cells: Form; terrains: readonly Terrain[]; on: boolean; enabled: boolean }>;
  terrains: readonly Terrain[];
  terrain: Terrain;
  canRotate: boolean;
  canFlip: boolean;
  canCommit: boolean;
  commitLabel: string;
  /** Why the commit button is disabled, in one short line. */
  reason: string;
  canUndo: boolean;
  note: string;
  carve: { anchor: string; dropped: boolean } | null;
}

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

export class View {
  readonly root: HTMLElement;
  private cells: HTMLElement[] = [];
  private ghostEl: HTMLElement;
  private boardEl: HTMLElement;
  private size = 9;
  private deps: ViewDeps;
  private dragId: number | null = null;
  private grabDX = 0;
  private grabDY = 0;

  constructor(size: number, deps: ViewDeps) {
    this.size = size;
    this.deps = deps;
    this.root = document.createElement('div');
    this.root.className = 'stage';
    this.root.innerHTML = `
      <div class="topbar">
        <div class="tb-left"><span class="watchpill" id="wpill"></span><span class="deals" id="deals"></span></div>
        <div class="tb-right"><span class="scorenum" id="score">0</span><span class="parnum" id="par"></span>
          <button class="iconbtn" id="helpBtn" type="button" aria-label="How to play">?</button>
          <button class="iconbtn" id="quitBtn" type="button" aria-label="Leave the survey">✕</button></div>
      </div>
      <div class="edictstrip" id="edicts"></div>
      <div class="boardwrap"><div class="board" id="board" role="grid" aria-label="Your map"></div></div>
      <p class="note" id="note"></p>
      <div class="tray" id="tray"></div>
      <div class="actionbar">
        <button class="ctl" id="rotBtn" type="button" aria-label="Rotate">⟳</button>
        <button class="ctl" id="flipBtn" type="button" aria-label="Flip">⇋</button>
        <div class="terrainseg" id="terr"></div>
        <button class="commit" id="commitBtn" type="button">Place</button>
      </div>`;

    this.boardEl = this.root.querySelector('#board')!;
    this.boardEl.style.setProperty('--n', String(size));
    for (let i = 0; i < size * size; i++) {
      const c = document.createElement('div');
      c.className = 'cell';
      c.setAttribute('role', 'gridcell');
      this.boardEl.append(c);
      this.cells.push(c);
    }
    this.ghostEl = document.createElement('div');
    this.ghostEl.className = 'pghost';
    this.ghostEl.setAttribute('aria-hidden', 'true');
    this.boardEl.append(this.ghostEl);

    this.wire();
  }

  private cellFromPointer(e: PointerEvent): { x: number; y: number } {
    // Rect read at event time, never cached from a previous frame and never from a rAF callback.
    const r = this.boardEl.getBoundingClientRect();
    const cell = r.width / this.size;
    const x = Math.floor((e.clientX - r.left) / cell);
    const y = Math.floor((e.clientY - r.top) / cell);
    return { x: clamp(x, 0, this.size - 1), y: clamp(y, 0, this.size - 1) };
  }

  private wire(): void {
    const d = this.deps;
    this.boardEl.addEventListener('pointerdown', (e) => {
      if (this.dragId !== null) return;
      this.dragId = e.pointerId;
      this.boardEl.setPointerCapture(e.pointerId);
      const { x, y } = this.cellFromPointer(e);
      // Touching down INSIDE the ghost drags it by the square you grabbed, so a piece never jumps
      // out from under the finger. Touching down anywhere else brings it to you.
      const g = this.currentGhost;
      if (g && x >= g.x && y >= g.y && x < g.x + g.w && y < g.y + g.h) {
        this.grabDX = x - g.x;
        this.grabDY = y - g.y;
      } else {
        this.grabDX = 0;
        this.grabDY = 0;
      }
      d.onMove(x - this.grabDX, y - this.grabDY);
      this.root.classList.add('dragging');
    });
    this.boardEl.addEventListener('pointermove', (e) => {
      if (this.dragId !== e.pointerId) return;
      const { x, y } = this.cellFromPointer(e);
      d.onMove(x - this.grabDX, y - this.grabDY);
    });
    const end = (e: PointerEvent): void => {
      if (this.dragId !== e.pointerId) return;
      this.dragId = null;
      this.root.classList.remove('dragging');
    };
    this.boardEl.addEventListener('pointerup', end);
    // A cancelled pointer (an incoming call, a system gesture) is an ABORTED gesture, not a drop.
    // The ghost simply stays where it was — nothing was committed, so there is nothing to undo.
    this.boardEl.addEventListener('pointercancel', end);

    this.root.querySelector('#rotBtn')!.addEventListener('click', () => d.onRotate());
    this.root.querySelector('#flipBtn')!.addEventListener('click', () => d.onFlip());
    this.root.querySelector('#commitBtn')!.addEventListener('click', () => d.onCommit());
    this.root.querySelector('#helpBtn')!.addEventListener('click', () => d.onHelp());
    this.root.querySelector('#quitBtn')!.addEventListener('click', () => d.onQuit());
  }

  private currentGhost: { x: number; y: number; w: number; h: number } | null = null;

  /** Desktop keys. Arrows nudge, R/F transform, Enter or Space commit, Z undoes. */
  handleKey(e: KeyboardEvent): boolean {
    const d = this.deps;
    switch (e.key) {
      case 'ArrowLeft':
        d.onNudge(-1, 0);
        return true;
      case 'ArrowRight':
        d.onNudge(1, 0);
        return true;
      case 'ArrowUp':
        d.onNudge(0, -1);
        return true;
      case 'ArrowDown':
        d.onNudge(0, 1);
        return true;
      case 'r':
      case 'R':
        d.onRotate();
        return true;
      case 'f':
      case 'F':
        d.onFlip();
        return true;
      case 'z':
      case 'Z':
        d.onUndo();
        return true;
      case 'Enter':
      case ' ':
        d.onCommit();
        return true;
      default:
        return false;
    }
  }

  render(p: Paint): void {
    const g = p.board.g;
    for (let i = 0; i < this.cells.length; i++) {
      const v = g[i];
      const el = this.cells[i];
      const key = v === UNWRITTEN ? 'empty' : keyOfTerrain(v);
      if (el.dataset.t !== key) {
        el.dataset.t = key;
        el.className = `cell t-${key}`;
        el.textContent = v === UNWRITTEN ? '' : glyphOf(v);
        el.setAttribute(
          'aria-label',
          `row ${Math.floor(i / this.size) + 1} column ${(i % this.size) + 1}, ${nameOf(v)}`,
        );
      }
    }
    for (const [x, y] of p.fresh) this.cells[idx(this.size, x, y)]?.classList.add('fresh');

    // ── the ghost ────────────────────────────────────────────────────────────────────────────
    if (p.ghost) {
      const { form, x, y, terrain, legal } = p.ghost;
      const w = Math.max(...form.map((c) => c.x)) + 1;
      const h = Math.max(...form.map((c) => c.y)) + 1;
      this.currentGhost = { x, y, w, h };
      this.ghostEl.hidden = false;
      this.ghostEl.className = `pghost t-${keyOfTerrain(terrain)}${legal ? '' : ' bad'}`;
      this.ghostEl.style.setProperty('--gx', String(x));
      this.ghostEl.style.setProperty('--gy', String(y));
      this.ghostEl.style.setProperty('--gw', String(w));
      this.ghostEl.style.setProperty('--gh', String(h));
      const want = form.map((c) => `${c.x},${c.y}`).join(' ') + `|${terrain}|${legal}`;
      if (this.ghostEl.dataset.k !== want) {
        this.ghostEl.dataset.k = want;
        this.ghostEl.replaceChildren();
        for (const c of form) {
          const s = document.createElement('span');
          s.className = 'gcell';
          s.style.setProperty('--cx', String(c.x));
          s.style.setProperty('--cy', String(c.y));
          s.textContent = glyphOf(terrain);
          this.ghostEl.append(s);
        }
      }
    } else {
      this.currentGhost = null;
      this.ghostEl.hidden = true;
    }

    // ── the chrome ───────────────────────────────────────────────────────────────────────────
    this.set('#wpill', `${p.watchName}`);
    this.set('#deals', `${p.dealNo}/${p.dealTotal}`);
    this.set('#score', String(p.score));
    this.set('#par', p.par === null ? '' : `par ${p.par}`);
    this.set('#note', p.carve ? `The canker spreads — ${p.carve.dropped ? 'nowhere meets the edict, so put it anywhere' : p.carve.anchor}.` : p.note);
    this.root.querySelector('#note')!.classList.toggle('warn', p.carve !== null);

    const ed = this.root.querySelector('#edicts')!;
    ed.innerHTML = p.edicts
      .map((e) =>
        e.hidden
          ? `<div class="echip hidden" aria-label="A rule still face down"><span class="ename">?</span><span class="etext">turns over later</span></div>`
          : `<button class="echip" type="button" data-etext="${esc(e.text)}"><span class="ename">${esc(e.name)}</span><span class="eval">${e.value}</span></button>`,
      )
      .join('');
    ed.querySelectorAll<HTMLElement>('.echip[data-etext]').forEach((b) =>
      b.addEventListener('click', () => {
        this.set('#note', b.dataset.etext ?? '');
      }),
    );

    const tray = this.root.querySelector('#tray')!;
    tray.innerHTML = p.branches
      .map(
        (b) =>
          `<button class="branch${b.on ? ' on' : ''}" type="button" data-b="${b.id}"${b.enabled ? '' : ' disabled'}>
             <span class="bmini" style="--bw:${Math.max(...b.cells.map((c) => c.x)) + 1};--bh:${Math.max(...b.cells.map((c) => c.y)) + 1}">${b.cells
               .map((c) => `<i style="--cx:${c.x};--cy:${c.y}"></i>`)
               .join('')}</span>
             <span class="blabel">${esc(b.label)}</span>
           </button>`,
      )
      .join('');
    tray.querySelectorAll<HTMLElement>('[data-b]').forEach((b) =>
      b.addEventListener('click', () => this.deps.onBranch(b.dataset.b!)),
    );

    const terr = this.root.querySelector('#terr')!;
    terr.innerHTML = p.terrains
      .map(
        (t) =>
          `<button class="tseg t-${keyOfTerrain(t)}${t === p.terrain ? ' on' : ''}" type="button" data-t="${t}">
             <span class="tg">${glyphOf(t)}</span><span class="tn">${TERRAIN[t]?.name ?? ''}</span></button>`,
      )
      .join('');
    terr.querySelectorAll<HTMLElement>('[data-t]').forEach((b) =>
      b.addEventListener('click', () => this.deps.onTerrain(Number(b.dataset.t) as Terrain)),
    );

    // A visibly dead button reads as a bug, so a shape with one orientation simply has no rotate.
    (this.root.querySelector('#rotBtn') as HTMLButtonElement).hidden = !p.canRotate;
    (this.root.querySelector('#flipBtn') as HTMLButtonElement).hidden = !p.canFlip;
    const commit = this.root.querySelector('#commitBtn') as HTMLButtonElement;
    commit.textContent = p.canUndo ? 'Undo' : p.commitLabel;
    commit.classList.toggle('undo', p.canUndo);
    commit.disabled = !p.canCommit && !p.canUndo;
    commit.title = p.canCommit || p.canUndo ? '' : p.reason;
    if (!p.canCommit && !p.canUndo && p.reason) this.set('#note', p.reason);
  }

  private set(sel: string, text: string): void {
    const el = this.root.querySelector(sel);
    if (el && el.textContent !== text) el.textContent = text;
  }

  destroy(): void {
    this.root.remove();
  }
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export { MIN_CELL, MAX_CELL, CANKER };
