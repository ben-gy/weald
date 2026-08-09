# Weald

**Everyone draws the same shape on their own map — the edicts decide what it was worth.**

🎮 Play: https://weald.benrichardson.dev

## What it is

Weald is a map-drawing race for one to six. Every player is dealt the *identical* sequence of
shapes, in the identical order, and draws each one anywhere on their own square map. You choose
where it goes, which way round it goes, and — usually — which of four terrains it is made of. You
cannot un-draw it.

Four **edicts** decide what a finished map is worth: score for big joined woods, or for the places
two terrains touch, or for finishing whole rows. Two are face up from the start and two turn over
part-way through, so the last watch is a change of plan rather than a lap of honour. Each edict
scores twice, over your whole map as it stands, which means an early square keeps paying and an
early mistake keeps costing.

Now and then the **canker** spreads and everybody carves the same rot into their own map. It bills
you at the end of every watch for each unwritten square it touches, so the entire skill is *where*
you absorb damage that everyone takes equally.

Because nobody can be dealt a better hand than anybody else, the end-of-run summary is the point:
every player's map, side by side, with an edict-by-edict breakdown and a mark against whoever read
each rule best. Solo, three seeded rivals draw the same run beside you and set the par.

## How to play

- **Phone:** drag anywhere on the map to move the piece. The map is never a commit target, so you
  can never mis-tap a square — get the drag wrong and you just drag again. Tap **⟳** and **⇋** to
  turn and flip, pick a terrain, then tap **Place**. The last placement can be undone.
- **Keyboard:** arrows move, **R** rotates, **F** flips, **Enter** places, **Z** undoes.

## Three surveys

| | Board | What a good map looks like |
|---|---|---|
| **Canopy** | 9×9 | Big joined masses, one large lake, and unwritten pockets you have walled in. You extend what you have, and cutting a lake in half is the mistake. |
| **March** | 9×9 | The inverse — score where terrains *touch*, for Grove along the rim, and for sealing the canker in. Blobbing is punished and the rot arrives in every watch. |
| **Survey** | 8×8 | The tight one. A smaller map makes whole rows reachable, so exact fits matter, and every card offers two different shapes of the same size. |

The modes are not a difficulty dial: each swaps the scoring language, so what counts as a good
placement genuinely changes. A bot that optimises one mode's edicts while playing another loses
48–79% of its score, which is measured in `tests/balance.test.ts` rather than asserted here.

## Multiplayer

Two to six players over a room link — create a room and send the link, scan the QR, or read the
four-character code down the phone.

It is **parallel same-seed**: every device derives the whole run — the crag layout, the edicts, every
card, every canker carve — from one shared seed, and plays it locally. No game state ever crosses
the network. What does cross is your finished map, once per watch, so that everyone's summary can
show everyone's map. That means there is nothing to desync, a host leaving is a display concern
rather than a broken match, and a peer who goes quiet simply keeps the figures they last posted.

Peer-to-peer over WebRTC, with no server: a public relay is used only to introduce the two browsers
to each other, and no gameplay is stored on it.

## Tech

- Vite 6 + vanilla TypeScript, DOM rendering (crisp text, easy hit targets, trivially responsive)
- Shared engine: P2P netcode, multi-round sessions, lobby + join QR, deterministic RNG, procedural
  audio, mobile hardening
- Vitest: geometry, rules, P2P determinism, a seeded balance sim, an independent scoring audit, a
  contrast gate and source-level layout invariants
- GitHub Pages hosting

No cookies, no fingerprinting, no third-party fonts. Anonymous, cookie-less page-view counts via
Cloudflare Web Analytics.

## Local dev

```bash
npm install
npm run dev
npm test
npm run build
npm run preview
```

## License

[GNU Affero General Public License v3.0 or later](./LICENSE), with an attribution
requirement added under section 7(b) — see [ADDITIONAL-TERMS.md](./ADDITIONAL-TERMS.md).

A separate commercial licence without the AGPL's source-disclosure obligations is
available on request: <hi@ben.gy>.

Third-party components keep their own licences — see [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).
