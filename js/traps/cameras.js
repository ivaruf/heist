/*
 * cameras.js — the camera corridor.
 *
 * A top-down hall with crates down it in a zigzag, the door at the bottom and
 * the way out at the top. Security cameras on the walls sweep back and forth.
 * Behind a crate the thief is hidden; between crates, out in the open, any
 * camera that has the thief in its cone catches them. So the whole trap is
 * one question asked again and again: *now?* It is the timing trap, where
 * lasers is the steering one and tiles the memory one.
 *
 * Moves are hops from cover to cover, never free walking: tap the next crate
 * (or the one behind, to retreat), or press an arrow / Space / Enter. A hop
 * runs in a straight line at HOP_SPEED and cannot be cancelled, which is what
 * makes the decision to go a decision. Caught: a flash (BLINK!), a mistake of
 * severity 1, and the thief scuttles back to the cover they left from; a
 * short lockout after that stops a frantic second tap firing them straight
 * back into the same cone.
 *
 * Solvable by construction, and checked rather than hoped for: every camera
 * shares one sweep period T, so the whole room repeats every T seconds, and
 * the generator simulates each hop from every start time across one period.
 * A camera is only kept if, with it, every hop still has a contiguous window
 * of safe start times at least `minWin` long (1 s at difficulty 1, 0.4 s at
 * 10). A camera that would close a hop is re-aimed, re-phased, and finally
 * dropped. So the generator asks for 1..5 cameras and keeps what fits: one
 * at difficulty 1-2, about two from 5 up; past that, difficulty is faster
 * sweeps, shorter dwells and narrower windows rather than more cameras.
 * `generate`, `seenAt` and `hopWindow` are exported for the tests.
 *
 * Jammer (tool tiers, DESIGN §4, cumulative):
 *   0 — cones drawn soft, with vague edges: three faint layers from 0.7× to
 *       1.3× the real width, so the true edge has to be guessed with margin.
 *   1 — Camera map: cones drawn with exact, inked hard edges.
 *   2 — Signal jammer: cameras sweep 25% slower (every window 33% longer).
 *   3 — Loop tape: tap a camera (or press F) to freeze it for 3 s, once per room.
 */

import * as art from '../art.js';
import { t, addStrings } from '../i18n.js';

addStrings({
  nb: {
    'trap.cameras.hint': 'Trykk på neste kasse når kameraene ser en annen vei. Bak kassene er du trygg.',
    'trap.cameras.hintCaught': 'Avslørt! Vent til kameraet har snudd seg bort.',
    'trap.cameras.hintTape': 'Trykk på et kamera (eller F) for å fryse det i 3 sekunder.',
    'trap.cameras.flash': 'BLINK!',
    'trap.cameras.freeze': 'FRYS!',
  },
  en: {
    'trap.cameras.hint': 'Tap the next crate when the cameras look away. Behind the crates you are safe.',
    'trap.cameras.hintCaught': 'Spotted! Wait until the camera has turned away.',
    'trap.cameras.hintTape': 'Tap a camera (or press F) to freeze it for 3 seconds.',
    'trap.cameras.flash': 'FLASH!',
    'trap.cameras.freeze': 'FREEZE!',
  },
});

export const W = 10;
export const HOP_SPEED = 5.5;
const STEP = 2.6; // vertical distance between covers
const BODY = 0.22; // the thief's radius, widening the cone check a little
const FREEZE = 3;
const JAM = 0.75; // tier 2+: cameras run at three quarters speed
const SLACK = 0.08; // radians of extra cone the generator plans around
const DUCK = 0.5; // within this of a crate the thief is still tucked in behind it

const NOOP = () => {};
const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = (a) => {
  a %= Math.PI * 2;
  return a > Math.PI ? a - Math.PI * 2 : a < -Math.PI ? a + Math.PI * 2 : a;
};

/*
 * The sweep: dwell at one end, ease across, dwell at the other, ease back.
 * The dwell is what makes an easy camera readable — it visibly *waits*.
 */
export function camAngle(c, t) {
  let p = (t / c.T + c.phase) % 1;
  if (p < 0) p += 1;
  const D = c.dwell;
  let s;
  if (p < D) s = 0;
  else if (p < 0.5) {
    const f = (p - D) / (0.5 - D);
    s = f * f * (3 - 2 * f);
  } else if (p < 0.5 + D) s = 1;
  else {
    const f = (p - 0.5 - D) / (0.5 - D);
    s = 1 - f * f * (3 - 2 * f);
  }
  return c.base + c.amp * (2 * s - 1);
}

