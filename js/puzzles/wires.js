/*
 * wires.js — the alarm box: trace the tangle, cut the right wire.
 *
 * THE MECHANIC
 * 3–7 wires run from numbered terminals on the left to lettered terminals on
 * the right, crossing on the way. The display at the top lights one letter
 * at a time; cut the wire that ENDS at that letter. Cutting happens at the
 * numbered end only, so the job is always the same: start at the lit
 * letter, follow its wire back through the tangle, and cut it at its number.
 * A right cut goes KNIPS and the next letter lights; a wrong one goes ZAPP —
 * a mistake of severity 2, the biggest in the game — and the wire stays
 * whole. Cut every wire and the alarm is off.
 *
 * Cutting is two taps on purpose: the first tap on a number opens the
 * cutters round that wire, the second closes them. A wrong cut costs double
 * time, so it must never come from a finger landing on the wrong plate.
 *
 * DIFFICULTY (u = 0..1 over difficulty 1..10)
 *   wires      3 at d1 → 7 at d10
 *   bends      each wire bends through 1 (d1–2) → 3 (d9–10) waypoints
 *   bundling   0 → 0.55: at the top the wires are squeezed through the
 *              middle of the box, so they bunch up where they cross
 *   colours    without the tier-2 tool, wires share 4 colours at d1 down to
 *              2 at d10, so colour alone cannot tell them apart
 *
 * TIERS (DESIGN.md §4, cumulative)
 *   0 nothing      trace by eye
 *   1 tester       tapping a terminal — a number or a letter — lights its
 *                  whole wire for 1.4 s. On a number that same tap also opens
 *                  the cutters, so test-then-cut is tap, look, tap
 *   2 colour-coded every wire its own colour (7 distinct)
 *   3 trace scope  the wire to cut next pulses
 *
 * INPUT
 *   pointer   tap a number to open the cutters, tap it again to cut;
 *             tap a letter to test it (tier 1+)
 *   keyboard  1–7 opens the cutters on that wire (again, or Enter / Space,
 *             cuts); ↑ ↓ move the open cutters; A–G tests a letter (tier 1+)
 */

import * as art from '../art.js';
import { t, addStrings } from '../i18n.js';

addStrings({
  nb: {
    'pz.wires.cut': (l) => `Klipp ledningen som ender i ${l}.`,
    'pz.wires.cutTest': (l) => `Klipp ledningen som ender i ${l}. Trykk på ${l} for å lyse den opp.`,
    'pz.wires.armed': (n) => `Trykk på ${n} en gang til for å klippe.`,
    'pz.wires.zap': 'Au! Feil ledning. Følg den fra bokstaven tilbake til tallet.',
    'pz.burst.alarmOff': 'ALARMEN AV!',
  },
  en: {
    'pz.wires.cut': (l) => `Cut the wire that ends at ${l}.`,
    'pz.wires.cutTest': (l) => `Cut the wire that ends at ${l}. Tap ${l} to light it up.`,
    'pz.wires.armed': (n) => `Tap ${n} again to cut.`,
    'pz.wires.zap': 'Ouch! Wrong wire. Follow it from the letter back to its number.',
    'pz.burst.alarmOff': 'ALARM OFF!',
  },
});

const NUMS = ['1', '2', '3', '4', '5', '6', '7'];
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
const S = 44; // samples per wire
const GAP0 = 2; // the cut: samples GAP0..GAP1 are left out
const GAP1 = 4;
const TEST_TIME = 1.4;

