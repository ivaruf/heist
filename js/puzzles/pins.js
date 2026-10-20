/*
 * pins.js — the pin tumbler door lock, picked one pin at a time.
 *
 * THE MECHANIC
 * A cut-away cylinder: 3–7 chambers, each holding a spring, a steel driver
 * pin and a brass key pin of its own length. The gap between the two pins
 * has to sit exactly on the shear line — the dashed line where the brass plug
 * meets the steel housing. Lift a pin (drag it up), and let go: if it is the
 * binding pin and its gap is on the line, it sets with a KLIKK and stays.
 * Then the next pin binds. Set them all and the plug turns.
 *
 * Only one pin binds at a time, in an order hidden from the player. The tell
 * is feel: the binding pin is stiff — it lags behind your finger and
 * trembles — while the others slide up loose and drop back when let go,
 * free of charge. Lift ANY pin too far past the line and it oversets: a
 * mistake (severity 1), and every set pin drops. So the skill is reading the
 * stiffness, then landing the gap on the line and letting go at the right
 * moment — the binding pin also wobbles a little at higher difficulty, so
 * the release wants timing as well as aim.
 *
 * DIFFICULTY (u = 0..1 over difficulty 1..10)
 *   pins        3 at d1 → 7 at d10
 *   shear line  window 0.20 of a pin's travel at d1 → 0.09 at d10 (on a
 *               300px lock that is about 12px → 5px of finger travel)
 *   overset     margin past the window 0.08 → 0.04 of travel
 *   wobble      none at d1 → ±0.025 of travel at d10 on the binding pin
 *
 * TIERS (DESIGN.md §4, cumulative)
 *   0 hairpin   the narrow window and short overset margin above
 *   1 pick set  the window is twice as wide, and the overset margin with it
 *   2 pro set   the binding pin glints (a white sparkle at its gap) while
 *               its gap sits in the window — let go now
 *   3 pick gun  the binding pin's chamber is marked with a mustard arrow,
 *               so you always know which is next
 *
 * INPUT
 *   pointer   press on a chamber and drag up; let go to try it
 *   keyboard  ← → choose a pin (or 1–7), ↑ lifts it (Shift for more),
 *             ↓ lowers it, Space or Enter lets go
 */

import * as art from '../art.js';
import { t, addStrings } from '../i18n.js';

addStrings({
  nb: {
    'pz.pins.find': 'Finn stiften som sitter fast. Løft den til streken og slipp.',
    'pz.pins.marked': 'Løft den merkede stiften til streken og slipp.',
    'pz.pins.good': 'Bra! Nå sitter en annen stift fast. Finn den.',
    'pz.pins.dropped': 'For høyt! Stiftene falt ned. Begynn på nytt.',
  },
  en: {
    'pz.pins.find': 'Find the stiff pin. Lift it to the line and let go.',
    'pz.pins.marked': 'Lift the marked pin to the line and let go.',
    'pz.pins.good': 'Nice! Another pin is stuck now. Find it.',
    'pz.pins.dropped': 'Too high! The pins fell. Start again.',
  },
});

const LABELS = ['1', '2', '3', '4', '5', '6', '7'];
const DASH = [6, 5];
const SOLID = [];

