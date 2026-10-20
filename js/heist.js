/*
 * heist.js — one job, from the first touch to the getaway or the cuffs
 * (DESIGN.md §1, §8). It owns the canvas for the whole game: the city at
 * night behind the start screen, the board and the shop, and the run itself.
 *
 *   createHeist({ canvas, hud, hudItems, corner, onGetaway, onBusted })
 *     .start(job)     begin (or restart) a job; an attempt gets a fresh seed
 *     .abort()        drop the run, back to the city backdrop (Give up, and
 *                     leaving an end card)
 *     .pause() / .resume()   the menu: clock and update stop, puzzle hidden
 *     .running()      a job is in play (cracking or in an open beat)
 *     .job()          the job in hand, if any
 *     .setCardArt(canvas, pose)   draw the thief, animated, into an end
 *                     card's little canvas ('cheer' | 'busted'); null stops
 *
 * THE CANVAS is the full viewport at devicePixelRatio capped at 2, and the
 * context is scaled so every lane draws in CSS pixels (DESIGN.md §3.4).
 *
 * THE LAYOUT. The police meter runs across the top and stops short of the
 * three corner plates, measured from #corner itself rather than guessed, so
 * whatever the art lane makes them, the road never runs under a button. The
 * challenge (a lock or a trap) gets the largest rect that fits between the
 * meter and the DOM HUD along the bottom (measured too, and re-measured by a
 * ResizeObserver, because the HUD's height is CSS this file does not own).
 * Tall screens put the lock counter and the take under the meter and the hint
 * under the challenge; wide ones (a phone on its side, hub §2's landscape
 * rule) move both into side columns so the challenge keeps the full height.
 *
 * THE LOOP. Fixed step 1/60 s with an accumulator; frame dt clamped to 0.25 s
 * and at most 8 substeps a frame, so a tab that was away for a minute neither
 * fast-forwards the police nor spirals. Nothing allocates in draw: option
 * objects for art.* are made once and mutated, and every string drawn is
 * cached and rebuilt only when what it says changes (a whole second ticking
 * by, a lock opening, a language switch).
 *
 * THE CLOCK starts at job.time × mods.timeScale and does not move until the
 * player first touches the challenge — that touch trips the silent alarm and
 * the police car sets off. A mistake knocks heatSeconds × severity ×
 * mods.heatScale off it and jolts the meter. Between locks the open beat
 * (0.8 s: KA-CHUNK!, then the next challenge slides in) holds the clock: the
 * player cannot act during it, so it must not cost them. At zero: busted.
 *
 * GADGETS (DESIGN.md §4): `addTime` puts seconds back (capped at the full
 * clock, so a donut never shows the car reversing past the start), and
 * `solveLock` drills the current challenge open after N seconds with the
 * clock still running, via forceSolve(). Never on the last challenge. Spent
 * when used, committed at once — so a busted run has lost exactly the gadgets
 * it used and nothing else (DESIGN.md §1).
 *
 * LOCKS AND TRAPS are one slot: TRAP_KINDS.includes(kind) ? createTrap :
 * createPuzzle, same options, same object (DESIGN.md §6a), tier MODS[kind].
 * Every challenge gets its own events object tagged with a serial, so a late
 * callback from one that has already been replaced cannot open the next lock.
 *
 * A LANGUAGE SWITCH mid-run changes only text: the cached strings are marked
 * stale, item labels repainted; nothing pauses, resumes or restarts.
 */

import * as art from './art.js';
import { createPuzzle } from './puzzles/index.js';
import { createTrap, TRAP_KINDS } from './traps/index.js';
import { ITEMS, modsFor } from './tools.js';
import { splitPayout } from './jobs.js';
import { save, commit } from './save.js';
import { sfx } from './audio.js';
import { t, money } from './i18n.js';

const STEP = 1 / 60;
const MAX_STEPS = 8;
const BEAT = 0.8; // the open beat between challenges, seconds
const SWAP = 0.45; // ...at which the next one starts sliding in
const MARGIN = 12;

