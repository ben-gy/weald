// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// See ADDITIONAL-TERMS.md for the section 7(b) attribution requirement.
//
// Weald — the screens that are not the map.

import { MODES, MODE_IDS, WATCH_NAMES, type ModeId } from './modes';
import { SKILLS, SKILL_IDS } from './bots';
import { TERRAIN, DRAWABLE } from './terrain';
import type { Summary } from './summary';

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

export const FOOTER_HTML = `<footer class="site-footer">Built by <a href="https://benrichardson.dev/" target="_blank" rel="noopener">benrichardson.dev</a> · <a href="https://lab.benrichardson.dev" target="_blank" rel="noopener">more games, tools &amp; sites</a></footer>`;

export const HOW_HTML = `
  <h2>How to play</h2>
  <ol>
    <li>Every player is dealt the <strong>same shape</strong> at the same moment, and draws it
      anywhere on their <strong>own</strong> map. You choose the spot, the rotation and — usually —
      which terrain to draw it in.</li>
    <li>Four <strong>edicts</strong> decide what a map is worth. Two are face up from the start; the
      other two turn over as the run goes on, so the endgame is a change of plan, not a lap of
      honour. Each one scores <strong>twice</strong>, over your whole map as it stands.</li>
    <li>Now and then the <strong>canker</strong> spreads: everybody carves the same rot into their
      own map. It costs you at every watch end for every unwritten square it touches — so the whole
      skill is <em>where</em> you take identical damage.</li>
    <li>Nothing fits? Every card can always be <strong>scrawled</strong> as a single square instead.
      Sometimes that is simply the better move.</li>
  </ol>
  <p><strong>On a phone:</strong> drag anywhere on the map to move the piece — the map is never a
  commit target, so you can never mis-tap a square. Tap <strong>⟳</strong> and <strong>⇋</strong> to
  turn and flip it, pick a terrain, then tap <strong>Place</strong>. You can undo the last one.</p>
  <p><strong>On a keyboard:</strong> arrows move, <strong>R</strong> rotates, <strong>F</strong>
  flips, <strong>Enter</strong> places, <strong>Z</strong> undoes.</p>`;

export function aboutHtml(): string {
  return `
  <h2>About</h2>
  <p><strong>Weald</strong> is a map-drawing race. Everyone gets the identical sequence of shapes, so
  nobody can be dealt a better hand than anybody else — the only difference at the end is where each
  of you put things, which is the whole point.</p>
  <p>Because every device works the same run out of the same seed, nothing about the game state ever
  crosses the network. Your finished map is sent once a watch so everyone's summary can show
  everyone's map; that is all.</p>
  <p>The end-of-run figure marked <em>second-guess</em> compares each of your placements against the
  best a simple one-move-ahead search would have found, using only the rules that were face up at the
  time. It is deliberately not called an optimum — finding the true best line here is far too hard to
  do honestly, and a number that claimed to be perfect would be lying to you.</p>
  <p>Everything runs in your browser. There is no account and no server. Playing with friends
  connects the browsers directly (peer-to-peer); a public relay is used only to introduce them, and
  no gameplay is stored on it.</p>
  <p>No cookies, no fingerprinting, no third-party fonts. Anonymous, cookie-less page-view counts via
  Cloudflare Web Analytics.</p>
  <p>Built by <a href="https://benrichardson.dev/" target="_blank" rel="noopener">benrichardson.dev</a>
  · <a href="https://lab.benrichardson.dev" target="_blank" rel="noopener">more games, tools &amp;
  sites</a></p>`;
}

export function edictHtml(mode: ModeId): string {
  return `<h2>The edicts of ${esc(MODES[mode].name)}</h2>
    <p>Four of these five are drawn each run, in a different order every time.</p>
    <ul>${/* filled by the caller from the pool */ ''}</ul>`;
}

export function menuHtml(mode: ModeId, skill: string, muted: boolean, best: number): string {
  return `
  <div class="main-content">
    <div class="brand">
      <h1>WEALD</h1>
      <p>Everyone draws the same shape. The edicts decide what it was worth.</p>
    </div>

    <div class="field">
      <div class="label">Survey</div>
      <div class="segmented">${MODE_IDS.map(
        (id) =>
          `<button type="button" class="seg${id === mode ? ' on' : ''}" data-mode="${id}">${MODES[id].name}</button>`,
      ).join('')}</div>
      <p class="fine">${esc(MODES[mode].blurb)}</p>
    </div>

    <div class="field">
      <div class="label">Rivals</div>
      <div class="segmented">${SKILL_IDS.map(
        (id) =>
          `<button type="button" class="seg${id === skill ? ' on' : ''}" data-skill="${id}">${SKILLS[id].name}</button>`,
      ).join('')}</div>
      <p class="fine">${esc(SKILLS[skill]?.blurb ?? '')} Three of them draw the same run beside you.</p>
    </div>

    <div class="menu">
      <button class="btn primary" id="playSolo" type="button">Play</button>
      <button class="btn" id="playFriends" type="button">Play with friends</button>
      <button class="btn ghost" id="howBtn" type="button">How to play</button>
      <button class="btn ghost" id="aboutBtn" type="button">About</button>
      <button class="btn ghost" id="muteBtn" type="button" aria-pressed="${muted}">${muted ? 'Sound off' : 'Sound on'}</button>
    </div>
    ${best > 0 ? `<p class="fine">Best ${esc(MODES[mode].name)} map: <strong>${best}</strong>.</p>` : ''}
  </div>
  ${FOOTER_HTML}`;
}