/**
 * Does camera c, at its local time t, see a thief at (x, y)? `slack` widens
 * the cone: the generator checks with SLACK so that every start time it
 * calls safe is safe by a margin, and an edge that only grazes the path for
 * a few milliseconds (caught on some frames, missed on others) can never be
 * the thing a window depends on. The live game checks with none.
 */
export function camSees(c, t, x, y, slack = 0) {
  const dx = x - c.x;
  const dy = y - c.y;
  const d2 = dx * dx + dy * dy;
  if (d2 > c.range * c.range) return false;
  const d = Math.sqrt(d2);
  return Math.abs(wrap(Math.atan2(dy, dx) - camAngle(c, t))) < c.alpha + slack + BODY / Math.max(d, 0.5);
}

/** Any camera, all at the same time t (true of the room as generated). */
export function seenAt(cams, t, x, y, slack = 0) {
  for (let i = 0; i < cams.length; i++) if (camSees(cams[i], t, x, y, slack)) return true;
  return false;
}

/** Longest run of safe start times (seconds, circular over T) for hop i → i+1. */
export function hopWindow(covers, cams, i, T) {
  if (!cams.length) return T;
  const a = covers[i];
  const b = covers[i + 1];
  const dur = Math.hypot(b.x - a.x, b.y - a.y) / HOP_SPEED;
  // Samples ~0.05 units apart along the path, far finer than SLACK's margin
  // (~0.4 units at a typical distance), so with the slack an edge cannot
  // slip between samples. The first and last DUCK of a hop are behind the
  // crates.
  const steps = Math.ceil(dur * 120);
  const len = dur * HOP_SPEED;
  const N = Math.ceil(T * 15);
  let run = 0;
  let bestRun = 0;
  let first = -1; // length of the leading safe run, for wrap-around
  for (let s = 0; s < N; s++) {
    const ts = (s / N) * T;
    let ok = true;
    for (let j = 0; j <= steps && ok; j++) {
      const f = j / steps;
      if (f * len < DUCK || (1 - f) * len < DUCK) continue;
      if (seenAt(cams, ts + f * dur, a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, SLACK)) ok = false;
    }
    if (ok) run++;
    else {
      if (first < 0) first = run;
      if (run > bestRun) bestRun = run;
      run = 0;
    }
  }
  if (first < 0) return T; // never seen at all
  bestRun = Math.max(bestRun, run + first);
  return (bestRun / N) * T;
}

export function generate(difficulty, rng) {
  const d = clamp(+difficulty || 1, 1, 10);
  const k = (d - 1) / 9;
  const hops = 3 + Math.round(k * 4);
  const H = hops * STEP + 2.0;
  const flip = rng() < 0.5;
  const covers = [];
  for (let i = 0; i <= hops; i++) {
    const y = H - 1.0 - i * STEP;
    let x = W / 2;
    if (i > 0 && i < hops) x = (i % 2 === 1) !== flip ? lerp(2.0, 3.8, rng()) : lerp(6.2, 8.0, rng());
    covers.push({ x, y });
  }
  const T = lerp(5.0, 2.8, k);
  const dwell = lerp(0.3, 0.12, k);
  const amp = lerp(30, 40, k) * (Math.PI / 180);
  const alpha = lerp(22, 24, k) * (Math.PI / 180);
  const minWin = lerp(1.0, 0.4, k);
  const want = 1 + Math.round(k * 4);

  // Spread cameras over different hops first, in a shuffled order.
  const order = [];
  for (let i = 0; i < hops; i++) order.push(i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = order[i];
    order[i] = order[j];
    order[j] = tmp;
  }

  const cams = [];
  const fits = () => {
    for (let i = 0; i < hops; i++) if (hopWindow(covers, cams, i, T) < minWin) return false;
    return true;
  };
  for (let n = 0; n < want; n++) {
    let placed = false;
    for (let tries = 0; tries < 32 && !placed; tries++) {
      const hop = order[(n + (tries >> 3)) % hops]; // every 8 misses, try the next hop
      const a = covers[hop];
      const b = covers[hop + 1];
      const f = lerp(0.3, 0.7, rng());
      const mx = a.x + (b.x - a.x) * f;
      const my = a.y + (b.y - a.y) * f;
      // Mostly on the wall across from the path, so the cone has room to
      // sweep; now and then on the near wall, close and quick.
      const far = rng() < 0.7;
      const x = (mx < W / 2) === far ? W : 0;
      const y = clamp(my + (rng() - 0.5) * 2, 0.6, H - 0.6);
      const base = Math.atan2(my - y, mx - x) + (rng() - 0.5) * 0.3;
      // A cone reaches the far wall. A shorter one would have a round tip,
      // and a tip that grazes a path makes a sliver of contact a few
      // milliseconds long: missed by one sampling, caught by another, and
      // so caught by the live game on some frames and not others.
      cams.push({ x, y, base, amp, alpha, range: W + H, T, dwell, phase: rng() });
      if (fits()) placed = true;
      else cams.pop();
    }
  }
  return { W, H, covers, cams, T, minWin, hops };
}

