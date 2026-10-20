/*
 * keypad.js — the vault keypad: deduce the code from the lights.
 *
 * THE MECHANIC
 * A 3–5 digit code. Type a guess and press OK. Every digit of the guess gets
 * a light: green, right digit in the right place; amber, the digit is in the
 * code but somewhere else; dark, not in the code (counted properly when a
 * digit repeats, as in Wordle). Right, and the bolt goes KA-KLONK. Wrong,
 * and the box goes BZZT — a mistake (severity 1) — and the guess and its
 * lights go up on the display's history. Pressing OK with too few digits
 * costs nothing; it only says how many the code has.
 *
 * The skill is the deduction: use each guess to test as much as possible,
 * because each wrong one costs seconds.
 *
 * DIFFICULTY (u = 0..1 over difficulty 1..10)
 *   length       3 (d1–3), 4 (d4–7), 5 (d8–10)
 *   repeats      digits are all different below d6; from d6 a digit may
 *                appear twice or more
 *   key marks    below d6 the keypad itself remembers what the lights have
 *                told you — a key goes dark when its digit is not in the
 *                code, and wears a green or amber dot when it is. From d6
 *                you keep that in your head (the last three guesses stay on
 *                the display).
 *
 * TIERS (DESIGN.md §4, cumulative)
 *   0 nothing      just the lights after each guess
 *   1 powder       the keys whose digits are in the code are smudged, all
 *                  alike; with repeats, fewer smudges than digits says so
 *   2 UV torch     the smudges show wear: the key first pressed in the code
 *                  is the most worn (densest dots), each later one lighter.
 *                  The steps between wear levels shrink with difficulty
 *                  (0.22 → 0.12), so at the top it takes a careful look
 *   3 code reader  one digit of the code is shown, in green, above its slot
 *
 * INPUT
 *   pointer   tap the keys: digits, ← to rub out one, OK to try
 *   keyboard  0–9 (top row or numpad), Backspace, Enter
 */

import * as art from '../art.js';
import { t, addStrings } from '../i18n.js';

addStrings({
  nb: {
    'pz.keypad.ok': 'OK',
    'pz.keypad.start': (n) => `Tast en kode med ${n} sifre, og trykk OK.`,
    'pz.keypad.more': (n) => `Koden har ${n} sifre. Tast flere!`,
    'pz.keypad.pressOk': 'Trykk OK for å prøve koden.',
    'pz.keypad.lights': 'Grønn: riktig plass. Gul: feil plass. Mørk: ikke med.',
    'pz.keypad.smudge': 'Tastene med fingermerker er med i koden.',
    'pz.keypad.wear': 'Den mest slitte tasten ble trykket først.',
    'pz.keypad.twice': 'Færre merker enn sifre: ett tall er med to ganger!',
    'pz.keypad.reader': 'Kodeleseren viser deg ett av sifrene.',
  },
  en: {
    'pz.keypad.ok': 'OK',
    'pz.keypad.start': (n) => `Type a ${n}-digit code and press OK.`,
    'pz.keypad.more': (n) => `The code has ${n} digits. Type more!`,
    'pz.keypad.pressOk': 'Press OK to try the code.',
    'pz.keypad.lights': 'Green: right spot. Yellow: wrong spot. Dark: not in it.',
    'pz.keypad.smudge': 'The smudged keys are in the code.',
    'pz.keypad.wear': 'The most worn key was pressed first.',
    'pz.keypad.twice': 'Fewer smudges than digits: one number is used twice!',
    'pz.keypad.reader': 'The code reader shows you one of the digits.',
  },
});

const DIG = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const HIST = 3; // guesses kept on the display
// Key index → what it is: 0–8 are digits 1–9, 9 rubs out, 10 is 0, 11 is OK.
const KEY_DIGIT = [1, 2, 3, 4, 5, 6, 7, 8, 9, -1, 0, -2];
const BACK = -1;
const OK = -2;