/**
 * THE DISMISSAL CONTRACT. Four exits, all four shipped: a 44px close control, a tap anywhere
 * outside the panel, Escape, and a backdrop that is genuinely reachable. The outside-tap listener is
 * armed 350ms late on purpose — a panel opened from a tap is otherwise closed by that same tap's own
 * trailing click, which reads as a button that does nothing at all.
 */
export function openPanel(host: HTMLElement, html: string): void {
  const back = document.createElement('div');
  back.className = 'backdrop';
  back.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">
    <button class="closex" type="button" aria-label="Close">✕</button>${html}</div>`;
  host.append(back);
  const sheet = back.querySelector<HTMLElement>('.sheet')!;
  let armed = false;
  const close = (): void => {
    document.removeEventListener('keydown', onKey);
    back.remove();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  back.querySelector<HTMLElement>('.closex')!.addEventListener('click', close);
  back.addEventListener('pointerdown', (e) => {
    if (!armed) return;
    if (!sheet.contains(e.target as Node)) close();
  });
  document.addEventListener('keydown', onKey);
  setTimeout(() => {
    armed = true;
  }, 350);
}

/** A small map, drawn from an encoded grid, for a summary row. */
export function thumbHtml(grid: string, size: number): string {
  const CH: Record<string, string> = { G: 'grove', M: 'mere', T: 'tilth', S: 'steading', K: 'canker', R: 'crag' };
  let cells = '';
  for (const c of grid) cells += `<i class="${c === '.' ? 'e' : `t-${CH[c] ?? 'e'}`}"></i>`;
  return `<div class="thumb" style="--n:${size}">${cells}</div>`;
}

export function summaryHtml(s: Summary, multiplayer: boolean): string {
  const row = (l: Summary['lines'][number], rank: number): string => `
    <div class="pline ${l.won ? 'win' : ''}">
      <div class="top">
        <span class="nm">${esc(l.name)}${l.you && l.name !== 'You' ? ' (you)' : ''}${l.bot ? ' <span class="botTag">bot</span>' : ''}</span>
        ${l.won ? '<span aria-label="best map">★</span>' : ''}
        <span class="tot">${l.total}</span>
      </div>
      <div class="prow">
        ${thumbHtml(l.grid, s.size)}
        <div class="pdetail">
          <div class="parts">${l.perEdict
            .map(
              (e) =>
                `<span class="ep${e.best ? ' best' : ''}">${esc(e.name)} <b>${e.value}</b></span>`,
            )
            .join('')}</div>
          <div class="parts">canker ${l.canker} · girt crags +${l.girt} · rank ${rank}</div>
          ${l.bot ? '' : `<div class="parts sg">Second-guess −${l.secondGuess} <span class="fine2">(one move ahead, revealed rules only — not a true optimum)</span></div>`}
        </div>
      </div>
    </div>`;
  return `<div class="main-content results">
    <h2>${esc(s.headline)}</h2>
    <p class="res-sub">${esc(s.sub)}</p>
    <div class="plines">${s.lines.map((l, i) => row(l, i + 1)).join('')}</div>
    <div class="missed">${esc(s.missed)}</div>
    <div class="res-actions">
      <button class="btn primary" id="againBtn" type="button">Play again</button>
      <button class="btn" id="lobbyBtn" type="button" hidden>Back to the lobby</button>
      <button class="btn ghost" id="menuBtn" type="button">${multiplayer ? 'Leave the room' : 'Menu'}</button>
      <p class="res-wait" id="resWait" hidden></p>
      <button class="results-feedback" type="button">Something wrong? Tell me</button>
    </div>
  </div>
  ${FOOTER_HTML}`;
}

/** The between-watches sheet. Shown after every watch, not only at the end. */
export function watchHtml(s: Summary, watch: number): string {
  return `<div class="main-content results">
    <h2>${esc(WATCH_NAMES[watch] ?? 'Watch')} ends</h2>
    <p class="res-sub">${esc(s.sub)}</p>
    <div class="plines">${s.lines
      .map(
        (l) => `<div class="pline ${l.won ? 'win' : ''}">
          <div class="top"><span class="nm">${esc(l.name)}${l.you && l.name !== 'You' ? ' (you)' : ''}</span>
            <span class="tot">${l.total}</span></div>
          <div class="parts">${l.perEdict.map((e) => `<span class="ep${e.best ? ' best' : ''}">${esc(e.name)} <b>${e.value}</b></span>`).join('')} · canker ${l.canker}</div>
        </div>`,
      )
      .join('')}</div>
    <div class="res-actions"><button class="btn primary" id="onwardBtn" type="button">Onward</button></div>
  </div>`;
}

export const TERRAIN_LEGEND = DRAWABLE.map((t) => `${TERRAIN[t].glyph} ${TERRAIN[t].name}`).join(' · ');
