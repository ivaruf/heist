/*
 * audio.js — every sound HEIST makes, and the two volumes and the mute.
 *
 *   sfx(name, opts?)        play a cue (DESIGN.md §3.3). Never throws, and
 *                           does nothing before the first gesture.
 *   volume(bus)             'music' | 'sfx', 0..1
 *   setVolume(bus, v)       store it, apply it, LIFT THE MUTE, and audition
 *   isMuted() / setMuted(m) the corner's live mute
 *
 * THE GRAPH.  music bus ─┐
 *                         ├─▶ master (0 when muted) ─▶ destination
 *             sfx bus  ──┘
 * Every cue goes through the sfx bus. Nothing is on the music bus in v1 but
 * the slider's own audition: HEIST has no music yet, the menu's hint line
 * says so plainly (hub §2, "a game with no audio yet still gets the panel"),
 * and the level persists for the day it arrives.
 *
 * Keys: `heist.vol.music.v1`, `heist.vol.sfx.v1` (0..1) and
 * `heist.muted.v1` ('true'|'false'). Every read and write in try/catch,
 * non-finite or out-of-range rejected on load — that store is shared by every
 * game on the origin. Never rename them (hub §6).
 *
 * LAZY CONTEXT. The AudioContext is created on the first pointerdown or
 * keydown anywhere and resume()d on every later one (Safari suspends it when
 * the tab hides). Before that, sfx() is a silent no-op, which is what a
 * browser's autoplay policy would make it anyway.
 *
 * PLACEHOLDERS. Every cue below is synthesised at runtime, short and with a
 * bit of character, so the build is playable with sound today. Hub §9 says
 * sound is Sonic Pi by default: all of these except the lock feedback are to
 * be replaced by composed renders behind the SAME names, and no caller has to
 * change when they are. `tick` and `click` are the honest exceptions that
 * should stay code — they track a live dial position and strength, which is
 * the continuous variation runtime audio exists for.
 *
 * THROTTLE. Each name has a minimum gap measured on AudioContext.currentTime,
 * never on a simulation clock (hub §2's trap: the fixed step is held while
 * the menu is up, so a sim-clocked limiter would audition once and then go
 * quiet for ever). The slider audition goes through the same limiter.
 */

const KEYS = { music: 'heist.vol.music.v1', sfx: 'heist.vol.sfx.v1' };
const MUTE_KEY = 'heist.muted.v1';

function readVol(bus) {
  try {
    const raw = localStorage.getItem(KEYS[bus]);
    const v = raw == null ? NaN : Number(raw);
    if (Number.isFinite(v) && v >= 0 && v <= 1) return v;
  } catch {
    /* default */
  }
  return 0.8;
}
function readMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === 'true';
  } catch {
    return false;
  }
}

const levels = { music: readVol('music'), sfx: readVol('sfx') };
let muted = readMuted();

let ctx = null;
let master = null;
const bus = { music: null, sfx: null };
let noise = null; // one second of white noise, made once

function boot() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try {
    ctx = new AC();
  } catch {
    ctx = null;
    return;
  }
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 1;
  master.connect(ctx.destination);
  for (const b of ['music', 'sfx']) {
    bus[b] = ctx.createGain();
    bus[b].gain.value = levels[b];
    bus[b].connect(master);
  }
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
}
// Capture phase, so a handler that stops propagation cannot keep us mute.
window.addEventListener('pointerdown', boot, true);
window.addEventListener('keydown', boot, true);

export const volume = (b) => levels[b];
export const isMuted = () => muted;

export function setMuted(m) {
  muted = !!m;
  try {
    localStorage.setItem(MUTE_KEY, String(muted));
  } catch {
    /* not kept */
  }
  if (master) master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.01);
}