export function createKeypad(kit) {
  const { tier, rng, C } = kit;
  const len = 3 + Math.round(kit.u * 2);
  const repeats = kit.difficulty >= 6;
  const marks = kit.difficulty < 6;

  /* The code. Distinct digits are drawn from a shuffled 0–9; with repeats,
   * each digit is free. Both paths always consume the same rng calls, and
   * the reader's slot is drawn last, so the code a seed gives does not
   * depend on which tools you own. */
  const pool = kit.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const code = new Int8Array(len);
  for (let i = 0; i < len; i++) {
    const free = Math.floor(rng() * 10);
    code[i] = repeats ? free : pool[i];
  }
  const revealAt = Math.floor(rng() * len);

  // Smudges and wear: in the code → smudged; first pressed → most worn.
  const wear = new Float32Array(10);
  const gap = kit.lerp(0.22, 0.12);
  let smudges = 0;
  for (let i = len - 1; i >= 0; i--) wear[code[i]] = 1 - i * gap;
  for (let d = 0; d < 10; d++) if (wear[d] > 0) smudges++;

  const entry = new Int8Array(len);
  let count = 0;
  const hist = new Int8Array(HIST * len);
  const histLit = new Int8Array(HIST * len); // 0 dark, 1 amber, 2 green
  let histN = 0; // rows filled, newest at row 0
  const known = new Int8Array(10); // 0 unknown, 1 not in code, 2 in it, 3 placed once
  const litNow = new Int8Array(len);
  const tally = new Int8Array(10);
  const press = new Float32Array(12); // key press animation
  let short = 0; // seconds of "the code has N digits"
  let flash = 0; // the display flashing red after a wrong guess
  let openT = 0;

  /* -------------------------------------------------------------- the rules */

  function score() {
    tally.fill(0);
    for (let i = 0; i < len; i++) {
      litNow[i] = 0;
      if (entry[i] === code[i]) litNow[i] = 2;
      else tally[code[i]]++;
    }
    let greens = 0;
    for (let i = 0; i < len; i++) {
      if (litNow[i] === 2) {
        greens++;
        continue;
      }
      if (tally[entry[i]] > 0) {
        litNow[i] = 1;
        tally[entry[i]]--;
      }
    }
    return greens;
  }

  function pushHistory() {
    hist.copyWithin(len, 0, (HIST - 1) * len);
    histLit.copyWithin(len, 0, (HIST - 1) * len);
    for (let i = 0; i < len; i++) {
      hist[i] = entry[i];
      histLit[i] = litNow[i];
      const d = entry[i];
      // What the keys remember: green beats amber beats dark.
      if (litNow[i] === 2) known[d] = 3;
      else if (litNow[i] === 1) known[d] = Math.max(known[d], 2);
      else if (known[d] === 0) known[d] = 1;
    }
    histN = Math.min(HIST, histN + 1);
  }

  function typeDigit(d) {
    if (count >= len) {
      kit.sfx('ui');
      return;
    }
    entry[count++] = d;
    kit.sfx('beep');
  }

  function rubOut() {
    if (count > 0) count--;
    kit.sfx('ui');
  }

  function submit() {
    if (count < len) {
      short = 2.5;
      kit.sfx('ui');
      return;
    }
    const greens = score();
    pushHistory();
    if (greens === len) {
      openT = 0.0001;
      kit.sfx('chime');
      kit.burst(0.5, 0.2, 'pz.burst.beep', C.green, 0.16, 0.8);
      kit.solve();
      return;
    }
    kit.sfx('buzz');
    kit.burst(0.5, 0.2, 'pz.burst.buzz', C.red, 0.15);
    kit.mistake(1);
    flash = 1;
    count = 0;
    let best = 0;
    for (let i = 0; i < len; i++) if (litNow[i] === 2) best++;
    kit.progress((best / len) * 0.9);
  }

  function pressKey(idx) {
    if (kit.locked()) return;
    press[idx] = 1;
    const d = KEY_DIGIT[idx];
    if (d === BACK) rubOut();
    else if (d === OK) submit();
    else typeDigit(d);
  }

  function update(dt) {
    kit.update(dt);
    for (let i = 0; i < 12; i++) if (press[i] > 0) press[i] = Math.max(0, press[i] - dt * 6);
    if (short > 0) short = Math.max(0, short - dt);
    if (flash > 0) flash = Math.max(0, flash - dt * 1.5);
    if (openT > 0 && openT < 1) openT = Math.min(1, openT + dt * 2);
  }

  /* ------------------------------------------------------------------- draw */

  const L = { x: -1, y: 0, w: 0, h: 0, s: 0, lw: 0, dx: 0, dy: 0, dw: 0, dh: 0, es: 0, ey: 0, rh: 0, hs: 0, kx: 0, ky: 0, cell: 0, ks: 0 };
  const PANEL = { fill: '', r: 0 };
  const METAL = { r: 0, tone: 'dark' };
  const CAP = { size: 0, align: 'center', fill: '', stroke: '' };
  const HALF = { color: '', spacing: 0, angle: 0.8, from: 0.4, to: 0.4 };

  function layout(rect) {
    if (rect.x === L.x && rect.y === L.y && rect.w === L.w && rect.h === L.h) return;
    L.x = rect.x;
    L.y = rect.y;
    L.w = rect.w;
    L.h = rect.h;
    L.s = Math.min(rect.w, rect.h);
    L.lw = kit.line(L.s);
    L.dw = Math.min(rect.w * 0.88, rect.h * 1.1);
    L.dx = rect.x + (rect.w - L.dw) / 2;
    L.dy = rect.y + rect.h * 0.03;
    L.dh = rect.h * 0.37;
    L.es = Math.min((L.dw * 0.84) / len, L.dh * 0.4);
    L.ey = L.dy + L.dh * 0.74;
    L.rh = L.dh * 0.16;
    L.hs = Math.min(L.rh * 0.9, (L.dw * 0.6) / len);
    const kw = Math.min(rect.w * 0.8, rect.h * 0.75);
    const kh = rect.h * 0.56;
    L.cell = Math.min(kw / 3, kh / 4);
    L.ks = L.cell * 0.86;
    L.kx = rect.x + (rect.w - L.cell * 3) / 2;
    L.ky = rect.y + rect.h * 0.425;
  }

  function draw(ctx, rect, now) {
    layout(rect);
    ctx.save();
    ctx.translate(kit.shakeX(L.s), 0);
    drawDisplay(ctx, now);
    for (let i = 0; i < 12; i++) drawKey(ctx, i);
    ctx.restore();
    kit.drawBursts(ctx, rect);
  }

  function drawDisplay(ctx, now) {
    const { dx, dy, dw, dh, lw, es, ey, rh, hs } = L;
    PANEL.fill = C.night;
    PANEL.r = L.s * 0.025;
    art.panel(ctx, dx, dy, dw, dh, PANEL);
    if (flash > 0) {
      ctx.globalAlpha = flash * 0.45;
      ctx.fillStyle = C.red;
      ctx.fillRect(dx, dy, dw, dh);
      ctx.globalAlpha = 1;
    }

    // History: the last guesses, newest at the bottom, each digit on its light.
    CAP.align = 'center';
    CAP.stroke = C.ink;
    CAP.size = Math.max(10, hs * 0.72);
    for (let r = 0; r < histN; r++) {
      const ry = dy + dh * 0.06 + (HIST - 1 - r) * rh + rh / 2;
      for (let i = 0; i < len; i++) {
        const cx = dx + dw / 2 + (i - (len - 1) / 2) * hs * 1.12;
        const lit = histLit[r * len + i];
        ctx.fillStyle = lit === 2 ? C.green : lit === 1 ? C.amber : C.steelDark;
        ctx.fillRect(cx - hs / 2, ry - hs / 2, hs, hs);
        art.ink(ctx, Math.max(1, lw * 0.4));
        ctx.strokeRect(cx - hs / 2, ry - hs / 2, hs, hs);
        CAP.fill = C.cream;
        art.caption(ctx, cx, ry, DIG[hist[r * len + i]], CAP);
      }
    }

    // The entry: one big slot per digit.
    CAP.size = Math.max(14, es * 0.62);
    for (let i = 0; i < len; i++) {
      const cx = dx + dw / 2 + (i - (len - 1) / 2) * es * 1.12;
      ctx.fillStyle = openT > 0 ? C.green : C.navy;
      ctx.fillRect(cx - es / 2, ey - es / 2, es, es);
      art.ink(ctx, lw * 0.7);
      ctx.strokeRect(cx - es / 2, ey - es / 2, es, es);
      let d = -1;
      if (kit.forcing && kit.forceT < 0.7) d = Math.floor(kit.time * 24 + i * 3) % 10;
      else if (kit.done) d = code[i];
      else if (i < count) d = entry[i];
      if (d >= 0) {
        CAP.fill = C.mustard;
        CAP.size = Math.max(14, es * 0.62);
        art.caption(ctx, cx, ey, DIG[d], CAP);
      } else if (i === count && !kit.locked() && Math.floor(now * 2) % 2 === 0) {
        // The blinking cursor.
        ctx.fillStyle = C.mustard;
        ctx.fillRect(cx - es * 0.25, ey + es * 0.28, es * 0.5, Math.max(2, es * 0.07));
      }
      // Code reader: the known digit in green, above its slot.
      if (tier >= 3 && i === revealAt && !kit.done) {
        CAP.fill = C.green;
        CAP.size = Math.max(11, es * 0.36);
        art.caption(ctx, cx, ey - es * 0.72, DIG[code[i]], CAP);
      }
    }
  }

  function drawKey(ctx, idx) {
    const col = idx % 3;
    const row = (idx / 3) | 0;
    const { cell, ks, lw } = L;
    const x = L.kx + col * cell + (cell - ks) / 2;
    const y = L.ky + row * cell + (cell - ks) / 2 + press[idx] * lw * 1.5;
    const d = KEY_DIGIT[idx];

    let fill = C.cream;
    if (d === OK) fill = C.green;
    else if (d === BACK) fill = C.steel;
    else if (marks && known[d] === 1) fill = C.steelDark;
    if (press[idx] > 0.5) fill = C.mustard;
    PANEL.fill = fill;
    PANEL.r = ks * 0.16;
    art.panel(ctx, x, y, ks, ks, PANEL);

    // Fingerprint powder: halftone smudges, denser for more wear under the UV torch.
    if (tier >= 1 && d >= 0 && wear[d] > 0) {
      const sw = tier >= 2 ? wear[d] : 0.6;
      HALF.color = C.ink;
      HALF.spacing = Math.max(3, ks * 0.09);
      HALF.from = 0.15 + sw * 0.6;
      HALF.to = 0.15 + sw * 0.6;
      art.halftone(ctx, x + ks * 0.18, y + ks * 0.2, ks * 0.64, ks * 0.6, HALF);
    }

    CAP.align = 'center';
    CAP.stroke = C.ink;
    if (d >= 0) {
      CAP.size = Math.max(14, ks * 0.5);
      CAP.fill = marks && known[d] === 1 ? C.steel : C.paper;
      art.caption(ctx, x + ks / 2, y + ks / 2, DIG[d], CAP);
      // Key marks: what the lights have taught, as a corner dot.
      if (marks && known[d] >= 2) {
        ctx.fillStyle = known[d] === 3 ? C.green : C.amber;
        ctx.beginPath();
        ctx.arc(x + ks * 0.8, y + ks * 0.2, ks * 0.1, 0, Math.PI * 2);
        ctx.fill();
        art.ink(ctx, Math.max(1, lw * 0.4));
        ctx.stroke();
      }
    } else if (d === OK) {
      CAP.size = Math.max(12, ks * 0.34);
      CAP.fill = C.paper;
      art.caption(ctx, x + ks / 2, y + ks / 2, t('pz.keypad.ok'), CAP);
    } else {
      // Rub out: the shared back arrow, drawn.
      const cx = x + ks / 2;
      const cy = y + ks / 2;
      const a = ks * 0.22;
      art.ink(ctx, lw * 1.1);
      ctx.beginPath();
      ctx.moveTo(cx + a, cy);
      ctx.lineTo(cx - a, cy);
      ctx.moveTo(cx - a * 0.3, cy - a * 0.7);
      ctx.lineTo(cx - a, cy);
      ctx.lineTo(cx - a * 0.3, cy + a * 0.7);
      ctx.stroke();
    }
  }

  /* ------------------------------------------------------------------ input */

  function pointerDown(p) {
    if (L.x < 0 || kit.locked()) return;
    const col = Math.floor((p.x - L.kx) / L.cell);
    const row = Math.floor((p.y - L.ky) / L.cell);
    if (col < 0 || col > 2 || row < 0 || row > 3) return;
    pressKey(row * 3 + col);
  }

  function key(e) {
    if (kit.locked()) return false;
    const k = e.key;
    if (k.length === 1 && k >= '0' && k <= '9') {
      const d = k.charCodeAt(0) - 48;
      pressKey(d === 0 ? 10 : d - 1);
      return true;
    }
    if (k === 'Backspace' || k === 'Delete') {
      pressKey(9);
      return true;
    }
    if (k === 'Enter') {
      pressKey(11);
      return true;
    }
    return false;
  }

  function hint() {
    if (kit.done || kit.forcing) return t('pz.open');
    if (short > 0) return t('pz.keypad.more', len);
    if (count === len) return t('pz.keypad.pressOk');
    if (histN > 0) return t('pz.keypad.lights');
    if (tier >= 1 && smudges < len) return t('pz.keypad.twice');
    if (tier >= 3) return t('pz.keypad.reader');
    if (tier >= 2) return t('pz.keypad.wear');
    if (tier >= 1) return t('pz.keypad.smudge');
    return t('pz.keypad.start', len);
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
      kit.force();
    },
    destroy() {},
  };
}
