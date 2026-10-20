/*
 * dial.js — the safe. A combination dial 0–99, cracked by ear.
 *
 * THE MECHANIC
 * The combination is 2–4 gate numbers, each approached in a fixed direction:
 * the first turning right (clockwise), the next left, and so on. While you
 * turn the right way for the number you are on, the dial gives a click
 * exactly as that gate's number comes under the red index. Stop there and
 * turn back: the turnaround is what sets the number, and the notepad writes
 * it down. When the last number is set the handle is tried. All right, and
 * the safe opens; any wrong, and the handle jams (a mistake, severity 1) and
 * the notepad is wiped back to number 1.
 *
 * Three details make it a skill and not a lottery:
 *   - Only the right direction clicks. Turning the wrong way past a gate is
 *     silent, so a player who knows the rule can hunt both ways.
 *   - Decoys. From difficulty 4 the wheel pack has worn spots (1–3 of them)
 *     that click too, in BOTH directions. That is the tell: wiggle across a
 *     click — a true gate goes quiet when you turn the wrong way, a decoy
 *     does not. The jam hint teaches this once there are decoys.
 *   - Precision. Low difficulty forgives landing two numbers off the gate;
 *     difficulty 10 wants it exact.
 * A turnaround only counts after a run of at least two numbers, so a jittery
 * finger does not set numbers by accident, and the notepad's ✕ (or
 * Backspace) clears it for free when you have lost the thread.
 *
 * DIFFICULTY (u = 0..1 over difficulty 1..10)
 *   numbers   2 (d1–3), 3 (d4–7), 4 (d8–10)
 *   tolerance ±2 at d1, ±1 mid, exact at d10
 *   decoys    0 at d1–3, 1 at d4–5, 2 at d6–8, 3 at d9–10
 *
 * TIERS (DESIGN.md §4, cumulative — each tier keeps the ones below)
 *   0 bare ear     the click is faint (strength 0.3) and the only thing you
 *                  see is a small pale "tik" by the index, decoys alike
 *   1 stethoscope  the click is loud, a KLIKK! word pops, and the dial
 *                  ripples — on a true gate only, so decoys give themselves
 *                  away by not rippling
 *   2 electronic   the bezel glows warm within 2 numbers of the current
 *                  gate and hot red exactly on it
 *   3 safe sense   every gate you have heard is pencilled on the notepad,
 *                  and stays there after a jam
 *
 * INPUT
 *   pointer   drag anywhere over the dial, round its centre; tap the notepad
 *             ✕ to clear
 *   keyboard  ← → (and ↓ ↑) turn one number, Shift for five; Backspace or
 *             Delete clears the notepad
 *
 * Coordinates: `pos` is the number under the index. Numbers increase
 * clockwise round the face, so turning the dial clockwise brings smaller
 * numbers to the top — CW is −1, as on a real safe.
 */

import * as art from '../art.js';
import { t, addStrings } from '../i18n.js';

addStrings({
  nb: {
    'pz.dial.right': 'høyre',
    'pz.dial.left': 'venstre',
    'pz.dial.turn': (i, d) => `Tall ${i}: vri mot ${d} til det klikker, og vri så tilbake.`,
    'pz.dial.turnTo': (i, d, g) => `Tall ${i}: vri mot ${d} til ${g}, og vri så tilbake.`,
    'pz.dial.jam': 'Feil tall! Begynn på nytt fra tall 1.',
    'pz.dial.jamDecoy': 'Feil! Et ekte klikk kommer bare når du vrir riktig vei.',
    'pz.dial.clear': 'Visk ut',
  },
  en: {
    'pz.dial.right': 'right',
    'pz.dial.left': 'left',
    'pz.dial.turn': (i, d) => `Number ${i}: turn ${d} until it clicks, then turn back.`,
    'pz.dial.turnTo': (i, d, g) => `Number ${i}: turn ${d} to ${g}, then turn back.`,
    'pz.dial.jam': 'Wrong numbers! Start again from number 1.',
    'pz.dial.jamDecoy': 'Wrong! A true click only comes when you turn the right way.',
    'pz.dial.clear': 'Clear',
  },
});

const CW = -1;
const CCW = 1;
const REV = 0.9; // numbers of travel the other way before a turnaround counts
const MIN_RUN = 2; // a run shorter than this does not set a number

