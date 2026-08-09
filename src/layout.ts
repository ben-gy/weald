// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// See ADDITIONAL-TERMS.md for the section 7(b) attribution requirement.
//
// Weald — the vertical arithmetic, in one place, so a test can evaluate the INTENT rather than the
// browser.
//
// THE GRID CELL IS NEVER THE COMMIT TARGET. At 375px a 9x9 map gives a 39px cell and an 8x8 gives
// 44px — below, or barely at, the 44px a fingertip needs. So the design inverts the usual failure:
// moving the piece is coarse, continuous and endlessly correctable, and COMMITTING is a 56px-tall
// button down in the thumb arc. A mis-drag costs nothing because you just keep dragging; a mis-tap
// on a cell would cost the whole placement, so no tap on a cell ever commits anything.
//
// Everything here is a pure number a unit test can check. An arithmetic layout test cannot see a
// browser bug — only the real-browser pass at every (mode x viewport) can — but it CAN catch the
// class of bug where the rows simply do not add up, which is what shipped a 9x9 board off the side
// of a phone in a sibling game.

export const ROWS = {
  topbar: 44,
  edicts: 60,
  tray: 92,
  actions: 76,
} as const;

export const GAP = 8;
export const PAGE_PAD = 8;

/** Board edge in CSS px for a viewport width, before any height clamp. */
export function boardPx(viewportW: number, maxCol: number): number {
  return Math.min(viewportW - PAGE_PAD * 2, maxCol);
}

export function cellPx(viewportW: number, cols: number, maxCol = 420): number {
  return boardPx(viewportW, maxCol) / cols;
}

/** Everything except the board. Four rows and the gaps between all five. */
export const chromeHeight = (): number =>
  ROWS.topbar + ROWS.edicts + ROWS.tray + ROWS.actions + GAP * 4 + PAGE_PAD * 2;

/** Total stage height for a given viewport. The board is square, so its width IS its height. */
export const stageHeight = (viewportW: number, maxCol = 420): number =>
  chromeHeight() + boardPx(viewportW, maxCol);

/**
 * The smallest cell the layout may shrink to before the board stops being usable. Below this a
 * 4-cell ghost is smaller than a fingertip and the map stops being readable at arm's length.
 */
export const MIN_CELL = 26;
export const MAX_CELL = 52;

/** Every tap target that is not a grid cell must clear this. WCAG 2.5.5 / the fleet's own rule. */
export const MIN_TARGET = 44;

/** The commit and transform controls, which sit in the thumb arc and are deliberately larger. */
export const CONTROL = 56;