export function createWires(kit) {
  const { tier, rng, C } = kit;
  const n = 3 + Math.round(kit.u * 4);
  const m = 1 + Math.round(kit.u * 2);
  const bundle = kit.lerp(0, 0.55);
  const shared = 4 - Math.round(kit.u * 2);

  const ends = kit.shuffle(Array.from({ length: n }, (_, i) => i)); // wire i ends at letter ends[i]
  const wp = new Float32Array(n * m); // waypoint heights, 0..1 of the wire area
  for (let i = 0; i < n * m; i++) wp[i] = rng() * (1 - bundle) + 0.5 * bundle;
  const sequence = kit.shuffle(Array.from({ length: n }, (_, i) => i)); // letters, in lighting order

  // Colours: always draw both schemes so the rng stream ignores the tier.
  const DISTINCT = [C.red, C.blue, C.green, C.mustard, C.cream, C.steel, C.brass];
  const distinct = kit.shuffle([0, 1, 2, 3, 4, 5, 6]);
  const colour = new Array(n);
  for (let i = 0; i < n; i++) {
    const s = Math.floor(rng() * shared);
    colour[i] = tier >= 2 ? DISTINCT[distinct[i]] : DISTINCT[s];
  }

  const wireTo = new Int8Array(n); // letter → wire
  for (let i = 0; i < n; i++) wireTo[ends[i]] = i;

  const cut = new Uint8Array(n);
  const testT = new Float32Array(n);
  const spark = new Float32Array(n);
  let step = 0; // index into sequence
  let armed = -1; // wire whose cutters are open
  let zapped = 0;

  const nextWire = () => (step < n ? wireTo[sequence[step]] : -1);

  /* -------------------------------------------------------------- the rules */

  function arm(i) {
    if (cut[i]) return;
    armed = i;
    kit.sfx('ui');
    if (tier >= 1) testT[i] = TEST_TIME;
  }

  function test(letter) {
    if (tier < 1) return;
    testT[wireTo[letter]] = TEST_TIME;
    kit.sfx('beep');
  }

  function snip(i) {
    armed = -1;
    if (cut[i]) return;
    const fy = L.w > 0 ? (rowY(i) - L.y) / L.h : 0.5;
    if (i === nextWire()) {
      cut[i] = 1;
      spark[i] = 0.5;
      step++;
      zapped = 0;
      kit.sfx('snip');
      kit.burst(0.24, fy, 'pz.burst.snip', C.cream, 0.11, 0.6);
      kit.progress(step / n);
      if (step === n) {
        kit.sfx('chime');
        kit.burst(0.5, 0.5, 'pz.burst.alarmOff', C.green, 0.2, 1.1);
        kit.solve();
      }
      return;
    }
    spark[i] = 1;
    zapped = 2.5;
    kit.sfx('buzz');
    kit.burst(0.26, fy, 'pz.burst.zap', C.mustard, 0.15);
    kit.mistake(2);
  }

  function update(dt) {
    kit.update(dt);
    for (let i = 0; i < n; i++) {
      if (testT[i] > 0) testT[i] = Math.max(0, testT[i] - dt);
      if (spark[i] > 0) spark[i] = Math.max(0, spark[i] - dt * 1.6);
    }
    if (zapped > 0) zapped = Math.max(0, zapped - dt);
    if (kit.forcing) {
      // The drill: the wires snip themselves, in order.
      while (step < n && kit.forceT > (step + 1) / (n + 1)) {
        const w = nextWire();
        cut[w] = 1;
        spark[w] = 0.5;
        step++;
        kit.sfx('snip');
      }
    }
  }

  /* ----------------------------------------------------------------- layout */

  const pts = new Float32Array(n * S * 2);
  const L = { x: -1, y: 0, w: 0, h: 0, s: 0, lw: 0, ww: 0, top: 0, bot: 0, rowH: 0, lx: 0, rx: 0, x0: 0, x1: 0, pw: 0, ph: 0, dy: 0, dh: 0 };
  const rowY = (j) => L.top + (j + 0.5) * L.rowH;

  function layout(rect) {
    if (rect.x === L.x && rect.y === L.y && rect.w === L.w && rect.h === L.h) return;
    L.x = rect.x;
    L.y = rect.y;
    L.w = rect.w;
    L.h = rect.h;
    L.s = Math.min(rect.w, rect.h);
    L.lw = kit.line(L.s);
    L.dy = rect.y + rect.h * 0.03;
    L.dh = rect.h * 0.15;
    L.top = rect.y + rect.h * 0.22;
    L.bot = rect.y + rect.h * 0.98;
    L.rowH = (L.bot - L.top) / n;
    L.pw = Math.max(26, rect.w * 0.11);
    L.ph = Math.min(L.rowH * 0.74, L.pw * 0.9);
    L.lx = rect.x + L.pw / 2 + rect.w * 0.01;
    L.rx = rect.x + rect.w - L.pw / 2 - rect.w * 0.01;
    L.x0 = L.lx + L.pw / 2;
    L.x1 = L.rx - L.pw / 2;
    L.ww = Math.max(3, Math.min(L.rowH * 0.14, L.s * 0.022));
    for (let i = 0; i < n; i++) buildWire(i);
  }

  /* One wire as a Catmull-Rom curve through its waypoints, sampled into pts.
   * Phantom points beyond each end make it leave and arrive horizontally. */
  const cpX = new Float32Array(8);
  const cpY = new Float32Array(8);
  function buildWire(i) {
    const cnt = m + 2;
    const span = L.x1 - L.x0;
    const area = L.bot - L.top;
    cpX[1] = L.x0;
    cpY[1] = rowY(i);
    for (let j = 0; j < m; j++) {
      cpX[2 + j] = L.x0 + span * (0.18 + (0.64 * (j + 0.5)) / m);
      cpY[2 + j] = L.top + area * (0.06 + wp[i * m + j] * 0.88);
    }
    cpX[cnt] = L.x1;
    cpY[cnt] = rowY(ends[i]);
    cpX[0] = cpX[1] - span * 0.2;
    cpY[0] = cpY[1];
    cpX[cnt + 1] = cpX[cnt] + span * 0.2;
    cpY[cnt + 1] = cpY[cnt];
    const segs = cnt - 1;
    const base = i * S * 2;
    for (let k = 0; k < S; k++) {
      const f = (k / (S - 1)) * segs;
      const sgi = Math.min(segs - 1, Math.floor(f));
      const tt = f - sgi;
      const a = sgi;
      pts[base + k * 2] = cr(cpX[a], cpX[a + 1], cpX[a + 2], cpX[a + 3], tt);
      pts[base + k * 2 + 1] = cr(cpY[a], cpY[a + 1], cpY[a + 2], cpY[a + 3], tt);
    }
  }

  function cr(p0, p1, p2, p3, tt) {
    const t2 = tt * tt;
    const t3 = t2 * tt;
    return 0.5 * (2 * p1 + (-p0 + p2) * tt + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }

  /* ------------------------------------------------------------------- draw */

  const PANEL = { fill: '', r: 0 };
  const METAL = { r: 0, tone: 'dark' };
  const CAP = { size: 0, align: 'center', fill: '', stroke: '' };
  const HALF = { color: '', spacing: 0, angle: 0.6, from: 0, to: 0.45 };

  function draw(ctx, rect, now) {
    layout(rect);
    const { lw, ww } = L;
    ctx.save();
    ctx.translate(kit.shakeX(L.s), 0);

    // The box: a dark steel backplate, shaded toward the bottom.
    METAL.r = L.s * 0.03;
    art.metal(ctx, rect.x, L.top - L.rowH * 0.15, rect.w, L.bot - L.top + L.rowH * 0.15, METAL);
    HALF.color = C.ink;
    HALF.spacing = Math.max(4, L.s * 0.025);
    art.halftone(ctx, rect.x, (L.top + L.bot) / 2, rect.w, (L.bot - L.top) / 2, HALF);

    drawDisplay(ctx, now);

    // Glows first (testers, trace scope), so every wire draws over them.
    const next = nextWire();
    for (let i = 0; i < n; i++) {
      let g = 0;
      if (testT[i] > 0) g = Math.min(1, testT[i] / 0.3);
      if (tier >= 3 && i === next && !kit.locked()) g = Math.max(g, 0.45 + 0.45 * Math.sin(now * 6));
      if (g <= 0 || cut[i]) continue;
      ctx.globalAlpha = g * 0.75;
      ctx.strokeStyle = C.cream;
      ctx.lineWidth = ww * 3.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      strokeWire(ctx, i, 0, S - 1);
      ctx.globalAlpha = 1;
    }
    // Wires: an ink outline under a colour core. Cut ones in two pieces.
    for (let i = 0; i < n; i++) {
      const pulse = tier >= 3 && i === next && !kit.locked() ? 1 + 0.3 * Math.sin(now * 6) : 1;
      for (let pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = pass ? colour[i] : C.ink;
        ctx.lineWidth = pass ? ww * pulse : ww * pulse + lw * 1.6;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (cut[i]) {
          strokeWire(ctx, i, 0, GAP0);
          strokeWire(ctx, i, GAP1, S - 1);
        } else {
          strokeWire(ctx, i, 0, S - 1);
        }
      }
    }

    // Terminals: number plates left, letter plates right.
    CAP.size = Math.max(12, L.ph * 0.56);
    CAP.align = 'center';
    CAP.stroke = C.ink;
    const lit = step < n ? sequence[step] : -1;
    for (let j = 0; j < n; j++) {
      const y = rowY(j);
      PANEL.fill = armed === j ? C.mustard : cut[j] ? C.steelDark : C.steel;
      PANEL.r = L.ph * 0.2;
      art.panel(ctx, L.lx - L.pw / 2, y - L.ph / 2, L.pw, L.ph, PANEL);
      CAP.fill = C.paper;
      art.caption(ctx, L.lx, y, NUMS[j], CAP);
      PANEL.fill = j === lit ? C.red : C.steel;
      art.panel(ctx, L.rx - L.pw / 2, y - L.ph / 2, L.pw, L.ph, PANEL);
      art.caption(ctx, L.rx, y, LETTERS[j], CAP);
      if (spark[j] > 0) drawSpark(ctx, L.x0 + L.lw * 3, y, spark[j]);
    }
    if (armed >= 0) drawCutters(ctx, armed, now);

    ctx.restore();
    kit.drawBursts(ctx, rect);
  }

  function strokeWire(ctx, i, a, b) {
    const base = i * S * 2;
    ctx.beginPath();
    ctx.moveTo(pts[base + a * 2], pts[base + a * 2 + 1]);
    for (let k = a + 1; k <= b; k++) ctx.lineTo(pts[base + k * 2], pts[base + k * 2 + 1]);
    ctx.stroke();
  }

  /** The display: one lamp per letter; the one to cut now blinks red, cut ones go green. */
  function drawDisplay(ctx, now) {
    const { lw } = L;
    const dw = Math.min(L.w * 0.8, n * L.dh * 1.1);
    const dx = L.x + (L.w - dw) / 2;
    PANEL.fill = C.night;
    PANEL.r = L.dh * 0.2;
    art.panel(ctx, dx, L.dy, dw, L.dh, PANEL);
    const cell = dw / n;
    const r = Math.min(cell * 0.4, L.dh * 0.36);
    CAP.size = Math.max(11, r * 1.05);
    CAP.align = 'center';
    CAP.stroke = C.ink;
    for (let j = 0; j < n; j++) {
      const letter = j; // lamps in alphabetical order, so they read like the plates
      const cx = dx + cell * (j + 0.5);
      const cy = L.dy + L.dh / 2;
      const done = cut[wireTo[letter]] === 1;
      const now_ = step < n && sequence[step] === letter;
      const on = now_ && (kit.locked() || Math.floor(now * 3) % 3 !== 0);
      ctx.fillStyle = done ? C.green : on ? C.red : C.navy;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      art.ink(ctx, lw * 0.6);
      ctx.stroke();
      CAP.fill = on || done ? C.paper : C.steelDark;
      art.caption(ctx, cx, cy, LETTERS[letter], CAP);
    }
  }

  /** Open cutter blades either side of the armed wire, just off its plate. */
  function drawCutters(ctx, i, now) {
    const x = L.x0 + L.lw * 3;
    const y = rowY(i);
    const a = L.ph * 0.55;
    const open = 0.35 + Math.sin(now * 8) * 0.08;
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass ? C.red : C.ink;
      ctx.lineWidth = pass ? L.lw * 1.2 : L.lw * 2.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x - a * 0.4, y - a);
      ctx.lineTo(x + a * open, y + a * 0.15);
      ctx.moveTo(x - a * 0.4, y + a);
      ctx.lineTo(x + a * open, y - a * 0.15);
      ctx.stroke();
    }
  }

  function drawSpark(ctx, x, y, f) {
    const r = L.ph * (0.4 + (1 - f) * 0.5);
    ctx.globalAlpha = Math.min(1, f * 1.5);
    ctx.strokeStyle = C.mustard;
    ctx.lineWidth = L.lw;
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + 0.3;
      ctx.moveTo(x + Math.cos(a) * r * 0.4, y + Math.sin(a) * r * 0.4);
      ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /* ------------------------------------------------------------------ input */

  function rowAt(y) {
    if (y < L.top || y > L.bot) return -1;
    return Math.max(0, Math.min(n - 1, Math.floor((y - L.top) / L.rowH)));
  }

  function pointerDown(p) {
    if (L.x < 0 || kit.locked()) return;
    const j = rowAt(p.y);
    if (j >= 0 && p.x <= L.x0 + L.pw * 0.6) {
      if (armed === j) snip(j);
      else arm(j);
      return;
    }
    if (j >= 0 && p.x >= L.rx - L.pw * 0.7) {
      test(j);
      return;
    }
    armed = -1; // a tap anywhere else closes the cutters
  }

  function key(e) {
    if (kit.locked()) return false;
    const k = e.key;
    if (k.length === 1 && k >= '1' && k <= '9') {
      const i = k.charCodeAt(0) - 49;
      if (i >= n) return false;
      if (armed === i) snip(i);
      else arm(i);
      return true;
    }
    if (k.length === 1) {
      const l = k.toUpperCase().charCodeAt(0) - 65;
      if (l >= 0 && l < n && tier >= 1) {
        test(l);
        return true;
      }
      if (k === ' ' && armed >= 0) {
        snip(armed);
        return true;
      }
      return false;
    }
    if (k === 'Enter' && armed >= 0) {
      snip(armed);
      return true;
    }
    if (k === 'ArrowUp' || k === 'ArrowDown') {
      // Move the open cutters to the next uncut wire.
      let i = armed < 0 ? (k === 'ArrowUp' ? n : -1) : armed;
      for (let tries = 0; tries < n; tries++) {
        i = (i + (k === 'ArrowUp' ? n - 1 : 1)) % n;
        if (!cut[i]) {
          arm(i);
          break;
        }
      }
      return true;
    }
    return false;
  }

  function hint() {
    if (kit.done || kit.forcing) return t('pz.open');
    if (zapped > 0) return t('pz.wires.zap');
    if (armed >= 0) return t('pz.wires.armed', NUMS[armed]);
    const l = LETTERS[sequence[step]];
    return t(tier >= 1 ? 'pz.wires.cutTest' : 'pz.wires.cut', l);
  }

  return {
    update,
    draw,
    pointerDown,
    pointerMove() {},
    pointerUp() {},
    key,
    hint,
    forceSolve() {
      if (kit.force()) armed = -1;
    },
    destroy() {
      armed = -1;
    },
  };
}
