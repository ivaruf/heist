/*
 * tiles.js — the pressure floor.
 *
 * A grid of floor tiles between a doormat and the way out. Most are wired to
 * the alarm; one winding path of them is safe. The path lights up tile by
 * tile (with a beep each, like a Simon game), goes dark, and the thief walks
 * it from memory, one tile at a time. It is the memory trap, beside the
 * steering of lasers and the timing of cameras.
 *
 * Movement is between 4-neighbours only: tap a neighbouring tile, or use the
 * arrows / WASD. The doormat under the grid is safe and can be walked along
 * freely, and from it any tile of the bottom row is one tap away (the thief
 * shuffles along the mat to it), so nobody has to aim for a starting column.
 * Any safe tile is fine to stand on, in any order; stepping on the last tile
 * of the path, in the top row, is the way out.
 *
 * A wrong tile: KRAKK!, a mistake of severity 1, and the whole path flashes
 * again with input held until it has. Below difficulty 5 the thief stays on
 * the last safe tile; from 5 up they go back to the mat, which is what makes
 * a long path a memory test rather than a series of guesses. Input is held
 * through every flash, so a wrong tap can never chain into a second one.
 *
 * Solvable by construction: the path is a monotone walk — sideways runs
 * inside a row, then one step up — so it is connected, never crosses itself,
 * starts in the bottom row and ends in the top one. Checked over many seeds.
 *
 * Chalk (tool tiers, DESIGN §4, cumulative):
 *   0 — the safe path is flashed once, briefly.
 *   1 — Chalk: the path is shown twice as long.
 *   2 — Replay: one extra showing per room, on demand (the eye button, or R).
 *   3 — Chalk marks: the first three safe tiles stay marked.
 */

import * as art from '../art.js';
import { t, addStrings } from '../i18n.js';

addStrings({
  nb: {
    'trap.tiles.hintWatch': 'Se nøye! Husk de trygge flisene.',
    'trap.tiles.hint': 'Gå på de trygge flisene til utgangen. Trykk på flisen ved siden av deg, eller bruk pilene.',
    'trap.tiles.hintReplay': 'Glemt veien? Trykk på øyet (eller R) for å se den én gang til.',
    'trap.tiles.hintWrong': 'Feil flis! Se på veien en gang til.',
    'trap.tiles.crack': 'KRAKK!',
    'trap.tiles.watch': 'SE!',
  },
  en: {
    'trap.tiles.hintWatch': 'Watch closely! Remember the safe tiles.',
    'trap.tiles.hint': 'Walk the safe tiles to the exit. Tap the tile next to you, or use the arrows.',
    'trap.tiles.hintReplay': 'Forgot the way? Tap the eye (or R) to see it once more.',
    'trap.tiles.hintWrong': 'Wrong tile! Watch the path once more.',
    'trap.tiles.crack': 'CRACK!',
    'trap.tiles.watch': 'WATCH!',
  },
});

const TOP = 0.9; // exit strip above the grid, in tile units
const MAT = 1.0; // doormat strip below it
const HOP = 0.16; // seconds per step

const NOOP = () => {};
const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/*
 * The safe path, bottom row to top. Rows are numbered top-down (0 = top),
 * like the screen. Returns { cols, rows, path: [{c, r}], safe: Uint8Array }.
 */
export function generate(difficulty, rng) {
  const d = clamp(+difficulty || 1, 1, 10);
  const k = (d - 1) / 9;
  const cols = Math.round(lerp(3, 6, k));
  const rows = Math.round(lerp(3, 7, k));
  const wiggle = lerp(0.35, 0.8, k); // chance a row has a sideways run
  const maxRun = 1 + Math.floor(k * 2.5);
  const path = [];
  let c = Math.floor(rng() * cols);
  for (let r = rows - 1; r >= 0; r--) {
    path.push({ c, r });
    if (rng() < wiggle) {
      let dir = rng() < 0.5 ? -1 : 1;
      if (c + dir < 0 || c + dir >= cols) dir = -dir;
      const room = dir > 0 ? cols - 1 - c : c;
      const run = Math.min(room, 1 + Math.floor(rng() * maxRun));
      for (let i = 0; i < run; i++) {
        c += dir;
        path.push({ c, r });
      }
    }
  }
  const safe = new Uint8Array(cols * rows);
  for (const p of path) safe[p.r * cols + p.c] = 1;
  return { cols, rows, path, safe };
}

