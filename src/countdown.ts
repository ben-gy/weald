// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// See ADDITIONAL-TERMS.md for the section 7(b) attribution requirement.
//
// Weald — 3-2-1-DRAW between the host's start arriving and the survey actually beginning.
//
// Without it, whoever happened to be looking at their screen when the message landed gets a free
// head start on a timed mode, and the map reads as a jump-cut. The AUDIO is what actually carries
// it: players watch the grid, not the overlay. Each peer counts locally from its own copy of the
// start, which is in step to within one network hop.
//
// setInterval, never rAF: a peer whose tab is backgrounded must still arrive on time.

export interface CountdownConfig {
  container: HTMLElement;
  sfx: (name: string) => void;
  onDone: () => void;
  stepMs?: number;
}

export function runCountdown(c: CountdownConfig): { cancel: () => void } {
  const step = c.stepMs ?? 700;
  const el = document.createElement('div');
  el.className = 'countdown';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'assertive');
  c.container.append(el);

  const beats = ['3', '2', '1', 'Draw!'];
  let i = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let done = false;

  const show = (): void => {
    el.textContent = beats[i];
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
    c.sfx(i === beats.length - 1 ? 'go' : 'tick');
  };

  const finish = (): void => {
    if (done) return;
    done = true;
    if (timer !== null) clearInterval(timer);
    timer = null;
    el.remove();
    c.onDone();
  };

  show();
  timer = setInterval(() => {
    i++;
    if (i >= beats.length) {
      show();
      setTimeout(finish, step);
      if (timer !== null) clearInterval(timer);
      timer = null;
      return;
    }
    show();
  }, step);

  return {
    cancel: () => {
      if (done) return;
      done = true;
      if (timer !== null) clearInterval(timer);
      timer = null;
      el.remove();
    },
  };
}