export function createPins(kit) {
  const { tier, rng, C } = kit;
  const n = 3 + Math.round(kit.u * 4);
  const win = kit.lerp(0.2, 0.09) * (tier >= 1 ? 2 : 1);
  const margin = kit.lerp(0.08, 0.04) * (tier >= 1 ? 2 : 1);
  const wobbleAmp = kit.lerp(0, 0.025);

  // Where each pin's gap meets the line, as a fraction of its travel, and the binding order.
  const shear = new Float32Array(n);
  for (let i = 0; i < n; i++) shear[i] = 0.36 + rng() * 0.34;
  const order = kit.shuffle(Array.from({ length: n }, (_, i) => i));

  const lift = new Float32Array(n); // where the pin is (0 rest .. ~1.15)
  const target = new Float32Array(n); // where the finger wants it
  const isSet = new Uint8Array(n);
  let bind = 0; // index into order: order[bind] is the binding pin
  let held = -1; // pin being lifted
  let cursor = order[0] === 0 ? 1 % n : 0; // keyboard / last-touched pin; never starts on the answer
  let dropped = 0; // seconds of "pins fell" hint left
  let good = 0; // seconds of "nice" hint left
  let openT = 0;
  let grab = null;
  let startY = 0;
  let startT = 0;

  const binding = () => (bind < n ? order[bind] : -1);

  /** The gap's height in travel units, including the binding pin's wobble while held. */
  function eff(i) {
    if (i === binding() && held === i && !isSet[i]) {
      return lift[i] + wobbleAmp * Math.sin(kit.time * 11 + i * 1.7);
    }
    return lift[i];
  }

  /* ------------------------------------------------------------- the rules */

  function release(i) {
    if (i < 0) return;
    held = -1;
    if (isSet[i] || kit.locked()) return;
    if (i === binding() && Math.abs(eff(i) - shear[i]) <= win / 2) {
      setPin(i);
      return;
    }
    target[i] = 0; // it falls back, at no cost
  }

  function setPin(i) {
    isSet[i] = 1;
    lift[i] = target[i] = shear[i];
    bind++;
    kit.sfx('pin');
    kit.burst(colFx(i), 0.08, 'pz.burst.click', C.cream, 0.11, 0.6);
    kit.progress(bind / n);
    good = bind < n ? 2 : 0;
    dropped = 0;
    if (bind === n) {
      openT = 0.0001;
      kit.sfx('chime');
      kit.solve();
    }
  }

  function overset() {
    kit.sfx('drop');
    kit.burst(0.5, 0.3, 'pz.burst.drop', C.red, 0.16);
    kit.mistake(1);
    for (let i = 0; i < n; i++) {
      isSet[i] = 0;
      target[i] = 0;
    }
    bind = 0;
    held = -1;
    grab = null;
    good = 0;
    dropped = 2.5;
    kit.progress(0);
  }

  function update(dt) {
    kit.update(dt);
    if (dropped > 0) dropped = Math.max(0, dropped - dt);
    if (good > 0) good = Math.max(0, good - dt);
    if (openT > 0 && openT < 1) openT = Math.min(1, openT + dt * 2);

    if (kit.forcing) {
      // The drill: pins jump to the line one after another.
      for (let j = 0; j < n; j++) {
        const i = order[j];
        if (!isSet[i] && kit.forceT > (j + 1) / (n + 1)) {
          isSet[i] = 1;
          lift[i] = target[i] = shear[i];
        }
      }
    }

    const b = binding();
    for (let i = 0; i < n; i++) {
      if (isSet[i]) continue;
      // Stiff when binding and lifted, loose otherwise, and quick to fall.
      const rate = held === i ? (i === b ? 7 : 28) : 14;
      lift[i] += (target[i] - lift[i]) * Math.min(1, dt * rate);
      if (held === i && !kit.locked() && eff(i) > shear[i] + win / 2 + margin) overset();
    }
  }

  /* ------------------------------------------------------------------- draw */

  const L = { x: -1, y: 0, w: 0, h: 0, s: 0, lw: 0, hx: 0, hw: 0, colW: 0, pw: 0, top: 0, shearY: 0, plugB: 0, travel: 0, drvLen: 0, keyRest: 0 };
  const METAL = { r: 0, tone: 'steel' };
  const CAP = { size: 0, align: 'center', fill: '', stroke: '' };
  const HALF = { color: '', spacing: 0, angle: 0.6, from: 0.05, to: 0.5 };

  function layout(rect) {
    if (rect.x === L.x && rect.y === L.y && rect.w === L.w && rect.h === L.h) return;
    L.x = rect.x;
    L.y = rect.y;
    L.w = rect.w;
    L.h = rect.h;
    L.s = Math.min(rect.w, rect.h);
    L.lw = kit.line(L.s);
    L.hx = rect.x + rect.w * 0.06;
    L.hw = rect.w * 0.88;
    L.colW = L.hw / n;
    L.pw = Math.min(L.colW * 0.48, L.s * 0.1);
    L.top = rect.y + rect.h * 0.1;
    L.shearY = rect.y + rect.h * 0.5;
    L.plugB = rect.y + rect.h * 0.76;
    const plugH = L.plugB - L.shearY;
    L.travel = plugH * 0.75;
    L.drvLen = L.travel * 0.7;
    L.keyRest = L.plugB - plugH * 0.08;
  }

  const colX = (i) => L.hx + L.colW * (i + 0.5);
  const colFx = (i) => (L.w > 0 ? (colX(i) - L.x) / L.w : (i + 0.5) / n);
  /** The gap's y for a pin at lift v. */
  const gapY = (i, v) => L.shearY + (shear[i] - v) * L.travel;

  function draw(ctx, rect, now) {
    layout(rect);
    const { lw, hx, hw, top, shearY, plugB, pw } = L;
    ctx.save();
    ctx.translate(kit.shakeX(L.s), 0);

    // Housing (steel, above the line) and plug (brass, below it).
    METAL.r = L.s * 0.03;
    METAL.tone = 'steel';
    art.metal(ctx, hx, top, hw, shearY - top, METAL);
    HALF.color = C.ink;
    HALF.spacing = Math.max(4, L.s * 0.025);
    art.halftone(ctx, hx, top + (shearY - top) * 0.55, hw, (shearY - top) * 0.45, HALF);
    METAL.tone = 'brass';
    METAL.r = L.s * 0.02;
    art.metal(ctx, hx, shearY, hw, plugB - shearY, METAL);
    art.ink(ctx, lw);
    ctx.strokeRect(hx, top, hw, plugB - top);

    // The keyway below the plug, where the pick comes in.
    ctx.fillStyle = C.night;
    ctx.fillRect(hx, plugB, hw, L.h * 0.1);
    ctx.strokeRect(hx, plugB, hw, L.h * 0.1);

    const b = binding();
    for (let i = 0; i < n; i++) drawChamber(ctx, i, b, now);

    // The shear line, dashed mustard over everything, green once open.
    ctx.setLineDash(DASH);
    ctx.strokeStyle = openT > 0 ? C.green : C.mustard;
    ctx.lineWidth = lw * 0.9;
    ctx.beginPath();
    ctx.moveTo(hx - lw * 2, shearY);
    ctx.lineTo(hx + hw + lw * 2, shearY);
    ctx.stroke();
    ctx.setLineDash(SOLID);

    drawPick(ctx);

    // Pin numbers under the keyway, for the keyboard (and the cursor chevron).
    CAP.size = Math.max(11, L.s * 0.05);
    CAP.align = 'center';
    for (let i = 0; i < n; i++) {
      CAP.fill = i === cursor ? C.mustard : C.cream;
      CAP.stroke = C.ink;
      art.caption(ctx, colX(i), plugB + L.h * 0.16, LABELS[i], CAP);
    }

    // Pick gun: a mustard arrow over the binding chamber.
    if (tier >= 3 && b >= 0 && !kit.done) {
      const x = colX(b);
      const y = top - L.h * 0.015 + Math.sin(now * 5) * L.h * 0.008;
      const a = Math.max(6, pw * 0.45);
      ctx.fillStyle = C.mustard;
      ctx.beginPath();
      ctx.moveTo(x - a, y - a * 1.1);
      ctx.lineTo(x + a, y - a * 1.1);
      ctx.lineTo(x, y);
      ctx.closePath();
      ctx.fill();
      art.ink(ctx, lw * 0.7);
      ctx.stroke();
    }

    ctx.restore();
    kit.drawBursts(ctx, rect);
  }

  function drawChamber(ctx, i, b, now) {
    const { lw, pw, top, shearY } = L;
    const x = colX(i);
    const v = isSet[i] ? shear[i] : eff(i);
    const gy = gapY(i, v);
    const stiff = i === b && held === i && lift[i] > 0.04;
    const jx = stiff ? Math.sin(kit.time * 45) * lw * 0.35 : 0;

    // The bore: a dark slot through housing and plug, ringed mustard for the pick gun.
    const bw = pw * 1.25;
    ctx.fillStyle = C.night;
    ctx.fillRect(x - bw / 2, top + L.h * 0.02, bw, L.keyRest - top - L.h * 0.02 + lw);
    if (tier >= 3 && i === b && !kit.done) {
      ctx.strokeStyle = C.mustard;
      ctx.lineWidth = lw;
      ctx.strokeRect(x - bw / 2, top + L.h * 0.02, bw, L.keyRest - top - L.h * 0.02 + lw);
    }

    // The spring, a zigzag from the bore top down to the driver.
    const sTop = top + L.h * 0.025;
    const sBot = gy - L.drvLen;
    ctx.strokeStyle = C.steel;
    ctx.lineWidth = Math.max(1, lw * 0.6);
    ctx.beginPath();
    ctx.moveTo(x, sTop);
    for (let z = 1; z <= 7; z++) {
      const zy = sTop + ((sBot - sTop) * z) / 8;
      ctx.lineTo(x + (z % 2 ? pw * 0.4 : -pw * 0.4), zy);
    }
    ctx.lineTo(x, sBot);
    ctx.stroke();

    // Driver pin (steel) above the gap.
    ctx.fillStyle = C.steel;
    ctx.fillRect(x - pw / 2 + jx, sBot, pw, L.drvLen);
    art.ink(ctx, lw * 0.8);
    ctx.strokeRect(x - pw / 2 + jx, sBot, pw, L.drvLen);

    // Key pin (brass) below it, with a pointed foot for the pick.
    const keyLen = L.keyRest - gapY(i, 0);
    const kb = gy + keyLen;
    ctx.fillStyle = C.brass;
    ctx.beginPath();
    ctx.moveTo(x - pw / 2 + jx, gy);
    ctx.lineTo(x + pw / 2 + jx, gy);
    ctx.lineTo(x + pw / 2 + jx, kb - pw * 0.35);
    ctx.lineTo(x + jx, kb);
    ctx.lineTo(x - pw / 2 + jx, kb - pw * 0.35);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // A set pin: a green tick of line under it.
    if (isSet[i]) {
      ctx.strokeStyle = C.green;
      ctx.lineWidth = lw * 1.6;
      ctx.beginPath();
      ctx.moveTo(x - bw * 0.7, shearY);
      ctx.lineTo(x + bw * 0.7, shearY);
      ctx.stroke();
    }

    // Pro set: the glint while the binding pin's gap is in the window.
    if (tier >= 2 && i === b && held === i && Math.abs(v - shear[i]) <= win / 2) {
      const r = pw * (0.75 + Math.sin(now * 18) * 0.15);
      ctx.fillStyle = C.cream;
      ctx.beginPath();
      ctx.moveTo(x + jx, gy - r);
      ctx.lineTo(x + jx + r * 0.22, gy - r * 0.22);
      ctx.lineTo(x + jx + r, gy);
      ctx.lineTo(x + jx + r * 0.22, gy + r * 0.22);
      ctx.lineTo(x + jx, gy + r);
      ctx.lineTo(x + jx - r * 0.22, gy + r * 0.22);
      ctx.lineTo(x + jx - r, gy);
      ctx.lineTo(x + jx - r * 0.22, gy - r * 0.22);
      ctx.closePath();
      ctx.fill();
      art.ink(ctx, lw * 0.5);
      ctx.stroke();
    }
  }

  /** The tension wrench at the left, and the pick reaching under the chosen pin. */
  function drawPick(ctx) {
    const { lw, hx, plugB } = L;
    const i = held >= 0 ? held : cursor;
    const v = isSet[i] ? shear[i] : eff(i);
    const tipX = colX(i);
    const tipY = gapY(i, v) + (L.keyRest - gapY(i, 0)) + lw;
    const baseX = L.x + L.w * 0.01;
    const baseY = plugB + L.h * 0.075;
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass ? C.steel : C.ink;
      ctx.lineWidth = pass ? lw * 0.9 : lw * 2.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(baseX, baseY);
      ctx.lineTo(tipX - L.colW * 0.3, baseY);
      ctx.lineTo(tipX, Math.min(tipY, baseY));
      ctx.stroke();
      // The wrench: an L hooked into the keyway's left end.
      ctx.beginPath();
      ctx.moveTo(L.x + L.w * 0.005, plugB + L.h * 0.02);
      ctx.lineTo(hx + L.colW * 0.25, plugB + L.h * 0.02);
      ctx.lineTo(hx + L.colW * 0.25, plugB + L.h * 0.045);
      ctx.stroke();
    }
  }

  /* ------------------------------------------------------------------ input */

  function colAt(p) {
    if (p.x < L.hx - 10 || p.x > L.hx + L.hw + 10) return -1;
    if (p.y < L.top - L.h * 0.08 || p.y > L.y + L.h) return -1;
    return Math.max(0, Math.min(n - 1, Math.floor((p.x - L.hx) / L.colW)));
  }

  function pointerDown(p) {
    if (L.x < 0 || kit.locked() || grab !== null) return;
    const i = colAt(p);
    if (i < 0) return;
    cursor = i;
    if (isSet[i]) return;
    if (held >= 0 && held !== i) release(held);
    grab = p.id;
    held = i;
    startY = p.y;
    startT = target[i];
  }

  function pointerMove(p) {
    if (grab === null || p.id !== grab || held < 0) return;
    target[held] = Math.max(0, Math.min(1.2, startT + (startY - p.y) / L.travel));
  }

  function pointerUp(p) {
    if (p.id !== grab) return;
    grab = null;
    if (held >= 0) release(held);
  }

  function key(e) {
    if (kit.locked()) return false;
    const step = Math.max(0.012, win * 0.4) * (e.shiftKey ? 3 : 1);
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      if (held >= 0) release(held);
      cursor = (cursor + (k === 'ArrowLeft' ? n - 1 : 1)) % n;
      return true;
    }
    if (k.length === 1 && k >= '1' && k <= '9') {
      const i = k.charCodeAt(0) - 49;
      if (i >= n) return false;
      if (held >= 0) release(held);
      cursor = i;
      return true;
    }
    if (k === 'ArrowUp') {
      if (isSet[cursor]) return true;
      if (held !== cursor) {
        if (held >= 0) release(held);
        held = cursor;
      }
      target[cursor] = Math.min(1.2, target[cursor] + step);
      return true;
    }
    if (k === 'ArrowDown') {
      if (held === cursor) {
        target[cursor] = Math.max(0, target[cursor] - step);
        if (target[cursor] === 0) held = -1;
      }
      return true;
    }
    if (k === ' ' || k === 'Enter') {
      if (held >= 0) release(held);
      return true;
    }
    return false;
  }

  function hint() {
    if (kit.done || kit.forcing) return t('pz.open');
    if (dropped > 0) return t('pz.pins.dropped');
    if (tier >= 3) return t('pz.pins.marked');
    if (good > 0) return t('pz.pins.good');
    return t('pz.pins.find');
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
      if (kit.force()) {
        held = -1;
        grab = null;
      }
    },
    destroy() {
      grab = null;
      held = -1;
    },
  };
}
