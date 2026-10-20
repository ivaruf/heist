/*
 * lasers.js — the laser hall.
 *
 * A top-down room, door at the bottom, exit at the top, and between them a
 * stack of laser obstacles the thief has to steer through. It is the trap
 * that asks for *movement*: the lock puzzles are all fingertips and thinking,
 * this one is reading a rhythm and walking into it at the right moment.
 *
 * Four obstacles, introduced in this order as difficulty climbs:
 *   wall   — a static beam from both side walls with one gap in it.
 *            At 5+ they can come as a zigzag pair, gaps on opposite sides.
 *   blink  — a full-width beam that switches on and off. It flickers as a
 *            warning just before it comes back on.
 *   slide  — a wall whose gap glides from side to side.
 *   scan   — a vertical curtain that sweeps across a band of the floor
 *            (two of them, mirrored, at 8+).
 *
 * Solvable by construction. Every obstacle is separated from the next by a
 * safe strip taller than the thief, so the player can always stop and wait,
 * and each obstacle on its own is generated inside limits that guarantee a
 * way through for a thief at SPEED: gaps wider than the thief plus margin,
 * blink-off times several times the crossing time, a sliding gap that never
 * outruns the thief, and a scanner whose half-period dwarfs the crossing time.
 * A throwaway time-expanded search over many seeds confirmed it (see the
 * lane report); `generate`, `pose` and `touching` are exported for that.
 *
 * Input. Pointer: the thief walks towards the finger at a capped speed and
 * never teleports. Keyboard: arrows / WASD, held. The shell only forwards
 * keydown, so this file listens for keyup on window itself (and drops
 * everything on blur), and removes both listeners in destroy().
 *
 * No mistake loop: a zap drops the drag and the held keys, slides the thief
 * back to the door, and gives a second of grace. A finger still pressed from
 * before the zap is ignored until it lifts, and a key's auto-repeat is
 * ignored until it is pressed afresh, so nobody walks straight back into the
 * same beam because they were still holding on.
 *
 * Goggles (tool tiers, DESIGN §4, cumulative):
 *   0 — beams faint, and they blink out of sight for a moment every few s.
 *   1 — beams always clearly visible.
 *   2 — a dashed ghost shows where each *moving* beam will be in 1 s.
 *   3 — the first beam touched in the room is bounced off a mirror (PLING!).
 */

import * as art from '../art.js';
import { t, addStrings } from '../i18n.js';

addStrings({
  nb: {
    'trap.lasers.hint': 'Dra med fingeren eller bruk pilene. Snik deg til utgangen uten å røre strålene!',
    'trap.lasers.hintHit': 'Au! Tilbake ved døra. Se på strålene litt før du går.',
    'trap.lasers.hintMirror': 'Speilet ditt sender den første strålen du rører tilbake.',
    'trap.lasers.zap': 'ZAPP!',
    'trap.lasers.mirror': 'PLING!',
  },
  en: {
    'trap.lasers.hint': 'Drag with your finger or use the arrows. Sneak to the exit without touching a beam!',
    'trap.lasers.hintHit': 'Ouch! Back at the door. Watch the beams a little before you go.',
    'trap.lasers.hintMirror': 'Your mirror bounces back the first beam you touch.',
    'trap.lasers.zap': 'ZAPP!',
    'trap.lasers.mirror': 'PLING!',
  },
});

// ---- the room, in room units (the thief is 0.6 across) ---------------------

export const W = 10;
export const R = 0.3; // thief hit radius; drawn a little larger, which is forgiving
export const BW = 0.05; // beam half-width
const HIT2 = (R + BW) * (R + BW);
export const SPEED = 3.2; // units per second, finger and keys alike
export const EXIT_Y = 1.0; // above this line the thief is out
const TOP_ZONE = 1.6; // exit strip above the first obstacle
const GAP = 1.4; // safe strip between obstacles: > thief + margin
const SCAN_H = 1.4;
const ZIG = 1.15; // distance between the two beams of a zigzag

const NOOP = () => {};
const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const tri = (p) => {
  const f = p - Math.floor(p);
  return f < 0.5 ? f * 2 : 2 - f * 2;
};