const BURST = { size: 0, fill: '', rot: 0, life: 0 };
const CAP = { size: 0, align: 'center', fill: '', stroke: '' };
const BTN = { fill: '', r: 6, shadow: true };

export function createTiles(opts = {}) {
  const tier = opts.tier | 0;
  const rng = opts.rng || Math.random;
  const sfx = opts.sfx || NOOP;
  const ev = opts.events || {};
  const mistake = ev.mistake || NOOP;
  const progress = ev.progress || NOOP;
  const solved = ev.solved || NOOP;

  const room = generate(opts.difficulty, rng);
  const { cols, rows, path, safe } = room;
  const d = clamp(+opts.difficulty || 1, 1, 10);
  const k = (d - 1) / 9;
  const W = cols;
  const H = TOP + rows + MAT;
  const show = tier >= 1 ? 2 : 1; // Chalk shows it twice as long
  const stepT = lerp(0.42, 0.2, k) * show;
  const holdT = lerp(1.4, 0.45, k) * show;
  const lead = 0.5;
  const flashLen = lead + path.length * stepT + holdT;
  const sendBack = d >= 5;
  const order = new Int16Array(cols * rows).fill(-1); // index along the path
  for (let i = 0; i < path.length; i++) order[path[i].r * cols + path[i].c] = i;
  const walked = new Uint8Array(cols * rows);

  let time = 0;
  let phase = 'watch'; // watch | walk | step | oops | exit | done | dash
  let timer = 0;
  let lastBeep = -1;
  let replays = tier >= 2 ? 1 : 0;
  let wrongs = 0;
  // Position in cells: r === rows is the mat.
  let pc = Math.floor(cols / 2); // starts on the mat, mid-room
  let pr = rows;
  let fx = 0;
  let fy = 0;
  let face = -Math.PI / 2;
  let badC = -1;
  let badR = -1;
  let best = 0;
  let didSolve = false;
  let dashI = 0;
  let queued = 0; // one buffered arrow press during a step
  const burst = { key: '', x: 0, y: 0, age: 9, dur: 0.9, fill: 'red' };
  const say = (key, bx, by, fill) => {
    burst.key = key;
    burst.x = bx;
    burst.y = by;
    burst.age = 0;
    burst.fill = fill;
  };

  // Cell centres in room units.
  const cx = (c) => c + 0.5;
  const cy = (r) => TOP + r + 0.5;
  let x = cx(pc);
  let y = cy(pr);

  function startFlash() {
    phase = 'watch';
    timer = 0;
    lastBeep = -1;
  }

  function stepTo(c, r) {
    fx = x;
    fy = y;
    face = Math.atan2(cy(r) - y, cx(c) - x);
    pc = c;
    pr = r;
    phase = 'step';
    timer = 0;
  }

  function land() {
    if (pr === rows) {
      phase = 'walk';
      return;
    }
    const i = pr * cols + pc;
    if (!safe[i]) {
      badC = pc;
      badR = pr;
      wrongs++;
      phase = 'oops';
      timer = 0;
      say('trap.tiles.crack', cx(pc), cy(pr) - 0.6, 'red');
      sfx('buzz');
      mistake(1);
      return;
    }
    walked[i] = 1;
    sfx('tick', { rate: 1 + order[i] * 0.05 });
    const f = (order[i] + 1) / path.length;
    if (f > best) {
      best = f;
      progress(f);
    }
    if (order[i] === path.length - 1) {
      phase = 'exit';
      timer = 0;
      fx = x;
      fy = y;
      sfx('chime');
      say('trap.phew', W / 2, TOP * 0.5 + 0.4, 'mustard');
      return;
    }
    phase = 'walk';
    if (queued) {
      const q = queued;
      queued = 0;
      move(q);
    }
  }

  function update(dt) {
    time += dt;
    burst.age += dt;
    timer += dt;
    if (phase === 'watch') {
      const i = Math.floor((timer - lead) / stepT);
      if (i > lastBeep && i < path.length && timer >= lead) {
        lastBeep = i;
        sfx('beep', { rate: 1 + i * 0.06 });
      }
      if (timer >= flashLen) phase = 'walk';
    } else if (phase === 'step' || phase === 'dash') {
      const f = Math.min(1, timer / (phase === 'dash' ? HOP * 0.5 : HOP));
      x = fx + (cx(pc) - fx) * f;
      y = fy + (cy(pr) - fy) * f;
      if (f >= 1) {
        if (phase === 'dash') {
          dashI++;
          if (dashI < path.length) {
            fx = x;
            fy = y;
            pc = path[dashI].c;
            pr = path[dashI].r;
            face = Math.atan2(cy(pr) - y, cx(pc) - x);
            timer = 0;
          } else {
            phase = 'exit';
            timer = 0;
            fx = x;
            fy = y;
            sfx('chime');
            say('trap.phew', W / 2, TOP * 0.5 + 0.4, 'mustard');
          }
        } else land();
      }
    } else if (phase === 'oops') {
      if (timer >= 0.7) {
        badC = -1;
        if (sendBack) {
          walked.fill(0);
          pr = rows;
          x = cx(pc);
          y = cy(pr);
        } else {
          // Back onto the tile they came from: the last safe one, or the mat.
          x = fx;
          y = fy;
          pc = Math.round(fx - 0.5);
          pr = Math.round(fy - TOP - 0.5);
        }
        queued = 0;
        startFlash();
      }
    } else if (phase === 'exit') {
      y = fy - Math.min(1, timer / 0.4) * 1.2;
      if (timer >= 0.6 && !didSolve) {
        didSolve = true;
        phase = 'done';
        progress(1);
        solved();
      }
    }
  }

  function canStep(c, r) {
    if (c < 0 || c >= cols || r < 0 || r > rows) return false;
    if (pr === rows && r === rows) return true; // along the mat
    if (pr === rows && r === rows - 1) return true; // mat to any bottom tile
    return Math.abs(c - pc) + Math.abs(r - pr) === 1;
  }

  // dir bits: 1 up, 2 down, 4 left, 8 right.
  function move(dir) {
    if (phase === 'step') {
      queued = dir;
      return;
    }
    if (phase !== 'walk') return;
    const c = pc + (dir === 8 ? 1 : dir === 4 ? -1 : 0);
    const r = pr + (dir === 2 ? 1 : dir === 1 ? -1 : 0);
    if (c < 0 || c >= cols || r < 0 || r > rows) return;
    stepTo(c, r);
  }

  // ---- drawing ---------------------------------------------------------------

  const L = { x: -1, y: -1, w: -1, h: -1, dpr: 0, s: 1, ox: 0, oy: 0, bx: 0, by: 0, bs: 0 };
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
    L.s = Math.max(1, Math.min((rect.w - pad * 2) / W, (rect.h - pad * 2) / H, 110));
    L.ox = rect.x + (rect.w - W * L.s) / 2;
    L.oy = rect.y + (rect.h - H * L.s) / 2;
    // The replay eye sits at the right end of the mat.
    L.bs = Math.max(30, L.s * 0.75);
    L.bx = L.ox + W * L.s - L.bs - 4;
    L.by = L.oy + (TOP + rows + MAT / 2) * L.s - L.bs / 2;
    bg = bake(bg, L, paintRoom);
  }

  function paintRoom(g) {
    const s = L.s;
    const PAL = art.PAL;
    art.panel(g, L.ox, L.oy, W * s, H * s, { fill: PAL.night, r: 4, shadow: true });
    // Exit strip and doormat.
    g.fillStyle = PAL.navy;
    g.fillRect(L.ox, L.oy, W * s, TOP * s);
    g.fillStyle = PAL.shadow;
    g.fillRect(L.ox + 2, L.oy + (TOP + rows) * s + 3, W * s - 4, MAT * s - 6);
    art.halftone(g, L.ox, L.oy + (TOP + rows) * s, W * s, MAT * s, { color: PAL.brass, spacing: Math.max(4, s * 0.12), angle: 0.785, from: 0.35, to: 0.1 });
    // The tiles themselves, each shaded so the grid reads as raised plates.
    const gap = Math.max(2, s * 0.06);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const tx = L.ox + c * s + gap;
        const ty = L.oy + (TOP + r) * s + gap;
        const ts = s - gap * 2;
        g.fillStyle = PAL.steel;
        g.fillRect(tx, ty, ts, ts);
        art.halftone(g, tx, ty, ts, ts, { color: PAL.steelDark, spacing: Math.max(3, s * 0.1), angle: 0.785, from: 0.05, to: 0.4 });
        art.ink(g, Math.max(1, art.LINE * 0.6));
        g.strokeRect(tx, ty, ts, ts);
      }
    }
    art.ink(g, art.LINE);
    g.strokeRect(L.ox, L.oy, W * s, H * s);
  }

  function fillTile(ctx, c, r, color, alpha) {
    const s = L.s;
    const gap = Math.max(2, s * 0.06);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(L.ox + c * s + gap, L.oy + (TOP + r) * s + gap, s - gap * 2, s - gap * 2);
  }

  function draw(ctx, rect, now) {
    relayout(rect);
    const PAL = art.PAL;
    const s = L.s;
    if (bg) ctx.drawImage(bg, L.x, L.y, L.w, L.h);

    // The flash: tiles light in order and stay lit until the hold ends.
    if (phase === 'watch') {
      const lit = (timer - lead) / stepT;
      const fade = timer > flashLen - 0.3 ? (flashLen - timer) / 0.3 : 1;
      for (let i = 0; i < path.length && i < lit; i++) {
        const fresh = lit - i < 1 ? 1 : 0.8;
        fillTile(ctx, path[i].c, path[i].r, PAL.mustard, fresh * fade);
      }
    }
    // Footsteps on safe tiles already walked.
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (walked[r * cols + c]) fillTile(ctx, c, r, PAL.cream, 0.45);
      }
    }
    if (badC >= 0) fillTile(ctx, badC, badR, PAL.red, 0.85);
    ctx.globalAlpha = 1;

    // Chalk marks (tier 3): a cross on the first three safe tiles.
    if (tier >= 3) {
      ctx.strokeStyle = PAL.cream;
      ctx.lineWidth = Math.max(2, s * 0.06);
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < 3 && i < path.length; i++) {
        const mx = L.ox + cx(path[i].c) * s;
        const my = L.oy + cy(path[i].r) * s;
        const m = s * 0.2;
        ctx.moveTo(mx - m, my - m);
        ctx.lineTo(mx + m, my + m);
        ctx.moveTo(mx + m, my - m);
        ctx.lineTo(mx - m, my + m);
      }
      ctx.stroke();
    }

    // Tappable neighbours get a thin ring, so a tablet player knows where to go.
    if (phase === 'walk') {
      ctx.strokeStyle = PAL.mustard;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.5 + 0.25 * Math.sin(time * 5);
      ctx.beginPath();
      for (let r = Math.max(0, pr - 1); r <= Math.min(rows - 1, pr + 1); r++) {
        for (let c = 0; c < cols; c++) {
          if (!canStep(c, r) || (c === pc && r === pr)) continue;
          ctx.rect(L.ox + c * s + s * 0.12, L.oy + (TOP + r) * s + s * 0.12, s * 0.76, s * 0.76);
        }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    CAP.size = Math.max(11, s * 0.4);
    CAP.fill = PAL.green;
    CAP.stroke = PAL.ink;
    art.caption(ctx, L.ox + (W / 2) * s, L.oy + TOP * 0.62 * s, t('trap.exit'), CAP);

    // The replay eye (tier 2+), while one is left.
    if (replays > 0) {
      const bs = L.bs;
      BTN.fill = phase === 'walk' ? PAL.mustard : PAL.steel;
      art.panel(ctx, L.bx, L.by, bs, bs, BTN);
      const ex = L.bx + bs / 2;
      const ey = L.by + bs / 2;
      art.ink(ctx, Math.max(1.5, art.LINE * 0.7));
      ctx.beginPath();
      ctx.moveTo(ex - bs * 0.32, ey);
      ctx.quadraticCurveTo(ex, ey - bs * 0.32, ex + bs * 0.32, ey);
      ctx.quadraticCurveTo(ex, ey + bs * 0.32, ex - bs * 0.32, ey);
      ctx.stroke();
      ctx.fillStyle = PAL.ink;
      ctx.beginPath();
      ctx.arc(ex, ey, bs * 0.09, 0, Math.PI * 2);
      ctx.fill();
    }

    if (phase !== 'done') art.drawThiefTop(ctx, L.ox + x * s, L.oy + y * s, s * 0.7, face, now, phase === 'step' || phase === 'dash' || phase === 'exit');

    if (phase === 'watch' && timer < lead + stepT) {
      CAP.size = Math.max(14, s * 0.5);
      CAP.fill = PAL.mustard;
      art.caption(ctx, L.ox + (W / 2) * s, L.oy + (TOP + rows / 2) * s, t('trap.tiles.watch'), CAP);
    }
    if (burst.age < burst.dur) {
      BURST.size = clamp(s * 1.1, 26, 56);
      BURST.fill = PAL[burst.fill];
      BURST.rot = -0.1;
      BURST.life = Math.min(1, burst.age / 0.1) * Math.min(1, (burst.dur - burst.age) / 0.3); // the puzzles' envelope
      art.burst(ctx, L.ox + clamp(burst.x, 1, W - 1) * s, L.oy + clamp(burst.y, 0.6, H - 0.6) * s, t(burst.key), BURST);
    }
  }

  // ---- input -----------------------------------------------------------------

  function replay() {
    if (replays <= 0 || phase !== 'walk') return false;
    replays--;
    sfx('ui');
    startFlash();
    return true;
  }

  function pointerDown(p) {
    if (L.w < 0) return;
    if (replays > 0 && p.x >= L.bx && p.x <= L.bx + L.bs && p.y >= L.by && p.y <= L.by + L.bs) {
      replay();
      return;
    }
    if (phase !== 'walk') return;
    const c = Math.floor((p.x - L.ox) / L.s);
    const r = Math.floor((p.y - L.oy) / L.s - TOP);
    if (c === pc && r === pr) return;
    if (canStep(c, r)) stepTo(c, r);
  }

  function key(e) {
    const k = e.key;
    if (k === 'r' || k === 'R') return replays > 0 ? (replay(), true) : false;
    const dir =
      k === 'ArrowUp' || k === 'w' || k === 'W' ? 1
      : k === 'ArrowDown' || k === 's' || k === 'S' ? 2
      : k === 'ArrowLeft' || k === 'a' || k === 'A' ? 4
      : k === 'ArrowRight' || k === 'd' || k === 'D' ? 8
      : 0;
    if (!dir) return false;
    if (!e.repeat) move(dir);
    return true;
  }

  function hint() {
    if (phase === 'oops' || (phase === 'watch' && wrongs > 0 && timer < 1)) return t('trap.tiles.hintWrong');
    if (phase === 'watch') return t('trap.tiles.hintWatch');
    if (replays > 0 && phase === 'walk') return t('trap.tiles.hintReplay');
    return t('trap.tiles.hint');
  }

  function forceSolve() {
    if (phase === 'dash' || phase === 'exit' || phase === 'done') return;
    badC = -1;
    queued = 0;
    // Start the dash at the first path tile, from wherever the thief stands.
    dashI = 0;
    fx = x;
    fy = y;
    pc = path[0].c;
    pr = path[0].r;
    timer = 0;
    phase = 'dash';
  }

  function destroy() {
    bg = null;
  }

  return { update, draw, pointerDown, pointerMove: NOOP, pointerUp: NOOP, key, hint, forceSolve, destroy, _room: room };
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
