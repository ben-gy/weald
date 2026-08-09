// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
//
// source-hygiene.test.ts
//
// The control-byte check is the one that has actually caught something, twice, in this factory. A
// raw control byte compiles and runs perfectly — and then `file` reports the source as "data", git
// treats it as binary, `diff` refuses it, and PLAIN GREP SILENTLY MATCHES NOTHING IN IT. So any
// audit that greps the file gets an all-clear it did not earn. Write `\x00`-style escapes instead.

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(`${ROOT}/${dir}`)) {
    const rel = `${dir}/${name}`;
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    if (statSync(`${ROOT}/${rel}`).isDirectory()) walk(rel, out);
    else if (/\.(ts|css|html|json|mjs|md|yml)$/.test(name)) out.push(rel);
  }
  return out;
}

const FILES = [...walk('src'), ...walk('tests'), ...walk('scripts'), 'index.html'];

describe('no literal control bytes anywhere in the source', () => {
  for (const f of FILES) {
    it(f, () => {
      const text = readFileSync(`${ROOT}/${f}`, 'utf8');
      // eslint-disable-next-line no-control-regex
      const bad = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.exec(text);
      expect(
        bad === null,
        bad ? `control byte 0x${bad[0].charCodeAt(0).toString(16)} at offset ${bad.index}` : '',
      ).toBe(true);
    });
  }
});

describe('nothing ships a debug channel', () => {
  const shipped = walk('src');
  for (const f of shipped) {
    if (!f.endsWith('.ts')) continue;
    it(`${f} has no console call`, () => {
      const text = readFileSync(`${ROOT}/${f}`, 'utf8').replace(/^\s*\/\/.*$/gm, '');
      expect(/\bconsole\.(log|error|warn|info|debug)\b/.test(text)).toBe(false);
    });
  }
});

describe('shared randomness never comes from Math.random', () => {
  // This game is PARALLEL SAME-SEED: every peer derives the identical card sequence from the seed
  // the host froze into the round start. One stray Math.random in that derivation and two players
  // are scoring different maps while the summary compares them side by side as if they were not.
  for (const f of walk('src')) {
    if (!f.endsWith('.ts')) continue;
    it(`${f}`, () => {
      // Comments stripped first. Several files explain in prose WHY Math.random is forbidden here,
      // and matching that prose would make the rule unstatable in the very place it matters most.
      const text = readFileSync(`${ROOT}/${f}`, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      const hits = [...text.matchAll(/Math\.random\(\)/g)];
      for (const h of hits) {
        const line = text.slice(0, h.index).split('\n').length;
        const context = text.split('\n')[line - 1];
        // The only permitted uses are cosmetic and purely local: a default display name, and which
        // of the rival names the solo ghost is given. Neither is ever compared across peers.
        expect(
          /Surveyor \$\{Math\.floor|RIVALS\[Math\.floor/.test(context),
          `${f}:${line} — shared randomness must come from rng.ts: ${context.trim()}`,
        ).toBe(true);
      }
    });
  }
});

describe('every first-party source file carries its SPDX header', () => {
  for (const f of walk('src')) {
    if (!f.endsWith('.ts') && !f.endsWith('.css')) continue;
    if (f.endsWith('.d.ts')) continue;
    it(f, () => {
      const head = readFileSync(`${ROOT}/${f}`, 'utf8').slice(0, 400);
      expect(head).toContain('SPDX-License-Identifier: AGPL-3.0-or-later');
      expect(head).toContain('Ben Richardson');
      expect(head).toContain('ADDITIONAL-TERMS.md');
    });
  }
});

describe('the engine is depended on, never copied', () => {
  it('there is no src/engine directory and no direct trystero dependency', () => {
    const pkg = JSON.parse(readFileSync(`${ROOT}/package.json`, 'utf8'));
    expect(pkg.dependencies).toEqual({
      '@ben-gy/game-engine': 'github:ben-gy/gh-game-engine#v1.3.2',
    });
    expect(pkg.dependencies.trystero, 'trystero arrives through the engine, pinned').toBeUndefined();
    expect(FILES.some((f) => f.startsWith('src/engine/'))).toBe(false);
  });

  it('and the installed engine really is the pinned tag — npm will serve a stale one silently', () => {
    const v = JSON.parse(
      readFileSync(`${ROOT}/node_modules/@ben-gy/game-engine/package.json`, 'utf8'),
    ).version;
    expect(v, 'a github: dependency is cached by tag; clear it and re-resolve').toBe('1.3.2');
  });

  it('the lockfile still carries every platform rollup binary', () => {
    const lock = readFileSync(`${ROOT}/package-lock.json`, 'utf8');
    const n = [...lock.matchAll(/"node_modules\/@rollup\/rollup-/g)].length;
    // A lock regenerated on macOS keeps ONE, and `npm ci` then dies on the Linux runner.
    expect(n, `${n} rollup binaries in the lockfile — expected roughly 25`).toBeGreaterThan(15);
  });
});
