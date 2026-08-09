# Contributing

Thanks for the interest. A few things to know before you open a pull request.

## Copyright assignment is required

This project is dual-licensed: AGPL-3.0-or-later for everyone, and a separate
commercial licence for anyone who needs one without the source-disclosure
obligations. That second licence is only possible if a single party holds the
copyright in the whole work.

So **by submitting a pull request you assign copyright in your contribution to
Ben Richardson**, and confirm that you are entitled to do so — that the work is
yours, that no employer or client has a claim on it, and that it is not copied
from anywhere else. Your contribution is then licensed back to you, and to
everyone, under the AGPL like the rest of the project.

If you cannot agree to that, please open an issue describing the change instead
of a pull request. A clear bug report is worth a great deal.

## Practical notes

- `npm test` must be green, and a fix needs a test that goes **red** without it.
  A test written after the fix and never seen failing is a guess.
- Match the surrounding style. Comments here explain *why*, not *what*.
- Colours that carry meaning belong in `src/palette.ts`, where the contrast gate
  can measure them — not inline in a renderer.
- The scoring rules live in `src/edicts.ts` and are audited from *outside* by
  `tests/mechanism.test.ts`. If you change a formula, change the independent
  re-derivation too — a scorer that grades its own homework proves nothing.
- Do not vendor the shared engine or edit anything under `node_modules`. If the
  engine cannot express something, say so in the issue.

## Reporting a problem

There is a **Feedback** link in the footer of the game itself, which is the
fastest route — it files an issue with the build details attached.
