/*
 * puzzles/index.js — the front door to the four locks, and the little kit
 * every lock shares.
 *
 * The shell asks for a lock by kind and gets back the object DESIGN.md §6
 * describes: update / draw / pointer* / key / hint / forceSolve / destroy.
 * What the four have in common lives here, handed to each maker as `kit`
 * rather than imported back from this file — dial.js importing index.js
 * while index.js imports dial.js is a module cycle, and a cycle is a load
 * order bug waiting for someone to add a top-level line.
 *
 * The kit holds:
 *   - the normalised options: difficulty clamped to 1..10, `u` the same thing
 *     as 0..1 (every curve in the lock files is a lerp on u), tier 0..3, an
 *     rng and an sfx that cannot be missing;
 *   - the solve-once latch. events.solved() is called exactly once per lock,
 *     whether the player opened it or the drill did, and after it (or while
 *     the drill is running) every input is ignored;
 *   - the drill. forceSolve() starts a short flourish that each lock animates
 *     its own way (the dial spins, pins rise, digits roll, wires snip), and
 *     when it ends the kit calls solved(). A natural solve calls solved() at
 *     once instead — the clock is the player's, and the shell plays the open
 *     beat, so the lock does not make anyone wait for its own animation;
 *   - the sound words. A fixed pool of six bursts, positioned in fractions of
 *     the lock's rect so they survive a resize, drawn through art.burst with
 *     a life that pops in fast and fades out slow. A fixed pool and option
 *     objects mutated in place, because draw must not allocate (hub §10);
 *   - the shake: a mistake jolts the lock for a quarter second.
 *
 * Severity: a wrong wire is 2, every other mistake is 1 (DESIGN.md §6).
 * The locks never play `clunk` on a natural solve: the shell's open beat
 * owns that sound, and two clunks a frame apart sound like a fault.
 */

import * as art from '../art.js';
import { t, addStrings } from '../i18n.js';
import { createDial } from './dial.js';
import { createPins } from './pins.js';
import { createKeypad } from './keypad.js';
import { createWires } from './wires.js';

export const KINDS = ['dial', 'pins', 'keypad', 'wires'];

const MAKERS = { dial: createDial, pins: createPins, keypad: createKeypad, wires: createWires };

/*
 * The sound words every lock may use. Comic onomatopoeia, which Norwegian
 * comics spell their own way — KLIKK, not CLICK — so these are translated
 * like any other word the player reads.
 */
addStrings({
  nb: {
    'pz.burst.click': 'KLIKK!',
    'pz.burst.chunk': 'KA-KLONK!',
    'pz.burst.jam': 'DUNK!',
    'pz.burst.buzz': 'BZZT!',
    'pz.burst.drop': 'KLIRR!',
    'pz.burst.snip': 'KNIPS!',
    'pz.burst.zap': 'ZAPP!',
    'pz.burst.beep': 'PIP-PIP!',
    'pz.burst.drill': 'BRRRRR!',
    'pz.burst.tick': 'tikk',
    'pz.open': 'Åpen!',
  },
  en: {
    'pz.burst.click': 'CLICK!',
    'pz.burst.chunk': 'KA-CHUNK!',
    'pz.burst.jam': 'THUNK!',
    'pz.burst.buzz': 'BZZT!',
    'pz.burst.drop': 'CLATTER!',
    'pz.burst.snip': 'SNIP!',
    'pz.burst.zap': 'ZAP!',
    'pz.burst.beep': 'BEEP-BEEP!',
    'pz.burst.drill': 'BRRRRR!',
    'pz.burst.tick': 'tik',
    'pz.open': 'Open!',
  },
});

/**
 * DESIGN.md §6. Unknown kinds throw: a job naming a lock that does not exist
 * is a data bug, and failing loudly at the start of a run beats a blank lock.
 */
export function createPuzzle(kind, opts = {}) {
  const make = MAKERS[kind];
  if (!make) throw new Error(`HEIST: no puzzle called "${kind}"`);
  return make(makeKit(opts));
}

const noop = () => {};

/* The colours, read once per lock with a fallback for each, so a palette
 * entry the art lane names differently degrades to a near colour rather than
 * to the canvas default black. */
function palette() {
  const P = art.PAL || {};
  const pick = (k, f) => P[k] || f;
  const C = {
    ink: pick('ink', '#14121a'),
    paper: pick('paper', '#f4ead2'),
    night: pick('night', '#121a33'),
    navy: pick('navy', '#1f2d5c'),
    mustard: pick('mustard', '#e8b730'),
    cream: pick('cream', '#fbf3dc'),
    steel: pick('steel', '#9aa6b2'),
    steelDark: pick('steelDark', '#5d6875'),
    brass: pick('brass', '#c99a3a'),
    red: pick('red', '#d8352a'),
    blue: pick('blue', '#2f6fd6'),
    green: pick('green', '#3aa655'),
    shadow: pick('shadow', 'rgba(0,0,0,0.35)'),
  };
  C.amber = pick('amber', C.mustard);
  return C;
}