/** A slider moved: store, apply, lift the mute, and let them hear it. */
export function setVolume(b, v) {
  if (b !== 'music' && b !== 'sfx') return;
  const n = Math.max(0, Math.min(1, Number(v)));
  if (!Number.isFinite(n)) return;
  levels[b] = n;
  try {
    localStorage.setItem(KEYS[b], String(n));
  } catch {
    /* not kept */
  }
  if (muted) setMuted(false);
  if (bus[b]) bus[b].gain.setTargetAtTime(n, ctx.currentTime, 0.01);
  // The audition. On the music bus because that is the level being set,
  // even though no music plays yet: a slider you cannot hear is one you
  // cannot use.
  play(b === 'music' ? 'audition' : 'click', b === 'music' ? null : { strength: 0.8 }, b, 0.12);
}

// ---------------------------------------------------------------- building blocks

/** An oscillator blip: type, f0→f1 over dur, attack/decay envelope. */
function tone(out, t0, { type = 'sine', f0, f1 = f0, dur = 0.1, gain = 0.3, attack = 0.004 }) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(out);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
  return o;
}

/** A burst of filtered noise. */
function hiss(out, t0, { dur = 0.1, gain = 0.3, freq = 2000, q = 1, type = 'bandpass', f1 = freq }) {
  const s = ctx.createBufferSource();
  s.buffer = noise;
  s.loop = dur > 0.9;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t0);
  if (f1 !== freq) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  s.connect(f).connect(g).connect(out);
  s.start(t0);
  s.stop(t0 + dur + 0.02);
}

// ---------------------------------------------------------------- the cues

