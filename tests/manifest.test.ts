// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
//
// manifest.test.ts — the boot-time contract: what the page loads, what it promises, and the parts
// of src/main.ts that are easy to get subtly wrong and impossible to notice.

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';

const ROOT = process.cwd();
const read = (p: string): string => readFileSync(`${ROOT}/${p}`, 'utf8');
const html = read('index.html');
const main = read('src/main.ts');
const SLUG = 'weald';
const HOST = `${SLUG}.benrichardson.dev`;

describe('privacy and third-party surface', () => {
  it('loads EXACTLY two external scripts: the beacon and the hosted feedback widget', () => {
    const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
    const external = scripts.filter((s) => /^https?:/.test(s));
    expect(external.sort()).toEqual([
      'https://feedback.benrichardson.dev/w.js',
      'https://static.cloudflareinsights.com/beacon.min.js',
    ]);
  });

  it('and no third-party fonts, stylesheets or images', () => {
    const links = [...html.matchAll(/<link[^>]*href="([^"]+)"/g)].map((m) => m[1]);
    expect(links.filter((l) => /^https?:/.test(l))).toEqual([]);
    expect(/fonts\.(googleapis|gstatic)/.test(html)).toBe(false);
    expect(/cdn\.|unpkg|jsdelivr/.test(html)).toBe(false);
  });

  it('never adds a canonical link — Pages already 301s the .github.io host', () => {
    expect(/rel="canonical"/.test(html)).toBe(false);
  });

  it('does not vendor the feedback widget', () => {
    expect(existsSync(`${ROOT}/src/feedback.ts`)).toBe(false);
    expect(/mountFeedback/.test(main)).toBe(false);
    expect(/window\.feedback\?\.open/.test(main), 'the results screen must offer feedback').toBe(true);
  });

  it('registers no service worker — a stale cache would serve an old build after every deploy', () => {
    expect(/serviceWorker/.test(html + main)).toBe(false);
  });
});

describe('the head', () => {
  it('has the viewport meta that the mobile hardening depends on', () => {
    const m = /<meta name="viewport" content="([^"]+)"/.exec(html);
    expect(m).not.toBeNull();
    expect(m![1]).toContain('width=device-width');
    // env(safe-area-inset-*) resolves to 0 without this, and the HUD then sits under the notch.
    expect(m![1]).toContain('viewport-fit=cover');
  });

  it('carries the social card and the structured data', () => {
    for (const needle of [
      `<meta property="og:url" content="https://${HOST}/" />`,
      `<meta property="og:image" content="https://${HOST}/og.png" />`,
      '"@type": "VideoGame"',
      'name="twitter:card" content="summary_large_image"',
    ]) {
      expect(html).toContain(needle);
    }
  });

  it('ships the iOS icon set, because iOS ignores the manifest icons', () => {
    for (const needle of [
      'rel="apple-touch-icon"',
      'name="apple-mobile-web-app-capable"',
      'name="apple-mobile-web-app-status-bar-style"',
      'name="apple-mobile-web-app-title"',
      'rel="manifest"',
    ]) {
      expect(html).toContain(needle);
    }
  });
});

