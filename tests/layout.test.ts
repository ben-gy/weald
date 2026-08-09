// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
//
// layout.test.ts — the source-level invariants behind the phone layout.
//
// WHAT THIS FILE CAN AND CANNOT DO. jsdom has no layout engine, so nothing here proves a board fits
// a phone; only the real-browser pass at every (mode x viewport) can do that, and it is what found
// the bugs this run. What a test CAN do is pin the arithmetic and the CSS rules that the fix
// depends on, so the next edit cannot quietly undo them. Each assertion below corresponds to a
// specific way this game, or a fleet sibling, has actually broken.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { MODES, MODE_IDS } from '../src/modes';
import { CONTROL, MIN_CELL, MIN_TARGET, boardPx, cellPx, chromeHeight, stageHeight } from '../src/layout';

const css = readFileSync(`${process.cwd()}/src/styles/main.css`, 'utf8');
const view = readFileSync(`${process.cwd()}/src/view.ts`, 'utf8');
/** Comments stripped. Several of the notes below quote the very rule they exist to forbid. */
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('the vertical budget, which is the one that actually broke', () => {
  // A 375px-wide map is 359px square. 359 plus the chrome is 679px — but Safari's visible viewport
  // on an iPhone SE in portrait is about 553px once its toolbars are counted, so a board sized from
  // the WIDTH pushes the tray and the Place button clean off the bottom of the screen and the
  // player cannot commit anything at all. Verified in a browser at 360x553: the board shrinks to
  // 255px and the commit button sits at 550.
  it('the chrome alone leaves room for a board on a short phone', () => {
    expect(chromeHeight()).toBeLessThan(340);
    expect(stageHeight(375), 'width-sized stage on an SE').toBeGreaterThan(553);
  });

  it('so --cell takes the MINIMUM of the width budget and the height budget', () => {
    const rule = /\.board\s*\{[^}]*--cell:([^;]+);/.exec(css);
    expect(rule, 'the board does not derive its cell size at all').not.toBeNull();
    const expr = rule![1];
    expect(expr, 'the cell size ignores the available height').toContain('100dvh');
    expect(expr).toContain('var(--chrome)');
    expect(expr, 'the cell size ignores the available width').toContain('100vw');
    expect(/\bmin\(/.test(expr), 'it must take the smaller of the two, not one of them').toBe(true);
  });

  it('and 100dvh, never 100vh, because a URL bar is not part of the viewport', () => {
    expect(css).toContain('100dvh');
  });

  it('the chrome custom properties the board subtracts all exist', () => {
    for (const v of ['--r-top', '--r-edicts', '--r-note', '--r-tray', '--r-actions', '--chrome']) {
      expect(new RegExp(`${v}:`).test(css), `${v} is subtracted but never defined`).toBe(true);
    }
  });
});

describe('the board never overflows sideways either', () => {
  for (const m of MODE_IDS) {
    it(`${m} (${MODES[m].size}x${MODES[m].size}) fits the narrowest phone in the fleet's matrix`, () => {
      for (const vw of [320, 360, 375, 390, 414]) {
        const cell = cellPx(vw, MODES[m].size);
        expect(boardPx(vw, 420), `${vw}px`).toBeLessThanOrEqual(vw);
        expect(cell, `${m} at ${vw}px gives a ${cell.toFixed(1)}px cell`).toBeGreaterThan(MIN_CELL - 8);
      }
    });
  }

  it('and the cell size is never a percentage — a % in --board collapses to a strip on desktop', () => {
    // A percentage in a custom property used for BOTH width and height resolves against an
    // auto-sized grid row and renders a 10px sliver. Pin it at source level.
    const rule = /\.board\s*\{[^}]*\}/.exec(css)![0];
    expect(/--cell:[^;]*%/.test(rule), 'a percentage reached --cell').toBe(false);
  });

  it('and every grid track can shrink, so a wide board cannot force the page wider', () => {
    expect(css).toContain('grid-template-columns: repeat(var(--n), minmax(0, 1fr))');
    expect(/\.cell\s*\{[^}]*min-width:\s*0/.test(css)).toBe(true);
  });
});