function pickKind(d, k, rng) {
  const w = [lerp(3, 1, k), d >= 2 ? lerp(1.2, 1.6, k) : 0, d >= 3 ? lerp(0.6, 2, k) : 0, d >= 4 ? lerp(0.5, 2, k) : 0, d >= 5 ? 1 : 0];
  const names = ['wall', 'blink', 'slide', 'scan', 'zig'];
  let sum = 0;
  for (const v of w) sum += v;
  let r = rng() * sum;
  for (let i = 0; i < w.length; i++) if ((r -= w[i]) < 0) return names[i];
  return 'wall';
}

/*
 * Build a room for a difficulty (1..10, fractional fine) from the rng.
 * Obstacles are laid top to bottom; each has an extent (0 for a line) and a
 * GAP of safe floor below it. Returns { W, H, doorX, doorY, beams, bands }.
 */
export function generate(difficulty, rng) {
  const d = clamp(+difficulty || 1, 1, 10);
  const k = (d - 1) / 9;
  const n = 2 + Math.round(k * 4);
  const kinds = [];
  for (let i = 0; i < n; i++) {
    let kind = pickKind(d, k, rng);
    if (i > 0 && kind === kinds[i - 1]) kind = pickKind(d, k, rng);
    kinds.push(kind);
  }
  // From 3 up, at least one thing in the room moves; that is the point of it.
  if (d >= 3 && !kinds.some((s) => s === 'slide' || s === 'scan')) kinds[Math.floor(rng() * n)] = d >= 4 && rng() < 0.5 ? 'scan' : 'slide';

  const beams = [];
  const bands = []; // [top, bottom] of each obstacle, for the drawing and the tests
  const wallGap = lerp(2.8, 1.25, k); // thief + beams need 0.7
  const wallAt = (y, g, cMin, cMax) => {
    const c = lerp(cMin, cMax, rng());
    beams.push({ kind: 'wall', y, gL: c - g / 2, gR: c + g / 2 });
  };
  let y = TOP_ZONE;
  for (const kind of kinds) {
    let ext = 0;
    if (kind === 'wall') {
      wallAt(y, wallGap, wallGap / 2 + 0.3, W - wallGap / 2 - 0.3);
    } else if (kind === 'zig') {
      // Gaps on opposite halves: walk through one, along, and out the other.
      const left = rng() < 0.5;
      const lo = wallGap / 2 + 0.3;
      wallAt(y, wallGap, left ? lo : W / 2 + 0.6, left ? W / 2 - 0.6 : W - lo);
      wallAt(y + ZIG, wallGap, left ? W / 2 + 0.6 : lo, left ? W - lo : W / 2 - 0.6);
      ext = ZIG;
    } else if (kind === 'blink') {
      // Crossing a line takes (2R+2BW)/SPEED ≈ 0.22 s; the shortest off is
      // 0.8 s, so even the hardest blink leaves three crossings of room.
      beams.push({ kind: 'blink', y, on: lerp(1.0, 1.7, k), off: lerp(1.7, 0.8, k), phase: rng() });
    } else if (kind === 'slide') {
      // The gap moves at most 2.2 u/s, below SPEED, so the thief can ride it.
      const g = lerp(2.8, 1.7, k);
      const A = (W - g) / 2 - 0.2;
      const vmax = lerp(0.8, 2.2, k);
      beams.push({ kind: 'slide', y, g, A, w: vmax / A, ph: rng() * Math.PI * 2 });
    } else {
      // A curtain crossing x every half period (≥1.7 s at the fastest),
      // against ~0.66 s to cross the band.
      const T = (2 * (W - 0.8)) / lerp(2.2, 5.5, k);
      const ph = rng();
      beams.push({ kind: 'scan', y0: y, h: SCAN_H, L: 0.4, D: W - 0.8, T, ph });
      if (d >= 8) beams.push({ kind: 'scan', y0: y, h: SCAN_H, L: 0.4, D: W - 0.8, T, ph: ph + 0.5 });
      ext = SCAN_H;
    }
    bands.push(y, y + ext);
    y += ext + GAP;
  }
  const H = y + 1.0;
  return { W, H, doorX: W / 2, doorY: H - 0.7, beams, bands };
}

const P = (out, i, x1, y1, x2, y2) => {
  out[i] = x1;
  out[i + 1] = y1;
  out[i + 2] = x2;
  out[i + 3] = y2;
};

/** Where a blink beam is in its cycle: [0, off) is dark, [off, off+on) lit. */
function blinkT(b, t) {
  const per = b.on + b.off;
  const p = (t + b.phase * per) % per;
  return p < 0 ? p + per : p;
}