describe('the shipped assets exist and are the right shape', () => {
  const files: Array<[string, number]> = [
    ['public/og.png', 5000],
    ['public/favicon.svg', 100],
    ['public/manifest.webmanifest', 100],
    ['public/robots.txt', 10],
    ['public/sitemap.xml', 50],
    ['public/CNAME', 5],
    ['public/133936b7b2ab337d2e2288fd7dd7c30f.txt', 10],
    ['public/icons/icon-192.png', 500],
    ['public/icons/icon-512.png', 500],
    ['public/icons/icon-512-maskable.png', 500],
    ['public/icons/apple-touch-icon.png', 500],
  ];
  for (const [p, min] of files) {
    it(p, () => {
      expect(existsSync(`${ROOT}/${p}`), `${p} is missing`).toBe(true);
      expect(statSync(`${ROOT}/${p}`).size).toBeGreaterThan(min);
    });
  }

  it('the CNAME, robots and sitemap all name the same host', () => {
    expect(read('public/CNAME').trim()).toBe(HOST);
    expect(read('public/robots.txt')).toContain(`https://${HOST}/sitemap.xml`);
    expect(read('public/sitemap.xml')).toContain(`https://${HOST}/`);
  });

  it('the IndexNow key file contains exactly its own name', () => {
    expect(read('public/133936b7b2ab337d2e2288fd7dd7c30f.txt').trim()).toBe(
      '133936b7b2ab337d2e2288fd7dd7c30f',
    );
  });

  it('the manifest is standalone with all three icon purposes', () => {
    const m = JSON.parse(read('public/manifest.webmanifest'));
    expect(m.display).toBe('standalone');
    expect(m.theme_color).toBe('#12160F');
    expect(m.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes}:${i.purpose}`)).toEqual([
      '192x192:any',
      '512x512:any',
      '512x512:maskable',
    ]);
  });

  it('the apple-touch icon is fully opaque — iOS composites onto black', () => {
    const png = readFileSync(`${ROOT}/public/icons/apple-touch-icon.png`);
    expect(read('scripts/gen-icons.mjs')).toContain("['apple-touch-icon.png', 180, { opaque: true");
    expect(png.length).toBeGreaterThan(500);
  });
});

describe('the boot contract in src/main.ts', () => {
  it('honours ?room= exactly once, and clears it on the way out', () => {
    expect(/deepLinkUsed = true;/.test(main)).toBe(true);
    expect(/clearRoomInUrl\(\)/.test(main), 'a reload must not drag a player back into a room').toBe(true);
  });

  it('offers create-a-room OR join-by-typed-code before the lobby', () => {
    expect(/createRoomEntry\(/.test(main)).toBe(true);
    expect(/normalizeRoomCode\(/.test(main)).toBe(true);
  });

  it('only the peer that MINTED the code claims host', () => {
    expect(/claimHost: iMintedIt/.test(main)).toBe(true);
    expect(/iMintedIt = false;/.test(main), 'a deep link joins as a guest').toBe(true);
  });

  it('sets the TURN config once, before any mesh exists', () => {
    const turn = main.indexOf('setTurnConfig(');
    expect(turn).toBeGreaterThan(0);
    expect(main.slice(turn).includes('await getTurnConfig()')).toBe(true);
    expect(main.indexOf('createNet(')).toBeGreaterThan(0);
  });

  it('wires the roster, peer-leave and host-change handlers — never a bare createNet', () => {
    const cfg = main.slice(main.indexOf('createNet('), main.indexOf('createNet(') + 900);
    for (const h of ['onPeers:', 'onPeerLeave:', 'onHostChange:']) expect(cfg).toContain(h);
  });

  it('never navigates from a net handler — they fire in the lobby AND just after a run ends', () => {
    const cfg = main.slice(main.indexOf('createNet('), main.indexOf('createNet(') + 900);
    expect(/showMenu\(\)/.test(cfg), 'a repaint that navigates ejects every peer').toBe(false);
  });

  it('the room is torn down in leaveRoom and nowhere else', () => {
    // Exactly two: leaveRoom, and the beforeunload handler.
    expect([...main.matchAll(/net\?\.leave\(\)/g)].length).toBe(2);
  });

  it('drives the clock on setInterval, never on rAF alone', () => {
    expect(/requestAnimationFrame/.test(main)).toBe(false);
    expect(/setInterval\(/.test(main)).toBe(true);
  });

  it('finishes the round before showing the lobby, or the engine paints nothing', () => {
    expect(/rounds\?\.finish\(\);\s*\n\s*showLobby\(\);/.test(main)).toBe(true);
  });

  it('hides the site footer while a survey is live, and shows it everywhere else', () => {
    expect(/classList\.toggle\('playing', on\)/.test(main)).toBe(true);
    expect(read('src/styles/main.css')).toContain('body.playing .site-footer');
  });

  it('counts the players in before a round starts', () => {
    expect(/runCountdown\(/.test(main), 'a jump-cut gives whoever is looking a head start').toBe(true);
  });

  it('the wire channel names are within Trystero s 12-byte budget', () => {
    const names = [...main.matchAll(/net\.channel<[^>]*>\('([^']+)'/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(n.length, `${n} is too long`).toBeLessThanOrEqual(12);
  });

  it('the attribution backlink points at the catalogue', () => {
    const ui = read('src/ui.ts');
    expect(ui).toContain('https://benrichardson.dev/');
    expect(ui).toContain('https://lab.benrichardson.dev');
    expect(/github\.com/.test(ui), 'no repo link in the game UI').toBe(false);
  });
});

describe('licensing files', () => {
  for (const p of [
    'LICENSE',
    'ADDITIONAL-TERMS.md',
    'CONTRIBUTING.md',
    'THIRD-PARTY-NOTICES.md',
    'public/third-party-notices.txt',
    'README.md',
  ]) {
    it(p, () => expect(existsSync(`${ROOT}/${p}`), `${p} is missing`).toBe(true));
  }
  it('is AGPL, never MIT', () => {
    expect(JSON.parse(read('package.json')).license).toBe('AGPL-3.0-or-later');
    const lic = read('LICENSE');
    expect(lic).toContain('GNU AFFERO GENERAL PUBLIC LICENSE');
    expect(lic.split('\n').length).toBeGreaterThan(600);
  });
  it('and there is no licence copy in the game UI', () => {
    const ui = read('src/ui.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(/AGPL|GNU|licen[cs]e/i.test(ui), 'licensing lives in the repo, not the title screen').toBe(false);
  });
});