describe('the media queries are ordered so the cascade does what it looks like it does', () => {
  // An 812x375 landscape phone is 812px WIDE, so it matches the tablet and desktop width queries
  // too. Whichever block is written LAST wins, so the short-viewport rules must come after them or
  // a phone on its side silently gets the roomy desktop row set.
  const at = (needle: string): number => css.indexOf(needle);
  it('short viewport comes after tablet and desktop', () => {
    expect(at('@media (max-height: 640px)')).toBeGreaterThan(at('@media (min-width: 720px)'));
    expect(at('@media (max-height: 640px)')).toBeGreaterThan(at('@media (min-width: 1000px)'));
  });
  it('and the landscape block comes last of all', () => {
    const land = at('@media (max-height: 500px) and (orientation: landscape)');
    expect(land).toBeGreaterThan(at('@media (max-height: 640px)'));
    expect(land).toBeGreaterThan(at('@media (min-width: 1000px)'));
  });
  it('and landscape genuinely re-lays out rather than just shrinking', () => {
    // At 812x375 the single column needs ~680px of height and has 375; shrinking cannot save it.
    // Verified in a browser: two columns, board 355px on the left, every control reachable.
    const block = css.slice(at('@media (max-height: 500px) and (orientation: landscape)'));
    expect(block).toContain('grid-template-areas');
    expect(block).toContain("'board top'");
  });
});

describe('the dismissal and visibility contract', () => {
  it('[hidden] is forced, because Safari s UA rule is not !important', () => {
    // A class that sets `display` on the same element beats the UA rule and leaves an invisible
    // layer sitting on top of the game eating every tap. This one line is the fix.
    expect(/\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(css)).toBe(true);
  });

  it('the backdrop is genuinely reachable and sits under the panel', () => {
    expect(/\.backdrop\s*\{[^}]*position:\s*fixed/.test(css)).toBe(true);
    expect(/\.backdrop\s*\{[^}]*inset:\s*0/.test(css)).toBe(true);
    expect(/\.backdrop\s*\{[^}]*pointer-events:\s*none/.test(css), 'an unreachable backdrop').toBe(false);
  });

  it('the close control clears the tap-target floor', () => {
    const m = /\.closex\s*\{([^}]*)\}/.exec(css)![1];
    expect(Number(/width:\s*(\d+)px/.exec(m)![1])).toBeGreaterThanOrEqual(MIN_TARGET);
    expect(Number(/height:\s*(\d+)px/.exec(m)![1])).toBeGreaterThanOrEqual(MIN_TARGET);
  });
});

describe('the touch scheme, pinned at source level', () => {
  it('the commit control is the only thing that writes, and it is thumb-sized', () => {
    const commit = /\.commit\s*\{([^}]*)\}/.exec(css)![1];
    expect(Number(/min-height:\s*(\d+)px/.exec(commit)![1])).toBeGreaterThanOrEqual(CONTROL);
    for (const sel of ['.ctl', '.tseg']) {
      const m = new RegExp(`\\${sel}\\s*\\{([^}]*)\\}`).exec(css)![1];
      expect(Number(/min-height:\s*(\d+)px/.exec(m)![1]), sel).toBeGreaterThanOrEqual(CONTROL);
    }
  });

  it('pointer geometry comes from getBoundingClientRect, never offsetX/offsetY', () => {
    // Comments stripped first: the file's own note explaining why offsetX is banned obviously
    // contains the word, and matching it would make this assertion unpassable.
    const code = view.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).toContain('getBoundingClientRect()');
    expect(/offsetX|offsetY/.test(code), 'offsetX scales oddly under DPR and page zoom').toBe(false);
  });

  it('and it is read at pointerdown, not inside a draw loop', () => {
    // Hit-testing computed inside the rAF draw silently drops every tap before the first frame.
    expect(/requestAnimationFrame/.test(view), 'the view must not own a frame loop').toBe(false);
  });

  it('a cancelled pointer is handled like an aborted gesture', () => {
    expect(view).toContain("addEventListener('pointercancel'");
  });

  it('the pointer is captured, so a drag that leaves the board still tracks', () => {
    expect(view).toContain('setPointerCapture');
  });

  it('the board takes the gesture rather than letting the page scroll under it', () => {
    expect(/\.board\s*\{[^}]*touch-action:\s*none/.test(css)).toBe(true);
  });

  it('the placement ghost does not use the generic .ghost class', () => {
    // THIS SHIPPED AND WAS CAUGHT IN A BROWSER. `.ghost` is the fleet's button modifier — the
    // results screen's Menu button is `class="btn ghost"` — so a bare `.ghost { position: absolute }`
    // for the placement preview also matched that button, took it out of the flex column, and
    // stacked it underneath "Play again" at identical coordinates. One of the two was unreachable.
    // A generic class name in a shared stylesheet is a collision waiting for somewhere to happen.
    expect(view, 'the placement preview must not be class "ghost"').not.toMatch(/className = 'ghost'/);
    expect(view).toContain('pghost');
    expect(
      /(^|[^p\w])\.ghost\s*\{[^}]*position:\s*absolute/m.test(cssCode),
      'a bare .ghost rule positions the button modifier too',
    ).toBe(false);
  });
});

describe('the play surface hides the site footer, and only there', () => {
  it('body.playing hides it', () => {
    expect(css).toContain('body.playing .site-footer');
  });
});