function makeKit(o) {
  const d = Number.isFinite(o.difficulty) ? Math.min(10, Math.max(1, o.difficulty)) : 1;
  const tier = Number.isFinite(o.tier) ? Math.min(3, Math.max(0, Math.floor(o.tier))) : 0;
  const rng = typeof o.rng === 'function' ? o.rng : Math.random;
  const rawSfx = typeof o.sfx === 'function' ? o.sfx : noop;
  const ev = o.events || {};

  // Six bursts is more than ever overlap; the oldest is reused if not.
  const bursts = [];
  for (let i = 0; i < 6; i++) {
    bursts.push({ on: false, age: 0, dur: 0.9, fx: 0, fy: 0, key: '', fill: '', size: 0, rot: 0 });
  }
  const BURST = { size: 0, fill: '', rot: 0, life: 0 };
  let flip = 1;

  const FORCE_DUR = 0.9;

  const kit = {
    difficulty: d,
    u: (d - 1) / 9,
    tier,
    rng,
    C: palette(),
    time: 0, // seconds of update() so far: the lock's own clock for animation
    shake: 0, // 1 on a mistake, decays to 0
    done: false, // solved() has been called
    forcing: false, // the drill is running
    forceT: 0, // 0..1 through the drill's flourish

    sfx(name, opts) {
      try {
        rawSfx(name, opts);
      } catch {
        // §3.3 says sfx never throws; a lock must not die if one does.
      }
    },

    /** Input is ignored once solved or while the drill is on it. */
    locked() {
      return kit.done || kit.forcing;
    },

    mistake(severity = 1) {
      if (kit.locked()) return;
      kit.shake = 1;
      if (ev.mistake) ev.mistake(severity);
    },

    progress(f) {
      if (ev.progress) ev.progress(Math.max(0, Math.min(1, f)));
    },

    solve() {
      if (kit.done) return;
      kit.done = true;
      kit.forcing = false;
      kit.progress(1);
      if (ev.solved) ev.solved();
    },

    /** Start the drill's flourish; solved() follows when it ends. */
    force() {
      if (kit.locked()) return false;
      kit.forcing = true;
      kit.forceT = 0;
      kit.burst(0.5, 0.42, 'pz.burst.drill', kit.C.mustard, 0.2, 1.1);
      return true;
    },

    /** A sound word at (fx, fy) in fractions of the rect; size in fractions of its short side. */
    burst(fx, fy, key, fill, size = 0.16, dur = 0.9) {
      let b = bursts[0];
      for (const c of bursts) {
        if (!c.on) {
          b = c;
          break;
        }
        if (c.age / c.dur > b.age / b.dur) b = c;
      }
      b.on = true;
      b.age = 0;
      b.dur = dur;
      b.fx = fx;
      b.fy = fy;
      b.key = key;
      b.fill = fill;
      b.size = size;
      flip = -flip;
      b.rot = flip * 0.12;
    },

    update(dt) {
      kit.time += dt;
      if (kit.shake > 0) kit.shake = Math.max(0, kit.shake - dt * 4);
      for (const b of bursts) {
        if (!b.on) continue;
        b.age += dt;
        if (b.age >= b.dur) b.on = false;
      }
      if (kit.forcing) {
        kit.forceT += dt / FORCE_DUR;
        if (kit.forceT >= 1) {
          kit.forceT = 1;
          kit.solve();
        }
      }
    },

    /** The horizontal jolt to apply this frame, in px. */
    shakeX(s) {
      return kit.shake > 0 ? Math.sin(kit.time * 70) * kit.shake * s * 0.025 : 0;
    },

    drawBursts(ctx, rect) {
      const s = Math.min(rect.w, rect.h);
      for (let i = 0; i < bursts.length; i++) {
        const b = bursts[i];
        if (!b.on) continue;
        // Pop in over 0.1 s, hold, fade over the last 0.3 s.
        const life = Math.min(1, b.age / 0.1) * Math.min(1, (b.dur - b.age) / 0.3);
        BURST.size = b.size * s;
        BURST.fill = b.fill;
        BURST.rot = b.rot;
        BURST.life = Math.max(0, life);
        art.burst(ctx, rect.x + b.fx * rect.w, rect.y + b.fy * rect.h, t(b.key), BURST);
      }
    },

    /** Fisher–Yates in place with the lock's rng, so the four agree on what a shuffle is. */
    shuffle(a) {
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = a[i];
        a[i] = a[j];
        a[j] = tmp;
      }
      return a;
    },

    /** u mapped onto a..b: every difficulty curve in the lock files is one of these. */
    lerp(a, b) {
      return a + (b - a) * kit.u;
    },

    /** The ink width for this rect: art.LINE at a 400px lock, never thinner than 3/4 of it. */
    line(s) {
      const L = Number.isFinite(art.LINE) ? art.LINE : 3;
      return L * Math.min(1.5, Math.max(0.75, s / 400));
    },
  };
  return kit;
}