/** A small seeded PRNG, one stream per attempt (hub §10: seed where it matters). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function createHeist({ canvas, hud, hudItems, corner, onGetaway, onBusted }) {
  const ctx = canvas.getContext('2d');
  let W = 0;
  let H = 0;
  let dpr = 1;

  // Layout rects, mutated in place by layout().
  const full = { x: 0, y: 0, w: 0, h: 0 };
  const meter = { x: 0, y: 0, w: 0, h: 0 };
  const box = { x: 0, y: 0, w: 0, h: 0 }; // the challenge
  const info = { x: 0, y: 0, w: 0, align: 'left', wide: false };
  const hintBox = { x: 0, y: 0, w: 0, lines: 2, align: 'center' };

  // Reusable option objects for art.* (no allocation in draw).
  const optBurst = { size: 64, life: 0, rot: -0.08, fill: undefined };
  const optCap = { size: 18, align: 'left', fill: undefined, stroke: undefined, baseline: 'alphabetic' }; // this file lays text out from the baseline
  const optPanel = { fill: undefined, r: 14, shadow: true };

  // ---- the run's state
  let run = null; // null when idle (city backdrop)
  let paused = false;
  let attempt = 0;
  let serial = 0; // which challenge's events count
  const pointers = new Set(); // pointer ids the challenge has seen go down

  // ---- cached strings (rebuilt only on change)
  let secsShown = -1;
  let secsText = '';
  let drillShown = -1;
  let drillText = '';
  let counterText = '';
  let takeText = '';
  let hintSrc = null; // the string the wrap below was made from
  let hintWidth = 0;
  const hintLines = ['', '', '', '', '', ''];
  let hintCount = 0;
  let hintFont = '';

  // ---------------------------------------------------------------- layout

  function layout() {
    W = Math.max(1, window.innerWidth);
    H = Math.max(1, window.innerHeight);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const pw = Math.round(W * dpr);
    const ph = Math.round(H * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    full.w = W;
    full.h = H;

    // The meter stops short of the corner's three plates.
    let cornerLeft = W - 170;
    let cornerBottom = 60;
    if (corner) {
      const c = corner.getBoundingClientRect();
      if (c.width > 0) {
        cornerLeft = c.left;
        cornerBottom = c.bottom;
      }
    }
    meter.x = MARGIN;
    meter.y = MARGIN;
    meter.h = Math.max(36, Math.min(56, H * 0.08));
    meter.w = cornerLeft - 2 * MARGIN;
    if (meter.w < 180) {
      // A very narrow screen: the road goes under the corner instead.
      meter.y = cornerBottom + 6;
      meter.w = W - 2 * MARGIN;
    }

    let hudTop = H;
    if (hud && !hud.hidden) {
      const r = hud.getBoundingClientRect();
      if (r.height > 0) hudTop = Math.min(H, r.top);
    }
    const top = meter.y + meter.h + MARGIN;
    const bottom = hudTop - MARGIN;

    // Wide: side columns for the counter and the hint, full height for the
    // challenge. Only if each column would still be readable.
    const availH = Math.max(120, bottom - top);
    const wideW = Math.min(W - 2 * MARGIN - 2 * 140, availH * 1.25);
    info.wide = W > H * 1.2 && wideW >= availH * 0.8;
    if (info.wide) {
      box.h = availH;
      box.w = Math.max(120, wideW);
      box.x = (W - box.w) / 2;
      box.y = top;
      info.x = MARGIN;
      info.y = top + 20;
      info.w = box.x - 2 * MARGIN;
      info.align = 'left';
      hintBox.x = box.x + box.w + MARGIN;
      hintBox.y = top + 56; // clear of the seconds and the heat under the road
      hintBox.w = W - hintBox.x - MARGIN;
      hintBox.lines = 6;
      hintBox.align = 'left';
    } else {
      info.x = MARGIN;
      info.y = top + 8;
      info.w = W - 2 * MARGIN;
      info.align = 'left';
      const ctop = top + 26;
      const hintH = 46;
      const h = Math.max(120, bottom - hintH - ctop);
      box.w = Math.min(W - 2 * MARGIN, h * 1.25);
      box.h = Math.min(h, box.w * 1.25);
      box.x = (W - box.w) / 2;
      box.y = ctop + (h - box.h) / 2;
      hintBox.x = W / 2;
      hintBox.y = box.y + box.h + 22;
      hintBox.w = W - 2 * MARGIN;
      hintBox.lines = 2;
      hintBox.align = 'center';
    }
    hintSrc = null; // re-wrap at the new width
  }
  window.addEventListener('resize', layout);
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(() => layout());
    if (hud) ro.observe(hud);
    if (corner) ro.observe(corner);
  }

  // ---------------------------------------------------------------- the HUD

  const itemEls = []; // { item, btn, count }

  function buildHud() {
    hudItems.textContent = '';
    itemEls.length = 0;
    for (const item of ITEMS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'item-btn';
      const pic = document.createElement('canvas');
      const size = 44;
      pic.width = Math.round(size * dpr);
      pic.height = Math.round(size * dpr);
      pic.style.width = `${size}px`;
      pic.style.height = `${size}px`;
      pic.setAttribute('aria-hidden', 'true');
      const pctx = pic.getContext('2d');
      pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      try {
        art.drawItem(pctx, item.id, size / 2, size / 2, size * 0.8, 0);
      } catch (err) {
        console.warn('HEIST: could not draw item', item.id, err);
      }
      const count = document.createElement('span');
      count.className = 'count';
      btn.append(pic, count);
      btn.addEventListener('click', () => {
        useItem(item);
        // Focus would otherwise sit on the button, and the next Enter meant
        // for a keypad would fire the gadget again.
        btn.blur();
      });
      hudItems.appendChild(btn);
      itemEls.push({ item, btn, count });
    }
  }

  function usable(item) {
    if (!run || paused || run.phase !== 'crack' || !run.tripped) return false;
    if (item.effect && item.effect.solveLock) {
      return run.drill < 0 && run.index < run.job.locks.length - 1;
    }
    return true;
  }

  function refreshItems() {
    for (const { item, btn, count } of itemEls) {
      const n = save.items[item.id] | 0;
      count.textContent = String(n);
      btn.disabled = n <= 0 || !usable(item);
      let label = t('run.item', t(item.nameKey), n);
      if (item.effect && item.effect.solveLock && run && run.index >= run.job.locks.length - 1) {
        label += `. ${t('run.item.lastlock')}`;
      }
      btn.setAttribute('aria-label', label);
      btn.title = label;
    }
  }

  function useItem(item) {
    if (!usable(item) || (save.items[item.id] | 0) <= 0) return;
    save.items[item.id] = (save.items[item.id] | 0) - 1;
    commit();
    const e = item.effect || {};
    if (Number.isFinite(e.addTime)) {
      run.clock = Math.min(run.limit, run.clock + e.addTime);
      sfx(item.id === 'donut' ? 'donut' : 'smoke');
    } else if (Number.isFinite(e.solveLock)) {
      run.drill = e.solveLock;
      sfx('drill', { dur: e.solveLock });
    }
    run.fxText = t(`run.burst.${item.id}`);
    run.fxT = 0;
    refreshItems();
  }

  // ---------------------------------------------------------------- challenges

  function makeChallenge(index) {
    const lock = run.job.locks[index];
    const id = ++serial;
    const events = {
      mistake(severity = 1) {
        if (id !== serial) return;
        onMistake(severity);
      },
      progress(f) {
        if (id !== serial || !run) return;
        if (Number.isFinite(f)) run.progress = clamp01(f);
        trip();
      },
      solved() {
        if (id !== serial) return;
        onSolved();
      },
    };
    const opts = { difficulty: lock.difficulty, tier: run.mods[lock.kind] | 0, rng: run.rng, sfx, events };
    return TRAP_KINDS.includes(lock.kind) ? createTrap(lock.kind, opts) : createPuzzle(lock.kind, opts);
  }

  function dropChallenge() {
    if (run && run.challenge) {
      try {
        run.challenge.destroy();
      } catch (err) {
        console.warn('HEIST: destroy failed', err);
      }
      run.challenge = null;
    }
    serial++;
    pointers.clear();
  }

  function trip() {
    if (!run || run.tripped) return;
    run.tripped = true;
    refreshItems();
  }

  function onMistake(severity) {
    if (!run || run.phase !== 'crack') return;
    trip();
    const s = run.job.heatSeconds * (Number.isFinite(severity) ? severity : 1) * run.mods.heatScale;
    run.clock -= s;
    run.jolt = 1;
    run.heatText = t('run.heat', Math.round(s));
    run.heatT = 0;
  }

  function onSolved() {
    if (!run || run.phase !== 'crack') return;
    run.phase = 'beat';
    run.beatT = 0;
    run.swapped = false;
    run.drill = -1;
    run.forced = -1;
    sfx('clunk');
    refreshItems();
  }

  // ---------------------------------------------------------------- run control

  function start(job) {
    dropChallenge();
    paused = false;
    attempt++;
    const mods = modsFor(save);
    const limit = job.time * mods.timeScale;
    const replay = !!(save.jobs[job.id] && save.jobs[job.id].done);
    run = {
      job,
      mods,
      replay,
      limit,
      clock: limit,
      tripped: false,
      index: 0,
      phase: 'crack', // 'crack' | 'beat' | 'won' | 'busted'
      beatT: 0,
      swapped: false,
      slide: 1, // 0 = in place; 1 = off to the right
      challenge: null,
      rng: mulberry32((Date.now() ^ Math.imul(attempt, 0x9e3779b9)) >>> 0),
      drill: -1, // seconds left on the drill, or -1
      forced: -1, // seconds left for a forceSolve to report solved
      jolt: 0,
      heatText: '',
      heatT: 1,
      fxText: '',
      fxT: 1,
      sirenT: 0,
      progress: 0,
    };
    run.challenge = makeChallenge(0);
    run.slide = 0;
    takeText = t('run.take', money(splitPayout(job, 0, replay).take));
    counterText = t('run.lock', 1, job.locks.length);
    secsShown = -1;
    hud.hidden = false;
    buildHud();
    refreshItems();
    layout();
  }

  function abort() {
    dropChallenge();
    run = null;
    paused = false;
    hud.hidden = true;
    layout();
  }

  function releasePointers() {
    if (!run || !run.challenge) return;
    for (const id of pointers) {
      try {
        run.challenge.pointerUp({ x: -1, y: -1, id });
      } catch {
        /* the challenge is going away anyway */
      }
    }
    pointers.clear();
  }

  function pause() {
    if (!run) return;
    paused = true;
    acc = 0;
    releasePointers();
    refreshItems();
  }

  function resume() {
    if (!run) return;
    paused = false;
    refreshItems();
  }

  function getaway() {
    run.phase = 'won';
    hud.hidden = true;
    const left = Math.max(0, run.clock);
    const split = splitPayout(run.job, left, run.replay);
    save.funds += split.total;
    const prev = save.jobs[run.job.id];
    const best = Math.round(left * 10) / 10;
    save.jobs[run.job.id] = { done: true, best: prev && prev.best > best ? prev.best : best };
    commit();
    sfx('coins');
    onGetaway({ job: run.job, take: split.take, bonus: split.bonus, total: split.total, replay: run.replay, secondsLeft: left });
  }

  function bust() {
    run.clock = 0;
    run.phase = 'busted';
    run.drill = -1;
    hud.hidden = true;
    releasePointers();
    sfx('busted');
    onBusted({ job: run.job });
  }

  // ---------------------------------------------------------------- update

  function update(dt) {
    const r = run;
    if (r.challenge && (r.phase === 'crack' || r.phase === 'beat')) r.challenge.update(dt);
    r.jolt = Math.max(0, r.jolt - dt * 2);
    if (r.heatT < 1) r.heatT = Math.min(1, r.heatT + dt);
    if (r.fxT < 1) r.fxT = Math.min(1, r.fxT + dt / 0.9);

    if (r.phase === 'crack') {
      if (r.tripped) {
        r.clock -= dt;
        // The drill: open after N seconds, clock still running.
        if (r.drill >= 0) {
          r.drill -= dt;
          if (r.drill <= 0) {
            r.drill = -1;
            r.forced = 3; // puzzles flourish for 0.9 s; a trap's thief may dash longer
            r.challenge.forceSolve();
          }
        }
        // forceSolve should report solved() itself, perhaps after a flourish;
        // if it never does, the drill still keeps its promise.
        if (r.forced >= 0 && r.phase === 'crack') {
          r.forced -= dt;
          if (r.forced <= 0) onSolved();
        }
        siren(dt);
      }
      if (r.phase === 'crack' && r.clock <= 0) bust();
    } else if (r.phase === 'beat') {
      r.beatT += dt;
      const last = r.index >= r.job.locks.length - 1;
      if (!last && !r.swapped && r.beatT >= SWAP) {
        dropChallenge();
        r.index++;
        r.challenge = makeChallenge(r.index);
        r.swapped = true;
        counterText = t('run.lock', r.index + 1, r.job.locks.length);
        r.progress = 0;
      }
      r.slide = r.swapped ? 1 - easeOut(clamp01((r.beatT - SWAP) / (BEAT - SWAP))) : 0;
      if (r.beatT >= BEAT) {
        if (last) getaway();
        else {
          r.phase = 'crack';
          r.slide = 0;
          refreshItems();
        }
      }
    }
  }

  const easeOut = (x) => 1 - (1 - x) * (1 - x) * (1 - x);

  // The siren comes in past halfway and gets faster and louder as the car
  // closes; the alarm wash in drawVenue follows the same curve.
  function siren(dt) {
    const frac = 1 - run.clock / run.limit;
    if (frac < 0.55) return;
    const k = clamp01((frac - 0.55) / 0.45);
    run.sirenT -= dt;
    if (run.sirenT <= 0) {
      sfx('siren', { gain: 0.05 + 0.15 * k });
      run.sirenT = 2.6 - 1.5 * k;
    }
  }

  // ---------------------------------------------------------------- draw

  function wrapHint(text) {
    hintSrc = text;
    hintWidth = hintBox.w;
    hintCount = 0;
    if (!text) return;
    const size = info.wide ? 16 : 17;
    hintFont = `bold ${size}px ${art.FONT}`;
    ctx.font = hintFont;
    const words = String(text).split(/\s+/);
    let line = '';
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (line && ctx.measureText(next).width * 1.08 > hintBox.w) {
        if (hintCount < hintBox.lines) hintLines[hintCount++] = line;
        line = w;
      } else line = next;
    }
    if (line && hintCount < hintBox.lines) hintLines[hintCount++] = line;
  }

  function caption(x, y, text, size, align) {
    optCap.size = size;
    optCap.align = align;
    art.caption(ctx, x, y, text, optCap);
  }

  function drawRun(now) {
    const r = run;
    const frac = r.tripped ? clamp01(1 - r.clock / r.limit) : 0;
    const alarm = r.tripped ? clamp01((frac - 0.4) / 0.6) : 0;
    art.drawVenue(ctx, full, r.job.venue, now, alarm);
    art.drawPoliceMeter(ctx, meter, frac, now, r.jolt);

    // Seconds left, at the building end of the road.
    const secs = Math.max(0, Math.ceil(r.clock));
    if (secs !== secsShown) {
      secsShown = secs;
      secsText = t('run.secs', secs);
    }
    caption(meter.x + meter.w - 10, meter.y + meter.h + 20, secsText, 18, 'right');
    if (r.heatT < 1) {
      caption(meter.x + meter.w - 10, meter.y + meter.h + 42 - r.heatT * 14, r.heatText, 20, 'right');
    }

    // The counter and the take.
    caption(info.x, info.y, counterText, 18, 'left');
    if (info.wide) caption(info.x, info.y + 26, takeText, 18, 'left');
    else caption(info.x + info.w / 2, info.y, takeText, 18, 'center');

    // The challenge, or a covered panel while paused (the clock is stopped,
    // so the lock is hidden: a pause is a breather, not free thinking time).
    if (paused) {
      optPanel.fill = art.PAL.night;
      HALFTONE.color = art.PAL.navy;
      art.panel(ctx, box.x, box.y, box.w, box.h, optPanel);
      art.halftone(ctx, box.x, box.y, box.w, box.h, HALFTONE);
    } else if (r.challenge) {
      const dx = r.slide * (W - box.x);
      if (dx) {
        ctx.save();
        ctx.translate(dx, 0);
        r.challenge.draw(ctx, box, now);
        ctx.restore();
      } else r.challenge.draw(ctx, box, now);
    }

    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    if (r.phase === 'beat' && !r.swapped) {
      optBurst.size = Math.min(box.w, box.h) * 0.22;
      optBurst.life = clamp01(r.beatT / SWAP);
      optBurst.fill = art.PAL.mustard;
      art.burst(ctx, cx, cy, t('run.open'), optBurst);
    }
    if (r.fxT < 1 && !paused) {
      optBurst.size = Math.min(box.w, box.h) * 0.18;
      optBurst.life = r.fxT;
      optBurst.fill = art.PAL.cream;
      art.burst(ctx, cx, box.y + box.h * 0.25, r.fxText, optBurst);
    }
    if (r.drill >= 0 && !paused) {
      const d = Math.ceil(r.drill);
      if (d !== drillShown) {
        drillShown = d;
        drillText = t('run.drilling', d);
      }
      caption(cx, box.y + 24, drillText, 20, 'center');
    }

    // The hint: before the alarm, how to start; after, the challenge's own.
    if (!paused && r.phase === 'crack') {
      const h = r.tripped && r.challenge ? r.challenge.hint() : t('run.start');
      if (h !== hintSrc || hintWidth !== hintBox.w) wrapHint(h);
      const step = info.wide ? 21 : 22;
      for (let i = 0; i < hintCount; i++) {
        caption(hintBox.x, hintBox.y + i * step, hintLines[i], info.wide ? 16 : 17, hintBox.align);
      }
    }
  }
  const HALFTONE = { color: undefined, spacing: 10, angle: 0.4, from: 0.1, to: 0.4 };

  // The end cards' thief, drawn live into their own small canvas.
  let card = null;
  let cardCtx = null;
  let cardPose = 'idle';
  let cardDpr = 0;

  function setCardArt(el, pose) {
    card = el || null;
    cardCtx = card ? card.getContext('2d') : null;
    cardPose = pose || 'idle';
    cardDpr = 0;
  }

  function drawCard(now) {
    if (!card || !card.isConnected) return;
    const cw = 160;
    const ch = 120;
    if (cardDpr !== dpr) {
      cardDpr = dpr;
      card.width = Math.round(cw * dpr);
      card.height = Math.round(ch * dpr);
    }
    cardCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cardCtx.clearRect(0, 0, cw, ch);
    art.drawThief(cardCtx, cw / 2, ch / 2, ch * 0.85, cardPose, now);
  }

  // ---------------------------------------------------------------- the loop

  let lastT = 0;
  let acc = 0;
  function frame(ms) {
    requestAnimationFrame(frame);
    const now = ms / 1000;
    let dt = lastT ? now - lastT : 0;
    lastT = now;
    if (dt > 0.25) dt = 0.25;
    if (dt < 0) dt = 0;

    if (run && !paused && (run.phase === 'crack' || run.phase === 'beat')) {
      acc += dt;
      let n = 0;
      while (acc >= STEP && n < MAX_STEPS && run && (run.phase === 'crack' || run.phase === 'beat')) {
        update(STEP);
        acc -= STEP;
        n++;
      }
      if (n >= MAX_STEPS) acc = 0;
    } else acc = 0;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (run) drawRun(now);
    else {
      ctx.clearRect(0, 0, W, H);
      art.drawCity(ctx, full, now);
    }
    if (card && !card.hidden) drawCard(now);
  }

  // ---------------------------------------------------------------- input

  function toCss(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, id: e.pointerId };
  }
  const live = () => run && !paused && run.phase === 'crack' && run.challenge;

  canvas.addEventListener('pointerdown', (e) => {
    if (!live()) return;
    const p = toCss(e);
    pointers.add(e.pointerId);
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* not capturable: moves outside the canvas are simply lost */
    }
    // Touching the challenge itself is what trips the silent alarm.
    if (p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h) trip();
    run.challenge.pointerDown(p);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!live()) return;
    run.challenge.pointerMove(toCss(e));
  });
  const up = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (run && run.challenge) run.challenge.pointerUp(toCss(e));
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  // Keys to the challenge. main.js takes Escape on the capture phase and
  // stops it there, so it never arrives; this also leaves Enter and Space
  // alone when a button has focus (that press belongs to the button), and
  // modified keys to the browser. Auto-repeat IS forwarded: a held arrow
  // turning a dial is the point of it.
  window.addEventListener('keydown', (e) => {
    if (!live() || e.key === 'Escape') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = e.target && e.target.tagName;
    if ((tag === 'BUTTON' || tag === 'INPUT') && (e.key === 'Enter' || e.key === ' ')) return;
    if (tag === 'INPUT') return;
    if (run.challenge.key(e)) {
      e.preventDefault();
      trip();
    }
  });

  document.addEventListener('arcade:lang', () => {
    secsShown = -1;
    drillShown = -1;
    hintSrc = null;
    if (run) {
      takeText = t('run.take', money(splitPayout(run.job, 0, run.replay).take));
      counterText = t('run.lock', run.index + 1, run.job.locks.length);
      refreshItems();
    }
  });

  layout();
  requestAnimationFrame(frame);

  return {
    start,
    abort,
    pause,
    resume,
    running: () => !!run && (run.phase === 'crack' || run.phase === 'beat'),
    job: () => (run ? run.job : null),
    setCardArt,
    layout,
  };
}