/** Fill `out` with the beam's live segments at time t; returns how many (0 = dark). */
export function pose(b, t, out) {
  switch (b.kind) {
    case 'wall':
      P(out, 0, 0, b.y, b.gL, b.y);
      P(out, 4, b.gR, b.y, W, b.y);
      return 2;
    case 'blink':
      if (blinkT(b, t) < b.off) return 0;
      P(out, 0, 0, b.y, W, b.y);
      return 1;
    case 'slide': {
      const c = W / 2 + b.A * Math.sin(b.w * t + b.ph);
      P(out, 0, 0, b.y, c - b.g / 2, b.y);
      P(out, 4, c + b.g / 2, b.y, W, b.y);
      return 2;
    }
    default: {
      const x = b.L + b.D * tri(t / b.T + b.ph);
      P(out, 0, x, b.y0, x, b.y0 + b.h);
      return 1;
    }
  }
}

function segD2(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let u = l2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  u = u < 0 ? 0 : u > 1 ? 1 : u;
  const ex = x1 + dx * u - px;
  const ey = y1 + dy * u - py;
  return ex * ex + ey * ey;
}

/** Index of the beam the thief at (x,y) touches at time t, or -1. */
export function touching(beams, x, y, t, buf) {
  for (let i = 0; i < beams.length; i++) {
    const n = pose(beams[i], t, buf);
    for (let s = 0; s < n; s++) {
      const o = s * 4;
      if (segD2(x, y, buf[o], buf[o + 1], buf[o + 2], buf[o + 3]) < HIT2) return i;
    }
  }
  return -1;
}

const keyBit = (k) =>
  k === 'ArrowUp' || k === 'w' || k === 'W' ? 1
  : k === 'ArrowDown' || k === 's' || k === 'S' ? 2
  : k === 'ArrowLeft' || k === 'a' || k === 'A' ? 4
  : k === 'ArrowRight' || k === 'd' || k === 'D' ? 8
  : 0;

// Reused option bags, so draw allocates nothing per frame (hub §10).
const BURST = { size: 0, fill: '', rot: 0, life: 0 };
const CAP = { size: 0, align: 'center', fill: '', stroke: '' };
const DASH = [6, 6];
const NODASH = [];

