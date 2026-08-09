#!/usr/bin/env node
/**
 * gen-icons.mjs — the home-screen icon set, from the same identity as public/favicon.svg: a small
 * survey grid with one parcel drawn into it. That is the entire game in one shape — an empty map,
 * and a polyomino you chose where to put — and it still reads at 32px. No native deps
 * (sharp/canvas break CI): it plots into an RGBA buffer and emits the PNG itself, with a signed-
 * distance edge for anti-aliasing. Deterministic — same bytes every run.
 *
 *   node scripts/gen-icons.mjs
 *
 * Outputs (public/icons/): icon-192.png and icon-512.png (any purpose, transparent corners),
 * icon-512-maskable.png (art inside the centre 80% safe zone, because Android crops), and
 * apple-touch-icon.png (180x180, FULLY OPAQUE — iOS composites onto black and a transparent icon
 * comes out as a black square).
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

// Must match src/palette.ts and the theme colour in index.html.
const GROUND = [0x12, 0x16, 0x0f];
const EMPTY = [0x2a, 0x33, 0x24];
const WOOD = [0x4f, 0x9e, 0x4a];
const WATER = [0x4a, 0xa8, 0xde];
const FIELD = [0xe0, 0xb1, 0x3c];

/** A 4x4 survey with an S-parcel of wood, a field corner and a water cell already drawn. */
const MAP = [
  [null, WOOD, WOOD, null],
  [WOOD, WOOD, null, FIELD],
  [null, null, null, FIELD],
  [WATER, null, null, null],
];

// ── PNG encoding ──────────────────────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── drawing ───────────────────────────────────────────────────────────────────────────────────────
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Coverage of a rounded rectangle at a point, as a soft 0..1 edge. */
function roundRect(px, py, x, y, w, h, r, feather) {
  const dx = Math.max(Math.abs(px - (x + w / 2)) - (w / 2 - r), 0);
  const dy = Math.max(Math.abs(py - (y + h / 2)) - (h / 2 - r), 0);
  const d = Math.hypot(dx, dy) - r;
  return clamp01(0.5 - d / feather);
}

function render(size, { opaque, inset }) {
  const buf = Buffer.alloc(size * size * 4);
  const feather = Math.max(1, size / 160);
  const artX = (size * (1 - inset)) / 2;
  const artY = (size * (1 - inset)) / 2;
  const art = size * inset;

  const bgR = art * 0.22;
  const pad = art * 0.14;
  const inner = art - pad * 2;
  const gap = inner * 0.035;
  const cell = (inner - gap * 3) / 4;
  const cellR = cell * 0.22;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      const bg = opaque ? 1 : roundRect(px, py, artX, artY, art, art, bgR, feather);
      if (bg > 0) {
        r = GROUND[0];
        g = GROUND[1];
        b = GROUND[2];
        a = bg;
      }

      for (let gy = 0; gy < 4; gy++) {
        for (let gx = 0; gx < 4; gx++) {
          const cx = artX + pad + gx * (cell + gap);
          const cy = artY + pad + gy * (cell + gap);
          const cov = roundRect(px, py, cx, cy, cell, cell, cellR, feather);
          if (cov <= 0) continue;
          const [pr, pg, pb] = MAP[gy][gx] ?? EMPTY;
          r = r * (1 - cov) + pr * cov;
          g = g * (1 - cov) + pg * cov;
          b = b * (1 - cov) + pb * cov;
          a = Math.max(a, cov);
        }
      }

      const o = (y * size + x) * 4;
      buf[o] = Math.round(r);
      buf[o + 1] = Math.round(g);
      buf[o + 2] = Math.round(b);
      buf[o + 3] = Math.round(clamp01(opaque ? 1 : a) * 255);
    }
  }
  return buf;
}

mkdirSync(OUT_DIR, { recursive: true });
const jobs = [
  ['icon-192.png', 192, { opaque: false, inset: 1 }],
  ['icon-512.png', 512, { opaque: false, inset: 1 }],
  // Android crops a maskable icon hard; everything meaningful stays inside the centre 80%.
  ['icon-512-maskable.png', 512, { opaque: true, inset: 0.8 }],
  // iOS composites onto black, so this one must be fully opaque or it ships as a black square.
  ['apple-touch-icon.png', 180, { opaque: true, inset: 0.92 }],
];
for (const [name, size, opts] of jobs) {
  writeFileSync(join(OUT_DIR, name), encodePng(size, render(size, opts)));
  process.stdout.write(`wrote ${name} (${size}x${size})\n`);
}