// Built once: the face's tick directions and its labels.
const NUMS = [];
const SIN = new Float32Array(100);
const COS = new Float32Array(100);
for (let i = 0; i < 100; i++) {
  NUMS.push(String(i));
  SIN[i] = Math.sin((i / 100) * Math.PI * 2);
  COS[i] = Math.cos((i / 100) * Math.PI * 2);
}

const w100 = (v) => ((v % 100) + 100) % 100;
const cyc = (a, b) => {
  const d = Math.abs(w100(a) - w100(b));
  return Math.min(d, 100 - d);
};

export function createDial(kit) {
  const { tier, rng, C } = kit;
  const n = 2 + Math.round(kit.u * 2);
  const tol = Math.round((1 - kit.u) * 2);
  const decoyCount = Math.max(0, Math.round(kit.u * 3.4 - 0.4));

  /* The gates: well apart from each other and from the resting 0, so the
   * first click is never under your thumb before you have moved. */
  const gates = [];
  for (let tries = 0; gates.length < n && tries < 500; tries++) {
    const g = Math.floor(rng() * 100);
    if (cyc(g, 0) < 8) continue;
    if (gates.some((h) => cyc(g, h) < 12)) continue;
    gates.push(g);
  }
  while (gates.length < n) gates.push((gates.length * 31 + 17) % 100);
  const req = gates.map((_, i) => (i % 2 === 0 ? CW : CCW));

  // Always draw three decoy candidates so the rng stream is the same at any difficulty.
  const decoys = [];
  for (let tries = 0; decoys.length < 3 && tries < 500; tries++) {
    const g = Math.floor(rng() * 100);
    if (gates.some((h) => cyc(g, h) < 5) || decoys.some((h) => cyc(g, h) < 5)) continue;
    decoys.push(g);
  }
  decoys.length = Math.min(decoys.length, decoyCount);

  // Play state.
  let pos = 0; // number under the index, float
  let lastRound = 0; // the integer last announced
  let travel = 0; // unwrapped distance, for runs and turnarounds
  let runDir = 0;
  let runStart = 0;
  let extreme = 0;
  let k = 0; // which number we are setting
  const set = new Int16Array(n).fill(-1);
  const found = new Uint8Array(n); // tier 3: gates heard, kept across jams
  let jammed = 0; // seconds of "wrong numbers" left in the hint and on the notepad

  // Feedback timers, all counting down in update().
  let ripple = 0;
  let faint = 0;
  let openT = 0; // 0..1 the handle swinging round once open
  let wiggle = 0; // the handle rattling on a jam

  const TICK = { rate: 1 };
  const CLICK = { strength: 1 };

  // Layout, recomputed only when the rect changes.
  const L = { x: -1, y: 0, w: 0, h: 0, s: 0, cx: 0, cy: 0, R: 0, lw: 0, nx: 0, ny: 0, nw: 0, nh: 0, slotW: 0, hx: 0, hy: 0, hasHandle: false };
  const PANEL = { fill: '', r: 0 };
  const METAL = { r: 0, tone: 'dark' };
  const CAP = { size: 0, align: 'center', fill: '', stroke: '' };
  const HALF = { color: '', spacing: 0, angle: 0.6, from: 0, to: 0.55 };

  function layout(rect) {
    if (rect.x === L.x && rect.y === L.y && rect.w === L.w && rect.h === L.h) return;
    L.x = rect.x;
    L.y = rect.y;
    L.w = rect.w;
    L.h = rect.h;
    L.s = Math.min(rect.w, rect.h);
    L.lw = kit.line(L.s);
    const nh = rect.h * 0.2;
    const top = rect.h - nh;
    L.R = Math.min(rect.w * 0.36, top * 0.4);
    L.cx = rect.x + rect.w / 2;
    L.cy = rect.y + top / 2 + top * 0.04;
    L.nx = rect.x + rect.w * 0.08;
    L.nw = rect.w * 0.84;
    L.ny = rect.y + top + nh * 0.08;
    L.nh = nh * 0.78;
    L.slotW = (L.nw - L.nh) / n;
    L.hasHandle = rect.w / 2 - L.R * 1.2 > L.R * 0.45;
    L.hx = L.cx + L.R * 1.42;
    L.hy = L.cy + L.R * 0.55;
  }

  /* ---------------------------------------------------------------- turning */

  function turn(d) {
    if (kit.locked()) return;
    // Half-number steps, so no number is ever skipped however fast the drag.
    while (Math.abs(d) > 1e-6 && !kit.done) {
      const step = Math.max(-0.5, Math.min(0.5, d));
      d -= step;
      stepTurn(step);
    }
  }

  function stepTurn(s) {
    const dir = s > 0 ? CCW : CW;
    travel += s;
    pos = w100(pos + s);

    if (runDir === 0) {
      runDir = dir;
      runStart = travel - s;
      extreme = travel;
    } else if (dir === runDir) {
      if ((travel - extreme) * dir > 0) extreme = travel;
    } else if (Math.abs(travel - extreme) >= REV) {
      // A turnaround: the number we stopped on is where the run peaked.
      const at = w100(Math.round(w100(pos - (travel - extreme))));
      turnaround(runDir, Math.abs(extreme - runStart), at);
      runDir = dir;
      runStart = extreme;
      extreme = travel;
      if (kit.done) return;
    }

    const r = w100(Math.round(pos));
    if (r !== lastRound) {
      lastRound = r;
      onNumber(r, dir);
    }
  }

  function onNumber(r, dir) {
    TICK.rate = 0.9 + ((r % 10) / 10) * 0.2;
    kit.sfx('tick', TICK);
    if (k < n && r === gates[k] && dir === req[k]) {
      found[k] = 1;
      click(true);
    } else if (decoys.indexOf(r) >= 0) {
      click(false);
    }
  }

  function click(real) {
    CLICK.strength = tier >= 1 ? 1 : 0.3;
    kit.sfx('click', CLICK);
    if (tier === 0) {
      faint = 1;
    } else if (real) {
      ripple = 1;
      kit.burst(0.5 + 0.18, 0.1, 'pz.burst.click', C.cream, 0.11, 0.6);
    } else {
      faint = 1; // loud, but no ripple: the stethoscope hears it is hollow
    }
  }

  function turnaround(prevDir, runLen, at) {
    if (k >= n || prevDir !== req[k] || runLen < MIN_RUN) return;
    set[k] = at;
    k++;
    jammed = 0;
    kit.sfx('pin');
    kit.progress((k / n) * 0.9);
    if (k === n) tryHandle();
  }

  function tryHandle() {
    let ok = true;
    for (let i = 0; i < n; i++) if (cyc(set[i], gates[i]) > tol) ok = false;
    if (ok) {
      openT = 0.0001;
      kit.sfx('chime');
      kit.solve();
      return;
    }
    kit.sfx('buzz');
    kit.burst(0.5, 0.36, 'pz.burst.jam', C.red, 0.17);
    kit.mistake(1);
    jammed = 3.5;
    wiggle = 1;
    clear(false);
  }

  function clear(byHand) {
    k = 0;
    set.fill(-1);
    runDir = 0;
    if (byHand) {
      jammed = 0;
      kit.sfx('ui');
    }
    kit.progress(0);
  }

  /* ----------------------------------------------------------------- update */

  function update(dt) {
    kit.update(dt);
    if (ripple > 0) ripple = Math.max(0, ripple - dt * 2.2);
    if (faint > 0) faint = Math.max(0, faint - dt * 3);
    if (jammed > 0) jammed = Math.max(0, jammed - dt);
    if (wiggle > 0) wiggle = Math.max(0, wiggle - dt * 2.5);
    if (openT > 0 && openT < 1) openT = Math.min(1, openT + dt * 1.8);
    if (kit.forcing) {
      // The drill: the dial whirls, then the handle swings.
      pos = w100(pos - dt * 160 * (1 - kit.forceT * 0.7));
      if (kit.forceT > 0.6 && openT === 0) openT = 0.0001;
    }
  }

  /* ------------------------------------------------------------------- draw */

  function draw(ctx, rect, now) {
    layout(rect);
    const { cx, cy, R, lw, s } = L;
    ctx.save();
    ctx.translate(kit.shakeX(s), 0);

    // Tier 2: the warm/hot glow round the bezel, for the current gate only.
    if (tier >= 2 && k < n && !kit.done) {
      const d = cyc(pos, gates[k]);
      if (d <= 2.5) {
        const hot = w100(Math.round(pos)) === gates[k];
        ctx.globalAlpha = hot ? 0.85 : 0.25 + (2.5 - d) * 0.15;
        ctx.fillStyle = hot ? C.red : C.amber;
        ctx.beginPath();
        ctx.arc(cx, cy, R * 1.26, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // The bezel: a fixed steel ring.
    ctx.fillStyle = C.steelDark;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.12, 0, Math.PI * 2);
    ctx.fill();
    art.ink(ctx, lw);
    ctx.stroke();

    // Which way to turn now: an arrow along the top of the bezel.
    if (k < n && !kit.locked()) drawTurnArrow(ctx, cx, cy - R * 0.02, R * 1.2, req[k], lw, now);

    // The face, rotated so `pos` sits under the index.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((-pos / 100) * Math.PI * 2);
    METAL.r = R;
    METAL.tone = 'dark';
    art.metal(ctx, -R, -R, R * 2, R * 2, METAL);

    // Ticks: minor in one path, every tenth heavier in another.
    ctx.strokeStyle = C.cream;
    ctx.lineWidth = Math.max(1, lw * 0.35);
    ctx.beginPath();
    for (let i = 0; i < 100; i++) {
      if (i % 10 === 0) continue;
      const r1 = i % 5 === 0 ? R * 0.8 : R * 0.86;
      ctx.moveTo(SIN[i] * r1, -COS[i] * r1);
      ctx.lineTo(SIN[i] * R * 0.95, -COS[i] * R * 0.95);
    }
    ctx.stroke();
    ctx.lineWidth = Math.max(1.5, lw * 0.7);
    ctx.beginPath();
    for (let i = 0; i < 100; i += 10) {
      ctx.moveTo(SIN[i] * R * 0.76, -COS[i] * R * 0.76);
      ctx.lineTo(SIN[i] * R * 0.95, -COS[i] * R * 0.95);
    }
    ctx.stroke();
    CAP.size = Math.max(11, R * 0.15);
    CAP.align = 'center';
    CAP.fill = C.cream;
    CAP.stroke = C.ink;
    for (let i = 0; i < 100; i += 10) {
      ctx.save();
      ctx.rotate((i / 100) * Math.PI * 2);
      art.caption(ctx, 0, -R * 0.62, NUMS[i], CAP);
      ctx.restore();
    }

    // The knob, with grip ridges that turn with it.
    METAL.r = R * 0.34;
    METAL.tone = 'brass';
    art.metal(ctx, -R * 0.34, -R * 0.34, R * 0.68, R * 0.68, METAL);
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.34, 0, Math.PI * 2);
    art.ink(ctx, lw);
    ctx.stroke();
    ctx.lineWidth = Math.max(1, lw * 0.5);
    ctx.beginPath();
    for (let i = 0; i < 100; i += 5) {
      ctx.moveTo(SIN[i] * R * 0.22, -COS[i] * R * 0.22);
      ctx.lineTo(SIN[i] * R * 0.32, -COS[i] * R * 0.32);
    }
    ctx.stroke();
    ctx.restore();

    // Face outline and a halftone shadow over its lower half.
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();
    HALF.color = C.ink;
    HALF.spacing = Math.max(4, R * 0.07);
    art.halftone(ctx, cx - R, cy, R * 2, R, HALF);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    art.ink(ctx, lw);
    ctx.stroke();

    // Tier 1: the ripple, a ring running out from the face.
    if (ripple > 0) {
      ctx.globalAlpha = ripple;
      ctx.strokeStyle = C.cream;
      ctx.lineWidth = lw * (0.6 + ripple);
      ctx.beginPath();
      ctx.arc(cx, cy, R * (1.02 + (1 - ripple) * 0.35), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // The index: a red pointer over the top of the face.
    const iy = cy - R * 1.04;
    ctx.fillStyle = C.red;
    ctx.beginPath();
    ctx.moveTo(cx - R * 0.09, iy - R * 0.12);
    ctx.lineTo(cx + R * 0.09, iy - R * 0.12);
    ctx.lineTo(cx, iy + R * 0.06);
    ctx.closePath();
    ctx.fill();
    art.ink(ctx, lw * 0.8);
    ctx.stroke();

    // Tier 0's only sign: a pale little "tik" by the index.
    if (faint > 0) {
      ctx.globalAlpha = faint * 0.6;
      CAP.size = Math.max(10, R * 0.13);
      CAP.fill = C.cream;
      CAP.stroke = C.ink;
      art.caption(ctx, cx + R * 0.32, iy - R * 0.06, t('pz.burst.tick'), CAP);
      ctx.globalAlpha = 1;
    }

    if (L.hasHandle) drawHandle(ctx, now);
    drawNotepad(ctx);
    ctx.restore();
    kit.drawBursts(ctx, rect);
  }

  /** A curved arrow along the bezel top, pointing the way to turn. */
  function drawTurnArrow(ctx, x, y, r, dir, lw, now) {
    const a0 = -Math.PI / 2 - 0.45;
    const a1 = -Math.PI / 2 + 0.45;
    const nudge = Math.sin(now * 4) * 0.04 * (dir === CW ? 1 : -1);
    ctx.strokeStyle = C.mustard;
    ctx.lineWidth = lw * 1.1;
    ctx.beginPath();
    ctx.arc(x, y, r, a0 + nudge, a1 + nudge);
    ctx.stroke();
    // Arrowhead at the end we are heading for: clockwise is the right-hand end.
    const ah = dir === CW ? a1 + nudge : a0 + nudge;
    const hx = x + Math.cos(ah) * r;
    const hy = y + Math.sin(ah) * r;
    const tx = -Math.sin(ah) * (dir === CW ? 1 : -1); // tangent, direction of travel
    const ty = Math.cos(ah) * (dir === CW ? 1 : -1);
    const hs = r * 0.09;
    ctx.fillStyle = C.mustard;
    ctx.beginPath();
    ctx.moveTo(hx + tx * hs, hy + ty * hs);
    ctx.lineTo(hx - tx * hs * 0.4 - ty * hs * 0.8, hy - ty * hs * 0.4 + tx * hs * 0.8);
    ctx.lineTo(hx - tx * hs * 0.4 + ty * hs * 0.8, hy - ty * hs * 0.4 - tx * hs * 0.8);
    ctx.closePath();
    ctx.fill();
    art.ink(ctx, lw * 0.6);
    ctx.stroke();
  }

  /** The safe handle: three spokes that swing a quarter turn on open, rattle on a jam. */
  function drawHandle(ctx, now) {
    const r = L.R * 0.32;
    const ang = openT * (Math.PI / 2) + Math.sin(now * 50) * wiggle * 0.12;
    ctx.save();
    ctx.translate(L.hx, L.hy);
    ctx.rotate(ang);
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = L.lw * 2.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.stroke();
    ctx.strokeStyle = C.steel;
    ctx.lineWidth = L.lw * 1.3;
    ctx.stroke();
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      art.bolt(ctx, Math.cos(a) * r, Math.sin(a) * r, r * 0.2);
    }
    art.bolt(ctx, 0, 0, r * 0.3);
    ctx.restore();
  }

  /** The notepad: one slot per number with its direction, and a clear button. */
  function drawNotepad(ctx) {
    PANEL.fill = jammed > 0 && Math.floor(jammed * 6) % 2 === 0 ? C.red : C.paper;
    PANEL.r = L.nh * 0.15;
    art.panel(ctx, L.nx, L.ny, L.nw, L.nh, PANEL);
    const midY = L.ny + L.nh / 2;
    CAP.size = Math.max(13, L.nh * 0.46);
    CAP.align = 'center';
    for (let i = 0; i < n; i++) {
      const sx = L.nx + L.slotW * i;
      const mx = sx + L.slotW * 0.6;
      // A small turn arrow for the slot's direction.
      drawMiniArrow(ctx, sx + L.slotW * 0.17, midY, L.nh * 0.17, req[i]);
      if (set[i] >= 0) {
        CAP.fill = C.ink;
        CAP.stroke = C.paper;
        art.caption(ctx, mx, midY, NUMS[set[i]], CAP);
      } else if (tier >= 3 && found[i]) {
        // Safe sense: the gate pencilled in, lighter than a set number.
        ctx.globalAlpha = 0.55;
        CAP.fill = C.steelDark;
        CAP.stroke = C.paper;
        art.caption(ctx, mx, midY, NUMS[gates[i]], CAP);
        ctx.globalAlpha = 1;
      }
      // The underline: mustard and thick under the number being worked on.
      ctx.strokeStyle = i === k && !kit.done ? C.mustard : C.ink;
      ctx.lineWidth = i === k && !kit.done ? L.lw * 1.4 : L.lw * 0.5;
      ctx.beginPath();
      ctx.moveTo(mx - L.slotW * 0.28, L.ny + L.nh * 0.84);
      ctx.lineTo(mx + L.slotW * 0.28, L.ny + L.nh * 0.84);
      ctx.stroke();
    }
    // The clear button, a ✕ in its own box at the right end.
    const bx = L.nx + L.nw - L.nh;
    ctx.globalAlpha = k > 0 && !kit.locked() ? 1 : 0.3;
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = L.lw * 0.6;
    ctx.beginPath();
    ctx.moveTo(bx, L.ny + L.nh * 0.15);
    ctx.lineTo(bx, L.ny + L.nh * 0.85);
    ctx.stroke();
    const c = L.nh * 0.18;
    const ccx = bx + L.nh / 2;
    ctx.strokeStyle = C.red;
    ctx.lineWidth = L.lw * 1.2;
    ctx.beginPath();
    ctx.moveTo(ccx - c, midY - c);
    ctx.lineTo(ccx + c, midY + c);
    ctx.moveTo(ccx + c, midY - c);
    ctx.lineTo(ccx - c, midY + c);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawMiniArrow(ctx, x, y, r, dir) {
    ctx.strokeStyle = C.navy;
    ctx.lineWidth = Math.max(1.5, L.lw * 0.6);
    ctx.beginPath();
    ctx.arc(x, y, r, -Math.PI * 0.9, Math.PI * 0.4);
    ctx.stroke();
    // Clockwise ends at the bottom-right end of the arc; anticlockwise at its start.
    const a = dir === CW ? Math.PI * 0.4 : -Math.PI * 0.9;
    const hx = x + Math.cos(a) * r;
    const hy = y + Math.sin(a) * r;
    const sgn = dir === CW ? 1 : -1;
    const tx = -Math.sin(a) * sgn;
    const ty = Math.cos(a) * sgn;
    const hs = r * 0.7;
    ctx.fillStyle = C.navy;
    ctx.beginPath();
    ctx.moveTo(hx + tx * hs, hy + ty * hs);
    ctx.lineTo(hx - ty * hs * 0.6, hy + tx * hs * 0.6);
    ctx.lineTo(hx + ty * hs * 0.6, hy - tx * hs * 0.6);
    ctx.closePath();
    ctx.fill();
  }

  /* ------------------------------------------------------------------ input */

  let grab = null; // pointer id while dragging
  let lastAng = 0;

  function inNotepadClear(p) {
    const bx = L.nx + L.nw - L.nh;
    return p.x >= bx - L.nh * 0.2 && p.x <= L.nx + L.nw + 8 && p.y >= L.ny - 8 && p.y <= L.ny + L.nh + 8;
  }

  function pointerDown(p) {
    if (L.x < 0 || kit.locked() || grab !== null) return;
    if (inNotepadClear(p)) {
      if (k > 0) clear(true);
      return;
    }
    if (p.y > L.ny - 4) return;
    grab = p.id;
    lastAng = Math.atan2(p.y - L.cy, p.x - L.cx);
  }

  function pointerMove(p) {
    if (grab === null || p.id !== grab) return;
    const dx = p.x - L.cx;
    const dy = p.y - L.cy;
    const a = Math.atan2(dy, dx);
    let da = a - lastAng;
    if (da > Math.PI) da -= Math.PI * 2;
    if (da < -Math.PI) da += Math.PI * 2;
    lastAng = a;
    // Near the centre the angle swings wildly for a tiny move: ignore it there.
    if (dx * dx + dy * dy < L.R * L.R * 0.02) return;
    // Screen angle grows clockwise; turning clockwise lowers the number.
    turn((-da / (Math.PI * 2)) * 100);
  }

  function pointerUp(p) {
    if (p.id === grab) grab = null;
  }

  function key(e) {
    if (kit.locked()) return false;
    const step = e.shiftKey ? 5 : 1;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        // Measured from the nearest whole number, so a key turn after a
        // drag still lands exactly on a number.
        turn(Math.round(pos) - step - pos);
        return true;
      case 'ArrowLeft':
      case 'ArrowDown':
        turn(Math.round(pos) + step - pos);
        return true;
      case 'Backspace':
      case 'Delete':
        if (k > 0) clear(true);
        return true;
      default:
        return false;
    }
  }

  function hint() {
    if (kit.done || kit.forcing) return t('pz.open');
    if (jammed > 0) return t(decoys.length > 0 ? 'pz.dial.jamDecoy' : 'pz.dial.jam');
    const dir = t(req[k] === CW ? 'pz.dial.right' : 'pz.dial.left');
    if (tier >= 3 && found[k]) return t('pz.dial.turnTo', k + 1, dir, gates[k]);
    return t('pz.dial.turn', k + 1, dir);
  }

  return {
    update,
    draw,
    pointerDown,
    pointerMove,
    pointerUp,
    key,
    hint,
    forceSolve() {
      kit.force();
    },
    destroy() {
      grab = null;
    },
  };
}