export function createLasers(opts = {}) {
  const tier = opts.tier | 0;
  const rng = opts.rng || Math.random;
  const sfx = opts.sfx || NOOP;
  const ev = opts.events || {};
  const mistake = ev.mistake || NOOP;
  const progress = ev.progress || NOOP;
  const solved = ev.solved || NOOP;

  const room = generate(opts.difficulty, rng);
  const { beams, H, doorX, doorY, bands } = room;
  const buf = new Float64Array(8);
  const gbuf = new Float64Array(8);

  let time = 0;
  let phase = 'play'; // play | zap | back | dash | exit | done
  let timer = 0;
  let grace = 0;
  let x = doorX;
  let y = doorY;
  let fromX = 0;
  let fromY = 0;
  let face = -Math.PI / 2;
  let moving = false;
  let held = 0;
  let needFresh = false;
  let dragId = null;
  let hasTarget = false;
  let tx = 0;
  let ty = 0;
  let hits = 0;
  let mirrorUsed = false;
  let best = 0;
  let didSolve = false;
  const burst = { key: '', x: 0, y: 0, age: 9, dur: 0.9, fill: 'red' };

  const say = (key, bx, by, fill) => {
    burst.key = key;
    burst.x = bx;
    burst.y = by;
    burst.age = 0;
    burst.fill = fill;
  };

  const onKeyUp = (e) => {
    held &= ~keyBit(e.key);
  };
  const onBlur = () => {
    held = 0;
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
  }

  function zap() {
    if (tier >= 3 && !mirrorUsed) {
      mirrorUsed = true;
      grace = 1.0;
      say('trap.lasers.mirror', x, y - 0.6, 'cream');
      sfx('click', { strength: 1 });
      return;
    }
    hits++;
    phase = 'zap';
    timer = 0;
    held = 0;
    needFresh = true;
    dragId = null;
    hasTarget = false;
    say('trap.lasers.zap', x, y - 0.6, 'red');
    sfx('buzz');
    mistake(2);
  }

  function walk(gx, gy, speed, dt) {
    const dx = gx - x;
    const dy = gy - y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.03) return dist;
    const step = Math.min(dist, speed * dt);
    x += (dx / dist) * step;
    y += (dy / dist) * step;
    face = Math.atan2(dy, dx);
    moving = true;
    return dist - step;
  }

  function update(dt) {
    time += dt;
    burst.age += dt;
    moving = false;
    if (phase === 'play') {
      if (held) {
        let mx = (held & 8 ? 1 : 0) - (held & 4 ? 1 : 0);
        let my = (held & 2 ? 1 : 0) - (held & 1 ? 1 : 0);
        const m = Math.hypot(mx, my);
        if (m > 0) {
          mx /= m;
          my /= m;
          x += mx * SPEED * dt;
          y += my * SPEED * dt;
          face = Math.atan2(my, mx);
          moving = true;
        }
      } else if (hasTarget) {
        walk(tx, ty, SPEED, dt);
      }
      x = clamp(x, R, W - R);
      y = clamp(y, R, H - R);
      if (grace > 0) grace -= dt;
      else if (touching(beams, x, y, time, buf) >= 0) zap();
      if (phase === 'play' && y < EXIT_Y) {
        phase = 'exit';
        timer = 0;
        sfx('chime');
        say('trap.phew', W / 2, 0.9, 'mustard');
      }
      const f = clamp((doorY - y) / (doorY - EXIT_Y), 0, 1);
      if (f > best + 0.02) {
        best = f;
        progress(f);
      }
    } else if (phase === 'zap') {
      timer += dt;
      if (timer >= 0.5) {
        phase = 'back';
        timer = 0;
        fromX = x;
        fromY = y;
      }
    } else if (phase === 'back') {
      timer += dt;
      const f = Math.min(1, timer / 0.5);
      const e = f * f * (3 - 2 * f);
      x = fromX + (doorX - fromX) * e;
      y = fromY + (doorY - fromY) * e;
      moving = true;
      if (f >= 1) {
        phase = 'play';
        grace = 1.0;
        face = -Math.PI / 2;
      }
    } else if (phase === 'dash') {
      walk(W / 2, EXIT_Y - 0.2, SPEED * 3, dt);
      if (y < EXIT_Y) {
        phase = 'exit';
        timer = 0;
        sfx('chime');
        say('trap.phew', W / 2, 0.9, 'mustard');
      }
    } else if (phase === 'exit') {
      timer += dt;
      walk(W / 2, 0.35, SPEED, dt);
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

  // The static part of the room, painted once per layout into an offscreen canvas.
  function paintRoom(g) {
    const s = L.s;
    const PAL = art.PAL;
    art.panel(g, L.ox, L.oy, W * s, H * s, { fill: PAL.night, r: 4, shadow: true });
    g.save();
    g.beginPath();
    g.rect(L.ox, L.oy, W * s, H * s);
    g.clip();
    // Floor tiles, then the halftone shading the whole book uses.
    g.strokeStyle = PAL.navy;
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 1; i < W; i++) {
      g.moveTo(L.ox + i * s, L.oy);
      g.lineTo(L.ox + i * s, L.oy + H * s);
    }
    for (let j = 1; j < H; j++) {
      g.moveTo(L.ox, L.oy + j * s);
      g.lineTo(L.ox + W * s, L.oy + j * s);
    }
    g.stroke();
    art.halftone(g, L.ox, L.oy, W * s, H * s, { color: PAL.navy, spacing: Math.max(4, s * 0.3), angle: 0.785, from: 0.05, to: 0.45 });
    // The exit strip glows faintly green: that is where you are going.
    g.globalAlpha = 0.22;
    g.fillStyle = PAL.green;
    g.fillRect(L.ox, L.oy, W * s, (TOP_ZONE - 0.45) * s);
    g.globalAlpha = 1;
    // Scanner rails.
    for (const b of beams) {
      if (b.kind !== 'scan') continue;
      g.fillStyle = PAL.steelDark;
      g.fillRect(L.ox, L.oy + b.y0 * s - 2, W * s, 4);
      g.fillRect(L.ox, L.oy + (b.y0 + b.h) * s - 2, W * s, 4);
    }
    g.restore();
    // Emitters on both walls for every horizontal beam.
    const e = Math.max(5, s * 0.32);
    g.fillStyle = PAL.steelDark;
    for (const b of beams) {
      if (b.kind === 'scan') continue;
      const py = L.oy + b.y * s;
      for (let side = 0; side < 2; side++) {
        const px = side ? L.ox + W * s - e * 0.6 : L.ox - e * 0.4;
        g.fillStyle = PAL.steelDark;
        g.fillRect(px, py - e / 2, e, e);
        art.ink(g, Math.max(1, art.LINE * 0.5));
        g.strokeRect(px, py - e / 2, e, e);
      }
    }
    // Doors: brass at the bottom where you came in, steel at the top.
    const dw = 1.8 * s;
    g.fillStyle = PAL.brass;
    g.fillRect(L.ox + doorX * s - dw / 2, L.oy + H * s - 5, dw, 10);
    g.fillStyle = PAL.steel;
    g.fillRect(L.ox + (W / 2) * s - dw * 0.7, L.oy - 5, dw * 1.4, 10);
    art.ink(g, art.LINE);
    g.strokeRect(L.ox + doorX * s - dw / 2, L.oy + H * s - 5, dw, 10);
    g.strokeRect(L.ox + (W / 2) * s - dw * 0.7, L.oy - 5, dw * 1.4, 10);
  }

  function strokeSegs(ctx, b, n) {
    const s = L.s;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      ctx.moveTo(L.ox + b[o] * s, L.oy + b[o + 1] * s);
      ctx.lineTo(L.ox + b[o + 2] * s, L.oy + b[o + 3] * s);
    }
    ctx.stroke();
  }

  function draw(ctx, rect, now) {
    relayout(rect);
    const PAL = art.PAL;
    const s = L.s;
    if (bg) ctx.drawImage(bg, L.x, L.y, L.w, L.h);
    ctx.save();
    ctx.lineCap = 'round';

    // Tier 0 sees faint beams that drop out of sight for 0.7 s in every 4.6 s;
    // a zap shows them all in full for a moment, so a miss is always explained.
    let a = 1;
    if (tier < 1 && phase !== 'zap') a = time % 4.6 > 3.9 ? 0 : 0.4;
    for (let i = 0; i < beams.length; i++) {
      const b = beams[i];
      const n = pose(b, time, buf);
      if (n === 0) {
        // A blink beam about to come back flickers dashed for 0.4 s.
        if (b.kind === 'blink' && b.off - blinkT(b, time) < 0.4 && a > 0) {
          ctx.globalAlpha = a * 0.6;
          ctx.strokeStyle = PAL.red;
          ctx.lineWidth = Math.max(1, s * 0.05);
          ctx.setLineDash(DASH);
          P(buf, 0, 0, b.y, W, b.y);
          strokeSegs(ctx, buf, 1);
          ctx.setLineDash(NODASH);
        }
        continue;
      }
      if (a > 0) {
        ctx.strokeStyle = PAL.red;
        ctx.globalAlpha = a * 0.3;
        ctx.lineWidth = Math.max(4, s * 0.28);
        strokeSegs(ctx, buf, n);
        ctx.globalAlpha = a;
        ctx.lineWidth = Math.max(2, s * 0.09);
        strokeSegs(ctx, buf, n);
        ctx.strokeStyle = PAL.cream;
        ctx.lineWidth = Math.max(1, s * 0.03);
        strokeSegs(ctx, buf, n);
      }
      // Thermal goggles: where the moving ones will be in a second.
      if (tier >= 2 && (b.kind === 'slide' || b.kind === 'scan')) {
        const gn = pose(b, time + 1, gbuf);
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = PAL.amber;
        ctx.lineWidth = Math.max(1.5, s * 0.06);
        ctx.setLineDash(DASH);
        strokeSegs(ctx, gbuf, gn);
        ctx.setLineDash(NODASH);
      }
      // The scanner's moving heads ride its rails.
      if (b.kind === 'scan') {
        ctx.globalAlpha = 1;
        const hx = L.ox + buf[0] * s;
        const hs = Math.max(5, s * 0.3);
        ctx.fillStyle = PAL.steelDark;
        ctx.fillRect(hx - hs / 2, L.oy + b.y0 * s - hs / 2, hs, hs);
        ctx.fillRect(hx - hs / 2, L.oy + (b.y0 + b.h) * s - hs / 2, hs, hs);
        art.ink(ctx, Math.max(1, art.LINE * 0.5));
        ctx.strokeRect(hx - hs / 2, L.oy + b.y0 * s - hs / 2, hs, hs);
        ctx.strokeRect(hx - hs / 2, L.oy + (b.y0 + b.h) * s - hs / 2, hs, hs);
      }
    }
    ctx.globalAlpha = 1;

    CAP.size = Math.max(11, s * 0.55);
    CAP.align = 'center';
    CAP.fill = PAL.green;
    CAP.stroke = PAL.ink;
    art.caption(ctx, L.ox + (W / 2) * s, L.oy + 0.55 * s, t('trap.exit'), CAP);

    // Where the finger is steering to.
    if (hasTarget && phase === 'play') {
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = PAL.cream;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(L.ox + tx * s, L.oy + ty * s, s * 0.35, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // The thief; flickering through the grace second after a zap or a mirror.
    const px = L.ox + x * s;
    const py = L.oy + y * s;
    if (!(grace > 0 && phase === 'play' && ((time * 10) | 0) % 2 === 0)) {
      if (phase === 'zap') {
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = PAL.red;
        ctx.beginPath();
        ctx.arc(px, py, s * 0.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      art.drawThiefTop(ctx, px, py, s * 0.85, face, now, moving);
    }
    // An unused mirror circles the thief, so its owner knows it is there.
    if (tier >= 3 && !mirrorUsed) {
      const ma = time * 3;
      const mx = px + Math.cos(ma) * s * 0.6;
      const my = py + Math.sin(ma) * s * 0.6;
      const m = Math.max(3, s * 0.13);
      ctx.fillStyle = PAL.cream;
      ctx.beginPath();
      ctx.moveTo(mx, my - m);
      ctx.lineTo(mx + m, my);
      ctx.lineTo(mx, my + m);
      ctx.lineTo(mx - m, my);
      ctx.closePath();
      ctx.fill();
      art.ink(ctx, 1);
      ctx.stroke();
    }

    if (burst.age < burst.dur) {
      BURST.size = clamp(s * 1.6, 26, 56);
      BURST.fill = PAL[burst.fill];
      BURST.rot = -0.12;
      BURST.life = Math.min(1, burst.age / 0.1) * Math.min(1, (burst.dur - burst.age) / 0.3); // the puzzles' envelope
      art.burst(ctx, L.ox + clamp(burst.x, 2, W - 2) * s, L.oy + Math.max(1, burst.y) * s, t(burst.key), BURST);
    }
    ctx.restore();
  }

  // ---- input -----------------------------------------------------------------

  const roomX = (p) => (p.x - L.ox) / L.s;
  const roomY = (p) => (p.y - L.oy) / L.s;

  function pointerDown(p) {
    if (phase !== 'play' || dragId !== null || L.w < 0) return;
    dragId = p.id;
    hasTarget = true;
    tx = roomX(p);
    ty = roomY(p);
  }
  function pointerMove(p) {
    if (p.id !== dragId || phase !== 'play') return;
    tx = roomX(p);
    ty = roomY(p);
  }
  function pointerUp(p) {
    if (p.id !== dragId) return;
    dragId = null;
    hasTarget = false;
  }
  function key(e) {
    const bit = keyBit(e.key);
    if (!bit) return false;
    if (phase !== 'play') return true;
    if (needFresh && e.repeat) return true;
    needFresh = false;
    held |= bit;
    hasTarget = false;
    return true;
  }

  function hint() {
    if (phase === 'zap' || phase === 'back' || (hits > 0 && grace > 0)) return t('trap.lasers.hintHit');
    if (tier >= 3 && !mirrorUsed) return t('trap.lasers.hintMirror');
    return t('trap.lasers.hint');
  }

  function forceSolve() {
    if (phase === 'dash' || phase === 'exit' || phase === 'done') return;
    phase = 'dash';
    held = 0;
    hasTarget = false;
    dragId = null;
  }

  function destroy() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    }
    bg = null;
  }

  return { update, draw, pointerDown, pointerMove, pointerUp, key, hint, forceSolve, destroy, _room: room, _bands: bands };
}

/*
 * Paint the static room into an offscreen canvas at device resolution, reusing
 * the previous canvas when there is one. Drawn with the same coordinates as
 * the live frame, so paint code needs no second coordinate system.
 */
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