const BURST = { size: 0, fill: '', rot: 0, life: 0 };
const CAP = { size: 0, align: 'center', fill: '', stroke: '' };
const CRATE = { fill: '', r: 3, shadow: true };

export function createCameras(opts = {}) {
  const tier = opts.tier | 0;
  const rng = opts.rng || Math.random;
  const sfx = opts.sfx || NOOP;
  const ev = opts.events || {};
  const mistake = ev.mistake || NOOP;
  const progress = ev.progress || NOOP;
  const solved = ev.solved || NOOP;

  const room = generate(opts.difficulty, rng);
  const { H, covers, cams, hops } = room;
  const n = cams.length;
  const camT = new Float64Array(n); // each camera's own clock, so tape can stop one
  const frozen = new Float64Array(n);
  const rate = tier >= 2 ? JAM : 1;

  let time = 0;
  let phase = 'idle'; // idle | hop | caught | back | dash | exit | done
  let timer = 0;
  let at = 0; // the cover the thief is at, or left from
  let to = 0;
  let dur = 0;
  let x = covers[0].x;
  let y = covers[0].y;
  let fromX = 0;
  let fromY = 0;
  let face = -Math.PI / 2;
  let lock = 0;
  let caughtBy = -1;
  let caughtCount = 0;
  let tapeLeft = tier >= 3 ? 1 : 0;
  let didSolve = false;
  const burst = { key: '', x: 0, y: 0, age: 9, dur: 0.9, fill: 'red' };
  const say = (key, bx, by, fill) => {
    burst.key = key;
    burst.x = bx;
    burst.y = by;
    burst.age = 0;
    burst.fill = fill;
  };

  function seenLive(px, py) {
    for (let i = 0; i < n; i++) if (camSees(cams[i], camT[i], px, py)) return i;
    return -1;
  }

  function hop(target) {
    if (phase !== 'idle' || lock > 0) return;
    if (target < 0 || target > hops || Math.abs(target - at) !== 1) return;
    to = target;
    phase = 'hop';
    timer = 0;
    fromX = covers[at].x;
    fromY = covers[at].y;
    dur = Math.hypot(covers[to].x - fromX, covers[to].y - fromY) / HOP_SPEED;
    face = Math.atan2(covers[to].y - fromY, covers[to].x - fromX);
    sfx('tick', { rate: 1.3 });
  }

  function freeze(i) {
    if (tapeLeft <= 0 || i < 0) return false;
    tapeLeft--;
    frozen[i] = FREEZE;
    say('trap.cameras.freeze', cams[i].x, cams[i].y, 'blue');
    sfx('click', { strength: 0.8 });
    return true;
  }

  function update(dt) {
    time += dt;
    burst.age += dt;
    for (let i = 0; i < n; i++) {
      if (frozen[i] > 0) frozen[i] = Math.max(0, frozen[i] - dt);
      else camT[i] += dt * rate;
    }
    if (lock > 0) lock -= dt;
    if (phase === 'hop' || phase === 'dash') {
      timer += dt;
      const f = Math.min(1, timer / dur);
      x = fromX + (covers[to].x - fromX) * f;
      y = fromY + (covers[to].y - fromY) * f;
      const len = dur * HOP_SPEED;
      if (phase === 'hop' && f * len >= DUCK && (1 - f) * len >= DUCK) {
        const c = seenLive(x, y);
        if (c >= 0) {
          phase = 'caught';
          timer = 0;
          caughtBy = c;
          caughtCount++;
          say('trap.cameras.flash', x, y - 0.7, 'red');
          sfx('buzz');
          mistake(1);
          return;
        }
      }
      if (f >= 1) {
        at = to;
        if (phase === 'dash' && at < hops) {
          // The drill-style dash runs through every remaining cover.
          to = at + 1;
          timer = 0;
          fromX = x;
          fromY = y;
          dur = Math.hypot(covers[to].x - x, covers[to].y - y) / (HOP_SPEED * 3);
        } else if (at === hops) {
          phase = 'exit';
          timer = 0;
          sfx('chime');
          say('trap.phew', W / 2, 1.2, 'mustard');
        } else {
          phase = 'idle';
          sfx('tick', { rate: 0.8 });
          progress(at / hops);
        }
      }
    } else if (phase === 'caught') {
      timer += dt;
      if (timer >= 0.5) {
        phase = 'back';
        timer = 0;
        fromX = x;
        fromY = y;
      }
    } else if (phase === 'back') {
      timer += dt;
      const f = Math.min(1, timer / 0.35);
      x = fromX + (covers[at].x - fromX) * f;
      y = fromY + (covers[at].y - fromY) * f;
      if (f >= 1) {
        phase = 'idle';
        lock = 0.45;
        caughtBy = -1;
      }
    } else if (phase === 'exit') {
      timer += dt;
      y -= dt * 2;
      if (timer >= 0.6 && !didSolve) {
        didSolve = true;
        phase = 'done';
        progress(1);
        solved();
      }
    }
  }

  // ---- drawing ---------------------------------------------------------------

  const L = { x: -1, y: -1, w: -1, h: -1, dpr: 0, s: 1, ox: 0, oy: 0 };
  let bg = null;

  function relayout(rect) {
    const dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1;
    if (rect.x === L.x && rect.y === L.y && rect.w === L.w && rect.h === L.h && dpr === L.dpr && bg) return;
    L.x = rect.x;
    L.y = rect.y;
    L.w = rect.w;
    L.h = rect.h;
    L.dpr = dpr;
    const pad = Math.max(6, Math.min(rect.w, rect.h) * 0.03);
    L.s = Math.max(1, Math.min((rect.w - pad * 2) / W, (rect.h - pad * 2) / H));
    L.ox = rect.x + (rect.w - W * L.s) / 2;
    L.oy = rect.y + (rect.h - H * L.s) / 2;
    bg = bake(bg, L, paintRoom);
  }

  function paintRoom(g) {
    const s = L.s;
    const PAL = art.PAL;
    art.panel(g, L.ox, L.oy, W * s, H * s, { fill: PAL.navy, r: 4, shadow: true });
    g.save();
    g.beginPath();
    g.rect(L.ox, L.oy, W * s, H * s);
    g.clip();
    // A long carpet runner down the middle, and the halftone over it all.
    g.fillStyle = PAL.night;
    g.fillRect(L.ox + 1.2 * s, L.oy, (W - 2.4) * s, H * s);
    art.halftone(g, L.ox, L.oy, W * s, H * s, { color: PAL.night, spacing: Math.max(4, s * 0.3), angle: 0.785, from: 0.05, to: 0.45 });
    g.restore();
    // Camera mounts: a bolt on the wall where each one hangs.
    for (const c of cams) art.bolt(g, L.ox + c.x * s, L.oy + c.y * s, Math.max(3, s * 0.16));
    const dw = 1.8 * s;
    g.fillStyle = PAL.brass;
    g.fillRect(L.ox + covers[0].x * s - dw / 2, L.oy + H * s - 5, dw, 10);
    g.fillStyle = PAL.steel;
    g.fillRect(L.ox + covers[hops].x * s - dw * 0.7, L.oy - 5, dw * 1.4, 10);
    art.ink(g, art.LINE);
    g.strokeRect(L.ox + covers[0].x * s - dw / 2, L.oy + H * s - 5, dw, 10);
    g.strokeRect(L.ox + covers[hops].x * s - dw * 0.7, L.oy - 5, dw * 1.4, 10);
  }

  function wedge(ctx, cx, cy, r, a0, a1) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, a0, a1);
    ctx.closePath();
  }

  function drawCrate(ctx, i) {
    const s = L.s;
    const c = covers[i];
    const w = s * 0.95;
    const cx = L.ox + c.x * s;
    const cy = L.oy + (c.y - 0.45) * s; // the crate sits just "above" the spot
    CRATE.fill = art.PAL.brass;
    art.panel(ctx, cx - w / 2, cy - w / 2, w, w, CRATE);
    art.ink(ctx, Math.max(1, art.LINE * 0.6));
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, cy - w / 2);
    ctx.lineTo(cx + w / 2, cy + w / 2);
    ctx.moveTo(cx + w / 2, cy - w / 2);
    ctx.lineTo(cx - w / 2, cy + w / 2);
    ctx.stroke();
  }

  function draw(ctx, rect, now) {
    relayout(rect);
    const PAL = art.PAL;
    const s = L.s;
    if (bg) ctx.drawImage(bg, L.x, L.y, L.w, L.h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(L.ox, L.oy, W * s, H * s);
    ctx.clip();

    // Cones first, under everything.
    for (let i = 0; i < n; i++) {
      const c = cams[i];
      const ang = camAngle(c, camT[i]);
      const cx = L.ox + c.x * s;
      const cy = L.oy + c.y * s;
      const hot = i === caughtBy;
      ctx.fillStyle = hot ? PAL.red : frozen[i] > 0 ? PAL.blue : PAL.amber;
      if (tier < 1) {
        // Soft: three faint layers; the real edge is somewhere in there.
        for (let l = 0; l < 3; l++) {
          const m = 0.7 + l * 0.3;
          ctx.globalAlpha = 0.14;
          wedge(ctx, cx, cy, c.range * s, ang - c.alpha * m, ang + c.alpha * m);
          ctx.fill();
        }
      } else {
        ctx.globalAlpha = hot ? 0.45 : 0.3;
        wedge(ctx, cx, cy, c.range * s, ang - c.alpha, ang + c.alpha);
        ctx.fill();
        ctx.globalAlpha = 0.9;
        art.ink(ctx, Math.max(1, art.LINE * 0.5));
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // The hop targets pulse, so a tablet player sees where to tap.
    if (phase === 'idle') {
      const pulse = 0.5 + 0.5 * Math.sin(time * 5);
      ctx.lineWidth = 2 + pulse * 2;
      for (let d = -1; d <= 1; d += 2) {
        const j = at + d;
        if (j < 0 || j > hops) continue;
        ctx.globalAlpha = d > 0 ? 0.6 + pulse * 0.4 : 0.35;
        ctx.strokeStyle = d > 0 ? PAL.mustard : PAL.cream;
        ctx.beginPath();
        ctx.arc(L.ox + covers[j].x * s, L.oy + covers[j].y * s, s * 0.55, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // The thief hides behind a crate when at one; otherwise crates go under.
    const hidden = phase === 'idle' && at > 0 && at < hops;
    const px = L.ox + x * s;
    const py = L.oy + y * s;
    if (!hidden) for (let i = 1; i < hops; i++) drawCrate(ctx, i);
    if (phase !== 'done') art.drawThiefTop(ctx, px, py, s * (hidden ? 0.75 : 0.85), face, now, phase === 'hop' || phase === 'dash' || phase === 'back');
    if (hidden) for (let i = 1; i < hops; i++) drawCrate(ctx, i);

    // Camera heads on top, turned to where they look.
    for (let i = 0; i < n; i++) {
      const c = cams[i];
      const cx = L.ox + c.x * s;
      const cy = L.oy + c.y * s;
      const bw = s * 0.55;
      const bh = s * 0.32;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(camAngle(c, camT[i]));
      ctx.fillStyle = PAL.steel;
      ctx.fillRect(-bw * 0.2, -bh / 2, bw, bh);
      art.ink(ctx, Math.max(1, art.LINE * 0.6));
      ctx.strokeRect(-bw * 0.2, -bh / 2, bw, bh);
      ctx.fillStyle = i === caughtBy ? PAL.red : PAL.ink;
      ctx.beginPath();
      ctx.arc(bw * 0.8, 0, bh * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      if (frozen[i] > 0) {
        // A strip of tape across it and a ring that runs down with the freeze.
        ctx.strokeStyle = PAL.blue;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, s * 0.5, -Math.PI / 2, -Math.PI / 2 + (frozen[i] / FREEZE) * Math.PI * 2);
        ctx.stroke();
      } else if (tapeLeft > 0) {
        ctx.globalAlpha = 0.5 + 0.3 * Math.sin(time * 4);
        ctx.strokeStyle = PAL.blue;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, s * 0.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    CAP.size = Math.max(11, s * 0.55);
    CAP.fill = PAL.green;
    CAP.stroke = PAL.ink;
    art.caption(ctx, L.ox + covers[hops].x * s, L.oy + 0.45 * s, t('trap.exit'), CAP);

    if (burst.age < burst.dur) {
      BURST.size = clamp(s * 1.5, 26, 56);
      BURST.fill = PAL[burst.fill];
      BURST.rot = 0.1;
      BURST.life = Math.min(1, burst.age / 0.1) * Math.min(1, (burst.dur - burst.age) / 0.3); // the puzzles' envelope
      art.burst(ctx, L.ox + clamp(burst.x, 2, W - 2) * s, L.oy + clamp(burst.y, 1, H - 1) * s, t(burst.key), BURST);
    }
  }

  // ---- input -----------------------------------------------------------------

  function pointerDown(p) {
    if (L.w < 0) return;
    const rx = (p.x - L.ox) / L.s;
    const ry = (p.y - L.oy) / L.s;
    // Tape first: a camera within reach of the tap.
    if (tapeLeft > 0 && phase !== 'done') {
      let best = -1;
      let bd = 1.0;
      for (let i = 0; i < n; i++) {
        const d = Math.hypot(cams[i].x - rx, cams[i].y - ry);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      if (freeze(best)) return;
    }
    // Then the nearer of the two neighbouring covers, generously.
    let target = -1;
    let bd = 1.8;
    for (let d = -1; d <= 1; d += 2) {
      const j = at + d;
      if (j < 0 || j > hops) continue;
      const dist = Math.hypot(covers[j].x - rx, covers[j].y - ry);
      if (dist < bd) {
        bd = dist;
        target = j;
      }
    }
    if (target >= 0) hop(target);
  }

  function key(e) {
    const k = e.key;
    if (k === 'f' || k === 'F') {
      if (tapeLeft <= 0) return false;
      // The camera that matters: nearest the middle of the next hop.
      const a = covers[at];
      const b = covers[Math.min(hops, at + 1)];
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      let best = -1;
      let bd = Infinity;
      for (let i = 0; i < n; i++) {
        const d = Math.hypot(cams[i].x - mx, cams[i].y - my);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      freeze(best);
      return true;
    }
    let dir = 0;
    if (k === 'ArrowUp' || k === 'w' || k === 'W' || k === ' ' || k === 'Enter') dir = 1;
    else if (k === 'ArrowDown' || k === 's' || k === 'S') dir = -1;
    else if (k === 'ArrowLeft' || k === 'a' || k === 'A' || k === 'ArrowRight' || k === 'd' || k === 'D') {
      // Sideways goes to whichever neighbour lies that way; forward if both do.
      const sx = k === 'ArrowLeft' || k === 'a' || k === 'A' ? -1 : 1;
      const next = covers[Math.min(hops, at + 1)];
      const prev = covers[Math.max(0, at - 1)];
      dir = (next.x - covers[at].x) * sx > 0.3 ? 1 : at > 0 && (prev.x - covers[at].x) * sx > 0.3 ? -1 : 1;
    } else return false;
    if (!e.repeat) hop(at + dir);
    return true;
  }

  function hint() {
    if (phase === 'caught' || phase === 'back' || (caughtCount > 0 && lock > 0)) return t('trap.cameras.hintCaught');
    if (tapeLeft > 0) return t('trap.cameras.hintTape');
    return t('trap.cameras.hint');
  }

  function forceSolve() {
    if (phase === 'dash' || phase === 'exit' || phase === 'done') return;
    if (phase === 'hop' || phase === 'caught' || phase === 'back') {
      // Settle on a cover first so the dash starts somewhere real.
      if (phase === 'hop') at = Math.min(at, to);
      x = covers[at].x;
      y = covers[at].y;
    }
    caughtBy = -1;
    if (at >= hops) {
      phase = 'exit';
      timer = 0;
      return;
    }
    to = at + 1;
    fromX = x;
    fromY = y;
    timer = 0;
    dur = Math.hypot(covers[to].x - x, covers[to].y - y) / (HOP_SPEED * 3);
    phase = 'dash';
  }

  function destroy() {
    bg = null;
  }

  // _room and _peek are for the throwaway solvability script only.
  return { update, draw, pointerDown, pointerMove: NOOP, pointerUp: NOOP, key, hint, forceSolve, destroy, _room: room, _peek: () => ({ phase, at }) };
}

function bake(prev, L, paint) {
  if (typeof document === 'undefined') return null;
  const c = prev || document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(L.w * L.dpr));
  c.height = Math.max(1, Math.ceil(L.h * L.dpr));
  const g = c.getContext('2d');
  g.setTransform(L.dpr, 0, 0, L.dpr, -L.x * L.dpr, -L.y * L.dpr);
  g.clearRect(L.x, L.y, L.w, L.h);
  paint(g);
  return c;
}
