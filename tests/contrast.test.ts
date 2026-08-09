// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
//
// contrast.test.ts — principle #22. A shape drawn in the right cell, at the right size, in nearly
// the colour of its background passes every geometry check there is; on a dark palette it reads as
// atmosphere, and the screenshot looks great. A sibling game shipped its walls at 1.14:1 and a
// player reported them as "see-through". So the colours are measured.
//
// This file pins the CONSTANTS. It cannot see what was actually painted — a piece drawn under
// something, at the wrong alpha, or not at all — so the browser pass samples real pixels as well.
// Both are needed: this one is the ratchet, the pixel probe is the truth.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { MEANINGFUL, PALETTE, SURFACES, TERRAIN_KEYS, contrast, luminance } from '../src/palette';
import { TERRAIN, DRAWABLE, CANKER, CRAG } from '../src/terrain';

const read = (p: string): string => readFileSync(`${process.cwd()}/${p}`, 'utf8');

const FLOOR = 3;
const TEXT_FLOOR = 4.5;

describe('every meaningful colour clears 3:1 on every surface it can sit on', () => {
  for (const key of MEANINGFUL) {
    for (const s of SURFACES) {
      it(`${key} on ${s}`, () => {
        const r = contrast(PALETTE[key], PALETTE[s]);
        expect(
          r,
          `${key} (${PALETTE[key]}) on ${s} (${PALETTE[s]}) = ${r.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(FLOOR);
      });
    }
  }
});

describe('the glyph printed IN a cell is readable against that cell', () => {
  // The glyph is the primary identity channel, not a decoration, so it is held to the text floor
  // rather than the graphic floor.
  for (const key of TERRAIN_KEYS) {
    it(`ink on ${key}`, () => {
      const r = contrast(PALETTE.ink, PALETTE[key]);
      expect(r, `${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(TEXT_FLOOR);
    });
  }
});

describe('body text', () => {
  it('clears 4.5:1 on every surface', () => {
    for (const s of SURFACES) {
      expect(contrast(PALETTE.text, PALETTE[s]), s).toBeGreaterThanOrEqual(TEXT_FLOOR);
    }
  });
  it('and so does the dim text used for labels and numbers', () => {
    for (const s of SURFACES) {
      expect(contrast(PALETTE.dim, PALETTE[s]), s).toBeGreaterThanOrEqual(TEXT_FLOOR);
    }
  });
});

describe('why colour is redundant here, stated as arithmetic rather than asserted as a vibe', () => {
  it('six mutually-3:1 colours are impossible in sRGB, so identity is carried by a glyph', () => {
    // A chain of n colours each 3:1 from the next needs (Lmax + 0.05) / (Lmin + 0.05) >= 3^(n-1).
    // sRGB's widest possible ratio is (1 + 0.05) / (0 + 0.05) = 21.
    const needed = Math.pow(3, TERRAIN_KEYS.length - 1);
    const available = 1.05 / 0.05;
    expect(needed).toBeGreaterThan(available);
  });

  it('so every terrain has its own glyph, and no two share one', () => {
    const codes = [...DRAWABLE, CANKER, CRAG];
    const glyphs = codes.map((c) => TERRAIN[c].glyph);
    expect(new Set(glyphs).size, 'two terrains sharing a glyph are indistinguishable').toBe(
      codes.length,
    );
    expect(glyphs.every((g) => typeof g === 'string' && g.length > 0)).toBe(true);
  });

  it('and every terrain is separated from every other in LUMINANCE, so none of them merge', () => {
    // Not 3:1 — that is impossible for six — but far enough apart that a greyscale board still has
    // six distinguishable tones behind the glyphs.
    const ls = TERRAIN_KEYS.map((k) => luminance(PALETTE[k])).sort((a, b) => a - b);
    for (let i = 1; i < ls.length; i++) {
      expect(ls[i] - ls[i - 1], 'two terrains are the same brightness').toBeGreaterThan(0.02);
    }
  });
});

describe('the illegal ghost is legible against everything it can cover', () => {
  it('clears 3:1 against the empty square, which is where it is almost always seen', () => {
    // Deliberately NOT asserted against every terrain fill. With six fills spanning L 0.22-0.67
    // there is no single colour 1.6:1 from all of them — the window is about a hundredth of a
    // luminance unit wide, and a rule pinned there would be fragile theatre. Illegality is carried
    // by the HATCH and the dashed rim, which is what the next assertion checks; the colour is a
    // reinforcement, measured where it does the work.
    const r = contrast(PALETTE.bad, PALETTE.sunk);
    expect(r, `bad on an empty square = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
  });
  it('and illegality is ALSO carried by a hatch, never by colour alone', () => {
    const css = read('src/styles/main.css');
    expect(
      /\.pghost\.bad[^{]*\{[^}]*repeating-linear-gradient/.test(css),
      'an illegal ghost must be distinguishable without colour vision',
    ).toBe(true);
  });
});

describe('the stylesheet paints what the palette declares', () => {
  it('every palette colour appears in main.css as a custom property', () => {
    const css = read('src/styles/main.css');
    const wanted: Array<[string, string]> = [
      ['--ground', PALETTE.ground],
      ['--card', PALETTE.card],
      ['--panel', PALETTE.panel],
      ['--sunk', PALETTE.sunk],
      ['--text', PALETTE.text],
      ['--dim', PALETTE.dim],
      ['--edge', PALETTE.edge],
      ['--gold', PALETTE.gold],
      ['--bad', PALETTE.bad],
      ['--t-grove', PALETTE.grove],
      ['--t-mere', PALETTE.mere],
      ['--t-tilth', PALETTE.tilth],
      ['--t-steading', PALETTE.steading],
      ['--t-canker', PALETTE.canker],
      ['--t-crag', PALETTE.crag],
    ];
    for (const [name, hex] of wanted) {
      const re = new RegExp(`${name}:\\s*${hex}`, 'i');
      expect(
        re.test(css),
        `${name} in the stylesheet must be ${hex} — the gate measures the constants, so a colour that only exists in CSS is unmeasured`,
      ).toBe(true);
    }
  });

  it('and nothing paints an element on itself', () => {
    // A rule that sets `color` AND `background: currentColor` resolves the background against the
    // NEW colour: 1.0:1, present and invisible, and the screenshot looks fine.
    const css = read('src/styles/main.css');
    const blocks = css.split('}');
    for (const b of blocks) {
      if (/background:\s*currentColor/i.test(b)) {
        expect(/(^|;|\{)\s*color:/i.test(b), `background: currentColor next to a color: ${b}`).toBe(
          false,
        );
      }
    }
  });
});