// Each takes (out, t0, opts). Placeholders, to be Sonic Pi renders (hub §9),
// except tick and click, which follow a live dial.
const CUES = {
  // The dial passing a number: a dry wooden tick, pitched by opts.rate.
  tick(out, t0, o) {
    const r = clampRate(o && o.rate);
    hiss(out, t0, { dur: 0.018, gain: 0.12, freq: 3200 * r, q: 6 });
  },
  // A true gate: a metallic click, louder and brighter with strength.
  click(out, t0, o) {
    const s = Math.max(0, Math.min(1, o && Number.isFinite(o.strength) ? o.strength : 0.5));
    hiss(out, t0, { dur: 0.03, gain: 0.08 + 0.4 * s, freq: 1800 + 2400 * s, q: 8 });
    tone(out, t0, { type: 'triangle', f0: 900 + 600 * s, dur: 0.04, gain: 0.05 + 0.15 * s });
  },
  pin(out, t0) {
    tone(out, t0, { type: 'square', f0: 1400, f1: 1100, dur: 0.05, gain: 0.08 });
    hiss(out, t0, { dur: 0.025, gain: 0.15, freq: 4000, q: 4 });
  },
  drop(out, t0) {
    for (let i = 0; i < 4; i++) {
      tone(out, t0 + i * 0.045, { type: 'triangle', f0: 700 - i * 90, f1: 300, dur: 0.06, gain: 0.12 });
    }
  },
  beep(out, t0) {
    tone(out, t0, { type: 'square', f0: 1046, dur: 0.07, gain: 0.07, attack: 0.002 });
  },
  buzz(out, t0) {
    tone(out, t0, { type: 'sawtooth', f0: 110, f1: 90, dur: 0.32, gain: 0.16 });
    tone(out, t0, { type: 'square', f0: 116, f1: 94, dur: 0.32, gain: 0.08 });
  },
  chime(out, t0) {
    tone(out, t0, { type: 'triangle', f0: 784, dur: 0.25, gain: 0.18 });
    tone(out, t0 + 0.08, { type: 'triangle', f0: 1175, dur: 0.35, gain: 0.16 });
  },
  snip(out, t0) {
    hiss(out, t0, { dur: 0.04, gain: 0.35, freq: 6000, q: 3 });
    hiss(out, t0 + 0.05, { dur: 0.03, gain: 0.2, freq: 5000, q: 3 });
  },
  // The bolt going back: a heavy low thump with a latch on top. KA-CHUNK.
  clunk(out, t0) {
    hiss(out, t0, { dur: 0.05, gain: 0.3, freq: 2500, q: 2 });
    tone(out, t0 + 0.06, { type: 'sine', f0: 140, f1: 55, dur: 0.28, gain: 0.5 });
    hiss(out, t0 + 0.06, { dur: 0.15, gain: 0.25, type: 'lowpass', freq: 600, q: 0.7 });
  },
  coins(out, t0) {
    const notes = [1568, 2093, 1760, 2349, 2637];
    for (let i = 0; i < notes.length; i++) {
      tone(out, t0 + i * 0.06, { type: 'triangle', f0: notes[i], dur: 0.18, gain: 0.1 });
    }
  },
  // A two-tone police wail, about a second. heist.js repeats it, faster and
  // louder (opts.gain) as the car closes in.
  siren(out, t0, o) {
    const g = Math.max(0.02, Math.min(0.25, o && Number.isFinite(o.gain) ? o.gain : 0.12));
    tone(out, t0, { type: 'sawtooth', f0: 650, f1: 950, dur: 0.5, gain: g * 0.6, attack: 0.05 });
    tone(out, t0 + 0.5, { type: 'sawtooth', f0: 950, f1: 650, dur: 0.5, gain: g * 0.6, attack: 0.05 });
  },
  // Sad trombone, comic not cruel.
  busted(out, t0) {
    const f = [392, 370, 349, 311];
    for (let i = 0; i < f.length; i++) {
      const last = i === f.length - 1;
      tone(out, t0 + i * 0.3, { type: 'sawtooth', f0: f[i], f1: last ? f[i] * 0.9 : f[i], dur: last ? 0.8 : 0.28, gain: 0.12, attack: 0.03 });
    }
  },
  // A rasping drill for opts.dur seconds (the drill gadget's whole run).
  drill(out, t0, o) {
    const dur = Math.max(0.3, Math.min(8, o && Number.isFinite(o.dur) ? o.dur : 1));
    const osc = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    const g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = 180;
    lfo.frequency.value = 23;
    depth.gain.value = 40;
    lfo.connect(depth).connect(osc.frequency);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.09, t0 + 0.05);
    g.gain.setValueAtTime(0.09, t0 + dur - 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(out);
    osc.start(t0);
    lfo.start(t0);
    osc.stop(t0 + dur + 0.02);
    lfo.stop(t0 + dur + 0.02);
  },
  smoke(out, t0) {
    hiss(out, t0, { dur: 0.7, gain: 0.35, freq: 3000, f1: 300, q: 0.8, type: 'lowpass' });
  },
  donut(out, t0) {
    // A cheerful "nom nom": two wobbly boops.
    tone(out, t0, { type: 'sine', f0: 330, f1: 440, dur: 0.12, gain: 0.25 });
    tone(out, t0 + 0.16, { type: 'sine', f0: 330, f1: 494, dur: 0.14, gain: 0.25 });
  },
  ui(out, t0) {
    tone(out, t0, { type: 'triangle', f0: 660, f1: 880, dur: 0.06, gain: 0.1 });
  },
  // The MUSIC slider's audition: a soft two-note phrase.
  audition(out, t0) {
    tone(out, t0, { type: 'sine', f0: 523, dur: 0.22, gain: 0.18 });
    tone(out, t0 + 0.11, { type: 'sine', f0: 659, dur: 0.26, gain: 0.16 });
  },
};

function clampRate(r) {
  return Number.isFinite(r) ? Math.max(0.25, Math.min(4, r)) : 1;
}

// Minimum gap per cue, in seconds of AudioContext time.
const GAP = { tick: 0.012, click: 0.03, beep: 0.03, siren: 0.6, drill: 0.5, coins: 0.15, busted: 1 };
const last = Object.create(null);

function play(name, opts, busName, gap) {
  if (!ctx || !noise) return;
  const cue = CUES[name];
  if (!cue) return;
  const now = ctx.currentTime;
  const g = gap ?? GAP[name] ?? 0.02;
  if (last[name] !== undefined && now - last[name] < g) return;
  last[name] = now;
  try {
    cue(bus[busName], now + 0.005, opts);
  } catch (err) {
    console.warn('HEIST: a sound failed', name, err);
  }
}

/** DESIGN.md §3.3. Never throws; silent before the first gesture. */
export function sfx(name, opts) {
  play(name, opts, 'sfx');
}
