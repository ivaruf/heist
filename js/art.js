/*
 * art.js — the whole look of HEIST, drawn by hand on Canvas 2D.
 *
 * HEIST is a comic book at night: heavy ink outlines, flat colour, halftone
 * dots where a printer would shade, starburst sound words, and a palette of
 * navy, mustard and cream that only lets siren red and blue in when the
 * police are close. Every lane draws through this file (DESIGN.md §3.4) so
 * that a lock by one agent, a trap room by another and the shopkeeper by a
 * third all look like one book. Nothing here is an image: every picture is a
 * path, so it is crisp at any size and ships as the code that drew it.
 *
 * THREE HOUSE RULES RUN THROUGH THE FILE.
 *
 *   INK FIRST. A shape is a flat fill and an ink outline of LINE px, with
 *   round joins. Shading is never a gradient on a character: it is a second
 *   flat colour, or halftone dots. Gradients are allowed only for light —
 *   the night sky, a lamp's pool, the alarm wash, brushed metal.
 *
 *   NOTHING IS ALLOCATED PER FRAME. Anything that does not move (a venue's
 *   facade, the skyline, the meter's road, the shopkeeper's back room, every
 *   item icon, every halftone field) is painted ONCE into an offscreen canvas
 *   at the device's pixel ratio, keyed by its size, and blitted after that;
 *   it is rebuilt only when the size changes. What moves on top (a flashing
 *   light bar, a chasing marquee bulb, a blink) is drawn with plain path
 *   calls and numbers. Options objects are read, never created, and cache
 *   keys are packed into integers so a lookup allocates no string.
 *
 *   NO WORDS IN THE PICTURES. The game speaks two languages (hub §2) and art
 *   is drawn below i18n, so no sign says PAWN or BANK: a pawnshop is three
 *   golden balls, a bank is columns and a coin, a casino is card suits and
 *   marquee bulbs. Sound words come in from the caller, already through t().
 *   Digits are allowed (a kiosk's "24/7" reads the same in both languages).
 *
 * Coordinates are CSS pixels; the caller's context is already scaled for
 * devicePixelRatio (capped at 2, hub §10). Offscreen layers read the same
 * ratio when they are built and remember it, so a window dragged to another
 * screen rebuilds them sharp.
 */

const TAU = Math.PI * 2;

/*
 * THE PALETTE. Named so a puzzle can say PAL.steel and mean the same steel
 * the vault door is made of. ink is not black: it is the darkest navy, so
 * an outline sits in the night instead of punching a hole in it. cream is
 * the lit paper colour (signs, faces of dials, the moon); paper is the
 * brighter speech-bubble white. Siren red and blue are deliberately the
 * most saturated things here, so they read as alarm wherever they appear.
 */
export const PAL = Object.freeze({
  ink: "#141625",
  paper: "#fff6e0",
  night: "#0b1029",
  navy: "#1c2a5e",
  navyHi: "#2d4189",
  navyLo: "#141d45",
  mustard: "#f4b63d",
  mustardDk: "#c98a1c",
  cream: "#fbe9c0",
  steel: "#a9b6c8",
  steelHi: "#e4ebf3",
  steelDark: "#5f6c82",
  brass: "#d9a43a",
  brassDk: "#9a6d1c",
  red: "#e5373d",
  redDk: "#a31f2a",
  blue: "#2f7fe5",
  blueDk: "#1c4fa3",
  green: "#47b04b",
  greenDk: "#2c7a33",
  amber: "#ff8a1c", // keypad "in the code, wrong place": kept clear of mustard
  skin: "#f1c39b",
  skinDk: "#d4976b",
  shadow: "rgba(8, 10, 28, 0.55)",
  glow: "#ffd76a", // a lit window at night
  brick: "#6b3440",
  wood: "#8a5a32",
  woodDk: "#5c3a20",
  purple: "#5a2477",
  magenta: "#d8418e",
  teal: "#1f6b62",
  pink: "#f27fb2",
  burlap: "#c99b5a",
  white: "#ffffff",
});

/*
 * THE LETTERING. Comic lettering is hand-lettered caps, so the stack reaches
 * first for the system faces that have a pen in them, and falls back to
 * weight rather than to whimsy:
 *
 *   Marker Felt      macOS / iOS / iPadOS — a felt-tip comic hand. An iPad
 *                    is the common case here, so this is the face most
 *                    players see.
 *   Chalkboard SE    the other hand-lettered face Apple ships; rounder.
 *   Comic Neue       if someone has it installed (we never load it: hub §1
 *                    bans web fonts, so this is a name, not a download).
 *   Arial Black      Windows. Comic Sans MS is deliberately NOT here: on a
 *                    PC it is the face of a photocopied notice, which is the
 *                    clip-art look the owner ruled out. Heavy grotesque caps
 *                    inside an ink outline read as a comic title instead.
 *   Arial Rounded MT Bold, Helvetica Neue, Arial, system-ui, sans-serif
 *                    — Android lands on Roboto via system-ui, bold.
 *
 * css/style.css uses the same stack as --font, so DOM and canvas agree.
 */
export const FONT =
  '"Marker Felt", "Chalkboard SE", "Comic Neue", "Arial Black", ' +
  '"Arial Rounded MT Bold", "Helvetica Neue", Arial, system-ui, sans-serif';

/* The standard ink width at 1x. Small drawings scale it down to ~1.2. */
export const LINE = 3;

const NONE = Object.freeze({});

/* ===================== internals ===================== */

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/* The ratio offscreen layers are painted at: the device's, capped at 2. */
function pxRatio() {
  const d =
    typeof window !== "undefined" && window.devicePixelRatio
      ? window.devicePixelRatio
      : 1;
  return d > 2 ? 2 : d < 1 ? 1 : d;
}

/* A fresh offscreen canvas of w×h CSS px at the current ratio. Build-time
   only — never called from a draw path except on a cache miss. */
function layer(w, h) {
  const s = pxRatio();
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w * s));
  c.height = Math.max(1, Math.ceil(h * s));
  const g = c.getContext("2d");
  g.scale(s, s);
  return { c, g, w, h, s };
}

/* A deterministic [0,1) from two integers, allocating nothing: used for
   per-frame flicker and for any jitter that must be the same every frame. */
function hash(a, b) {
  let t =
    (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x165667b1, 0x9e3779b1)) | 0;
  t = Math.imul(t ^ (t >>> 15), 0x85ebca6b);
  t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35);
  t ^= t >>> 16;
  return (t >>> 0) / 4294967296;
}

/* A seeded generator for build-time layouts (window lights, stars, bricks),
   so a venue looks the same every time it is rebuilt. */
function seeded(seed) {
  let a = seed >>> 0 || 1;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/*
 * font(size, weight) — the canvas font string for the lettering stack.
 * Cached per integer size and weight so setting ctx.font in a draw loop does
 * not build a new string every frame. Exported: puzzles letter through it.
 */
const FONT_CACHE = new Map();
export function font(size, weight = 700) {
  const sz = Math.max(1, Math.round(size));
  const key = sz * 1000 + weight;
  let f = FONT_CACHE.get(key);
  if (f === undefined) {
    f = weight + " " + sz + "px " + FONT;
    FONT_CACHE.set(key, f);
  }
  return f;
}

/*
 * textWidth(ctx, text, size) — the width of a word in the lettering at
 * `size`. measureText returns a fresh object, so each word is measured once
 * at 100px and scaled; the cache is cleared rather than grown without bound
 * (money and clock strings change every second).
 */
const TW = new Map();
export function textWidth(ctx, text, size) {
  let w100 = TW.get(text);
  if (w100 === undefined) {
    const prev = ctx.font;
    ctx.font = font(100);
    w100 = ctx.measureText(text).width;
    ctx.font = prev;
    if (TW.size > 400) TW.clear();
    TW.set(text, w100);
  }
  return (w100 * size) / 100;
}

/*
 * rrect(ctx, x, y, w, h, r) — adds a rounded-rectangle subpath. Hand-rolled
 * because ctx.roundRect is missing from the older iPads this is meant to run
 * on. Does not begin or close the path for you beyond its own subpath.
 */
export function rrect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function circ(g, x, y, r) {
  g.moveTo(x + r, y);
  g.arc(x, y, r, 0, TAU);
}

/* Fill the current path flat, then ink it. The one gesture of the style. */
function fillInk(g, fill, lw) {
  g.fillStyle = fill;
  g.fill();
  g.strokeStyle = PAL.ink;
  g.lineWidth = lw;
  g.lineJoin = "round";
  g.lineCap = "round";
  g.stroke();
}
function blob(g, x, y, r, fill, lw) {
  g.beginPath();
  circ(g, x, y, r);
  fillInk(g, fill, lw);
}
function oval(g, x, y, rx, ry, rot, fill, lw) {
  g.beginPath();
  g.ellipse(x, y, rx, ry, rot, 0, TAU);
  fillInk(g, fill, lw);
}
function box(g, x, y, w, h, r, fill, lw) {
  g.beginPath();
  rrect(g, x, y, w, h, r);
  fillInk(g, fill, lw);
}
function seg(g, x1, y1, x2, y2, color, lw) {
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.strokeStyle = color;
  g.lineWidth = lw;
  g.lineCap = "round";
  g.stroke();
}
/* An outlined limb or tube through three points: ink first, wider, then the
   colour on top — the cheapest way to get an inked arm with a bend in it. */
function tube(g, x1, y1, x2, y2, x3, y3, wd, color, lw) {
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.lineTo(x3, y3);
  g.lineCap = "round";
  g.lineJoin = "round";
  g.strokeStyle = PAL.ink;
  g.lineWidth = wd + lw * 2;
  g.stroke();
  g.strokeStyle = color;
  g.lineWidth = wd;
  g.stroke();
}
/* The same, along a quadratic curve (stethoscope tubes, cords, wires). */
function hose(g, x1, y1, cx, cy, x2, y2, wd, color, lw) {
  g.beginPath();
  g.moveTo(x1, y1);
  g.quadraticCurveTo(cx, cy, x2, y2);
  g.lineCap = "round";
  g.strokeStyle = PAL.ink;
  g.lineWidth = wd + lw * 2;
  g.stroke();
  g.strokeStyle = color;
  g.lineWidth = wd;
  g.stroke();
}
/* A five-point star subpath (badges, tier pips, the bank's coin). */
function starPath(g, x, y, r, inner, rot) {
  for (let i = 0; i < 10; i++) {
    const a = rot - Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * inner : r;
    if (i === 0) g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    else g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
}
/* A four-point twinkle, the jeweller's and the night sky's sparkle. */
function twinkle(g, x, y, r, color) {
  g.beginPath();
  g.moveTo(x, y - r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.quadraticCurveTo(x, y, x, y + r);
  g.quadraticCurveTo(x, y, x - r, y);
  g.quadraticCurveTo(x, y, x, y - r);
  g.fillStyle = color;
  g.fill();
}

/* ===================== the basic marks ===================== */

/* ink(ctx, width) — set the stroke to ink, round joins and caps. */
export function ink(ctx, width = LINE) {
  ctx.strokeStyle = PAL.ink;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
}

/*
 * panel(ctx, x, y, w, h, { fill, r, shadow, line }) — a comic panel: flat
 * fill, ink border, and the offset ink drop shadow every panel in the book
 * casts down and to the right. shadow is a px offset (default 6), or false.
 */
export function panel(ctx, x, y, w, h, o = NONE) {
  const fill = o.fill || PAL.cream;
  const r = o.r === undefined ? 10 : o.r;
  const sh =
    o.shadow === undefined || o.shadow === true ? 6 : +o.shadow || 0;
  const lw = o.line || LINE;
  if (sh) {
    ctx.beginPath();
    rrect(ctx, x + sh, y + sh, w, h, r);
    ctx.fillStyle = PAL.ink;
    ctx.fill();
  }
  ctx.beginPath();
  rrect(ctx, x, y, w, h, r);
  fillInk(ctx, fill, lw);
}

/*
 * bubble(ctx, x, y, w, h, tx, ty, { fill }) — a speech bubble with its tail
 * pointing at (tx, ty). Extra to the contract: the shopkeeper's patter and
 * any puzzle that wants a character to speak on canvas.
 */
export function bubble(ctx, x, y, w, h, tx, ty, o = NONE) {
  const r = Math.min(18, h / 2);
  const cy = y + h / 2;
  // the tail's root sits on the edge nearest the target
  const bx = clamp(tx, x + r + 8, x + w - r - 8);
  const below = ty > cy;
  const by = below ? y + h : y;
  const half = Math.min(10, w / 6);
  ctx.beginPath();
  rrect(ctx, x, y, w, h, r);
  ctx.moveTo(bx - half, by);
  ctx.lineTo(tx, ty);
  ctx.lineTo(bx + half, by);
  ctx.fillStyle = PAL.ink;
  ctx.save();
  ctx.translate(4, 4);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = o.fill || PAL.paper;
  ctx.fill();
  ink(ctx);
  ctx.beginPath();
  rrect(ctx, x, y, w, h, r);
  ctx.stroke();
  // the tail: stroke its two sides, then paint over the seam it crosses
  ctx.beginPath();
  ctx.moveTo(bx - half, by);
  ctx.lineTo(tx, ty);
  ctx.lineTo(bx + half, by);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(bx - half + 2, by + (below ? -2 : 2));
  ctx.lineTo(bx + half - 2, by + (below ? -2 : 2));
  ctx.strokeStyle = o.fill || PAL.paper;
  ctx.lineWidth = LINE + 1;
  ctx.stroke();
}

/*
 * Halftone. dots() paints a dot screen straight onto a context: a grid
 * rotated by `angle`, each dot's radius running from `from` to `to` (as a
 * fraction of the spacing; 1 ≈ dots just merging) across the rect, along y
 * (default), x, or outward from the centre ('radial'). It is the costly
 * half, so it runs at build time; halftone() below caches its output.
 */
function dots(g, x, y, w, h, color, sp, ang, from, to, dir) {
  if (w <= 0 || h <= 0) return;
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = color;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const half = Math.hypot(w, h) / 2;
  const n = Math.ceil(half / sp) + 1;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  g.beginPath();
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const u = i * sp;
      const v = j * sp;
      const px = cx + u * ca - v * sa;
      const py = cy + u * sa + v * ca;
      if (px < x - sp || px > x + w + sp || py < y - sp || py > y + h + sp)
        continue;
      let t;
      if (dir === "x") t = (px - x) / w;
      else if (dir === "radial") t = Math.hypot(px - cx, py - cy) / half;
      else t = (py - y) / h;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const r = (from + (to - from) * t) * sp * 0.62;
      if (r < 0.25) continue;
      g.moveTo(px + r, py);
      g.arc(px, py, r, 0, TAU);
    }
  }
  g.fill();
  g.restore();
}

/*
 * The halftone cache: one offscreen field per colour and per packed integer
 * of (w, h, spacing, from, to, angle, direction, ratio). Integer keys mean a
 * hit allocates nothing; a page of puzzles uses a handful of fields, and the
 * whole cache is dropped rather than grown past 64.
 */
const HT = new Map();
let htCount = 0;
const DIRS = { y: 0, x: 1, radial: 2 };
function htBlit(ctx, x, y, w, h, color, sp, ang, from, to, dir) {
  const wq = Math.min(4095, Math.round(w));
  const hq = Math.min(4095, Math.round(h));
  if (wq < 1 || hq < 1) return;
  const spq = clamp(Math.round(sp * 2), 2, 63);
  const fq = Math.round(clamp(from, 0, 1) * 31);
  const tq = Math.round(clamp(to, 0, 1) * 31);
  const aq = ((Math.round((ang / Math.PI) * 16) % 32) + 32) % 32;
  const dq = DIRS[dir] || 0;
  const s = pxRatio();
  const rq = Math.round(s * 4) & 15;
  const key =
    ((((((wq * 4096 + hq) * 64 + spq) * 32 + fq) * 32 + tq) * 32 + aq) * 4 + dq) * 16 + rq;
  let byColor = HT.get(color);
  if (byColor === undefined) {
    byColor = new Map();
    HT.set(color, byColor);
  }
  let c = byColor.get(key);
  if (c === undefined) {
    if (htCount > 64) {
      HT.clear();
      htCount = 0;
      byColor = new Map();
      HT.set(color, byColor);
    }
    const L = layer(wq, hq);
    dots(L.g, 0, 0, wq, hq, color, spq / 2, (aq / 16) * Math.PI, fq / 31, tq / 31, dir);
    c = L.c;
    byColor.set(key, c);
    htCount++;
  }
  ctx.drawImage(c, x, y, w, h);
}

/*
 * halftone(ctx, x, y, w, h, { color, spacing, angle, from, to, dir }) — dot
 * shading over a rect, cached. Defaults: ink at 45°, 6px apart, growing from
 * nothing at the top to 0.6 at the bottom. Clip first if the shape is not a
 * rectangle.
 */
export function halftone(ctx, x, y, w, h, o = NONE) {
  htBlit(
    ctx,
    x,
    y,
    w,
    h,
    o.color || PAL.shadow,
    o.spacing || 6,
    o.angle === undefined ? Math.PI / 4 : o.angle,
    o.from === undefined ? 0 : o.from,
    o.to === undefined ? 0.6 : o.to,
    o.dir || "y",
  );
}

/*
 * Metal. A vertical gradient per tone (cached per tone and integer height,
 * built relative to 0,0 and drawn under a translate so the same gradient
 * serves every x and y), a brushed-streak pattern laid over it, a bright
 * lip along the top edge, and the ink outline.
 */
const TONES = {
  steel: ["#eef3f8", "#b4c0d0", "#98a6b9", "#5f6c82", "#ffffff"],
  brass: ["#fde6a6", "#e0ad45", "#c48e2a", "#8a5f18", "#fff2c8"],
  dark: ["#76839a", "#465169", "#3a4359", "#1f2533", "#a9b6c8"],
};
const GRADS = new Map();
function metalGrad(ctx, tone, h) {
  const key = (tone === "brass" ? 1 : tone === "dark" ? 2 : 0) * 8192 + Math.min(8191, Math.round(h));
  let gr = GRADS.get(key);
  if (gr === undefined) {
    const T = TONES[tone] || TONES.steel;
    gr = ctx.createLinearGradient(0, 0, 0, Math.max(1, h));
    gr.addColorStop(0, T[0]);
    gr.addColorStop(0.46, T[1]);
    gr.addColorStop(0.54, T[2]);
    gr.addColorStop(1, T[3]);
    if (GRADS.size > 128) GRADS.clear();
    GRADS.set(key, gr);
  }
  return gr;
}
let brush = null;
function brushPattern(ctx) {
  if (brush) return brush;
  const L = layer(96, 48);
  const rnd = seeded(91);
  for (let i = 0; i < 70; i++) {
    const y = rnd() * 48;
    const x = rnd() * 96;
    const len = 20 + rnd() * 60;
    L.g.strokeStyle = rnd() < 0.5 ? "rgba(255,255,255,0.55)" : "rgba(20,22,37,0.35)";
    L.g.lineWidth = 0.6;
    L.g.beginPath();
    L.g.moveTo(x, y);
    L.g.lineTo(x + len, y);
    L.g.moveTo(x - 96, y);
    L.g.lineTo(x - 96 + len, y);
    L.g.stroke();
  }
  brush = ctx.createPattern(L.c, "repeat");
  if (brush && brush.setTransform && typeof DOMMatrix !== "undefined") {
    brush.setTransform(new DOMMatrix([1 / L.s, 0, 0, 1 / L.s, 0, 0]));
  }
  return brush;
}

/* metal(ctx, x, y, w, h, { r, tone, line }) — a brushed face, tone
   'steel' | 'brass' | 'dark'. */
export function metal(ctx, x, y, w, h, o = NONE) {
  const r = o.r === undefined ? 8 : o.r;
  const tone = o.tone || "steel";
  const T = TONES[tone] || TONES.steel;
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  rrect(ctx, 0, 0, w, h, r);
  ctx.fillStyle = metalGrad(ctx, tone, h);
  ctx.fill();
  ctx.save();
  ctx.clip();
  const pat = brushPattern(ctx);
  if (pat) {
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
  }
  // the lit top lip; on a disc (r = w/2) it is an arc rather than a chord
  ctx.beginPath();
  if (r >= Math.min(w, h) / 2 - 0.5) {
    const rr = Math.min(w, h) / 2;
    ctx.arc(w / 2, h / 2, rr - 2.5, Math.PI * 1.15, Math.PI * 1.85);
  } else {
    ctx.moveTo(r * 0.7 + 2, 2.5);
    ctx.lineTo(w - r * 0.7 - 2, 2.5);
  }
  ctx.strokeStyle = T[4];
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.8;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();
  ctx.beginPath();
  rrect(ctx, 0, 0, w, h, r);
  ink(ctx, o.line || LINE);
  ctx.stroke();
  ctx.restore();
}

/*
 * bolt(ctx, x, y, r) — a rivet / screw head: steel dome, a slot turned by
 * its own position (so a row of them is not a row of clones), a glint.
 */
export function bolt(ctx, x, y, r) {
  const lw = Math.max(1, Math.min(LINE * 0.7, r * 0.4));
  ctx.beginPath();
  circ(ctx, x + r * 0.25, y + r * 0.3, r);
  ctx.fillStyle = PAL.ink;
  ctx.fill();
  blob(ctx, x, y, r, PAL.steel, lw);
  ctx.beginPath();
  ctx.arc(x, y, r * 0.62, Math.PI * 0.15, Math.PI * 0.95);
  ctx.strokeStyle = PAL.steelDark;
  ctx.lineWidth = Math.max(0.8, r * 0.25);
  ctx.stroke();
  const a = hash(Math.round(x), Math.round(y)) * Math.PI;
  const dx = Math.cos(a) * r * 0.6;
  const dy = Math.sin(a) * r * 0.6;
  seg(ctx, x - dx, y - dy, x + dx, y + dy, PAL.ink, Math.max(0.8, r * 0.28));
  ctx.beginPath();
  circ(ctx, x - r * 0.35, y - r * 0.38, r * 0.2);
  ctx.fillStyle = PAL.white;
  ctx.fill();
}

/*
 * caption(ctx, x, y, text, { size, align, fill, stroke, shadow, max,
 * baseline }) — outlined comic lettering: an ink drop shadow, a thick ink
 * outline, the fill on top.
 *
 * y is the VERTICAL CENTRE of the lettering by default (textBaseline
 * 'middle'), because almost every caller letters into a box — a key, a
 * terminal, a dial number — and wants it centred there. Pass baseline:
 * 'alphabetic' to set y as the baseline instead, as for running text.
 * align is 'left' | 'center' | 'right'. An empty or missing fill/stroke
 * means the default (cream on ink); stroke null or false means none. max
 * squeezes a long Norwegian word into a width rather than overflowing.
 * Options objects are only read, never kept, so callers may reuse one.
 */
export function caption(ctx, x, y, text, o = NONE) {
  const size = o.size || 22;
  const fill = o.fill || PAL.cream;
  const stroke = o.stroke === null || o.stroke === false ? null : o.stroke || PAL.ink;
  const max = o.max || undefined;
  ctx.font = font(size);
  ctx.textAlign = o.align || "center";
  ctx.textBaseline = o.baseline || "middle";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  if (stroke) {
    const lw = Math.max(2, size * 0.2);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    if (o.shadow !== false) {
      const d = Math.max(1.5, size * 0.07);
      ctx.fillStyle = stroke;
      if (max) {
        ctx.strokeText(text, x + d, y + d, max);
        ctx.fillText(text, x + d, y + d, max);
      } else {
        ctx.strokeText(text, x + d, y + d);
        ctx.fillText(text, x + d, y + d);
      }
    }
    if (max) ctx.strokeText(text, x, y, max);
    else ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = fill;
  if (max) ctx.fillText(text, x, y, max);
  else ctx.fillText(text, x, y);
}

/*
 * burst(ctx, x, y, text, { size, fill, color, rot, life }) — a starburst
 * sound word. `size` is the lettering's size; the star grows to fit the
 * word. Its spikes are jittered by a hash of the word, so "KLIKK!" always
 * has the same silhouette and two different words never match.
 *
 * `life` 0..1 (default 1, fully shown). Counted UP as progress (age/dur),
 * the word pops in over the first ~30% — overshooting full size and
 * settling — then holds at full size through 1, and is gone when the caller
 * stops drawing it. There is deliberately no automatic fade at the top end,
 * because the same number also serves as PRESENCE: js/puzzles/index.js
 * passes an envelope, min(1, age/0.1) * min(1, (dur-age)/0.3), which holds
 * at 1 and then counts back down, so its words shrink and fade out through
 * the same pop in reverse. Both readings draw correctly. rot is radians.
 */
function backOut(t) {
  const c1 = 2.2;
  const c3 = c1 + 1;
  const u = t - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}
/* Reused, never reallocated: the options burst hands to caption. */
const BURST_CAP = { size: 0, fill: "" };
export function burst(ctx, x, y, text, o = NONE) {
  const life = o.life === undefined ? 1 : clamp(o.life, 0, 1);
  if (life <= 0.001) return;
  const size = o.size || 34;
  const fill = o.fill || PAL.mustard;
  const color = o.color || PAL.red;
  const rot = o.rot === undefined ? -0.12 : o.rot;
  const k = backOut(life < 0.3 ? life / 0.3 : 1);
  let seed = 7;
  for (let i = 0; i < text.length; i++) seed = (Math.imul(seed, 31) + text.charCodeAt(i)) | 0;
  const tw = textWidth(ctx, text, size);
  const rx = Math.max(size * 1.15, tw * 0.62 + size * 0.6);
  const ry = size * 1.05;
  const spikes = 13 + (seed & 3);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot + (life < 0.3 ? (1 - life / 0.3) * 0.35 : 0));
  ctx.scale(k, k);
  if (life < 0.2) ctx.globalAlpha = life / 0.2;
  const lw = Math.max(2, size * 0.09);
  // shadow, outer star, inner star
  for (let pass = 0; pass < 3; pass++) {
    const sc = pass === 2 ? 0.74 : 1;
    const off = pass === 0 ? size * 0.14 : 0;
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const a = (i / (spikes * 2)) * TAU + (hash(seed, i) - 0.5) * 0.18;
      const out = i % 2 === 0;
      const j = out ? 0.9 + hash(seed, i + 99) * 0.32 : 0.72 + hash(seed, i + 7) * 0.06;
      const px = off + Math.cos(a) * rx * j * sc * (out ? 1.12 : 1);
      const py = off + Math.sin(a) * ry * j * sc * (out ? 1.12 : 1);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    if (pass === 0) {
      ctx.fillStyle = PAL.ink;
      ctx.fill();
    } else if (pass === 1) {
      fillInk(ctx, fill, lw);
      ctx.save();
      ctx.clip();
      htBlit(ctx, -rx * 1.2, -ry * 1.2, rx * 2.4, ry * 2.4, "rgba(201,74,28,0.45)", Math.max(4, size * 0.2), 0.8, 0, 0.7, "radial");
      ctx.restore();
    } else {
      ctx.fillStyle = PAL.paper;
      ctx.fill();
    }
  }
  BURST_CAP.size = size;
  BURST_CAP.fill = color;
  caption(ctx, 0, size * 0.04, text, BURST_CAP);
  ctx.restore();
}

/* ===================== the night street: shared scenery ===================== */

/*
 * Scenery is laid out in fractions of the rect and detailed in units of k,
 * so one builder serves a 160px job-card thumbnail and a 1400px landscape
 * tablet: k is ~1 at 420px on the short side, and the ink thins with it.
 */
function sceneScale(w, h) {
  return clamp(Math.min(w, h) / 420, 0.3, 1.6);
}
function sceneLine(k) {
  return Math.max(1.1, LINE * Math.min(1, k * 1.15));
}

function moon(g, x, y, r, lw) {
  const gl = g.createRadialGradient(x, y, r * 0.9, x, y, r * 3);
  gl.addColorStop(0, "rgba(251,233,192,0.26)");
  gl.addColorStop(1, "rgba(251,233,192,0)");
  g.fillStyle = gl;
  g.beginPath();
  circ(g, x, y, r * 3);
  g.fill();
  blob(g, x, y, r, PAL.cream, lw);
  g.save();
  g.beginPath();
  circ(g, x, y, r);
  g.clip();
  dots(g, x - r, y - r, 2 * r, 2 * r, "rgba(201,138,28,0.6)", Math.max(3, r * 0.17), 0.5, 0, 0.95, "x");
  g.fillStyle = "rgba(201,138,28,0.35)";
  g.beginPath();
  circ(g, x - r * 0.35, y - r * 0.2, r * 0.18);
  circ(g, x + r * 0.12, y + r * 0.42, r * 0.12);
  circ(g, x - r * 0.05, y - r * 0.58, r * 0.09);
  g.fill();
  g.restore();
  g.beginPath();
  circ(g, x, y, r);
  g.strokeStyle = PAL.ink;
  g.lineWidth = lw;
  g.stroke();
}

/* The sky every exterior shares: night to navy, a dot screen thinning
   downwards, stars, and (where given) the moon. */
function nightSky(g, w, h, rnd, k, lw, mx, my) {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, PAL.night);
  gr.addColorStop(0.7, PAL.navy);
  gr.addColorStop(1, PAL.navyHi);
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
  dots(g, 0, 0, w, h * 0.6, "rgba(45,65,137,0.85)", Math.max(4, 8 * k), Math.PI / 4, 0.7, 0, "y");
  for (let i = 0; i < 46; i++) {
    const sx = rnd() * w;
    const sy = rnd() * h * 0.55;
    const r = (0.5 + rnd() * 1.3) * Math.max(0.7, k);
    g.globalAlpha = 0.35 + rnd() * 0.65;
    if (rnd() < 0.15) twinkle(g, sx, sy, r * 3, PAL.cream);
    else {
      g.beginPath();
      circ(g, sx, sy, r);
      g.fillStyle = PAL.cream;
      g.fill();
    }
  }
  g.globalAlpha = 1;
  if (mx !== undefined) moon(g, mx, my, Math.max(10, 34 * k), lw);
}

/* A row of far rooftops, flat navy, a few windows lit. */
function backRow(g, w, base, maxH, rnd, k, lw) {
  let x = -10 * k;
  while (x < w) {
    const bw = (40 + rnd() * 70) * k;
    const bh = maxH * (0.45 + rnd() * 0.55);
    g.beginPath();
    g.rect(x, base - bh, bw, bh + 2);
    fillInk(g, "#18245a", lw * 0.7);
    g.fillStyle = PAL.glow;
    for (let yy = base - bh + 8 * k; yy < base - 8 * k; yy += 14 * k) {
      for (let xx = x + 6 * k; xx < x + bw - 8 * k; xx += 12 * k) {
        if (rnd() < 0.13) g.fillRect(xx, yy, 5 * k, 7 * k);
      }
    }
    x += bw + rnd() * 6 * k;
  }
}

/* Pavement, kerb and the road in front, with paving joints and dots. */
function street(g, w, h, gy, k, lw) {
  const ry = gy + (h - gy) * 0.55;
  g.fillStyle = "#2f3860";
  g.fillRect(0, gy, w, ry - gy);
  g.strokeStyle = "rgba(20,22,37,0.45)";
  g.lineWidth = Math.max(1, lw * 0.5);
  g.beginPath();
  const step = Math.max(24, 70 * k);
  for (let x = step * 0.5; x < w; x += step) {
    g.moveTo(x, gy);
    g.lineTo(x - step * 0.15, ry);
  }
  g.stroke();
  g.fillStyle = "#171d3d";
  g.fillRect(0, ry, w, h - ry);
  dots(g, 0, ry, w, h - ry, "rgba(45,65,137,0.7)", Math.max(3, 6 * k), 0.3, 0.1, 0.55, "y");
  const kh = Math.max(2, 4 * k);
  g.fillStyle = "#4a5582";
  g.fillRect(0, ry - kh, w, kh);
  seg(g, 0, gy, w, gy, PAL.ink, lw);
  seg(g, 0, ry, w, ry, PAL.ink, lw);
}

/* A street lamp: a pool on the pavement, a halo, the post, the lantern. */
function lamp(g, x, gy, ht, k, lw) {
  const pr = ht * 0.6;
  const pool = g.createRadialGradient(x, gy, 0, x, gy, pr);
  pool.addColorStop(0, "rgba(255,215,106,0.38)");
  pool.addColorStop(1, "rgba(255,215,106,0)");
  g.fillStyle = pool;
  g.beginPath();
  g.ellipse(x, gy + 4 * k, pr, pr * 0.3, 0, 0, TAU);
  g.fill();
  const top = gy - ht;
  const glow = g.createRadialGradient(x, top + 8 * k, 0, x, top + 8 * k, ht * 0.45);
  glow.addColorStop(0, "rgba(255,226,140,0.55)");
  glow.addColorStop(1, "rgba(255,226,140,0)");
  g.fillStyle = glow;
  g.beginPath();
  circ(g, x, top + 8 * k, ht * 0.45);
  g.fill();
  const pw = Math.max(3, 6 * k);
  box(g, x - pw / 2, top + 10 * k, pw, ht - 10 * k, pw / 2, PAL.steelDark, lw);
  box(g, x - pw * 1.4, gy - 9 * k, pw * 2.8, 9 * k, 2 * k, PAL.steelDark, lw);
  g.beginPath();
  g.moveTo(x - 9 * k, top + 2 * k);
  g.lineTo(x + 9 * k, top + 2 * k);
  g.lineTo(x + 6 * k, top + 18 * k);
  g.lineTo(x - 6 * k, top + 18 * k);
  g.closePath();
  fillInk(g, PAL.glow, lw);
  g.beginPath();
  g.moveTo(x - 13 * k, top + 3 * k);
  g.lineTo(x, top - 8 * k);
  g.lineTo(x + 13 * k, top + 3 * k);
  g.closePath();
  fillInk(g, PAL.ink, lw);
}

/* A window: lit (glow and warm dots) or dark (a moonlight glint). */
function litWindow(g, x, y, w, h, k, lw, lit) {
  box(g, x, y, w, h, 2 * k, lit ? PAL.glow : "#22306a", lw);
  g.save();
  g.beginPath();
  rrect(g, x, y, w, h, 2 * k);
  g.clip();
  if (lit) {
    dots(g, x, y, w, h, "rgba(201,138,28,0.6)", Math.max(3, 5 * k), 0.785, 0, 0.75, "y");
  } else {
    g.fillStyle = "rgba(160,190,255,0.14)";
    g.beginPath();
    g.moveTo(x, y + h * 0.7);
    g.lineTo(x + w * 0.6, y);
    g.lineTo(x + w * 0.85, y);
    g.lineTo(x, y + h);
    g.closePath();
    g.fill();
  }
  g.restore();
  seg(g, x + w / 2, y, x + w / 2, y + h, PAL.ink, lw * 0.7);
  seg(g, x, y + h * 0.45, x + w, y + h * 0.45, PAL.ink, lw * 0.7);
  box(g, x - 3 * k, y + h, w + 6 * k, 4 * k, 1, "#4c5579", lw * 0.8);
}

function bricks(g, x, y, w, h, base, k, lw) {
  g.fillStyle = base;
  g.fillRect(x, y, w, h);
  const bh = Math.max(5, 12 * k);
  const bw = bh * 2.3;
  g.strokeStyle = "rgba(20,22,37,0.5)";
  g.lineWidth = Math.max(0.7, lw * 0.4);
  g.beginPath();
  let row = 0;
  for (let yy = y; yy < y + h; yy += bh, row++) {
    g.moveTo(x, yy);
    g.lineTo(x + w, yy);
    for (let xx = x + (row % 2 ? bw / 2 : 0); xx < x + w; xx += bw) {
      g.moveTo(xx, yy);
      g.lineTo(xx, Math.min(y + h, yy + bh));
    }
  }
  g.stroke();
}

/* A striped shop awning with a scalloped hem, and the dotted shadow it
   throws on the wall below. */
function awning(g, x, y, w, h, c1, c2, k, lw) {
  const n = Math.max(4, Math.round(w / Math.max(16, 34 * k)));
  const sw = w / n;
  for (let i = 0; i < n; i++) {
    g.beginPath();
    g.moveTo(x + i * sw, y);
    g.lineTo(x + (i + 1) * sw, y);
    g.lineTo(x + (i + 1) * sw, y + h);
    g.arc(x + (i + 0.5) * sw, y + h, sw / 2, 0, Math.PI);
    g.closePath();
    g.fillStyle = i % 2 ? c2 : c1;
    g.fill();
  }
  g.save();
  g.globalAlpha = 0.5;
  dots(g, x, y + h + sw / 2, w, 24 * k, PAL.ink, Math.max(3, 5 * k), 0.785, 0.85, 0, "y");
  g.restore();
  g.save();
  g.beginPath();
  g.rect(x, y + h * 0.45, w, h * 0.55 + sw / 2);
  g.clip();
  dots(g, x, y + h * 0.45, w, h * 0.55 + sw / 2, "rgba(20,22,37,0.4)", Math.max(3, 5 * k), 0.785, 0, 0.7, "y");
  g.restore();
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + w, y);
  g.lineTo(x + w, y + h);
  for (let i = n - 1; i >= 0; i--) g.arc(x + (i + 0.5) * sw, y + h, sw / 2, 0, Math.PI);
  g.closePath();
  g.strokeStyle = PAL.ink;
  g.lineWidth = lw;
  g.lineJoin = "round";
  g.stroke();
  seg(g, x, y + h * 0.18, x + w, y + h * 0.18, PAL.ink, lw * 0.5);
}

/* A lit shop window with three shelves of little goods and a glass glint. */
function shopWindow(g, x, y, w, h, k, lw, rnd, frame) {
  box(g, x - 5 * k, y - 5 * k, w + 10 * k, h + 10 * k, 3 * k, frame, lw);
  box(g, x, y, w, h, 2 * k, PAL.glow, lw);
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  const goods = [PAL.red, PAL.blue, PAL.green, PAL.pink, PAL.mustardDk, PAL.purple, PAL.cream];
  for (let s = 1; s <= 3; s++) {
    const sy = y + (h * s) / 3.3;
    let gx = x + 4 * k;
    while (gx < x + w - 8 * k) {
      const gw = (6 + rnd() * 10) * k;
      const gh = (8 + rnd() * 16) * k;
      const c = goods[(rnd() * goods.length) | 0];
      if (rnd() < 0.4) oval(g, gx + gw / 2, sy - gh / 2, gw / 2, gh / 2, 0, c, lw * 0.6);
      else box(g, gx, sy - gh, gw, gh, 1.5 * k, c, lw * 0.6);
      gx += gw + (2 + rnd() * 4) * k;
    }
    box(g, x - 2, sy, w + 4, 4 * k, 0, PAL.woodDk, lw * 0.6);
  }
  dots(g, x, y, w, h, "rgba(201,138,28,0.5)", Math.max(3, 5 * k), 0.785, 0, 0.6, "y");
  g.fillStyle = "rgba(255,255,255,0.28)";
  g.beginPath();
  g.moveTo(x + w * 0.1, y + h);
  g.lineTo(x + w * 0.55, y);
  g.lineTo(x + w * 0.72, y);
  g.lineTo(x + w * 0.27, y + h);
  g.closePath();
  g.fill();
  g.restore();
  g.beginPath();
  g.rect(x, y, w, h);
  g.strokeStyle = PAL.ink;
  g.lineWidth = lw;
  g.stroke();
}

/* Dots darkening toward the edges: the panel's own vignette. */
function vignette(g, w, h, k) {
  dots(g, 0, 0, w, h, "rgba(8,10,28,0.6)", Math.max(4, 7 * k), 0.785, 0, 0.8, "radial");
}

/* ===================== the six venues ===================== */

/*
 * Each builder paints a venue's still picture into a layer and returns the
 * few numbers its animation needs; each animator draws only what moves.
 * The lock sits in the middle of the rect, so every venue keeps its
 * recognisable things (a sign, a window, a column, a vault door's rim) at
 * the top and the sides, where the lock does not cover them.
 */

/* KIOSK — the corner kiosk: a "24/7" board on the roof, a red-and-cream
   awning, a window of sweets, a roller shutter half down, a newspaper rack. */
function buildKiosk(g, w, h, k, lw, rnd) {
  const gy = h * 0.84;
  nightSky(g, w, h, rnd, k, lw, w * 0.86, h * 0.1);
  backRow(g, w, h * 0.36, h * 0.18, rnd, k, lw);
  const bx = w * 0.07;
  const bw = w * 0.86;
  const top = h * 0.3;
  box(g, bx, top, bw, gy - top, 0, "#3b4a85", lw);
  g.save();
  g.beginPath();
  g.rect(bx, top, bw, gy - top);
  g.clip();
  dots(g, bx, top, bw, gy - top, "rgba(20,22,37,0.4)", Math.max(3, 6 * k), 0.785, 0, 0.55, "y");
  g.restore();
  box(g, bx - 6 * k, top - 10 * k, bw + 12 * k, 12 * k, 2 * k, "#4c5a96", lw);
  const sw = Math.min(bw * 0.56, h * 0.6);
  const sh = Math.max(20, h * 0.13);
  const sx = w / 2 - sw / 2;
  const sy = top - 10 * k - sh - 8 * k;
  seg(g, sx + sw * 0.2, sy + sh, sx + sw * 0.2, top - 10 * k, PAL.ink, lw * 1.6);
  seg(g, sx + sw * 0.8, sy + sh, sx + sw * 0.8, top - 10 * k, PAL.ink, lw * 1.6);
  box(g, sx + 4 * k, sy + 4 * k, sw, sh, 6 * k, PAL.ink, lw);
  box(g, sx, sy, sw, sh, 6 * k, PAL.red, lw);
  g.beginPath();
  rrect(g, sx + 5 * k, sy + 5 * k, sw - 10 * k, sh - 10 * k, 4 * k);
  g.strokeStyle = PAL.cream;
  g.lineWidth = lw * 0.6;
  g.stroke();
  caption(g, w / 2, sy + sh * 0.53, "24/7", { size: sh * 0.56, fill: PAL.mustard });
  // a lollipop and a soda bottle either side of the lettering
  const ly = sy + sh / 2;
  const lx = sx + sw * 0.12;
  seg(g, lx, ly, lx, ly + sh * 0.3, PAL.cream, lw);
  blob(g, lx, ly - sh * 0.05, sh * 0.17, PAL.pink, lw * 0.7);
  const bxx = sx + sw * 0.88;
  box(g, bxx - sh * 0.09, ly - sh * 0.2, sh * 0.18, sh * 0.42, sh * 0.06, PAL.green, lw * 0.7);
  const ay = top + (gy - top) * 0.1;
  const ah = (gy - top) * 0.16;
  awning(g, bx - 10 * k, ay, bw + 20 * k, ah, PAL.red, PAL.cream, k, lw);
  const wy = ay + ah + 30 * k;
  const wh = gy - wy - 16 * k;
  shopWindow(g, bx + bw * 0.05, wy, bw * 0.28, wh, k, lw, rnd, "#2a2546");
  // the roller shutter, down to a lit slot
  const dx = bx + bw * 0.67;
  const dw = bw * 0.28;
  const slot = wh * 0.22;
  box(g, dx, gy - slot, dw, slot, 0, PAL.glow, lw);
  metal(g, dx - 3 * k, wy - 6 * k, dw + 6 * k, gy - slot - wy + 6 * k, { r: 2, tone: "dark", line: lw });
  g.strokeStyle = "rgba(20,22,37,0.55)";
  g.lineWidth = Math.max(0.8, lw * 0.5);
  g.beginPath();
  for (let yy = wy; yy < gy - slot - 2; yy += Math.max(4, 7 * k)) {
    g.moveTo(dx, yy);
    g.lineTo(dx + dw, yy);
  }
  g.stroke();
  box(g, dx + dw * 0.4, gy - slot - 7 * k, dw * 0.2, 6 * k, 2 * k, PAL.steel, lw * 0.7);
  street(g, w, h, gy, k, lw);
  // the newspaper rack by the window
  const nx = bx + bw * 0.36;
  const nh = (gy - wy) * 0.45;
  box(g, nx, gy - nh, 30 * k, nh, 2 * k, PAL.blueDk, lw);
  box(g, nx + 4 * k, gy - nh + 4 * k, 22 * k, nh * 0.42, 1, PAL.paper, lw * 0.6);
  for (let i = 0; i < 3; i++) seg(g, nx + 7 * k, gy - nh + (9 + i * 5) * k, nx + 23 * k, gy - nh + (9 + i * 5) * k, PAL.steelDark, lw * 0.5);
  lamp(g, w * 0.965, gy, h * 0.55, k, lw);
  vignette(g, w, h, k);
  return { sx, sy, sw, sh };
}
function animKiosk(ctx, d, w, h, now) {
  // the sign's tube stutters now and then, as every all-night sign does
  const tick = Math.floor(now * 9);
  if (hash(tick, 3) < 0.05 || hash(tick >> 3, 5) < 0.04) {
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = PAL.ink;
    ctx.beginPath();
    rrect(ctx, d.sx, d.sy, d.sw, d.sh, 4);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

/* PAWNSHOP — brick, two storeys, a fire-escape-dark upstairs, a barred
   window of other people's guitars and clocks, and the three golden balls
   that have meant "pawnbroker" for five hundred years. */
function buildPawn(g, w, h, k, lw, rnd) {
  const gy = h * 0.84;
  nightSky(g, w, h, rnd, k, lw, w * 0.5, h * 0.06);
  const bx = w * 0.04;
  const bw = w * 0.92;
  const top = h * 0.1;
  bricks(g, bx, top, bw, gy - top, "#5e2f45", k, lw);
  g.save();
  g.beginPath();
  g.rect(bx, top, bw, gy - top);
  g.clip();
  dots(g, bx, top, bw, gy - top, "rgba(20,22,37,0.45)", Math.max(3, 6 * k), 0.785, 0.55, 0.1, "y");
  g.restore();
  g.beginPath();
  g.rect(bx, top, bw, gy - top);
  g.strokeStyle = PAL.ink;
  g.lineWidth = lw;
  g.stroke();
  box(g, bx - 6 * k, top - 8 * k, bw + 12 * k, 12 * k, 2 * k, "#4c5579", lw);
  const fh = gy - top;
  for (let i = 0; i < 3; i++) {
    const ww = bw * 0.17;
    const x = bx + bw * (0.115 + i * 0.29);
    litWindow(g, x, top + fh * 0.07, ww, fh * 0.2, k, lw, i === 2);
    if (i === 2) {
      // a blind half down, and somebody's cat
      box(g, x, top + fh * 0.07, ww, fh * 0.08, 1, PAL.cream, lw * 0.7);
      g.strokeStyle = "rgba(20,22,37,0.35)";
      g.lineWidth = 1;
      g.beginPath();
      for (let yy = top + fh * 0.07 + 4 * k; yy < top + fh * 0.15; yy += 4 * k) {
        g.moveTo(x, yy);
        g.lineTo(x + ww, yy);
      }
      g.stroke();
      const cx = x + ww * 0.3;
      const cy = top + fh * 0.27 - 5 * k;
      g.fillStyle = PAL.ink;
      g.beginPath();
      g.ellipse(cx, cy, 9 * k, 7 * k, 0, 0, TAU);
      circ(g, cx + 6 * k, cy - 8 * k, 5 * k);
      g.moveTo(cx + 2 * k, cy - 11 * k);
      g.lineTo(cx + 3 * k, cy - 17 * k);
      g.lineTo(cx + 6 * k, cy - 12 * k);
      g.moveTo(cx + 7 * k, cy - 12 * k);
      g.lineTo(cx + 10 * k, cy - 17 * k);
      g.lineTo(cx + 11 * k, cy - 10 * k);
      g.fill();
    }
  }
  const cy = top + fh * 0.36;
  box(g, bx - 6 * k, cy, bw + 12 * k, 12 * k, 2 * k, "#4c5579", lw);
  box(g, bx + bw * 0.03, cy + 18 * k, bw * 0.94, gy - cy - 18 * k, 0, "#2a2546", lw);
  const wy = cy + 30 * k;
  const wh = gy - wy - 14 * k;
  const ww = bw * 0.27;
  for (let side = 0; side < 2; side++) {
    const wx = side ? bx + bw * 0.67 : bx + bw * 0.06;
    box(g, wx, wy, ww, wh, 2 * k, PAL.glow, lw);
    g.save();
    g.beginPath();
    g.rect(wx, wy, ww, wh);
    g.clip();
    if (!side) {
      // a guitar leaning, a wall clock
      const gx = wx + ww * 0.35;
      const gb = wy + wh * 0.82;
      g.save();
      g.translate(gx, gb);
      g.rotate(-0.25);
      box(g, -2.5 * k, -wh * 0.75, 5 * k, wh * 0.5, 1, PAL.woodDk, lw * 0.7);
      g.beginPath();
      g.ellipse(0, -wh * 0.2, wh * 0.13, wh * 0.13, 0, 0, TAU);
      g.ellipse(0, -wh * 0.05, wh * 0.17, wh * 0.15, 0, 0, TAU);
      fillInk(g, PAL.amber, lw * 0.7);
      blob(g, 0, -wh * 0.17, wh * 0.045, PAL.ink, lw * 0.5);
      g.restore();
      const kx = wx + ww * 0.74;
      const ky = wy + wh * 0.28;
      blob(g, kx, ky, wh * 0.14, PAL.cream, lw * 0.8);
      seg(g, kx, ky, kx, ky - wh * 0.09, PAL.ink, lw * 0.7);
      seg(g, kx, ky, kx + wh * 0.06, ky + wh * 0.03, PAL.ink, lw * 0.7);
    } else {
      // a television and a trumpet
      const tx = wx + ww * 0.1;
      const ty = wy + wh * 0.42;
      box(g, tx, ty, ww * 0.5, wh * 0.38, 4 * k, PAL.woodDk, lw * 0.8);
      box(g, tx + ww * 0.05, ty + wh * 0.06, ww * 0.32, wh * 0.26, 6 * k, "#8fb3d9", lw * 0.6);
      seg(g, tx + ww * 0.15, ty, tx + ww * 0.05, ty - wh * 0.15, PAL.ink, lw * 0.6);
      seg(g, tx + ww * 0.3, ty, tx + ww * 0.4, ty - wh * 0.15, PAL.ink, lw * 0.6);
      const px = wx + ww * 0.62;
      const py = wy + wh * 0.25;
      seg(g, px, py, px + ww * 0.28, py, PAL.brass, 4 * k);
      g.beginPath();
      g.moveTo(px + ww * 0.24, py);
      g.lineTo(px + ww * 0.36, py - wh * 0.08);
      g.lineTo(px + ww * 0.36, py + wh * 0.08);
      g.closePath();
      fillInk(g, PAL.brass, lw * 0.6);
    }
    dots(g, wx, wy, ww, wh, "rgba(201,138,28,0.5)", Math.max(3, 5 * k), 0.785, 0, 0.6, "y");
    g.restore();
    // the bars
    g.strokeStyle = PAL.ink;
    g.lineWidth = Math.max(1.5, lw * 0.9);
    g.beginPath();
    g.rect(wx, wy, ww, wh);
    const bars = Math.max(3, Math.round(ww / (14 * k)));
    for (let i = 1; i < bars; i++) {
      g.moveTo(wx + (ww * i) / bars, wy);
      g.lineTo(wx + (ww * i) / bars, wy + wh);
    }
    g.moveTo(wx, wy + wh * 0.5);
    g.lineTo(wx + ww, wy + wh * 0.5);
    g.stroke();
  }
  street(g, w, h, gy, k, lw);
  lamp(g, w * 0.5, gy, h * 0.12, k * 0.6, lw * 0.8);
  vignette(g, w, h, k);
  // the bracket for the three balls
  const ax = bx + bw * 0.2;
  const ay = cy + 12 * k;
  seg(g, bx + bw * 0.03, ay, ax + 18 * k, ay, PAL.ink, Math.max(2, 4 * k));
  return { ax, ay, k, lw };
}
function animPawn(ctx, d, w, h, now) {
  const k = d.k;
  const r = Math.max(5, 12 * k);
  ctx.save();
  ctx.translate(d.ax, d.ay);
  ctx.rotate(Math.sin(now * 1.3) * 0.05);
  ctx.strokeStyle = PAL.ink;
  ctx.lineWidth = Math.max(1, d.lw * 0.6);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-r * 1.1, r * 1.6);
  ctx.moveTo(0, 0);
  ctx.lineTo(r * 1.1, r * 1.6);
  ctx.moveTo(0, 0);
  ctx.lineTo(0, r * 3.3);
  ctx.stroke();
  for (let i = 0; i < 3; i++) {
    const bx = i === 0 ? -r * 1.1 : i === 1 ? r * 1.1 : 0;
    const by = i === 2 ? r * 3.6 : r * 2.2;
    blob(ctx, bx, by, r, PAL.mustard, d.lw);
    ctx.beginPath();
    ctx.arc(bx, by, r * 0.7, Math.PI * 0.2, Math.PI * 0.85);
    ctx.strokeStyle = PAL.mustardDk;
    ctx.lineWidth = r * 0.3;
    ctx.stroke();
    ctx.beginPath();
    circ(ctx, bx - r * 0.35, by - r * 0.35, r * 0.2);
    ctx.fillStyle = PAL.paper;
    ctx.fill();
  }
  ctx.restore();
}

/* JEWELLER — a teal marble front with gold trim, two arched windows of
   rings and necklaces on velvet, and a cut diamond hanging over the door. */
function buildJeweller(g, w, h, k, lw, rnd) {
  const gy = h * 0.84;
  nightSky(g, w, h, rnd, k, lw, w * 0.12, h * 0.1);
  const bx = w * 0.05;
  const bw = w * 0.9;
  const top = h * 0.12;
  box(g, bx, top, bw, gy - top, 0, "#1d5a57", lw);
  g.save();
  g.beginPath();
  g.rect(bx, top, bw, gy - top);
  g.clip();
  // marble veins
  g.strokeStyle = "rgba(200,240,230,0.18)";
  g.lineWidth = Math.max(1, 1.5 * k);
  for (let i = 0; i < 14; i++) {
    let x = bx + rnd() * bw;
    let y = top + rnd() * (gy - top);
    g.beginPath();
    g.moveTo(x, y);
    for (let j = 0; j < 5; j++) {
      x += (rnd() - 0.3) * 40 * k;
      y += (rnd() - 0.5) * 30 * k;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  dots(g, bx, top, bw, gy - top, "rgba(20,22,37,0.45)", Math.max(3, 6 * k), 0.785, 0.5, 0.15, "y");
  g.restore();
  // gold trim: cornice, a frieze, pilasters at both ends
  box(g, bx - 6 * k, top - 10 * k, bw + 12 * k, 14 * k, 2 * k, PAL.brass, lw);
  box(g, bx, top + 14 * k, bw, 5 * k, 0, PAL.brassDk, lw * 0.7);
  const pw = Math.max(8, 18 * k);
  box(g, bx, top + 19 * k, pw, gy - top - 19 * k, 0, "#2a7a74", lw);
  box(g, bx + bw - pw, top + 19 * k, pw, gy - top - 19 * k, 0, "#2a7a74", lw);
  const sparks = [];
  const wy = top + (gy - top) * 0.36;
  const wh = gy - wy - 12 * k;
  const ww = bw * 0.24;
  for (let side = 0; side < 2; side++) {
    const wx = side ? bx + bw - pw - 10 * k - ww : bx + pw + 10 * k;
    // arched window: gold frame, lit cream interior, velvet stands
    g.beginPath();
    g.moveTo(wx - 5 * k, wy + wh + 5 * k);
    g.lineTo(wx - 5 * k, wy + ww / 2);
    g.arc(wx + ww / 2, wy + ww / 2, ww / 2 + 5 * k, Math.PI, 0);
    g.lineTo(wx + ww + 5 * k, wy + wh + 5 * k);
    g.closePath();
    fillInk(g, PAL.brass, lw);
    g.beginPath();
    g.moveTo(wx, wy + wh);
    g.lineTo(wx, wy + ww / 2);
    g.arc(wx + ww / 2, wy + ww / 2, ww / 2, Math.PI, 0);
    g.lineTo(wx + ww, wy + wh);
    g.closePath();
    fillInk(g, "#fbecc4", lw);
    g.save();
    g.clip();
    // a velvet bust with a necklace, a ring box
    const cx = wx + ww * 0.5;
    const by = wy + wh;
    g.beginPath();
    g.moveTo(cx - ww * 0.32, by);
    g.quadraticCurveTo(cx - ww * 0.3, by - wh * 0.38, cx - ww * 0.1, by - wh * 0.45);
    g.lineTo(cx - ww * 0.08, by - wh * 0.62);
    g.lineTo(cx + ww * 0.08, by - wh * 0.62);
    g.lineTo(cx + ww * 0.1, by - wh * 0.45);
    g.quadraticCurveTo(cx + ww * 0.3, by - wh * 0.38, cx + ww * 0.32, by);
    g.closePath();
    fillInk(g, "#3a2a6b", lw * 0.8);
    g.beginPath();
    g.arc(cx, by - wh * 0.47, ww * 0.16, 0.2, Math.PI - 0.2);
    g.strokeStyle = PAL.mustard;
    g.lineWidth = Math.max(1.5, 3 * k);
    g.stroke();
    const gx = cx;
    const gyy = by - wh * 0.47 + ww * 0.16;
    g.beginPath();
    g.moveTo(gx, gyy - 5 * k);
    g.lineTo(gx + 5 * k, gyy);
    g.lineTo(gx, gyy + 7 * k);
    g.lineTo(gx - 5 * k, gyy);
    g.closePath();
    fillInk(g, PAL.red, lw * 0.5);
    sparks.push(gx + 3 * k, gyy - 4 * k);
    dots(g, wx, wy, ww, wh, "rgba(201,138,28,0.4)", Math.max(3, 5 * k), 0.785, 0, 0.5, "y");
    g.restore();
  }
  // the big diamond sign over the door
  const dx = w / 2;
  const dy = top + (gy - top) * 0.06 + 22 * k;
  const dr = Math.max(14, 34 * k);
  seg(g, dx, top + 4 * k, dx, dy - dr * 0.6, PAL.ink, lw);
  g.beginPath();
  g.moveTo(dx - dr, dy - dr * 0.25);
  g.lineTo(dx - dr * 0.55, dy - dr * 0.65);
  g.lineTo(dx + dr * 0.55, dy - dr * 0.65);
  g.lineTo(dx + dr, dy - dr * 0.25);
  g.lineTo(dx, dy + dr * 0.85);
  g.closePath();
  fillInk(g, "#bfe9ff", lw);
  g.beginPath();
  g.moveTo(dx - dr, dy - dr * 0.25);
  g.lineTo(dx + dr, dy - dr * 0.25);
  g.moveTo(dx - dr * 0.55, dy - dr * 0.65);
  g.lineTo(dx - dr * 0.25, dy - dr * 0.25);
  g.lineTo(dx, dy - dr * 0.65);
  g.lineTo(dx + dr * 0.25, dy - dr * 0.25);
  g.lineTo(dx + dr * 0.55, dy - dr * 0.65);
  g.moveTo(dx - dr * 0.25, dy - dr * 0.25);
  g.lineTo(dx, dy + dr * 0.85);
  g.lineTo(dx + dr * 0.25, dy - dr * 0.25);
  g.strokeStyle = PAL.ink;
  g.lineWidth = lw * 0.6;
  g.stroke();
  g.fillStyle = "rgba(47,127,229,0.35)";
  g.beginPath();
  g.moveTo(dx + dr * 0.25, dy - dr * 0.25);
  g.lineTo(dx + dr, dy - dr * 0.25);
  g.lineTo(dx, dy + dr * 0.85);
  g.closePath();
  g.fill();
  sparks.push(dx - dr * 0.5, dy - dr * 0.5, dx + dr * 0.75, dy - dr * 0.3);
  street(g, w, h, gy, k, lw);
  lamp(g, w * 0.03, gy, h * 0.5, k, lw);
  vignette(g, w, h, k);
  return { sparks: new Float32Array(sparks), k };
}
function animJeweller(ctx, d, w, h, now) {
  const s = d.sparks;
  for (let i = 0; i < s.length; i += 2) {
    const p = (now * 0.9 + i * 0.37) % 1.6;
    if (p > 1) continue;
    const r = Math.sin(p * Math.PI) * 9 * Math.max(0.6, d.k);
    twinkle(ctx, s[i], s[i + 1], r, PAL.white);
  }
}

/* CASINO — a purple front under a red marquee ringed with chasing bulbs,
   the four suits on the board, a giant die and a chip, and a red carpet
   between brass posts. */
function buildCasino(g, w, h, k, lw, rnd) {
  const gy = h * 0.84;
  nightSky(g, w, h, rnd, k, lw);
  backRow(g, w, h * 0.3, h * 0.2, rnd, k, lw);
  const bx = w * 0.03;
  const bw = w * 0.94;
  const top = h * 0.2;
  box(g, bx, top, bw, gy - top, 0, PAL.purple, lw);
  g.save();
  g.beginPath();
  g.rect(bx, top, bw, gy - top);
  g.clip();
  dots(g, bx, top, bw, gy - top, "rgba(216,65,142,0.45)", Math.max(4, 8 * k), 0.785, 0.55, 0.05, "y");
  // vertical pinstripes
  g.fillStyle = "rgba(20,22,37,0.25)";
  for (let x = bx; x < bx + bw; x += 26 * k) g.fillRect(x, top, 6 * k, gy - top);
  g.restore();
  // the marquee
  const mw = Math.min(bw * 0.84, h * 1.1);
  const mh = Math.max(26, h * 0.2);
  const mx = w / 2 - mw / 2;
  const my = h * 0.05;
  box(g, mx + 5 * k, my + 5 * k, mw, mh, 10 * k, PAL.ink, lw);
  box(g, mx, my, mw, mh, 10 * k, PAL.redDk, lw);
  box(g, mx + 9 * k, my + 9 * k, mw - 18 * k, mh - 18 * k, 6 * k, PAL.red, lw * 0.8);
  // four suits on the board
  const sr = Math.min(mh * 0.26, mw * 0.08);
  for (let i = 0; i < 4; i++) {
    const sx = mx + mw * (0.2 + i * 0.2);
    const sy = my + mh / 2;
    blob(g, sx, sy, sr * 1.35, PAL.cream, lw * 0.8);
    suit(g, sx, sy, sr, i, lw * 0.6);
  }
  // bulb positions round the marquee rim
  const bulbs = [];
  const gap = Math.max(10, 18 * k);
  for (let x = mx + 8 * k; x <= mx + mw - 8 * k; x += gap) bulbs.push(x, my + 4.5 * k, x, my + mh - 4.5 * k);
  for (let y = my + 4.5 * k + gap; y < my + mh - 4.5 * k - gap * 0.5; y += gap) bulbs.push(mx + 4.5 * k, y, mx + mw - 4.5 * k, y);
  // the doors under a little canopy
  const dw = bw * 0.26;
  const dx = w / 2 - dw / 2;
  const dt = top + (gy - top) * 0.3;
  box(g, dx - 10 * k, dt - 10 * k, dw + 20 * k, 10 * k, 2 * k, PAL.mustard, lw);
  box(g, dx, dt, dw, gy - dt, 0, "#2b1240", lw);
  seg(g, w / 2, dt, w / 2, gy, PAL.ink, lw);
  // a giant die on the left, a chip on the right
  const ds = Math.max(18, Math.min(bw * 0.16, (gy - top) * 0.35));
  g.save();
  g.translate(bx + bw * 0.14, gy - (gy - top) * 0.42);
  g.rotate(-0.2);
  box(g, -ds / 2 + 4 * k, -ds / 2 + 4 * k, ds, ds, ds * 0.18, PAL.ink, lw);
  box(g, -ds / 2, -ds / 2, ds, ds, ds * 0.18, PAL.paper, lw);
  g.fillStyle = PAL.red;
  g.beginPath();
  circ(g, -ds * 0.25, -ds * 0.25, ds * 0.09);
  circ(g, 0, 0, ds * 0.09);
  circ(g, ds * 0.25, ds * 0.25, ds * 0.09);
  g.fill();
  g.restore();
  const cr = ds * 0.6;
  const cxp = bx + bw * 0.86;
  const cyp = gy - (gy - top) * 0.42;
  blob(g, cxp + 4 * k, cyp + 4 * k, cr, PAL.ink, lw);
  blob(g, cxp, cyp, cr, PAL.blue, lw);
  for (let i = 0; i < 6; i++) {
    g.beginPath();
    g.arc(cxp, cyp, cr * 0.82, (i / 6) * TAU, (i / 6) * TAU + 0.45);
    g.strokeStyle = PAL.paper;
    g.lineWidth = cr * 0.3;
    g.stroke();
  }
  blob(g, cxp, cyp, cr * 0.55, PAL.paper, lw * 0.7);
  starPath(g, cxp, cyp, cr * 0.32, 0.45, 0);
  g.fillStyle = PAL.blue;
  g.fill();
  street(g, w, h, gy, k, lw);
  // red carpet and the rope line
  g.beginPath();
  g.moveTo(dx + dw * 0.1, gy);
  g.lineTo(dx + dw * 0.9, gy);
  g.lineTo(dx + dw * 1.05, h);
  g.lineTo(dx - dw * 0.05, h);
  g.closePath();
  fillInk(g, PAL.red, lw);
  for (let side = 0; side < 2; side++) {
    const px = side ? dx + dw * 1.15 : dx - dw * 0.15;
    const ph = (h - gy) * 0.9 + 14 * k;
    box(g, px - 3 * k, gy + (h - gy) * 0.6 - ph, 6 * k, ph, 3 * k, PAL.brass, lw * 0.8);
    blob(g, px, gy + (h - gy) * 0.6 - ph, 5 * k, PAL.brass, lw * 0.8);
    const ox = side ? px + 50 * k : px - 50 * k;
    hose(g, px, gy + (h - gy) * 0.6 - ph + 6 * k, (px + ox) / 2, gy + (h - gy) * 0.6 - ph + 22 * k, ox, gy + (h - gy) * 0.6 - ph + 6 * k, 4 * k, PAL.redDk, lw * 0.6);
  }
  vignette(g, w, h, k);
  return { bulbs: new Float32Array(bulbs), r: Math.max(2.2, 4.5 * k), lw: lw * 0.6 };
}
function suit(g, x, y, r, which, lw) {
  g.beginPath();
  if (which === 1 || which === 2) g.fillStyle = PAL.red;
  else g.fillStyle = PAL.ink;
  if (which === 0) {
    // spade
    g.moveTo(x, y - r);
    g.bezierCurveTo(x + r * 1.3, y - r * 0.1, x + r * 0.8, y + r * 0.8, x, y + r * 0.25);
    g.bezierCurveTo(x - r * 0.8, y + r * 0.8, x - r * 1.3, y - r * 0.1, x, y - r);
    g.moveTo(x, y + r * 0.1);
    g.lineTo(x + r * 0.35, y + r);
    g.lineTo(x - r * 0.35, y + r);
    g.closePath();
  } else if (which === 1) {
    // heart
    g.moveTo(x, y + r);
    g.bezierCurveTo(x - r * 1.5, y - r * 0.1, x - r * 0.6, y - r * 1.2, x, y - r * 0.4);
    g.bezierCurveTo(x + r * 0.6, y - r * 1.2, x + r * 1.5, y - r * 0.1, x, y + r);
  } else if (which === 2) {
    // diamond
    g.moveTo(x, y - r);
    g.lineTo(x + r * 0.7, y);
    g.lineTo(x, y + r);
    g.lineTo(x - r * 0.7, y);
    g.closePath();
  } else {
    // club
    circ(g, x, y - r * 0.45, r * 0.42);
    circ(g, x - r * 0.48, y + r * 0.12, r * 0.42);
    circ(g, x + r * 0.48, y + r * 0.12, r * 0.42);
    g.moveTo(x, y);
    g.lineTo(x + r * 0.32, y + r);
    g.lineTo(x - r * 0.32, y + r);
    g.closePath();
  }
  g.fill();
  void lw;
}
function animCasino(ctx, d, w, h, now) {
  const b = d.bulbs;
  const step = Math.floor(now * 7);
  for (let i = 0, n = 0; i < b.length; i += 2, n++) {
    const on = (n + step) % 3 === 0;
    ctx.beginPath();
    circ(ctx, b[i], b[i + 1], d.r);
    ctx.fillStyle = on ? PAL.paper : PAL.brassDk;
    ctx.fill();
    ctx.strokeStyle = PAL.ink;
    ctx.lineWidth = d.lw;
    ctx.stroke();
    if (on) {
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      circ(ctx, b[i], b[i + 1], d.r * 2.2);
      ctx.fillStyle = PAL.glow;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
}

/* BANK — stone, a pediment with a gold coin in it, six fluted columns,
   tall dark windows between them, three steps, and two globe lamps. */
function buildBank(g, w, h, k, lw, rnd) {
  const gy = h * 0.86;
  nightSky(g, w, h, rnd, k, lw, w * 0.88, h * 0.09);
  const bx = w * 0.04;
  const bw = w * 0.92;
  const pTop = h * 0.04;
  const pBase = h * 0.21;
  const stone = "#56628a";
  // the body
  box(g, bx + bw * 0.03, pBase, bw * 0.94, gy - pBase, 0, "#28305a", lw);
  // pediment
  g.beginPath();
  g.moveTo(bx, pBase);
  g.lineTo(w / 2, pTop);
  g.lineTo(bx + bw, pBase);
  g.closePath();
  fillInk(g, stone, lw);
  g.beginPath();
  g.moveTo(bx + bw * 0.08, pBase - 4 * k);
  g.lineTo(w / 2, pTop + 10 * k);
  g.lineTo(bx + bw * 0.92, pBase - 4 * k);
  g.closePath();
  fillInk(g, "#46517a", lw * 0.7);
  const cr = Math.max(7, (pBase - pTop) * 0.36);
  const ccy = pBase - (pBase - pTop) * 0.4;
  blob(g, w / 2 + 3 * k, ccy + 3 * k, cr, PAL.ink, lw);
  blob(g, w / 2, ccy, cr, PAL.mustard, lw);
  g.beginPath();
  circ(g, w / 2, ccy, cr * 0.75);
  g.strokeStyle = PAL.mustardDk;
  g.lineWidth = lw * 0.6;
  g.stroke();
  g.beginPath();
  starPath(g, w / 2, ccy, cr * 0.5, 0.45, 0);
  fillInk(g, PAL.mustardDk, lw * 0.5);
  // entablature
  box(g, bx, pBase, bw, Math.max(8, 16 * k), 0, stone, lw);
  box(g, bx + bw * 0.02, pBase + Math.max(8, 16 * k), bw * 0.96, Math.max(5, 9 * k), 0, "#46517a", lw * 0.8);
  const cTop = pBase + Math.max(13, 25 * k);
  const sTop = gy - Math.max(12, 30 * k);
  // windows between the columns
  const n = 6;
  const span = bw * 0.86;
  const x0 = bx + bw * 0.07;
  const cw = Math.max(8, Math.min(span / n * 0.42, 34 * k + 6));
  for (let i = 0; i < n - 1; i++) {
    const mid = x0 + (span * (i + 0.5)) / (n - 1);
    const winW = span / (n - 1) - cw - 14 * k;
    if (i === 2) continue; // the door is behind the lock
    litWindow(g, mid - winW / 2 + cw * 0.5 - cw * 0.5, cTop + (sTop - cTop) * 0.18, winW, (sTop - cTop) * 0.6, k, lw, hash(i, 2) < 0.35);
  }
  for (let i = 0; i < n; i++) {
    const cx = x0 + (span * i) / (n - 1);
    box(g, cx - cw / 2 - 4 * k, cTop, cw + 8 * k, 7 * k, 1, stone, lw * 0.8);
    box(g, cx - cw / 2, cTop + 7 * k, cw, sTop - cTop - 14 * k, 0, "#c3cadf", lw);
    g.save();
    g.beginPath();
    g.rect(cx - cw / 2, cTop + 7 * k, cw, sTop - cTop - 14 * k);
    g.clip();
    dots(g, cx, cTop, cw / 2, sTop - cTop, "rgba(40,48,90,0.75)", Math.max(3, 4 * k), 0.785, 0.15, 0.85, "x");
    g.strokeStyle = "rgba(40,48,90,0.45)";
    g.lineWidth = Math.max(0.8, lw * 0.4);
    g.beginPath();
    g.moveTo(cx - cw * 0.2, cTop);
    g.lineTo(cx - cw * 0.2, sTop);
    g.moveTo(cx + cw * 0.15, cTop);
    g.lineTo(cx + cw * 0.15, sTop);
    g.stroke();
    g.restore();
    box(g, cx - cw / 2 - 4 * k, sTop - 7 * k, cw + 8 * k, 7 * k, 1, stone, lw * 0.8);
  }
  // steps
  const st = gy - sTop;
  for (let i = 0; i < 3; i++) {
    const inset = (2 - i) * 10 * k;
    box(g, bx + inset - 6 * k, sTop + (st * i) / 3, bw - inset * 2 + 12 * k, st / 3, 0, i % 2 ? "#6a77a3" : "#5d6a96", lw * 0.8);
  }
  street(g, w, h, gy, k, lw);
  // globe lamps either side of the steps
  for (let side = 0; side < 2; side++) {
    const lx = side ? bx + bw + 2 * k : bx - 2 * k;
    const lh = (gy - cTop) * 0.55;
    const ly = gy - lh;
    const gl = g.createRadialGradient(lx, ly, 0, lx, ly, lh * 0.5);
    gl.addColorStop(0, "rgba(255,226,140,0.5)");
    gl.addColorStop(1, "rgba(255,226,140,0)");
    g.fillStyle = gl;
    g.beginPath();
    circ(g, lx, ly, lh * 0.5);
    g.fill();
    box(g, lx - 3 * k, ly, 6 * k, lh, 3 * k, PAL.ink, lw);
    blob(g, lx, ly, Math.max(5, 11 * k), PAL.paper, lw);
  }
  vignette(g, w, h, k);
  // a security camera on the corner, its LED animated
  const camX = bx + bw * 0.06;
  const camY = pBase + Math.max(30, 50 * k);
  g.save();
  g.translate(camX, camY);
  g.rotate(0.35);
  box(g, -4 * k, -6 * k, 26 * k, 12 * k, 3 * k, PAL.steel, lw * 0.8);
  box(g, 22 * k, -4 * k, 5 * k, 8 * k, 1, PAL.ink, lw * 0.6);
  g.restore();
  seg(g, camX - 8 * k, camY - 2 * k, camX, camY, PAL.ink, lw);
  return { lx: camX + Math.cos(0.35) * 8 * k - Math.sin(0.35) * -1 * k, ly: camY + Math.sin(0.35) * 8 * k, r: Math.max(1.5, 2.6 * k) };
}
function animBank(ctx, d, w, h, now) {
  if ((now % 1.4) < 0.7) {
    ctx.beginPath();
    circ(ctx, d.lx, d.ly, d.r);
    ctx.fillStyle = PAL.red;
    ctx.fill();
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    circ(ctx, d.lx, d.ly, d.r * 3);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

/* VAULT — inside at last: riveted steel walls, deposit boxes, a round door
   with a brass rim as big as the room allows, gold bars stacked on the
   diamond-plate floor, and a red laser line sweeping the floor. */
function buildVault(g, w, h, k, lw, rnd) {
  const fy = h * 0.8;
  // walls: steel plates
  g.fillStyle = "#2b3350";
  g.fillRect(0, 0, w, h);
  const pw = Math.max(40, 120 * k);
  const ph = Math.max(30, 90 * k);
  for (let y = 0; y < fy; y += ph) {
    for (let x = ((y / ph) % 2) * -pw * 0.5; x < w; x += pw) {
      metal(g, x + 1, y + 1, pw - 2, ph - 2, { r: 3, tone: "dark", line: lw * 0.6 });
    }
  }
  for (let y = 0; y < fy; y += ph) {
    for (let x = ((y / ph) % 2) * -pw * 0.5; x < w; x += pw) {
      const r = Math.max(1.5, 3 * k);
      bolt(g, x + 7 * k, y + 7 * k, r);
      bolt(g, x + pw - 7 * k, y + 7 * k, r);
      bolt(g, x + 7 * k, y + ph - 7 * k, r);
      bolt(g, x + pw - 7 * k, y + ph - 7 * k, r);
    }
  }
  // deposit boxes at both sides
  const dbw = Math.min(w * 0.2, 170 * k);
  for (let side = 0; side < 2; side++) {
    const x0 = side ? w - dbw - w * 0.02 : w * 0.02;
    const y0 = h * 0.08;
    const hh = fy - y0 - 10 * k;
    box(g, x0 - 4 * k, y0 - 4 * k, dbw + 8 * k, hh + 8 * k, 3 * k, PAL.brassDk, lw);
    const cols = 3;
    const rows = Math.max(3, Math.round(hh / (34 * k)));
    const cw = dbw / cols;
    const rh = hh / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = x0 + c * cw;
        const y = y0 + r * rh;
        metal(g, x + 1.5, y + 1.5, cw - 3, rh - 3, { r: 2, tone: "brass", line: lw * 0.5 });
        blob(g, x + cw / 2, y + rh / 2, Math.max(1.5, 3 * k), PAL.ink, 0.5);
        seg(g, x + cw / 2, y + rh / 2, x + cw / 2, y + rh / 2 + 5 * k, PAL.ink, Math.max(1, 1.6 * k));
      }
    }
  }
  // the round door, centred above the floor
  const cx = w / 2;
  const cy = fy * 0.52;
  const R = Math.min(w * 0.32, fy * 0.48);
  blob(g, cx + 6 * k, cy + 6 * k, R * 1.08, PAL.ink, lw);
  g.beginPath();
  circ(g, cx, cy, R * 1.08);
  g.fillStyle = metalGrad(g, "brass", R * 2.16);
  g.save();
  g.translate(0, cy - R * 1.08);
  g.beginPath();
  circ(g, cx, R * 1.08, R * 1.08);
  g.fill();
  g.restore();
  g.beginPath();
  circ(g, cx, cy, R * 1.08);
  g.strokeStyle = PAL.ink;
  g.lineWidth = lw;
  g.stroke();
  g.save();
  g.translate(0, cy - R);
  g.beginPath();
  circ(g, cx, R, R * 0.93);
  g.fillStyle = metalGrad(g, "steel", R * 2);
  g.fill();
  g.restore();
  g.beginPath();
  circ(g, cx, cy, R * 0.93);
  g.strokeStyle = PAL.ink;
  g.lineWidth = lw;
  g.stroke();
  g.save();
  g.beginPath();
  circ(g, cx, cy, R * 0.93);
  g.clip();
  dots(g, cx - R, cy - R, R * 2, R * 2, "rgba(40,48,90,0.55)", Math.max(4, 7 * k), 0.785, 0, 0.75, "x");
  g.restore();
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU;
    bolt(g, cx + Math.cos(a) * R * 1.0, cy + Math.sin(a) * R * 1.0, Math.max(2, R * 0.035));
  }
  g.beginPath();
  circ(g, cx, cy, R * 0.72);
  g.strokeStyle = "rgba(20,22,37,0.5)";
  g.lineWidth = lw * 0.8;
  g.stroke();
  // hinge
  box(g, cx + R * 0.98, cy - R * 0.45, R * 0.16, R * 0.9, 4 * k, PAL.steelDark, lw);
  // floor: diamond plate
  g.fillStyle = "#3c4560";
  g.fillRect(0, fy, w, h - fy);
  g.fillStyle = "rgba(228,235,243,0.18)";
  const ds = Math.max(8, 16 * k);
  for (let y = fy + ds / 2, r = 0; y < h; y += ds * 0.7, r++) {
    for (let x = (r % 2) * ds * 0.5; x < w; x += ds) {
      g.save();
      g.translate(x, y);
      g.rotate(r % 2 ? 0.6 : -0.6);
      g.fillRect(-ds * 0.25, -ds * 0.06, ds * 0.5, ds * 0.12);
      g.restore();
    }
  }
  dots(g, 0, fy, w, h - fy, "rgba(8,10,28,0.5)", Math.max(3, 6 * k), 0.785, 0.7, 0.1, "y");
  seg(g, 0, fy, w, fy, PAL.ink, lw);
  // gold bars, stacked in pyramids, and a money bag
  for (let side = 0; side < 2; side++) {
    const bxx = side ? w * 0.84 : w * 0.16;
    const bw = Math.max(16, 34 * k);
    const bh = Math.max(7, 13 * k);
    const base = fy + (h - fy) * 0.55;
    for (let row = 0; row < 3; row++) {
      const count = 3 - row;
      for (let i = 0; i < count; i++) {
        const x = bxx - (count * bw) / 2 + i * bw;
        const y = base - (row + 1) * bh;
        g.beginPath();
        g.moveTo(x + bw * 0.12, y);
        g.lineTo(x + bw * 0.88, y);
        g.lineTo(x + bw, y + bh);
        g.lineTo(x, y + bh);
        g.closePath();
        fillInk(g, PAL.mustard, lw * 0.7);
        seg(g, x + bw * 0.2, y + bh * 0.35, x + bw * 0.6, y + bh * 0.35, PAL.paper, Math.max(1, 1.6 * k));
      }
    }
  }
  // overhead lamps in cages
  for (let i = 0; i < 2; i++) {
    const lx = w * (i ? 0.7 : 0.3);
    const gl = g.createRadialGradient(lx, 0, 0, lx, 0, h * 0.4);
    gl.addColorStop(0, "rgba(255,226,140,0.28)");
    gl.addColorStop(1, "rgba(255,226,140,0)");
    g.fillStyle = gl;
    g.fillRect(lx - h * 0.4, 0, h * 0.8, h * 0.4);
    g.beginPath();
    g.arc(lx, 0, Math.max(6, 14 * k), 0, Math.PI);
    fillInk(g, PAL.glow, lw * 0.8);
  }
  vignette(g, w, h, k);
  return { fy, k, lw };
}
function animVault(ctx, d, w, h, now) {
  // a laser fence sweeping the floor: two beams, a glow under each
  for (let i = 0; i < 2; i++) {
    const t = (Math.sin(now * 0.9 + i * 2.1) + 1) / 2;
    const y = d.fy + (h - d.fy) * (0.15 + 0.75 * t);
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = PAL.red;
    ctx.fillRect(0, y - 4 * d.k - 1, w, 8 * d.k + 2);
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.strokeStyle = "#ff6a6a";
    ctx.lineWidth = Math.max(1, 1.8 * d.k);
    ctx.stroke();
  }
}

const VENUES = {
  kiosk: { build: buildKiosk, anim: animKiosk, seed: 11 },
  pawnshop: { build: buildPawn, anim: animPawn, seed: 23 },
  jeweller: { build: buildJeweller, anim: animJeweller, seed: 37 },
  casino: { build: buildCasino, anim: animCasino, seed: 41 },
  bank: { build: buildBank, anim: animBank, seed: 53 },
  vault: { build: buildVault, anim: animVault, seed: 67 },
};

/* Per venue, up to four cached sizes (a run's background and the job
   board's thumbnails can live side by side without thrashing). */
const VENUE_CACHE = new Map();
function venueLayer(id, w, h) {
  let list = VENUE_CACHE.get(id);
  if (list === undefined) {
    list = [];
    VENUE_CACHE.set(id, list);
  }
  const s = pxRatio();
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e.w === w && e.h === h && e.s === s) return e;
  }
  const V = VENUES[id];
  const L = layer(w, h);
  const k = sceneScale(w, h);
  const data = V.build(L.g, w, h, k, sceneLine(k), seeded(V.seed));
  const e = { w, h, s, c: L.c, data };
  if (list.length >= 4) list.shift();
  list.push(e);
  return e;
}

/*
 * The alarm wash: a red light from the left and a blue one from the right,
 * swapping about one and a half times a second, with a red cast over all of
 * it as the alarm climbs. Two radial gradients per size, built once.
 */
const WASH = { w: 0, h: 0, red: null, blue: null };
function alarmWash(ctx, w, h, now, alarm) {
  if (WASH.w !== w || WASH.h !== h) {
    const R = Math.max(w, h) * 0.95;
    WASH.red = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
    WASH.red.addColorStop(0, "rgba(229,55,61,0.95)");
    WASH.red.addColorStop(0.55, "rgba(229,55,61,0.35)");
    WASH.red.addColorStop(1, "rgba(229,55,61,0)");
    WASH.blue = ctx.createRadialGradient(w, 0, 0, w, 0, R);
    WASH.blue.addColorStop(0, "rgba(47,127,229,0.95)");
    WASH.blue.addColorStop(0.55, "rgba(47,127,229,0.35)");
    WASH.blue.addColorStop(1, "rgba(47,127,229,0)");
    WASH.w = w;
    WASH.h = h;
  }
  const a = clamp(alarm, 0, 1);
  const ph = Math.sin(now * TAU * 1.5);
  ctx.globalAlpha = a * 0.12;
  ctx.fillStyle = PAL.redDk;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = a * (0.15 + 0.5 * Math.max(0, ph));
  ctx.fillStyle = WASH.red;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = a * (0.15 + 0.5 * Math.max(0, -ph));
  ctx.fillStyle = WASH.blue;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 1;
}

/*
 * drawVenue(ctx, rect, venueId, now, alarm) — the building behind the lock.
 * An unknown id draws the kiosk rather than nothing. alarm 0..1 brings the
 * red and blue wash in; 0 skips it entirely, so thumbnails pay nothing.
 */
export function drawVenue(ctx, rect, venueId, now, alarm) {
  const id = VENUES[venueId] ? venueId : "kiosk";
  const w = Math.max(1, Math.round(rect.w));
  const h = Math.max(1, Math.round(rect.h));
  const e = venueLayer(id, w, h);
  ctx.drawImage(e.c, rect.x, rect.y, rect.w, rect.h);
  ctx.save();
  ctx.translate(rect.x, rect.y);
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  VENUES[id].anim(ctx, e.data, w, h, now || 0);
  if (alarm > 0.001) alarmWash(ctx, w, h, now || 0, alarm);
  ctx.restore();
}

/* ===================== the police car ===================== */

/*
 * drawCar — the patrol car seen side on, facing right, in its own 100-unit
 * space: x is the rear bumper, yb the bottom of the wheels, len its length.
 * Navy body, cream doors with a gold star, a red-and-blue light bar that
 * alternates four times a second and throws its colour around it. Shared by
 * the police meter and the skyline, so it is the same car everywhere.
 */
function drawCar(ctx, x, yb, len, now, lw) {
  const u = len / 100;
  const L = lw / u;
  ctx.save();
  ctx.translate(x, yb);
  ctx.scale(u, u);
  const flip = (now * 4) % 2 < 1;
  // headlight beam ahead
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = PAL.glow;
  ctx.beginPath();
  ctx.moveTo(98, -21);
  ctx.lineTo(170, -34);
  ctx.lineTo(170, -2);
  ctx.closePath();
  ctx.fill();
  // the light bar's glow
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = flip ? PAL.red : PAL.blue;
  ctx.beginPath();
  circ(ctx, flip ? 46 : 56, -47, 22);
  ctx.fill();
  ctx.globalAlpha = 1;
  // ground shadow
  ctx.fillStyle = PAL.shadow;
  ctx.beginPath();
  ctx.ellipse(50, -1, 52, 4, 0, 0, TAU);
  ctx.fill();
  // cabin
  ctx.beginPath();
  ctx.moveTo(22, -27);
  ctx.lineTo(33, -43);
  ctx.lineTo(70, -43);
  ctx.lineTo(82, -27);
  ctx.closePath();
  fillInk(ctx, PAL.cream, L);
  ctx.beginPath();
  ctx.moveTo(29, -28);
  ctx.lineTo(36, -39);
  ctx.lineTo(50, -39);
  ctx.lineTo(50, -28);
  ctx.closePath();
  ctx.moveTo(54, -28);
  ctx.lineTo(54, -39);
  ctx.lineTo(68, -39);
  ctx.lineTo(76, -28);
  ctx.closePath();
  fillInk(ctx, "#8fb3d9", L * 0.7);
  // body
  ctx.beginPath();
  rrect(ctx, 0, -29, 100, 19, 6);
  fillInk(ctx, PAL.navy, L);
  ctx.beginPath();
  rrect(ctx, 28, -27, 50, 15, 2);
  fillInk(ctx, PAL.cream, L * 0.7);
  ctx.beginPath();
  starPath(ctx, 53, -19.5, 5, 0.45, 0);
  fillInk(ctx, PAL.mustard, L * 0.5);
  seg(ctx, 52, -27, 52, -12, PAL.ink, L * 0.6);
  // lights: tail, head, bar
  box(ctx, -1, -25, 4, 6, 1.5, PAL.red, L * 0.6);
  box(ctx, 96, -24, 5, 6, 1.5, PAL.glow, L * 0.6);
  box(ctx, 41, -49, 9, 6, 2, flip ? PAL.red : PAL.redDk, L * 0.7);
  box(ctx, 51, -49, 9, 6, 2, flip ? PAL.blueDk : PAL.blue, L * 0.7);
  // wheels with turning hubs
  const spin = now * 14;
  for (let i = 0; i < 2; i++) {
    const wx = i ? 80 : 20;
    blob(ctx, wx, -9, 9, PAL.ink, L);
    blob(ctx, wx, -9, 4.5, PAL.steel, L * 0.6);
    const c = Math.cos(spin) * 4;
    const s = Math.sin(spin) * 4;
    seg(ctx, wx - c, -9 - s, wx + c, -9 + s, PAL.ink, L * 0.6);
  }
  ctx.restore();
}

/* ===================== the police meter ===================== */

/*
 * A strip, read at a glance: a road running left to right, the building
 * you are robbing at the right-hand end with your mask on its door, and the
 * patrol car on its way. The distance left is the time left. As the car
 * closes, the building's windows start throwing red and blue back; a jolt
 * (heat) shakes the whole strip and flashes it red.
 *
 * The road, the far skyline and the building are one cached layer per size.
 */
const METER = { w: 0, h: 0, s: 0, c: null, roadY: 0, bx: 0, bw: 0, by: 0, x0: 0, x1: 0, len: 0, lw: 0, win: null };
function meterLayer(w, h) {
  const s = pxRatio();
  if (METER.c && METER.w === w && METER.h === h && METER.s === s) return METER;
  const L = layer(w, h);
  const g = L.g;
  const sh = 4;
  const pw = w - sh;
  const ph = h - sh;
  const r = Math.min(10, ph * 0.25);
  const lw = Math.max(1.5, Math.min(LINE, ph * 0.06));
  const rnd = seeded(7);
  // the panel and its shadow
  g.beginPath();
  rrect(g, sh, sh, pw, ph, r);
  g.fillStyle = PAL.ink;
  g.fill();
  g.save();
  g.beginPath();
  rrect(g, 0, 0, pw, ph, r);
  g.clip();
  const sky = g.createLinearGradient(0, 0, 0, ph);
  sky.addColorStop(0, PAL.night);
  sky.addColorStop(1, PAL.navy);
  g.fillStyle = sky;
  g.fillRect(0, 0, pw, ph);
  const roadTop = ph * 0.58;
  // far rooftops along the top
  let x = 0;
  while (x < pw) {
    const bw = ph * (0.3 + rnd() * 0.5);
    const bh = roadTop * (0.25 + rnd() * 0.45);
    g.fillStyle = "#18245a";
    g.fillRect(x, roadTop - bh, bw, bh);
    g.fillStyle = PAL.glow;
    if (rnd() < 0.6) g.fillRect(x + bw * 0.3, roadTop - bh * 0.7, Math.max(1.5, bw * 0.12), Math.max(2, bh * 0.15));
    x += bw + 2;
  }
  dots(g, 0, 0, pw, roadTop, "rgba(45,65,137,0.9)", Math.max(3, ph * 0.09), 0.785, 0.7, 0, "y");
  // the road
  g.fillStyle = "#262c4a";
  g.fillRect(0, roadTop, pw, ph - roadTop);
  g.fillStyle = "#3a4370";
  g.fillRect(0, roadTop, pw, Math.max(2, ph * 0.06));
  const mid = roadTop + (ph - roadTop) * 0.55;
  g.strokeStyle = PAL.cream;
  g.lineWidth = Math.max(1.5, ph * 0.04);
  g.setLineDash([ph * 0.25, ph * 0.2]);
  g.beginPath();
  g.moveTo(0, mid);
  g.lineTo(pw, mid);
  g.stroke();
  g.setLineDash([]);
  seg(g, 0, roadTop, pw, roadTop, PAL.ink, lw * 0.8);
  // the building at the end: a small shop with an awning and your mask
  const bw = Math.min(ph * 1.05, pw * 0.2);
  const bx = pw - bw - lw;
  const by = ph * 0.12;
  const bh = roadTop + (ph - roadTop) * 0.25 - by;
  box(g, bx, by, bw, bh, 2, "#3b4a85", lw);
  box(g, bx - 2, by - 3, bw + 4, Math.max(3, ph * 0.08), 1, "#4c5a96", lw * 0.8);
  const aw = Math.max(4, bh * 0.16);
  const ay = by + bh * 0.22;
  const stripes = 5;
  for (let i = 0; i < stripes; i++) {
    g.fillStyle = i % 2 ? PAL.cream : PAL.red;
    g.fillRect(bx - 2 + ((bw + 4) * i) / stripes, ay, (bw + 4) / stripes + 0.5, aw);
  }
  g.beginPath();
  g.rect(bx - 2, ay, bw + 4, aw);
  g.strokeStyle = PAL.ink;
  g.lineWidth = lw * 0.8;
  g.stroke();
  const winY = ay + aw + bh * 0.08;
  const winH = bh * 0.3;
  const winW = bw * 0.26;
  box(g, bx + bw * 0.1, winY, winW, winH, 1, PAL.glow, lw * 0.7);
  box(g, bx + bw * 0.64, winY, winW, winH, 1, PAL.glow, lw * 0.7);
  const dw = bw * 0.26;
  const dh = by + bh - (winY + winH * 0.2);
  box(g, bx + bw / 2 - dw / 2, by + bh - dh, dw, dh, 1, PAL.ink, lw * 0.7);
  // the mask: "you are here"
  const mx = bx + bw / 2;
  const my = by - Math.max(4, ph * 0.04);
  const mw = bw * 0.36;
  const mh = Math.max(4, ph * 0.11);
  g.save();
  g.translate(mx, my);
  g.beginPath();
  rrect(g, -mw / 2, -mh / 2, mw, mh, mh / 2);
  fillInk(g, PAL.ink, lw * 0.6);
  g.fillStyle = PAL.cream;
  g.beginPath();
  g.ellipse(-mw * 0.2, 0, mw * 0.11, mh * 0.26, 0, 0, TAU);
  g.ellipse(mw * 0.2, 0, mw * 0.11, mh * 0.26, 0, 0, TAU);
  g.fill();
  g.restore();
  g.restore();
  g.beginPath();
  rrect(g, 0, 0, pw, ph, r);
  g.strokeStyle = PAL.ink;
  g.lineWidth = lw;
  g.stroke();
  const len = clamp(ph * 1.45, 26, 120);
  METER.w = w;
  METER.h = h;
  METER.s = s;
  METER.c = L.c;
  METER.pw = pw;
  METER.ph = ph;
  METER.r = r;
  METER.roadY = ph - Math.max(2, (ph - roadTop) * 0.12);
  METER.bx = bx;
  METER.bw = bw;
  METER.len = len;
  METER.x0 = lw + 4;
  METER.x1 = bx - len - lw * 2;
  METER.lw = lw;
  METER.win = new Float32Array([bx + bw * 0.1, winY, winW, winH, bx + bw * 0.64, winY, winW, winH]);
  return METER;
}

/*
 * drawPoliceMeter(ctx, rect, frac, now, jolt) — frac 0 the car is at the
 * far left, 1 it has arrived at your door. jolt 0..1 shakes it and flashes
 * red (heat).
 */
export function drawPoliceMeter(ctx, rect, frac, now, jolt) {
  const w = Math.max(20, Math.round(rect.w));
  const h = Math.max(12, Math.round(rect.h));
  const M = meterLayer(w, h);
  const f = clamp(frac || 0, 0, 1);
  const j = clamp(jolt || 0, 0, 1);
  const t = now || 0;
  const sx = j ? Math.sin(t * 83) * j * 4 : 0;
  const sy = j ? Math.cos(t * 71) * j * 2 : 0;
  ctx.save();
  ctx.translate(rect.x + sx, rect.y + sy);
  ctx.drawImage(M.c, 0, 0, w, h);
  ctx.save();
  ctx.beginPath();
  rrect(ctx, 0, 0, M.pw, M.ph, M.r);
  ctx.clip();
  // the windows catch the lights as the car closes
  if (f > 0.6) {
    const a = (f - 0.6) / 0.4;
    const flip = (t * 4) % 2 < 1;
    const win = M.win;
    for (let i = 0; i < 8; i += 4) {
      ctx.globalAlpha = a * 0.85;
      ctx.fillStyle = (i === 0) === flip ? PAL.red : PAL.blue;
      ctx.fillRect(win[i], win[i + 1], win[i + 2], win[i + 3]);
    }
    ctx.globalAlpha = a * 0.25;
    ctx.fillStyle = flip ? PAL.red : PAL.blue;
    ctx.fillRect(M.bx - M.bw * 0.4, 0, M.bw * 1.6, M.ph);
    ctx.globalAlpha = 1;
  }
  const cx = lerp(M.x0, M.x1, f);
  // speed lines behind the car
  ctx.strokeStyle = PAL.cream;
  ctx.lineWidth = Math.max(1, M.lw * 0.6);
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const ly = M.roadY - M.len * (0.1 + i * 0.1);
    const ph = (t * 3 + i * 0.3) % 1;
    ctx.moveTo(cx - M.len * (0.08 + ph * 0.2), ly);
    ctx.lineTo(cx - M.len * (0.3 + ph * 0.2), ly);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  drawCar(ctx, cx, M.roadY, M.len, t, M.lw);
  if (j > 0) {
    ctx.globalAlpha = j * 0.35;
    ctx.fillStyle = PAL.red;
    ctx.fillRect(0, 0, M.pw, M.ph);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  ctx.beginPath();
  rrect(ctx, 0, 0, M.pw, M.ph, M.r);
  ink(ctx, M.lw);
  if (f > 0.85) ctx.strokeStyle = (t * 4) % 2 < 1 ? PAL.red : PAL.blue;
  ctx.stroke();
  ctx.restore();
}

/* ===================== the thief ===================== */

/*
 * Our hero, in a 100-unit space with the feet at 0 and the top of the
 * beanie near -97: a navy beanie, the black domino mask with its two tails
 * flapping behind, a big round nose, stubble, a cream-and-navy striped
 * shirt, black gloves, and a burlap swag bag. Funny, never sloppy: every
 * limb is an inked tube, every part a flat colour with one shadow shape.
 */
const BEANIE = "#23264a";
const BEANIE_BAND = "#343a6a";
const PANTS = "#262d55";
const EX_SLY = 0;
const EX_FOCUS = 1;
const EX_JOY = 2;
const EX_WORRY = 3;

function thiefHead(g, hx, hy, ex, now, L, tilt) {
  g.save();
  g.translate(hx, hy);
  g.rotate(tilt);
  // the mask's tails, flapping behind
  const fl = Math.sin(now * 7) * 2;
  g.beginPath();
  g.moveTo(-13, -1);
  g.quadraticCurveTo(-21, -6 + fl, -28, -3 + fl);
  g.lineTo(-25, 2 + fl * 0.6);
  g.quadraticCurveTo(-19, 0, -13, 3);
  g.closePath();
  g.moveTo(-13, 2);
  g.quadraticCurveTo(-20, 5 - fl * 0.5, -25, 9 - fl * 0.5);
  g.lineTo(-21, 11 - fl * 0.3);
  g.quadraticCurveTo(-17, 7, -12, 5);
  g.closePath();
  fillInk(g, PAL.ink, L);
  // face, with one flat shadow shape down its left side
  g.beginPath();
  g.ellipse(0, 0, 15, 16, 0, 0, TAU);
  fillInk(g, PAL.skin, L);
  g.save();
  g.beginPath();
  g.ellipse(0, 0, 15, 16, 0, 0, TAU);
  g.clip();
  g.beginPath();
  g.ellipse(-15, 5, 8, 18, 0, 0, TAU);
  g.fillStyle = PAL.skinDk;
  g.fill();
  // stubble
  g.fillStyle = "rgba(20,22,37,0.4)";
  g.beginPath();
  for (let i = 0; i < 14; i++) {
    const row = (i / 7) | 0;
    circ(g, -9 + (i % 7) * 3 + row * 1.5, 10.5 + row * 3, 0.75);
  }
  g.fill();
  g.restore();
  g.beginPath();
  g.ellipse(0, 0, 15, 16, 0, 0, TAU);
  g.strokeStyle = PAL.ink;
  g.lineWidth = L;
  g.stroke();
  // beanie, its turned-up band and a stitch
  g.beginPath();
  g.moveTo(-15.5, -4);
  g.bezierCurveTo(-16.5, -24, 16.5, -24, 15.5, -4);
  g.closePath();
  fillInk(g, BEANIE, L);
  box(g, -16.5, -8, 33, 6.5, 3, BEANIE_BAND, L);
  g.strokeStyle = "rgba(20,22,37,0.6)";
  g.lineWidth = L * 0.4;
  g.beginPath();
  for (let i = -12; i <= 12; i += 4) {
    g.moveTo(i, -7);
    g.lineTo(i, -3);
  }
  g.stroke();
  blob(g, 0, -20, 3.2, BEANIE_BAND, L * 0.8);
  // the domino mask
  g.beginPath();
  g.moveTo(-16, -1);
  g.quadraticCurveTo(0, -4, 16, -1);
  g.lineTo(15.5, 6);
  g.quadraticCurveTo(8, 9, 1, 5);
  g.quadraticCurveTo(-7, 9, -15.5, 6);
  g.closePath();
  fillInk(g, PAL.ink, L * 0.6);
  // eyes
  const blink = (now % 3.7) < 0.12 && ex !== EX_JOY;
  const ex1 = -6;
  const ex2 = 6.5;
  const ey = 2;
  if (ex === EX_JOY) {
    g.strokeStyle = PAL.cream;
    g.lineWidth = L * 0.8;
    g.beginPath();
    g.arc(ex1, ey + 1.5, 3, Math.PI * 1.1, Math.PI * 1.9);
    g.moveTo(ex2 + 3 * Math.cos(Math.PI * 1.1), ey + 1.5 + 3 * Math.sin(Math.PI * 1.1));
    g.arc(ex2, ey + 1.5, 3, Math.PI * 1.1, Math.PI * 1.9);
    g.stroke();
  } else if (blink) {
    seg(g, ex1 - 3, ey, ex1 + 3, ey, PAL.cream, L * 0.6);
    seg(g, ex2 - 3, ey, ex2 + 3, ey, PAL.cream, L * 0.6);
  } else {
    const ry = ex === EX_FOCUS ? 1.9 : ex === EX_WORRY ? 3.6 : 3;
    let lx = 0;
    let ly = 0;
    if (ex === EX_SLY) lx = Math.sin(now * 0.8) * 1.4;
    else if (ex === EX_FOCUS) { lx = 1.4; ly = 0.6; }
    else if (ex === EX_WORRY) { ly = -1; lx = Math.sin(now * 9) * 0.5; }
    g.fillStyle = PAL.paper;
    g.beginPath();
    g.ellipse(ex1, ey, 3.6, ry, 0, 0, TAU);
    g.ellipse(ex2, ey, 3.6, ry, 0, 0, TAU);
    g.fill();
    g.fillStyle = PAL.ink;
    g.beginPath();
    const pr = ex === EX_WORRY ? 1.2 : 1.7;
    circ(g, ex1 + lx, ey + ly, Math.min(pr, ry * 0.8));
    circ(g, ex2 + lx, ey + ly, Math.min(pr, ry * 0.8));
    g.fill();
    if (ex === EX_WORRY) {
      // brows pushed up over the mask, worried
      seg(g, ex1 - 3, ey - 6.5, ex1 + 2.5, ey - 8, PAL.ink, L * 0.7);
      seg(g, ex2 - 2.5, ey - 8, ex2 + 3, ey - 6.5, PAL.ink, L * 0.7);
    } else if (ex === EX_FOCUS) {
      seg(g, ex1 - 3, ey - 5, ex1 + 3, ey - 3.5, PAL.ink, L * 0.7);
      seg(g, ex2 - 3, ey - 3.5, ex2 + 3, ey - 5, PAL.ink, L * 0.7);
    }
  }
  // nose
  blob(g, 2.5, 8, 4, PAL.skin, L * 0.8);
  g.beginPath();
  circ(g, 1.3, 6.6, 1.1);
  g.fillStyle = PAL.paper;
  g.fill();
  // mouth
  g.strokeStyle = PAL.ink;
  g.lineWidth = L * 0.75;
  g.lineCap = "round";
  if (ex === EX_SLY) {
    g.beginPath();
    g.moveTo(-5, 13.5);
    g.quadraticCurveTo(1, 15.5, 6, 12);
    g.stroke();
  } else if (ex === EX_FOCUS) {
    g.beginPath();
    g.moveTo(-3, 14);
    g.lineTo(3, 13.6);
    g.stroke();
    oval(g, 4.5, 15, 2.2, 2.6, 0.3, PAL.pink, L * 0.5);
  } else if (ex === EX_JOY) {
    g.beginPath();
    g.moveTo(-7, 12);
    g.quadraticCurveTo(0, 23, 8, 11.5);
    g.closePath();
    fillInk(g, PAL.redDk, L * 0.7);
    g.beginPath();
    g.moveTo(-6, 12.3);
    g.lineTo(7, 11.8);
    g.lineTo(6.2, 14);
    g.lineTo(-5.4, 14.4);
    g.closePath();
    g.fillStyle = PAL.paper;
    g.fill();
  } else {
    g.beginPath();
    g.moveTo(-5, 15);
    g.quadraticCurveTo(-2.5, 13, 0, 15);
    g.quadraticCurveTo(2.5, 17, 5, 14.5);
    g.stroke();
  }
  g.restore();
}

/* The striped shirt and belt, hips at (0,0) and shoulders at y = -31. */
function thiefTorso(g, L) {
  g.beginPath();
  g.moveTo(-17, -27);
  g.quadraticCurveTo(-17, -32, -12, -32);
  g.lineTo(12, -32);
  g.quadraticCurveTo(17, -32, 17, -27);
  g.lineTo(14, 0);
  g.lineTo(-14, 0);
  g.closePath();
  g.fillStyle = PAL.cream;
  g.fill();
  g.save();
  g.clip();
  g.fillStyle = PAL.navyLo;
  for (let y = -29; y < 0; y += 7) g.fillRect(-20, y, 40, 3.5);
  g.fillStyle = "rgba(20,22,37,0.28)";
  g.fillRect(-20, -34, 9, 36);
  g.restore();
  g.strokeStyle = PAL.ink;
  g.lineWidth = L;
  g.lineJoin = "round";
  g.stroke();
  box(g, -14.5, -4, 29, 5, 2, PAL.ink, L * 0.5);
  box(g, -3, -4.5, 6, 6, 1.5, PAL.mustard, L * 0.5);
}

function shoe(g, x, y, dir, L) {
  g.beginPath();
  g.moveTo(x - 5 * dir, y);
  g.quadraticCurveTo(x - 6 * dir, y - 7, x + 1 * dir, y - 7);
  g.quadraticCurveTo(x + 9 * dir, y - 6, x + 9 * dir, y);
  g.closePath();
  fillInk(g, PAL.ink, L * 0.7);
  seg(g, x - 4.5 * dir, y - 1, x + 8.5 * dir, y - 1, PAL.steel, L * 0.6);
}

/* The swag bag, its neck at (x, y): burlap, a darker fold, a tied cord,
   and a star patch rather than a currency sign (no words, no "$"). */
function sack(g, x, y, r, L) {
  g.beginPath();
  g.moveTo(x - r * 0.25, y);
  g.quadraticCurveTo(x - r * 1.15, y + r * 0.4, x - r, y + r * 1.25);
  g.quadraticCurveTo(x - r * 0.6, y + r * 2.1, x, y + r * 2.05);
  g.quadraticCurveTo(x + r * 0.9, y + r * 2.1, x + r, y + r * 1.2);
  g.quadraticCurveTo(x + r * 1.1, y + r * 0.4, x + r * 0.25, y);
  g.closePath();
  fillInk(g, PAL.burlap, L);
  g.save();
  g.clip();
  g.beginPath();
  g.ellipse(x + r * 0.95, y + r * 1.4, r * 0.55, r * 1.1, 0, 0, TAU);
  g.fillStyle = "#a87a3e";
  g.fill();
  g.restore();
  g.beginPath();
  starPath(g, x - r * 0.1, y + r * 1.2, r * 0.42, 0.45, 0.1);
  fillInk(g, PAL.mustard, L * 0.6);
  g.beginPath();
  g.moveTo(x - r * 0.35, y - r * 0.5);
  g.lineTo(x + r * 0.35, y - r * 0.5);
  g.lineTo(x + r * 0.22, y + r * 0.05);
  g.lineTo(x - r * 0.22, y + r * 0.05);
  g.closePath();
  fillInk(g, PAL.burlap, L * 0.8);
  seg(g, x - r * 0.3, y + r * 0.05, x + r * 0.3, y + r * 0.05, PAL.woodDk, L);
}

/*
 * drawThief(ctx, x, y, size, pose, now) — (x, y) is the CENTRE of the
 * figure and size about its full height. pose: 'idle' (bag on the shoulder,
 * eyes sliding about), 'work' (crouched, picking, tongue out), 'cheer'
 * (jumping, bag held high), 'busted' (cuffed, worried, trembling).
 */
export function drawThief(ctx, x, y, size, pose, now) {
  const u = size / 100;
  if (u <= 0) return;
  const lw = clamp(size * 0.028, 1.1, LINE);
  const L = lw / u;
  const t = now || 0;
  ctx.save();
  ctx.translate(x, y + size * 0.5);
  ctx.scale(u, u);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  // ground shadow
  ctx.fillStyle = PAL.shadow;
  ctx.beginPath();
  ctx.ellipse(0, 0, 24, 4, 0, 0, TAU);
  ctx.fill();

  if (pose === "work") {
    const jig = Math.sin(t * 22) * 1.2;
    tube(ctx, -6, -27, -14, -14, -17, -4, 11, PANTS, L);
    tube(ctx, 2, -27, 11, -17, 11, -4, 11, PANTS, L);
    shoe(ctx, -17, 0, -1, L);
    shoe(ctx, 12, 0, 1, L);
    // back arm, behind the body
    tube(ctx, 9, -56, 20, -45, 29 + jig, -48, 8.5, PAL.cream, L);
    blob(ctx, 30 + jig, -48, 4.6, PAL.ink, L * 0.6);
    ctx.save();
    ctx.translate(-3, -27);
    ctx.rotate(0.32);
    thiefTorso(ctx, L);
    ctx.restore();
    thiefHead(ctx, 12, -73, EX_FOCUS, t, L, 0.18);
    // the pick and the tension wrench
    seg(ctx, 31 + jig, -46, 42, -43, PAL.steelDark, 2.6);
    seg(ctx, 31 + jig, -46, 42, -43, PAL.steel, 1.4);
    seg(ctx, 33, -40 - jig, 42, -40 - jig * 0.5, PAL.steelDark, 2.6);
    tube(ctx, 4, -54, 17, -40, 31, -40 - jig, 8.5, PAL.cream, L);
    blob(ctx, 32, -40 - jig, 4.6, PAL.ink, L * 0.6);
    // a bead of sweat
    const sp = (t * 0.8) % 1;
    ctx.globalAlpha = sp < 0.85 ? 1 : (1 - sp) / 0.15;
    oval(ctx, -2, -82 + sp * 10, 2, 2.8, 0, "#9fd3ff", L * 0.5);
    ctx.globalAlpha = 1;
  } else if (pose === "cheer") {
    const jump = Math.abs(Math.sin(t * 5)) * 9;
    ctx.translate(0, -jump);
    if (jump > 5) {
      ctx.strokeStyle = PAL.cream;
      ctx.lineWidth = L * 0.7;
      ctx.beginPath();
      ctx.moveTo(-12, jump + 2);
      ctx.lineTo(-18, jump + 7);
      ctx.moveTo(0, jump + 3);
      ctx.lineTo(0, jump + 9);
      ctx.moveTo(12, jump + 2);
      ctx.lineTo(18, jump + 7);
      ctx.stroke();
    }
    tube(ctx, -6, -31, -10, -16, -9, -3, 11, PANTS, L);
    tube(ctx, 6, -31, 15, -20, 12, -9, 11, PANTS, L);
    shoe(ctx, -10, 0, -1, L);
    shoe(ctx, 13, -6, 1, L);
    ctx.save();
    ctx.translate(0, -31);
    thiefTorso(ctx, L);
    ctx.restore();
    // bag held high in the right hand
    const wave = Math.sin(t * 10) * 2;
    sack(ctx, 27 + wave, -103, 12, L);
    tube(ctx, -12, -58, -22, -72, -24 + wave, -88, 8.5, PAL.cream, L);
    blob(ctx, -24 + wave, -89, 4.8, PAL.ink, L * 0.6);
    tube(ctx, 12, -58, 22, -76, 26 + wave, -98, 8.5, PAL.cream, L);
    blob(ctx, 26 + wave, -99, 4.8, PAL.ink, L * 0.6);
    thiefHead(ctx, 1, -78, EX_JOY, t, L, -0.06);
  } else if (pose === "busted") {
    const tr = Math.sin(t * 31) * 0.5;
    ctx.translate(tr, 0);
    tube(ctx, -6, -31, -7, -16, -8, -3, 11, PANTS, L);
    tube(ctx, 6, -31, 7, -16, 8, -3, 11, PANTS, L);
    shoe(ctx, -9, 0, -1, L);
    shoe(ctx, 9, 0, 1, L);
    ctx.save();
    ctx.translate(0, -31);
    thiefTorso(ctx, L);
    ctx.restore();
    // arms forward and down, cuffed at the wrists
    tube(ctx, -12, -57, -14, -45, -3, -38, 8.5, PAL.cream, L);
    tube(ctx, 12, -57, 14, -45, 5, -38, 8.5, PAL.cream, L);
    blob(ctx, -3, -37, 4.6, PAL.ink, L * 0.6);
    blob(ctx, 5, -37, 4.6, PAL.ink, L * 0.6);
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = PAL.ink;
    ctx.beginPath();
    circ(ctx, -4, -40, 4);
    circ(ctx, 6, -40, 4);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = PAL.steelHi;
    ctx.stroke();
    seg(ctx, 0, -40, 2, -40, PAL.steel, 2);
    thiefHead(ctx, 0, -76, EX_WORRY, t, L, 0.1);
    // sweat flying off
    oval(ctx, -17, -86, 1.8, 2.6, -0.4, "#9fd3ff", L * 0.5);
    oval(ctx, 17, -84, 1.8, 2.6, 0.4, "#9fd3ff", L * 0.5);
  } else {
    // idle
    const bob = Math.sin(t * 2.2) * 1;
    tube(ctx, -6, -31, -8, -16, -9, -3, 11, PANTS, L);
    tube(ctx, 6, -31, 8, -16, 9, -3, 11, PANTS, L);
    shoe(ctx, -9, 0, -1, L);
    shoe(ctx, 10, 0, 1, L);
    ctx.translate(0, bob);
    sack(ctx, -14, -72, 13, L);
    ctx.save();
    ctx.translate(0, -31);
    thiefTorso(ctx, L);
    ctx.restore();
    tube(ctx, -12, -58, -19, -66, -14, -72, 8.5, PAL.cream, L);
    blob(ctx, -14, -73, 4.8, PAL.ink, L * 0.6);
    tube(ctx, 12, -58, 16, -45, 14, -34, 8.5, PAL.cream, L);
    blob(ctx, 14, -33, 4.8, PAL.ink, L * 0.6);
    thiefHead(ctx, 1, -79, EX_SLY, t, L, 0);
  }
  ctx.restore();
}

/*
 * drawThiefTop(ctx, x, y, size, angle, now, moving) — the same thief seen
 * from directly above, for the trap rooms. (x, y) is the centre; size is
 * about his width across the shoulders and elbows; angle is the way he
 * faces in canvas radians (0 = right, -π/2 = up, atan2 order). What makes
 * him readable from above: the striped shoulders, the beanie's pompom, the
 * nose poking out ahead of him, the mask's tails streaming behind, and the
 * bag on his back. Moving, his feet and hands swing in opposition and he
 * bobs a little; standing, he breathes.
 */
export function drawThiefTop(ctx, x, y, size, angle, now, moving) {
  const u = size / 44;
  if (u <= 0) return;
  const lw = clamp(size * 0.045, 1, LINE);
  const L = lw / u;
  const t = now || 0;
  const p = moving ? Math.sin(t * 13) : 0;
  const breathe = moving ? 1 + Math.abs(p) * 0.03 : 1 + Math.sin(t * 2.4) * 0.015;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = PAL.shadow;
  ctx.beginPath();
  ctx.ellipse(size * 0.08, size * 0.1, size * 0.48, size * 0.42, 0, 0, TAU);
  ctx.fill();
  ctx.rotate(angle || 0);
  ctx.scale(u * breathe, u * breathe);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  // feet
  oval(ctx, 7 * p + 3, -7, 6.5, 3.6, 0, PAL.ink, L * 0.6);
  oval(ctx, -7 * p + 3, 7, 6.5, 3.6, 0, PAL.ink, L * 0.6);
  // the bag on his back
  blob(ctx, -12, 0, 9, PAL.burlap, L);
  ctx.beginPath();
  starPath(ctx, -13, 0, 3.6, 0.45, 0);
  fillInk(ctx, PAL.mustard, L * 0.5);
  // arms and gloves, swinging against the feet
  tube(ctx, 0, -14, -2 - 5 * p, -19, 4 - 7 * p, -18, 6.5, PAL.cream, L);
  tube(ctx, 0, 14, -2 + 5 * p, 19, 4 + 7 * p, 18, 6.5, PAL.cream, L);
  blob(ctx, 5 - 7 * p, -18, 3.8, PAL.ink, L * 0.6);
  blob(ctx, 5 + 7 * p, 18, 3.8, PAL.ink, L * 0.6);
  // shoulders: the striped shirt from above
  ctx.beginPath();
  ctx.ellipse(0, 0, 8.5, 16, 0, 0, TAU);
  ctx.fillStyle = PAL.cream;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = PAL.navyLo;
  for (let yy = -15; yy < 16; yy += 6) ctx.fillRect(-10, yy, 20, 3);
  ctx.fillStyle = "rgba(20,22,37,0.25)";
  ctx.fillRect(-10, -17, 6, 34);
  ctx.restore();
  ctx.beginPath();
  ctx.ellipse(0, 0, 8.5, 16, 0, 0, TAU);
  ctx.strokeStyle = PAL.ink;
  ctx.lineWidth = L;
  ctx.stroke();
  // the mask's tails, streaming behind the head
  const fl = Math.sin(t * (moving ? 16 : 5)) * (moving ? 2.5 : 1);
  ctx.beginPath();
  ctx.moveTo(-6, -2);
  ctx.quadraticCurveTo(-12, -4 + fl, -17, -5 + fl);
  ctx.lineTo(-16, -1 + fl);
  ctx.quadraticCurveTo(-11, -1, -6, 0);
  ctx.moveTo(-6, 1);
  ctx.quadraticCurveTo(-12, 3 - fl, -16, 6 - fl);
  ctx.lineTo(-14, 8 - fl);
  ctx.quadraticCurveTo(-10, 4, -6, 3);
  fillInk(ctx, PAL.ink, L * 0.5);
  // the nose, ahead: which way he faces
  blob(ctx, 8.6, 0, 2.6, PAL.skin, L * 0.7);
  // the beanie from above: crown, band, pompom
  blob(ctx, 1, 0, 8.2, BEANIE, L);
  ctx.beginPath();
  circ(ctx, 1, 0, 6.3);
  ctx.strokeStyle = BEANIE_BAND;
  ctx.lineWidth = 2.2;
  ctx.stroke();
  blob(ctx, 0.6, 0, 2.8, BEANIE_BAND, L * 0.7);
  ctx.restore();
}

/* ===================== the shopkeeper ===================== */

/*
 * A shady back-room tool dealer behind a counter: a fedora with a mustard
 * band, a trench coat with the collar up, a loose red tie, heavy-lidded eyes,
 * a long nose, a toothpick, and a five-o'clock shadow done in dots. Behind
 * him a pegboard of tools and a bare bulb swinging on its flex. Moods:
 *   idle       half-lidded, toothpick wandering, fingers drumming
 *   happy      eyes shut in a grin with a gold tooth, hat tipped, hands rubbing
 *   skeptical  one eyebrow up, mouth pulled sideways, arms folded
 *
 * The back room and the counter are two cached layers (behind him, in front
 * of him); he and the bulb's light are drawn live.
 */
const COAT = "#b8955a";
const COAT_DK = "#8c6c3a";
const HAT = "#4a3b33";
const KEEP = { w: 0, h: 0, s: 0, back: null, front: null, u: 0, cx: 0, cy: 0, lw: 0, bx: 0, by: 0 };
function keeperLayers(w, h) {
  const s = pxRatio();
  if (KEEP.back && KEEP.w === w && KEEP.h === h && KEEP.s === s) return KEEP;
  const u = Math.min(w / 110, h / 100);
  const lw = clamp(u * 2.6, 1.2, LINE);
  const cy = h * 0.74;
  const cx = w * 0.5;
  const k = u / 3.4;
  const rnd = seeded(5);
  // behind him
  const B = layer(w, h);
  const g = B.g;
  bricks(g, 0, 0, w, h, "#2c2547", k, lw);
  dots(g, 0, 0, w, h, "rgba(8,10,28,0.55)", Math.max(4, 7 * k), 0.785, 0.15, 0.6, "y");
  // the pegboard, and the tools hung on it
  const px = w * 0.08;
  const py = h * 0.1;
  const pw = w * 0.84;
  const ph = cy - py - 4 * u;
  box(g, px + 4, py + 4, pw, ph, 3, PAL.ink, lw);
  box(g, px, py, pw, ph, 3, "#7a5634", lw);
  g.fillStyle = "rgba(20,22,37,0.5)";
  g.beginPath();
  const hs = Math.max(6, 4 * u);
  for (let yy = py + hs; yy < py + ph - 2; yy += hs) {
    for (let xx = px + hs; xx < px + pw - 2; xx += hs) circ(g, xx, yy, Math.max(0.8, 0.45 * u));
  }
  g.fill();
  const tools = 9;
  for (let i = 0; i < tools; i++) {
    const tx = px + pw * ((i + 0.5) / tools);
    if (Math.abs(tx - cx) < 26 * u) continue; // he stands there
    const ty = py + ph * (0.18 + rnd() * 0.15);
    const kind = i % 4;
    g.save();
    g.translate(tx, ty);
    g.rotate((rnd() - 0.5) * 0.3);
    if (kind === 0) {
      // a wrench
      tube(g, 0, 0, 0, ph * 0.25, 0, ph * 0.5, 2.6 * u, PAL.steel, lw * 0.7);
      g.beginPath();
      g.arc(0, 0, 3.5 * u, 0.6, Math.PI * 2 - 0.6 + Math.PI, false);
      g.strokeStyle = PAL.ink;
      g.lineWidth = 2.4 * u;
      g.stroke();
    } else if (kind === 1) {
      // a hammer
      tube(g, 0, 0, 0, ph * 0.2, 0, ph * 0.42, 2.4 * u, PAL.wood, lw * 0.7);
      box(g, -6 * u, -2 * u, 12 * u, 5 * u, 1, PAL.steelDark, lw * 0.7);
    } else if (kind === 2) {
      // a hacksaw
      g.beginPath();
      g.moveTo(-5 * u, 0);
      g.lineTo(5 * u, 0);
      g.lineTo(5 * u, ph * 0.35);
      g.moveTo(-5 * u, 0);
      g.lineTo(-5 * u, ph * 0.35);
      g.strokeStyle = PAL.ink;
      g.lineWidth = 2.2 * u;
      g.stroke();
      seg(g, -5 * u, ph * 0.35, 5 * u, ph * 0.35, PAL.steel, 1.4 * u);
      box(g, -2 * u, -7 * u, 4 * u, 7 * u, 1, PAL.red, lw * 0.6);
    } else {
      // a coil of rope
      g.beginPath();
      g.ellipse(0, ph * 0.12, 6 * u, 8 * u, 0, 0, TAU);
      g.ellipse(0, ph * 0.12, 3.5 * u, 5 * u, 0, 0, TAU);
      g.strokeStyle = PAL.ink;
      g.lineWidth = 3 * u;
      g.stroke();
      g.strokeStyle = PAL.burlap;
      g.lineWidth = 1.8 * u;
      g.stroke();
    }
    g.restore();
  }
  // the bulb's flex comes from the ceiling, top left of him
  KEEP.bx = cx - 30 * u;
  KEEP.by = 0;
  // in front of him: the counter
  const F = layer(w, h);
  const f = F.g;
  const ch = h - cy;
  box(f, -lw, cy, w + lw * 2, Math.max(6, 6 * u), 2, PAL.wood, lw);
  box(f, -lw, cy + Math.max(6, 6 * u), w + lw * 2, ch, 0, PAL.woodDk, lw);
  f.save();
  f.beginPath();
  f.rect(0, cy + 6 * u, w, ch);
  f.clip();
  f.strokeStyle = "rgba(20,22,37,0.5)";
  f.lineWidth = Math.max(1, lw * 0.5);
  f.beginPath();
  for (let xx = w * 0.07; xx < w; xx += Math.max(18, 16 * u)) {
    f.moveTo(xx, cy + 6 * u);
    f.lineTo(xx, h);
  }
  f.stroke();
  dots(f, 0, cy, w, ch, "rgba(8,10,28,0.6)", Math.max(3, 5 * k), 0.785, 0.15, 0.8, "y");
  f.restore();
  // a brass bell and a ledger on the counter
  const bx = w * 0.82;
  f.beginPath();
  f.arc(bx, cy, 6 * u, Math.PI, 0);
  f.closePath();
  fillInk(f, PAL.brass, lw * 0.8);
  blob(f, bx, cy - 6.5 * u, 1.4 * u, PAL.brass, lw * 0.6);
  box(f, bx - 8 * u, cy - 1.2 * u, 16 * u, 2.4 * u, 1, PAL.brassDk, lw * 0.6);
  f.save();
  f.translate(w * 0.17, cy);
  f.rotate(-0.08);
  box(f, -11 * u, -3 * u, 22 * u, 3 * u, 1, PAL.cream, lw * 0.6);
  box(f, -12 * u, -5 * u, 24 * u, 2.5 * u, 1, PAL.redDk, lw * 0.6);
  f.restore();
  KEEP.w = w;
  KEEP.h = h;
  KEEP.s = s;
  KEEP.back = B.c;
  KEEP.front = F.c;
  KEEP.u = u;
  KEEP.cx = cx;
  KEEP.cy = cy;
  KEEP.lw = lw;
  return KEEP;
}

/* drawShopkeeper(ctx, rect, now, mood) — mood 'idle' | 'happy' | 'skeptical'. */
export function drawShopkeeper(ctx, rect, now, mood) {
  const w = Math.max(20, Math.round(rect.w));
  const h = Math.max(20, Math.round(rect.h));
  const K = keeperLayers(w, h);
  const t = now || 0;
  const happy = mood === "happy";
  const skep = mood === "skeptical";
  ctx.save();
  ctx.translate(rect.x, rect.y);
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  ctx.drawImage(K.back, 0, 0, w, h);
  // the bulb swings; its pool of light swings with it
  const u = K.u;
  const sw = Math.sin(t * 1.1) * 0.12;
  const flex = h * 0.2;
  const lx = K.bx + Math.sin(sw) * flex;
  const ly = Math.cos(sw) * flex;
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = PAL.glow;
  ctx.beginPath();
  ctx.moveTo(lx - 4 * u, ly);
  ctx.lineTo(lx + 4 * u, ly);
  ctx.lineTo(lx + 60 * u + sw * 80 * u, h);
  ctx.lineTo(lx - 50 * u + sw * 80 * u, h);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 0.3;
  ctx.beginPath();
  circ(ctx, lx, ly + 4 * u, 12 * u);
  ctx.fill();
  ctx.globalAlpha = 1;
  seg(ctx, K.bx, 0, lx, ly, PAL.ink, Math.max(1, K.lw * 0.6));
  box(ctx, lx - 2 * u, ly - 1 * u, 4 * u, 3 * u, 1, PAL.steelDark, K.lw * 0.6);
  blob(ctx, lx, ly + 4.5 * u, 3.6 * u, PAL.paper, K.lw * 0.7);
  // him, in a 100-unit space: the counter top at y = 0, his middle at x = 0
  ctx.save();
  ctx.translate(K.cx, K.cy);
  ctx.scale(u, u);
  const L = K.lw / u;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const sway = Math.sin(t * 0.9) * 0.6;
  ctx.translate(sway, 0);
  // the coat
  ctx.beginPath();
  ctx.moveTo(-33, 2);
  ctx.quadraticCurveTo(-34, -26, -24, -31);
  ctx.lineTo(24, -31);
  ctx.quadraticCurveTo(34, -26, 33, 2);
  ctx.closePath();
  fillInk(ctx, COAT, L);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = COAT_DK;
  ctx.fillRect(-36, -33, 11, 40);
  ctx.restore();
  // shirt, tie, lapels
  ctx.beginPath();
  ctx.moveTo(-9, -31);
  ctx.lineTo(9, -31);
  ctx.lineTo(0, -6);
  ctx.closePath();
  fillInk(ctx, "#3a3f5e", L * 0.7);
  ctx.beginPath();
  ctx.moveTo(-2.5, -29);
  ctx.lineTo(2.5, -29);
  ctx.lineTo(4, -14);
  ctx.lineTo(0, -8);
  ctx.lineTo(-4, -14);
  ctx.closePath();
  fillInk(ctx, PAL.redDk, L * 0.6);
  ctx.beginPath();
  ctx.moveTo(-10, -32);
  ctx.lineTo(-3, -7);
  ctx.lineTo(-14, -20);
  ctx.closePath();
  ctx.moveTo(10, -32);
  ctx.lineTo(3, -7);
  ctx.lineTo(14, -20);
  ctx.closePath();
  fillInk(ctx, COAT_DK, L * 0.8);
  // the collar, turned up
  ctx.beginPath();
  ctx.moveTo(-17, -29);
  ctx.lineTo(-19, -47);
  ctx.lineTo(-9, -36);
  ctx.closePath();
  ctx.moveTo(17, -29);
  ctx.lineTo(19, -47);
  ctx.lineTo(9, -36);
  ctx.closePath();
  fillInk(ctx, COAT, L * 0.8);
  // head
  const hx = 0;
  const hy = -48;
  ctx.beginPath();
  ctx.ellipse(hx, hy, 12.5, 16, 0, 0, TAU);
  fillInk(ctx, PAL.skin, L);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(hx, hy, 12.5, 16, 0, 0, TAU);
  ctx.clip();
  ctx.beginPath();
  ctx.ellipse(hx - 13, hy + 4, 7, 18, 0, 0, TAU);
  ctx.fillStyle = PAL.skinDk;
  ctx.fill();
  // five-o'clock shadow
  ctx.fillStyle = "rgba(60,50,80,0.45)";
  ctx.beginPath();
  for (let i = 0; i < 24; i++) {
    const row = (i / 8) | 0;
    circ(ctx, hx - 9 + (i % 8) * 2.6 + (row % 2) * 1.3, hy + 6 + row * 2.6, 0.75);
  }
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  ctx.ellipse(hx, hy, 12.5, 16, 0, 0, TAU);
  ctx.strokeStyle = PAL.ink;
  ctx.lineWidth = L;
  ctx.stroke();
  // eyes
  const blink = !happy && (t % 4.3) < 0.13;
  if (happy) {
    ctx.strokeStyle = PAL.ink;
    ctx.lineWidth = L * 0.8;
    ctx.beginPath();
    ctx.arc(hx - 5, hy - 2, 2.6, Math.PI * 1.15, Math.PI * 1.85);
    ctx.moveTo(hx + 5 + 2.6 * Math.cos(Math.PI * 1.15), hy - 2 + 2.6 * Math.sin(Math.PI * 1.15));
    ctx.arc(hx + 5, hy - 2, 2.6, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
  } else {
    const lid = blink ? 2.4 : skep ? 1.3 : 1.0;
    for (let i = 0; i < 2; i++) {
      const ex = hx + (i ? 5 : -5);
      const ey = hy - 3;
      oval(ctx, ex, ey, 2.8, 2.4, 0, PAL.paper, L * 0.5);
      if (!blink) {
        ctx.beginPath();
        circ(ctx, ex + (skep ? -0.8 : 0.8), ey + 0.5, 1.2);
        ctx.fillStyle = PAL.ink;
        ctx.fill();
      }
      // the heavy lid
      ctx.beginPath();
      ctx.ellipse(ex, ey, 3.2, 2.8, 0, Math.PI, 0);
      ctx.lineTo(ex + 3.2, ey - 2.8 + lid * 2.6);
      ctx.lineTo(ex - 3.2, ey - 2.8 + lid * 2.6);
      ctx.closePath();
      ctx.fillStyle = PAL.skinDk;
      ctx.fill();
      seg(ctx, ex - 3.2, ey - 2.8 + lid * 2.6, ex + 3.2, ey - 2.8 + lid * 2.6, PAL.ink, L * 0.6);
    }
  }
  // brows
  const raise = skep ? Math.sin(t * 2) * 0.6 + 3 : 0;
  seg(ctx, hx - 8.5, hy - 7.5 - raise, hx - 2, hy - 7 - raise * 1.3, PAL.ink, L * 1.1);
  seg(ctx, hx + 2, hy - 6.5, hx + 8.5, hy - (skep ? 5.5 : 7.5), PAL.ink, L * 1.1);
  // the long nose
  ctx.beginPath();
  ctx.moveTo(hx + 0.5, hy - 3);
  ctx.quadraticCurveTo(hx + 6, hy + 4, hx + 4, hy + 6);
  ctx.quadraticCurveTo(hx + 1, hy + 7.5, hx - 1, hy + 5);
  fillInk(ctx, PAL.skin, L * 0.7);
  // mouth
  const my = hy + 10;
  if (happy) {
    ctx.beginPath();
    ctx.moveTo(hx - 7, my - 1.5);
    ctx.quadraticCurveTo(hx, my + 7, hx + 7, my - 1.5);
    ctx.closePath();
    fillInk(ctx, PAL.redDk, L * 0.7);
    ctx.beginPath();
    ctx.moveTo(hx - 6, my - 1.2);
    ctx.lineTo(hx + 6, my - 1.2);
    ctx.lineTo(hx + 5.2, my + 1);
    ctx.lineTo(hx - 5.2, my + 1);
    ctx.closePath();
    ctx.fillStyle = PAL.paper;
    ctx.fill();
    ctx.fillStyle = PAL.mustard;
    ctx.fillRect(hx + 1, my - 1.2, 2.2, 2.2);
    ctx.strokeStyle = PAL.ink;
    ctx.lineWidth = L * 0.3;
    ctx.strokeRect(hx + 1, my - 1.2, 2.2, 2.2);
  } else if (skep) {
    ctx.beginPath();
    ctx.moveTo(hx - 5, my + 1);
    ctx.quadraticCurveTo(hx, my - 0.5, hx + 3, my + 0.5);
    ctx.quadraticCurveTo(hx + 5, my + 1.5, hx + 7, my - 1);
    ctx.strokeStyle = PAL.ink;
    ctx.lineWidth = L * 0.8;
    ctx.stroke();
  } else {
    seg(ctx, hx - 5, my + 0.5, hx + 4, my, PAL.ink, L * 0.8);
  }
  if (!happy) {
    // the toothpick, wandering from one corner
    const wob = Math.sin(t * 1.7) * 0.25 + (skep ? -0.2 : 0);
    const tx = hx + 4;
    const ty = my;
    seg(ctx, tx, ty, tx + Math.cos(0.25 + wob) * 11, ty + Math.sin(0.25 + wob) * 11, PAL.ink, 2.4);
    seg(ctx, tx, ty, tx + Math.cos(0.25 + wob) * 11, ty + Math.sin(0.25 + wob) * 11, PAL.cream, 1.2);
  }
  // the fedora
  ctx.save();
  ctx.translate(hx, hy - 12 - (happy ? 3 : 0));
  ctx.rotate(happy ? -0.18 : -0.07);
  ctx.beginPath();
  ctx.ellipse(0, 0, 23, 4.8, 0, 0, TAU);
  fillInk(ctx, HAT, L);
  ctx.beginPath();
  ctx.moveTo(-13, 0);
  ctx.lineTo(-11.5, -15);
  ctx.quadraticCurveTo(-6, -18, 0, -15);
  ctx.quadraticCurveTo(6, -18, 11.5, -15);
  ctx.lineTo(13, 0);
  ctx.closePath();
  fillInk(ctx, HAT, L);
  box(ctx, -13, -6, 26, 5, 1, PAL.mustard, L * 0.7);
  seg(ctx, -5, -15.5, 0, -12.5, PAL.ink, L * 0.6);
  seg(ctx, 5, -15.5, 0, -12.5, PAL.ink, L * 0.6);
  ctx.restore();
  // hands
  if (skep) {
    // arms folded across the chest
    box(ctx, -26, -20, 52, 10, 5, COAT, L);
    box(ctx, -22, -21, 8, 9, 3, PAL.skin, L * 0.7);
    box(ctx, 14, -14, 8, 9, 3, PAL.skin, L * 0.7);
    seg(ctx, 0, -20, -4, -10, PAL.ink, L * 0.7);
  } else if (happy) {
    const rub = Math.sin(t * 12) * 2.5;
    tube(ctx, -27, -24, -22, -10, -6 + rub, -8, 9, COAT, L);
    tube(ctx, 27, -24, 22, -10, 6 + rub, -8, 9, COAT, L);
    oval(ctx, -4 + rub, -8, 5, 4.4, 0.3, PAL.skin, L * 0.7);
    oval(ctx, 4 + rub, -8.5, 5, 4.4, -0.3, PAL.skin, L * 0.7);
  } else {
    tube(ctx, -28, -24, -30, -8, -22, -1, 9, COAT, L);
    tube(ctx, 28, -24, 30, -8, 22, -1, 9, COAT, L);
    oval(ctx, -20, -1.5, 6, 3.6, 0, PAL.skin, L * 0.7);
    // the drumming fingers
    for (let i = 0; i < 4; i++) {
      const tap = Math.max(0, Math.sin(t * 9 - i * 0.9)) * 1.8;
      oval(ctx, 23 + i * 2.6, -1.5 - tap, 1.4, 2.4, 0, PAL.skin, L * 0.5);
    }
    oval(ctx, 21, -2, 4.5, 3.4, 0, PAL.skin, L * 0.7);
  }
  ctx.restore();
  ctx.drawImage(K.front, 0, 0, w, h);
  ctx.restore();
}

/* ===================== tools and gadgets ===================== */

/*
 * Every icon is drawn in a 100-unit box centred on 0,0 and cached per id,
 * tier and size, so the shop, the HUD's gadget buttons and the trap rooms
 * can call drawItem every frame for the price of one drawImage.
 *
 * A tool's tiers are different objects, not recolours, because each tier
 * IS a different tool (DESIGN.md §4): tier 0 is what you have without
 * buying anything — your bare ear, a hairpin, your own eyes — and tiers 1–3
 * get better gear, the top tier usually in gold. Tiers 1–3 also carry that
 * many small gold stars in the corner when the icon is big enough to read
 * them (36px and up). Gadgets ignore tier.
 */
const TIERED = {
  stethoscope: 1, picks: 1, powder: 1, tester: 1, sneakers: 1, scanner: 1,
  goggles: 1, jammer: 1, chalk: 1,
};

function pips(g, tier, L) {
  for (let i = 0; i < tier; i++) {
    g.beginPath();
    starPath(g, 41 - i * 14, 40, 7.5, 0.45, 0);
    fillInk(g, PAL.mustard, L * 0.7);
  }
}

function iconStethoscope(g, tier, L) {
  if (tier === 0) {
    // the bare ear: tier 0 is listening with nothing but your head
    g.beginPath();
    g.moveTo(-4, -34);
    g.bezierCurveTo(22, -38, 30, -8, 14, 8);
    g.bezierCurveTo(6, 16, 10, 28, -2, 32);
    g.bezierCurveTo(-14, 36, -20, 24, -14, 16);
    g.bezierCurveTo(-24, 0, -26, -30, -4, -34);
    g.closePath();
    fillInk(g, PAL.skin, L);
    g.beginPath();
    g.moveTo(-8, -20);
    g.bezierCurveTo(8, -26, 16, -8, 4, 2);
    g.bezierCurveTo(-2, 8, 2, 14, -4, 16);
    g.strokeStyle = PAL.skinDk;
    g.lineWidth = L * 2;
    g.stroke();
    g.strokeStyle = PAL.ink;
    g.lineWidth = L * 0.8;
    g.stroke();
    g.strokeStyle = PAL.cream;
    g.lineWidth = L * 1.2;
    g.beginPath();
    for (let i = 0; i < 3; i++) {
      const r = 10 + i * 9;
      g.moveTo(-34 + Math.cos(Math.PI * 0.8) * r, -2 + Math.sin(Math.PI * 0.8) * r);
      g.arc(-34, -2, r, Math.PI * 0.8, Math.PI * 1.2, true);
    }
    g.stroke();
    return;
  }
  const tubeC = tier === 1 ? "#2b2f45" : tier === 2 ? PAL.blue : PAL.red;
  // ear pieces
  for (let s = -1; s <= 1; s += 2) {
    seg(g, s * 18, -40, s * 12, -18, PAL.ink, 6 + L * 2);
    seg(g, s * 18, -40, s * 12, -18, tier === 3 ? PAL.brass : PAL.steel, 6);
    blob(g, s * 19, -42, 4.5, PAL.ink, L * 0.6);
  }
  hose(g, -12, -18, -13, 2, 0, 6, 7, tubeC, L);
  hose(g, 12, -18, 13, 2, 0, 6, 7, tubeC, L);
  hose(g, 0, 6, -6, 38, 20, 24, 7, tubeC, L);
  if (tier === 1) {
    blob(g, 24, 22, 14, PAL.steel, L);
    blob(g, 24, 22, 8, PAL.steelHi, L * 0.7);
  } else if (tier === 2) {
    box(g, 10, 10, 30, 24, 6, PAL.steelDark, L);
    box(g, 14, 14, 16, 9, 2, "#163a2a", L * 0.6);
    g.beginPath();
    g.moveTo(15, 19);
    g.lineTo(18, 19);
    g.lineTo(20, 15);
    g.lineTo(23, 22);
    g.lineTo(25, 18);
    g.lineTo(29, 18);
    g.strokeStyle = "#7bff9a";
    g.lineWidth = L * 0.6;
    g.stroke();
    blob(g, 35, 18, 3, PAL.green, L * 0.5);
  } else {
    g.strokeStyle = PAL.mustard;
    g.lineWidth = L * 1.2;
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + i * 0.55 - 0.6;
      g.moveTo(24 + Math.cos(a) * 18, 22 + Math.sin(a) * 18);
      g.lineTo(24 + Math.cos(a) * 25, 22 + Math.sin(a) * 25);
    }
    g.stroke();
    blob(g, 24, 22, 14, PAL.brass, L);
    g.beginPath();
    starPath(g, 24, 22, 8, 0.45, 0);
    fillInk(g, PAL.mustard, L * 0.6);
  }
}

function pick(g, x, y, a, len, tip, handle, L) {
  g.save();
  g.translate(x, y);
  g.rotate(a);
  seg(g, 0, -10, 0, -len, PAL.ink, 4 + L * 2);
  seg(g, 0, -10, 0, -len, PAL.steel, 4);
  g.beginPath();
  if (tip === 0) {
    g.moveTo(0, -len);
    g.quadraticCurveTo(0, -len - 8, 6, -len - 6);
  } else if (tip === 1) {
    g.moveTo(0, -len + 14);
    g.lineTo(4, -len + 10);
    g.lineTo(0, -len + 6);
    g.lineTo(4, -len + 2);
    g.lineTo(0, -len - 3);
  } else {
    g.moveTo(0, -len + 4);
    g.lineTo(5, -len - 2);
    g.lineTo(0, -len - 6);
  }
  g.strokeStyle = PAL.ink;
  g.lineWidth = 4 + L * 2;
  g.stroke();
  g.strokeStyle = PAL.steel;
  g.lineWidth = 3.5;
  g.stroke();
  box(g, -5, -12, 10, 26, 4, handle, L);
  g.restore();
}

function iconPicks(g, tier, L) {
  if (tier === 0) {
    // a hairpin, bent into service
    g.save();
    g.rotate(0.5);
    g.beginPath();
    g.moveTo(-6, 38);
    g.lineTo(-6, -26);
    g.arc(0, -26, 6, Math.PI, 0);
    g.lineTo(6, -8);
    g.lineTo(10, -2);
    g.lineTo(6, 4);
    g.lineTo(10, 10);
    g.lineTo(6, 16);
    g.lineTo(10, 22);
    g.lineTo(6, 38);
    g.strokeStyle = PAL.ink;
    g.lineWidth = 5 + L * 2;
    g.stroke();
    g.strokeStyle = PAL.steelDark;
    g.lineWidth = 5;
    g.stroke();
    blob(g, -6, 40, 4, PAL.paper, L * 0.6);
    blob(g, 6, 40, 4, PAL.paper, L * 0.6);
    g.restore();
    return;
  }
  if (tier === 3) {
    // the pick gun
    g.save();
    g.rotate(-0.15);
    box(g, -26, -4, 16, 40, 6, PAL.ink, L);
    box(g, -24, -2, 12, 34, 5, "#2b2f45", L * 0.6);
    g.beginPath();
    g.arc(-6, 6, 8, -0.2, Math.PI * 0.9);
    g.strokeStyle = PAL.ink;
    g.lineWidth = L * 1.6;
    g.stroke();
    box(g, -32, -22, 52, 20, 7, PAL.mustard, L);
    g.save();
    g.beginPath();
    rrect(g, -32, -22, 52, 20, 7);
    g.clip();
    dots(g, -32, -22, 52, 20, "rgba(201,74,28,0.5)", 5, 0.785, 0, 0.8, "y");
    g.restore();
    box(g, 18, -16, 10, 9, 2, PAL.steel, L * 0.8);
    seg(g, 28, -12, 46, -12, PAL.ink, 3 + L * 2);
    seg(g, 28, -12, 46, -12, PAL.steelHi, 3);
    g.beginPath();
    g.moveTo(34, -30);
    g.lineTo(40, -22);
    g.lineTo(36, -22);
    g.lineTo(42, -14);
    g.strokeStyle = PAL.mustard;
    g.lineWidth = L * 1.3;
    g.stroke();
    g.restore();
    return;
  }
  if (tier === 2) {
    // the leather roll behind the pro set
    g.save();
    g.rotate(-0.08);
    box(g, -38, -18, 76, 52, 10, PAL.woodDk, L);
    g.setLineDash([4, 4]);
    g.beginPath();
    rrect(g, -33, -13, 66, 42, 7);
    g.strokeStyle = PAL.burlap;
    g.lineWidth = L * 0.6;
    g.stroke();
    g.setLineDash([]);
    g.restore();
  }
  const hc = tier === 2 ? PAL.brass : PAL.navyHi;
  pick(g, -14, 34, -0.38, 60, 0, hc, L);
  pick(g, 0, 34, 0, 64, 1, hc, L);
  pick(g, 14, 34, 0.38, 60, 2, hc, L);
  if (tier === 2) twinkle(g, 2, -38, 12, PAL.white);
}

function iconPowder(g, tier, L) {
  if (tier === 0) {
    // a bare fingerprint: you can see there was a finger, nothing more
    g.save();
    g.beginPath();
    g.ellipse(0, 0, 26, 34, 0, 0, TAU);
    g.fillStyle = "rgba(169,182,200,0.25)";
    g.fill();
    g.strokeStyle = PAL.steelDark;
    g.lineWidth = L * 1.1;
    for (let i = 1; i <= 6; i++) {
      g.beginPath();
      g.ellipse(0, 4, i * 4.2, i * 5.4, 0, Math.PI * (0.95 + i * 0.03), Math.PI * (2.05 + i * 0.03));
      g.stroke();
    }
    g.restore();
    return;
  }
  if (tier === 1) {
    // a jar of dusting powder and its brush
    box(g, -34, -6, 34, 40, 6, "rgba(200,230,255,0.85)", L);
    g.save();
    g.beginPath();
    rrect(g, -34, -6, 34, 40, 6);
    g.clip();
    g.fillStyle = PAL.steel;
    g.fillRect(-36, 12, 38, 24);
    dots(g, -34, 12, 34, 22, PAL.steelDark, 4, 0.5, 0.2, 0.6, "y");
    g.restore();
    box(g, -36, -14, 38, 10, 3, PAL.ink, L * 0.7);
    g.save();
    g.translate(14, 2);
    g.rotate(0.55);
    box(g, -4, -40, 8, 34, 3, PAL.wood, L);
    box(g, -5, -8, 10, 8, 1, PAL.steel, L * 0.7);
    g.beginPath();
    g.moveTo(-6, 0);
    g.lineTo(-12, 26);
    g.quadraticCurveTo(0, 32, 12, 26);
    g.lineTo(6, 0);
    g.closePath();
    fillInk(g, "#3a2a1a", L);
    g.restore();
    g.fillStyle = PAL.steelHi;
    g.beginPath();
    circ(g, 28, 34, 2.5);
    circ(g, 34, 28, 2);
    circ(g, 22, 40, 1.8);
    g.fill();
    return;
  }
  if (tier === 2) {
    // a UV torch, and a print glowing in its beam
    g.save();
    g.globalAlpha = 0.45;
    g.fillStyle = "#b07cff";
    g.beginPath();
    g.moveTo(-6, -4);
    g.lineTo(44, -34);
    g.lineTo(44, 30);
    g.closePath();
    g.fill();
    g.restore();
    g.strokeStyle = "#e6d4ff";
    g.lineWidth = L * 0.9;
    for (let i = 1; i <= 4; i++) {
      g.beginPath();
      g.ellipse(28, 0, i * 3, i * 4, 0, Math.PI * 1.0, Math.PI * 2.1);
      g.stroke();
    }
    g.save();
    g.rotate(0);
    box(g, -44, -9, 32, 18, 5, PAL.purple, L);
    g.beginPath();
    g.moveTo(-14, -12);
    g.lineTo(-2, -16);
    g.lineTo(-2, 16);
    g.lineTo(-14, 12);
    g.closePath();
    fillInk(g, PAL.steelDark, L);
    seg(g, -2, -12, -2, 12, "#d8b8ff", L * 1.4);
    box(g, -34, -4, 8, 8, 2, PAL.mustard, L * 0.6);
    g.restore();
    return;
  }
  // the code reader: a handheld box that has already read one digit
  box(g, -26, -38, 52, 76, 9, PAL.steelDark, L);
  box(g, -20, -30, 40, 24, 4, "#163a2a", L * 0.8);
  g.font = font(20);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#7bff9a";
  g.fillText("7", -10, -17);
  g.fillStyle = "rgba(123,255,154,0.4)";
  g.fillRect(0, -11, 6, 3);
  g.fillRect(9, -11, 6, 3);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      box(g, -18 + c * 13, 2 + r * 11, 10, 8, 2, PAL.steel, L * 0.5);
    }
  }
  seg(g, 16, -38, 22, -48, PAL.ink, L * 1.6);
  blob(g, 22, -48, 3, PAL.red, L * 0.6);
}

function iconTester(g, tier, L) {
  if (tier === 0) {
    // your own eye
    g.beginPath();
    g.moveTo(-38, 0);
    g.quadraticCurveTo(0, -34, 38, 0);
    g.quadraticCurveTo(0, 34, -38, 0);
    g.closePath();
    fillInk(g, PAL.paper, L);
    blob(g, 0, 0, 15, PAL.blue, L * 0.8);
    blob(g, 0, 0, 7, PAL.ink, L * 0.5);
    g.beginPath();
    circ(g, -5, -5, 3.5);
    g.fillStyle = PAL.white;
    g.fill();
    g.strokeStyle = PAL.ink;
    g.lineWidth = L;
    g.beginPath();
    for (let i = -2; i <= 2; i++) {
      const x = i * 13;
      const y = -Math.sqrt(Math.max(0, 1 - (x / 38) * (x / 38))) * 17;
      g.moveTo(x, y);
      g.lineTo(x * 1.2, y - 9);
    }
    g.stroke();
    return;
  }
  if (tier === 1) {
    // the screwdriver tester with its neon bulb lit
    g.save();
    g.rotate(-0.7);
    seg(g, 0, 8, 0, 46, PAL.ink, 7 + L * 2);
    seg(g, 0, 8, 0, 46, PAL.steel, 7);
    box(g, -10, -42, 20, 52, 8, "rgba(255,240,170,0.75)", L);
    oval(g, 0, -16, 4, 9, 0, PAL.red, L * 0.6);
    g.globalAlpha = 0.4;
    g.beginPath();
    circ(g, 0, -16, 16);
    g.fillStyle = PAL.red;
    g.fill();
    g.globalAlpha = 1;
    box(g, -4, -50, 8, 10, 3, PAL.steelDark, L * 0.7);
    g.restore();
    return;
  }
  if (tier === 2) {
    // four colour-coded wires and their crocodile clips
    const cols = [PAL.red, PAL.blue, PAL.green, PAL.mustard];
    for (let i = 0; i < 4; i++) {
      const y0 = -27 + i * 18;
      const y1 = 27 - i * 18;
      hose(g, -30, y0, 0, (y0 + y1) / 2 + (i % 2 ? 14 : -14), 30, y1, 6, cols[i], L);
      box(g, -42, y0 - 4, 12, 8, 2, PAL.steel, L * 0.6);
      box(g, 30, y1 - 4, 12, 8, 2, PAL.steel, L * 0.6);
    }
    return;
  }
  // the trace scope: a screen with a live trace and a probe
  box(g, -40, -32, 62, 50, 6, PAL.steelDark, L);
  box(g, -34, -26, 40, 32, 3, "#0f2a1e", L * 0.7);
  g.beginPath();
  for (let x = -32; x <= 4; x += 2) {
    const y = -10 + Math.sin(x * 0.35) * 9;
    if (x === -32) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.strokeStyle = "#7bff9a";
  g.lineWidth = L * 0.9;
  g.stroke();
  blob(g, 14, -18, 4, PAL.steel, L * 0.6);
  blob(g, 14, -2, 4, PAL.red, L * 0.6);
  hose(g, 22, 8, 40, 20, 30, 36, 4, PAL.ink, L * 0.5);
  seg(g, 30, 36, 36, 46, PAL.ink, 5 + L);
  seg(g, 30, 36, 36, 46, PAL.red, 5);
}

function iconSneakers(g, tier, L) {
  const upper = tier === 0 ? "#7a5634" : tier === 1 ? PAL.red : tier === 2 ? PAL.blue : PAL.mustard;
  if (tier >= 2) {
    g.strokeStyle = PAL.cream;
    g.lineWidth = L * 1.4;
    g.beginPath();
    for (let i = 0; i < tier; i++) {
      g.moveTo(-48, -8 + i * 11);
      g.lineTo(-38 + (i % 2) * 6, -8 + i * 11);
    }
    g.stroke();
  }
  g.beginPath();
  g.moveTo(-34, 20);
  g.lineTo(-32, -6);
  g.quadraticCurveTo(-28, -16, -16, -14);
  g.lineTo(-4, -20);
  g.quadraticCurveTo(12, -6, 26, -2);
  g.quadraticCurveTo(40, 2, 38, 16);
  g.lineTo(38, 20);
  g.closePath();
  fillInk(g, upper, L);
  g.save();
  g.clip();
  if (tier === 0) {
    oval(g, -14, 4, 7, 5, 0.3, "#9a7650", L * 0.5);
    g.fillStyle = PAL.ink;
    g.beginPath();
    g.ellipse(20, 8, 3, 2, 0, 0, TAU);
    g.fill();
  } else {
    g.fillStyle = tier === 3 ? PAL.paper : PAL.cream;
    g.beginPath();
    g.moveTo(-22, 14);
    g.quadraticCurveTo(0, -2, 22, 10);
    g.lineTo(22, 16);
    g.quadraticCurveTo(0, 4, -22, 20);
    g.closePath();
    g.fill();
    dots(g, -36, -20, 76, 40, "rgba(20,22,37,0.3)", 5, 0.785, 0, 0.7, "y");
  }
  g.restore();
  // sole and laces
  box(g, -36, 16, 76, 8, 4, tier === 0 ? PAL.ink : PAL.paper, L);
  if (tier > 0) {
    g.strokeStyle = PAL.paper;
    g.lineWidth = L * 1.1;
    g.beginPath();
    for (let i = 0; i < 3; i++) {
      g.moveTo(-10 + i * 6, -16 + i * 4);
      g.lineTo(-4 + i * 6, -10 + i * 4);
      g.moveTo(-4 + i * 6, -16 + i * 4);
      g.lineTo(-10 + i * 6, -10 + i * 4);
    }
    g.stroke();
  }
  if (tier === 3) {
    // a little wing at the heel
    g.beginPath();
    g.moveTo(-30, -6);
    g.quadraticCurveTo(-48, -26, -40, -36);
    g.quadraticCurveTo(-36, -24, -30, -26);
    g.quadraticCurveTo(-30, -34, -22, -38);
    g.quadraticCurveTo(-22, -22, -22, -12);
    g.closePath();
    fillInk(g, PAL.paper, L);
  }
}

function iconScanner(g, tier, L) {
  const body = tier === 0 ? PAL.steelDark : "#2b2f45";
  // waves
  g.lineWidth = L * 1.4;
  for (let i = 0; i < tier; i++) {
    g.strokeStyle = i % 2 ? PAL.blue : PAL.red;
    g.beginPath();
    g.arc(-14, -40, 10 + i * 9, -Math.PI * 0.85, -Math.PI * 0.15);
    g.stroke();
  }
  seg(g, -14, -18, -14, -40, PAL.ink, 4 + L * 2);
  seg(g, -14, -18, -14, -40, PAL.steel, 4);
  blob(g, -14, -42, 4, PAL.ink, L * 0.5);
  box(g, -22, -20, 44, 62, 9, body, L);
  if (tier === 3) {
    g.beginPath();
    rrect(g, -18, -16, 36, 54, 6);
    g.strokeStyle = PAL.brass;
    g.lineWidth = L * 1.2;
    g.stroke();
  }
  box(g, -15, -12, 30, 16, 3, tier === 0 ? "#3a4359" : tier === 3 ? "#9fd3ff" : "#7bff9a", L * 0.7);
  g.strokeStyle = "rgba(20,22,37,0.7)";
  g.lineWidth = L * 0.8;
  g.beginPath();
  for (let i = 0; i < 4; i++) {
    g.moveTo(-12, 12 + i * 6);
    g.lineTo(12, 12 + i * 6);
  }
  g.stroke();
  if (tier > 0) blob(g, 14, -26 + 10, 3.4, tier === 2 ? PAL.blue : PAL.red, L * 0.5);
  blob(g, 10, -24, 4, PAL.steel, L * 0.5);
}

function iconGoggles(g, tier, L) {
  if (tier === 0) {
    // a faint beam, and a pair of eyes trying to see it
    g.save();
    g.globalAlpha = 0.5;
    g.setLineDash([6, 6]);
    seg(g, -46, 30, 46, -10, PAL.red, L * 1.6);
    g.setLineDash([]);
    g.restore();
    for (let s = -1; s <= 1; s += 2) {
      oval(g, s * 13, -10, 11, 9, 0, PAL.paper, L);
      blob(g, s * 13 + 3, -6, 4, PAL.ink, L * 0.4);
      seg(g, s * 13 - 10, -22, s * 13 + 9, -20 - s * 2, PAL.ink, L);
    }
    return;
  }
  if (tier === 3) {
    // the laser mirror: a beam in, a beam out, nobody hurt
    seg(g, -48, 22, -6, 0, PAL.red, L * 2.2);
    seg(g, -6, 0, 40, -34, PAL.red, L * 2.2);
    g.save();
    g.translate(4, 10);
    g.rotate(-0.4);
    box(g, -4, 14, 8, 30, 3, PAL.brassDk, L);
    blob(g, 0, 0, 18, PAL.brass, L);
    blob(g, 0, 0, 13, "#cfeeff", L * 0.7);
    g.fillStyle = "rgba(255,255,255,0.7)";
    g.fillRect(-8, -8, 4, 12);
    g.restore();
    twinkle(g, -6, 0, 12, PAL.white);
    return;
  }
  // goggles: a strap, two lenses, a bridge
  hose(g, -44, -2, -40, -24, 0, -26, 6, PAL.ink, L * 0.5);
  hose(g, 44, -2, 40, -24, 0, -26, 6, PAL.ink, L * 0.5);
  box(g, -46, -8, 92, 14, 7, "#2b2f45", L);
  for (let s = -1; s <= 1; s += 2) {
    const x = s * 18;
    blob(g, x, 0, 17, tier === 2 ? PAL.steelDark : "#3a4359", L);
    if (tier === 1) {
      blob(g, x, 0, 12, "#5fe08a", L * 0.7);
    } else {
      blob(g, x, 0, 12, PAL.red, L * 0.7);
      g.beginPath();
      circ(g, x + 1, 1, 8);
      g.fillStyle = PAL.amber;
      g.fill();
      g.beginPath();
      circ(g, x + 2, 2, 4);
      g.fillStyle = PAL.mustard;
      g.fill();
    }
    g.beginPath();
    circ(g, x - 4, -4, 3);
    g.fillStyle = "rgba(255,255,255,0.75)";
    g.fill();
  }
  box(g, -4, -4, 8, 6, 2, PAL.steel, L * 0.6);
}

function iconJammer(g, tier, L) {
  if (tier === 0) {
    // a security camera and its soft, vague cone
    g.save();
    g.globalAlpha = 0.3;
    g.fillStyle = PAL.cream;
    g.beginPath();
    g.moveTo(-14, -2);
    g.lineTo(-48, 44);
    g.lineTo(6, 46);
    g.closePath();
    g.fill();
    g.restore();
    seg(g, 30, -40, 22, -20, PAL.ink, 5);
    g.save();
    g.translate(8, -14);
    g.rotate(0.5);
    box(g, -28, -11, 44, 22, 5, PAL.steel, L);
    box(g, -34, -8, 8, 16, 2, PAL.ink, L * 0.7);
    g.restore();
    blob(g, 18, -22, 3, PAL.red, L * 0.5);
    return;
  }
  if (tier === 1) {
    // a camera map: folded paper, the cones drawn hard
    box(g, -40, -32, 80, 64, 3, PAL.paper, L);
    seg(g, -13, -32, -13, 32, "rgba(20,22,37,0.3)", L);
    seg(g, 13, -32, 13, 32, "rgba(20,22,37,0.3)", L);
    for (let i = 0; i < 2; i++) {
      const cx = i ? 22 : -22;
      const cy = i ? 18 : -16;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + (i ? -26 : 24), cy + (i ? -16 : 6));
      g.lineTo(cx + (i ? -20 : 18), cy + (i ? 4 : 22));
      g.closePath();
      g.fillStyle = "rgba(229,55,61,0.55)";
      g.fill();
      g.strokeStyle = PAL.red;
      g.lineWidth = L * 0.8;
      g.stroke();
      blob(g, cx, cy, 4, PAL.ink, L * 0.4);
    }
    g.setLineDash([4, 4]);
    seg(g, -34, 26, 34, -24, PAL.ink, L * 0.7);
    g.setLineDash([]);
    return;
  }
  if (tier === 2) {
    // the signal jammer: a box, two aerials, crackle
    g.strokeStyle = PAL.mustard;
    g.lineWidth = L * 1.2;
    g.beginPath();
    for (let s = -1; s <= 1; s += 2) {
      g.moveTo(s * 28, -26);
      g.lineTo(s * 36, -32);
      g.lineTo(s * 32, -36);
      g.lineTo(s * 42, -44);
    }
    g.stroke();
    seg(g, -14, -10, -20, -40, PAL.ink, 3 + L);
    seg(g, 14, -10, 20, -40, PAL.ink, 3 + L);
    blob(g, -20, -40, 3.5, PAL.steel, L * 0.5);
    blob(g, 20, -40, 3.5, PAL.steel, L * 0.5);
    box(g, -30, -12, 60, 44, 8, PAL.navy, L);
    box(g, -22, -4, 30, 12, 3, "#0f2a1e", L * 0.6);
    blob(g, 18, 2, 4, PAL.red, L * 0.5);
    g.strokeStyle = "rgba(251,233,192,0.6)";
    g.lineWidth = L * 0.8;
    g.beginPath();
    for (let i = 0; i < 4; i++) {
      g.moveTo(-22 + i * 12, 18);
      g.lineTo(-16 + i * 12, 24);
    }
    g.stroke();
    return;
  }
  // loop tape: a cassette with an arrow round it
  g.beginPath();
  g.arc(0, -6, 40, Math.PI * 1.1, Math.PI * 1.9);
  g.strokeStyle = PAL.ink;
  g.lineWidth = 7 + L * 2;
  g.stroke();
  g.strokeStyle = PAL.cream;
  g.lineWidth = 7;
  g.stroke();
  const ax = Math.cos(Math.PI * 1.9) * 40;
  const ay = -6 + Math.sin(Math.PI * 1.9) * 40;
  g.beginPath();
  g.moveTo(ax + 9, ay - 3);
  g.lineTo(ax - 3, ay + 10);
  g.lineTo(ax - 7, ay - 9);
  g.closePath();
  fillInk(g, PAL.cream, L * 0.8);
  box(g, -40, -12, 80, 46, 5, PAL.ink, L);
  box(g, -32, -6, 64, 12, 2, PAL.mustard, L * 0.5);
  for (let s = -1; s <= 1; s += 2) {
    blob(g, s * 16, 20, 8, PAL.cream, L * 0.6);
    blob(g, s * 16, 20, 3, PAL.ink, L * 0.4);
  }
}

function iconChalk(g, tier, L) {
  const tiles = tier === 0 || tier === 3;
  if (tiles) {
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 2; c++) {
        box(g, -40 + c * 40, -40 + r * 40, 38, 38, 3, (r + c) % 2 ? "#3a4a7c" : "#2c3a68", L);
      }
    }
    if (tier === 0) {
      // one tile caught mid-flash: you saw it once, briefly
      g.globalAlpha = 0.55;
      box(g, 0, -40, 38, 38, 3, PAL.mustard, L * 0.5);
      g.globalAlpha = 1;
      return;
    }
    // chalk crosses on the safe tiles
    g.strokeStyle = PAL.paper;
    g.lineWidth = L * 1.6;
    g.beginPath();
    const marks = [-21, 19, 19, 19, 19, -21];
    for (let i = 0; i < 6; i += 2) {
      const x = marks[i];
      const y = marks[i + 1];
      g.moveTo(x - 9, y - 9);
      g.lineTo(x + 9, y + 9);
      g.moveTo(x + 9, y - 9);
      g.lineTo(x - 9, y + 9);
    }
    g.stroke();
  }
  // the stick of chalk
  if (!tiles) {
    g.strokeStyle = PAL.paper;
    g.lineWidth = L * 1.4;
    g.beginPath();
    g.moveTo(-40, 34);
    g.bezierCurveTo(-24, 20, -10, 40, 4, 26);
    g.stroke();
  }
  g.save();
  g.translate(tiles ? 10 : 6, tiles ? 4 : 0);
  g.rotate(-0.7);
  box(g, -10, -30, 20, 56, 6, PAL.paper, L);
  g.beginPath();
  g.ellipse(0, 26, 10, 4, 0, 0, Math.PI);
  g.fillStyle = PAL.steel;
  g.fill();
  g.restore();
  if (tier === 2) {
    // replay: one more showing on demand
    g.beginPath();
    g.arc(-22, -22, 16, Math.PI * 0.2, Math.PI * 1.75);
    g.strokeStyle = PAL.ink;
    g.lineWidth = 6 + L * 2;
    g.stroke();
    g.strokeStyle = PAL.mustard;
    g.lineWidth = 6;
    g.stroke();
    const ax = -22 + Math.cos(Math.PI * 1.75) * 16;
    const ay = -22 + Math.sin(Math.PI * 1.75) * 16;
    g.beginPath();
    g.moveTo(ax + 8, ay - 2);
    g.lineTo(ax - 2, ay + 9);
    g.lineTo(ax - 4, ay - 8);
    g.closePath();
    fillInk(g, PAL.mustard, L * 0.7);
  }
}

function iconSmoke(g, tier, L) {
  // the puff it is about to become
  g.beginPath();
  circ(g, 18, -18, 16);
  circ(g, 30, -2, 13);
  circ(g, 4, -30, 12);
  circ(g, 26, -32, 10);
  fillInk(g, PAL.steel, L);
  g.save();
  g.clip();
  dots(g, -10, -46, 60, 60, "rgba(95,108,130,0.6)", 5, 0.785, 0, 0.8, "y");
  g.restore();
  blob(g, -8, 12, 28, PAL.ink, L);
  g.beginPath();
  g.arc(-8, 12, 21, Math.PI * 1.15, Math.PI * 1.45);
  g.strokeStyle = PAL.navyHi;
  g.lineWidth = 5;
  g.stroke();
  box(g, 6, -22, 14, 12, 3, PAL.steelDark, L * 0.8);
  hose(g, 13, -22, 18, -36, 30, -36, 3, PAL.burlap, L * 0.5);
  g.beginPath();
  starPath(g, 33, -37, 10, 0.4, 0.3);
  fillInk(g, PAL.mustard, L * 0.6);
  g.beginPath();
  starPath(g, 33, -37, 5, 0.4, 0.3);
  g.fillStyle = PAL.red;
  g.fill();
  void tier;
}

function iconDonut(g, tier, L) {
  // dough, frosting, sprinkles, and the hole cut clean through
  g.beginPath();
  g.ellipse(0, 4, 40, 34, 0, 0, TAU);
  g.ellipse(0, 2, 12, 9, 0, 0, TAU);
  g.fillStyle = "#d99a52";
  g.fill("evenodd");
  g.strokeStyle = PAL.ink;
  g.lineWidth = L;
  g.stroke();
  g.beginPath();
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * TAU;
    const r = 33 + (i % 2 ? 3 : -1);
    const x = Math.cos(a) * r;
    const y = -2 + Math.sin(a) * r * 0.82;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.ellipse(0, 2, 14, 10.5, 0, 0, TAU);
  g.fillStyle = PAL.pink;
  g.fill("evenodd");
  g.stroke();
  const sp = [PAL.cream, PAL.blue, PAL.mustard, PAL.green, PAL.paper];
  for (let i = 0; i < 16; i++) {
    const a = hash(i, 4) * TAU;
    const r = 18 + hash(i, 5) * 12;
    const x = Math.cos(a) * r;
    const y = -2 + Math.sin(a) * r * 0.8;
    const d = hash(i, 6) * Math.PI;
    seg(g, x - Math.cos(d) * 3, y - Math.sin(d) * 3, x + Math.cos(d) * 3, y + Math.sin(d) * 3, sp[i % 5], 2.6);
  }
  void tier;
}

function iconDrill(g, tier, L) {
  // the bit, with its flutes
  seg(g, 26, -14, 48, -14, PAL.ink, 6 + L * 2);
  seg(g, 26, -14, 48, -14, PAL.steel, 6);
  g.strokeStyle = PAL.steelDark;
  g.lineWidth = 1.6;
  g.beginPath();
  for (let x = 30; x < 46; x += 5) {
    g.moveTo(x, -17);
    g.lineTo(x + 3, -11);
  }
  g.stroke();
  box(g, 16, -22, 12, 16, 3, PAL.steel, L);
  // the grip, the battery and the body
  g.save();
  g.translate(-14, 4);
  g.rotate(0.22);
  box(g, -8, -6, 18, 36, 5, PAL.ink, L);
  g.restore();
  box(g, -30, 30, 36, 14, 4, PAL.navy, L);
  box(g, -38, -30, 56, 26, 11, PAL.mustard, L);
  g.save();
  g.beginPath();
  rrect(g, -38, -30, 56, 26, 11);
  g.clip();
  dots(g, -38, -30, 56, 26, "rgba(201,74,28,0.5)", 5, 0.785, 0, 0.8, "y");
  g.restore();
  g.strokeStyle = PAL.ink;
  g.lineWidth = L * 0.8;
  g.beginPath();
  for (let i = 0; i < 3; i++) {
    g.moveTo(-30 + i * 6, -24);
    g.lineTo(-30 + i * 6, -12);
  }
  g.stroke();
  box(g, -4, -2, 6, 9, 2, PAL.red, L * 0.7);
  void tier;
}

function iconUnknown(g, tier, L) {
  box(g, -34, -34, 68, 68, 6, PAL.wood, L);
  seg(g, -30, -30, 30, 30, PAL.woodDk, L * 2);
  caption(g, 0, 0, "?", UNKNOWN_CAP);
  void tier;
}
const UNKNOWN_CAP = { size: 50, fill: PAL.mustard };

const ICONS = {
  stethoscope: iconStethoscope,
  picks: iconPicks,
  powder: iconPowder,
  tester: iconTester,
  sneakers: iconSneakers,
  scanner: iconScanner,
  goggles: iconGoggles,
  jammer: iconJammer,
  chalk: iconChalk,
  smoke: iconSmoke,
  donut: iconDonut,
  drill: iconDrill,
};

const ITEM_CACHE = new Map();
/*
 * drawItem(ctx, id, x, y, size, tier) — the icon for any tool or gadget id,
 * centred on (x, y) and fitting a size×size box (outlines may breathe a few
 * percent past it). An unknown id draws a crate with a question mark rather
 * than nothing, so a missing icon is visible instead of silent.
 */
export function drawItem(ctx, id, x, y, size, tier) {
  const sz = Math.max(4, Math.round(size));
  const tr = clamp(tier | 0, 0, 3);
  const s = pxRatio();
  let m = ITEM_CACHE.get(id);
  if (m === undefined) {
    m = new Map();
    ITEM_CACHE.set(id, m);
  }
  const key = (sz * 4 + tr) * 8 + Math.round(s * 2);
  let c = m.get(key);
  if (c === undefined) {
    if (m.size > 32) m.clear();
    const pad = Math.ceil(sz * 0.1);
    const full = sz + pad * 2;
    const Lr = layer(full, full);
    const g = Lr.g;
    g.translate(full / 2, full / 2);
    const u = sz / 100;
    g.scale(u, u);
    const lw = clamp(sz * 0.035, 1, LINE);
    const L = lw / u;
    g.lineJoin = "round";
    g.lineCap = "round";
    (ICONS[id] || iconUnknown)(g, tr, L);
    if (tr > 0 && TIERED[id] && sz >= 36) pips(g, tr, L);
    c = Lr.c;
    c.full = full;
    m.set(key, c);
  }
  const f = c.full;
  ctx.drawImage(c, x - f / 2, y - f / 2, f, f);
}

/* ===================== the city at night ===================== */

/*
 * The start screen's comic panel: a big moon, three rows of rooftops (the
 * far ones flat navy, the near ones inked with lit windows), a water tower,
 * an aerial blinking red, two searchlights sweeping the sky between the
 * rows, windows going on and off, the thief himself waiting on a rooftop,
 * and every so often a patrol car crossing the street at the bottom.
 *
 * Two cached layers per size (the sky and far rows behind the searchlights,
 * the near rows in front of them) and a handful of numbers for what moves.
 */
const CITY = { w: 0, h: 0, s: 0, back: null, front: null, stars: null, wins: null, ax: 0, ay: 0, tx: 0, ty: 0, ts: 0, gy: 0, k: 0, lw: 0 };
function cityLayers(w, h) {
  const s = pxRatio();
  if (CITY.back && CITY.w === w && CITY.h === h && CITY.s === s) return CITY;
  const k = clamp(Math.min(w, h) / 500, 0.35, 1.8);
  const lw = Math.max(1.2, LINE * Math.min(1, k * 1.2));
  const rnd = seeded(2026);
  const gy = h * 0.92;
  // behind: the sky, the moon, two far rows
  const B = layer(w, h);
  const g = B.g;
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, PAL.night);
  sky.addColorStop(0.6, PAL.navy);
  sky.addColorStop(1, PAL.navyHi);
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  dots(g, 0, 0, w, h * 0.7, "rgba(45,65,137,0.85)", Math.max(5, 9 * k), Math.PI / 4, 0.75, 0, "y");
  const stars = [];
  for (let i = 0; i < 70; i++) {
    const sx = rnd() * w;
    const sy = rnd() * h * 0.6;
    const r = (0.6 + rnd() * 1.4) * Math.max(0.8, k);
    if (i < 14) {
      stars.push(sx, sy, r * 3.2, rnd() * TAU);
      continue;
    }
    g.globalAlpha = 0.3 + rnd() * 0.6;
    g.beginPath();
    circ(g, sx, sy, r);
    g.fillStyle = PAL.cream;
    g.fill();
  }
  g.globalAlpha = 1;
  moon(g, w * 0.78, h * 0.2, Math.max(18, Math.min(w, h) * 0.1), lw);
  // far row
  let x = -20 * k;
  while (x < w) {
    const bw = (50 + rnd() * 90) * k;
    const bh = h * (0.18 + rnd() * 0.22);
    g.fillStyle = "#1e2c66";
    g.fillRect(x, gy - h * 0.12 - bh, bw, bh + h * 0.12);
    if (rnd() < 0.3) {
      g.fillRect(x + bw * 0.4, gy - h * 0.12 - bh - 18 * k, 3 * k, 18 * k);
    }
    x += bw;
  }
  // mid row, with a few lit windows
  x = -30 * k;
  while (x < w) {
    const bw = (60 + rnd() * 80) * k;
    const bh = h * (0.12 + rnd() * 0.2);
    const top = gy - h * 0.06 - bh;
    g.fillStyle = "#16204f";
    g.fillRect(x, top, bw, bh + h * 0.06);
    g.fillStyle = "rgba(255,215,106,0.75)";
    for (let yy = top + 10 * k; yy < gy - 10 * k; yy += 16 * k) {
      for (let xx = x + 8 * k; xx < x + bw - 10 * k; xx += 14 * k) {
        if (rnd() < 0.1) g.fillRect(xx, yy, 5 * k, 8 * k);
      }
    }
    x += bw + 4 * k;
  }
  // in front: the near rooftops, inked
  const F = layer(w, h);
  const f = F.g;
  const wins = [];
  x = -10 * k;
  let tallest = 0;
  let ax = 0;
  let ay = 0;
  let tx = 0;
  let ty = 0;
  let towerDone = false;
  while (x < w) {
    const bw = (70 + rnd() * 110) * k;
    const bh = h * (0.1 + rnd() * 0.2);
    const top = gy - bh;
    f.beginPath();
    f.rect(x, top, bw, bh + h);
    fillInk(f, "#111839", lw);
    // a parapet
    box(f, x - 3 * k, top - 6 * k, bw + 6 * k, 6 * k, 1, "#1b2452", lw * 0.8);
    for (let yy = top + 12 * k; yy < gy - 12 * k; yy += 20 * k) {
      for (let xx = x + 10 * k; xx < x + bw - 16 * k; xx += 18 * k) {
        const r = rnd();
        if (r < 0.22) {
          f.fillStyle = PAL.glow;
          f.fillRect(xx, yy, 8 * k, 11 * k);
          f.strokeStyle = PAL.ink;
          f.lineWidth = Math.max(1, lw * 0.5);
          f.strokeRect(xx, yy, 8 * k, 11 * k);
        } else if (r < 0.3) {
          wins.push(xx, yy, 8 * k, 11 * k);
        }
      }
    }
    if (x <= w * 0.16 && x + bw >= w * 0.16) {
      tx = w * 0.16;
      ty = top - 6 * k;
    }
    if (bh > tallest && x > w * 0.3 && x < w * 0.9) {
      tallest = bh;
      ax = x + bw * 0.7;
      ay = top - 6 * k;
    }
    if (!towerDone && x > w * 0.5 && bw > 90 * k) {
      // a water tower on legs
      towerDone = true;
      const cx = x + bw * 0.3;
      const tw = 34 * k;
      const leg = 22 * k;
      f.strokeStyle = PAL.ink;
      f.lineWidth = lw;
      f.beginPath();
      f.moveTo(cx - tw * 0.4, top - 6 * k);
      f.lineTo(cx - tw * 0.3, top - 6 * k - leg);
      f.moveTo(cx + tw * 0.4, top - 6 * k);
      f.lineTo(cx + tw * 0.3, top - 6 * k - leg);
      f.moveTo(cx - tw * 0.35, top - 6 * k - leg * 0.5);
      f.lineTo(cx + tw * 0.35, top - 6 * k - leg * 0.5);
      f.stroke();
      const tt = top - 6 * k - leg - 30 * k;
      box(f, cx - tw / 2, tt, tw, 30 * k, 3 * k, PAL.woodDk, lw);
      f.beginPath();
      f.moveTo(cx - tw / 2 - 3 * k, tt);
      f.lineTo(cx, tt - 14 * k);
      f.lineTo(cx + tw / 2 + 3 * k, tt);
      f.closePath();
      fillInk(f, "#3a2a1a", lw);
      f.strokeStyle = "rgba(20,22,37,0.6)";
      f.lineWidth = Math.max(1, lw * 0.5);
      f.beginPath();
      f.moveTo(cx - tw / 2, tt + 10 * k);
      f.lineTo(cx + tw / 2, tt + 10 * k);
      f.moveTo(cx - tw / 2, tt + 20 * k);
      f.lineTo(cx + tw / 2, tt + 20 * k);
      f.stroke();
    }
    x += bw + rnd() * 10 * k;
  }
  // the aerial on the tallest roof
  if (ax) {
    f.strokeStyle = PAL.ink;
    f.lineWidth = lw;
    f.beginPath();
    f.moveTo(ax, ay);
    f.lineTo(ax, ay - 50 * k);
    f.moveTo(ax - 10 * k, ay - 30 * k);
    f.lineTo(ax + 10 * k, ay - 30 * k);
    f.moveTo(ax - 6 * k, ay - 42 * k);
    f.lineTo(ax + 6 * k, ay - 42 * k);
    f.stroke();
    ay -= 50 * k;
  }
  // the street
  f.fillStyle = "#171d3d";
  f.fillRect(0, gy, w, h - gy);
  seg(f, 0, gy, w, gy, PAL.ink, lw);
  f.strokeStyle = PAL.cream;
  f.lineWidth = Math.max(1, 2 * k);
  f.setLineDash([16 * k, 14 * k]);
  f.beginPath();
  f.moveTo(0, gy + (h - gy) * 0.55);
  f.lineTo(w, gy + (h - gy) * 0.55);
  f.stroke();
  f.setLineDash([]);
  dots(f, 0, 0, w, h, "rgba(8,10,28,0.55)", Math.max(5, 8 * k), 0.785, 0, 0.7, "radial");
  CITY.w = w;
  CITY.h = h;
  CITY.s = s;
  CITY.back = B.c;
  CITY.front = F.c;
  CITY.stars = new Float32Array(stars);
  CITY.wins = new Float32Array(wins);
  CITY.ax = ax;
  CITY.ay = ay;
  CITY.tx = tx;
  CITY.ty = ty;
  CITY.ts = clamp(h * 0.11, 26, 120);
  CITY.gy = gy;
  CITY.k = k;
  CITY.lw = lw;
  return CITY;
}

/* drawCity(ctx, rect, now) — the start screen's night skyline. */
export function drawCity(ctx, rect, now) {
  const w = Math.max(20, Math.round(rect.w));
  const h = Math.max(20, Math.round(rect.h));
  const C = cityLayers(w, h);
  const t = now || 0;
  ctx.save();
  ctx.translate(rect.x, rect.y);
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  ctx.drawImage(C.back, 0, 0, w, h);
  // twinkling stars
  const st = C.stars;
  for (let i = 0; i < st.length; i += 4) {
    const a = 0.5 + 0.5 * Math.sin(t * 1.7 + st[i + 3]);
    ctx.globalAlpha = 0.25 + a * 0.75;
    twinkle(ctx, st[i], st[i + 1], st[i + 2] * (0.6 + a * 0.4), PAL.cream);
  }
  ctx.globalAlpha = 1;
  // two searchlights, between the rows
  ctx.fillStyle = PAL.cream;
  for (let i = 0; i < 2; i++) {
    const bx = w * (i ? 0.72 : 0.3);
    const by = C.gy;
    const a = -Math.PI / 2 + Math.sin(t * 0.35 + i * 2.4) * 0.55;
    const len = h * 1.3;
    const spread = 0.07;
    ctx.globalAlpha = 0.09;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + Math.cos(a - spread) * len, by + Math.sin(a - spread) * len);
    ctx.lineTo(bx + Math.cos(a + spread) * len, by + Math.sin(a + spread) * len);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.drawImage(C.front, 0, 0, w, h);
  // windows going on and off
  const wn = C.wins;
  for (let i = 0, n = 0; i < wn.length; i += 4, n++) {
    if (hash(n, Math.floor(t / 3 + n * 0.37)) < 0.5) {
      ctx.fillStyle = PAL.glow;
      ctx.fillRect(wn[i], wn[i + 1], wn[i + 2], wn[i + 3]);
      ctx.strokeStyle = PAL.ink;
      ctx.lineWidth = Math.max(1, C.lw * 0.5);
      ctx.strokeRect(wn[i], wn[i + 1], wn[i + 2], wn[i + 3]);
    }
  }
  // the aerial's red light
  if (C.ax && t % 1.6 < 0.8) {
    ctx.fillStyle = PAL.red;
    ctx.beginPath();
    circ(ctx, C.ax, C.ay, 3 * C.k + 1);
    ctx.fill();
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    circ(ctx, C.ax, C.ay, 10 * C.k + 3);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  // the thief, on the roof, waiting for dark
  if (C.ty) drawThief(ctx, C.tx, C.ty - C.ts * 0.5, C.ts, "idle", t);
  // a patrol car crossing every so often
  const period = 17;
  const p = (t % period) / period;
  if (p < 0.45) {
    const len = clamp(h * 0.12, 40, 130);
    const cx = lerp(-len * 1.8, w + len * 0.2, p / 0.45);
    drawCar(ctx, cx, h - (h - C.gy) * 0.15, len, t, C.lw);
  }
  ctx.restore();
}

/* ===================== floors, for the trap rooms ===================== */

/*
 * floor(ctx, x, y, w, h, { tone, cell, shade, border }) — a top-down floor
 * filling a rect, for the laser hall, the camera corridor and the pressure
 * tiles. tone: 'tile' (navy checker, the default), 'marble' (pale slabs with
 * veins, the bank), 'wood' (planks), 'steel' (diamond plate, the vault),
 * 'carpet' (casino red with gold diamonds), 'concrete' (a back room).
 * cell is the pattern's grid in px (default 32): match it to the room's
 * grid and the tiles line up with the game's own. The pattern is anchored at
 * (x, y). shade (default true) adds the halftone vignette; border (default
 * true) the ink outline. One cached pattern per tone, cell and ratio.
 */
const FLOOR_TONES = { tile: 0, marble: 1, wood: 2, steel: 3, carpet: 4, concrete: 5 };
const FLOORS = new Map();
function floorPattern(ctx, tone, cell) {
  const s = pxRatio();
  const ti = FLOOR_TONES[tone] === undefined ? 0 : FLOOR_TONES[tone];
  const key = (ti * 1024 + cell) * 8 + Math.round(s * 2);
  let p = FLOORS.get(key);
  if (p !== undefined) return p;
  const cw = ti === 2 ? cell * 4 : cell * 2;
  const ch = ti === 2 ? cell * 2 : cell * 2;
  const L = layer(cw, ch);
  const g = L.g;
  const lw = Math.max(1, Math.min(2, cell * 0.05));
  const rnd = seeded(ti * 31 + cell);
  if (ti === 0) {
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 2; c++) {
        g.fillStyle = (r + c) % 2 ? "#33437a" : "#26335f";
        g.fillRect(c * cell, r * cell, cell, cell);
        g.fillStyle = "rgba(255,255,255,0.07)";
        g.fillRect(c * cell + 2, r * cell + 2, cell - 4, cell * 0.18);
      }
    }
    g.strokeStyle = PAL.ink;
    g.lineWidth = lw;
    g.strokeRect(0, 0, cell, cell);
    g.strokeRect(cell, cell, cell, cell);
    g.strokeRect(cell, 0, cell, cell);
    g.strokeRect(0, cell, cell, cell);
  } else if (ti === 1) {
    g.fillStyle = "#6f7aa0";
    g.fillRect(0, 0, cw, ch);
    g.strokeStyle = "rgba(228,235,243,0.3)";
    g.lineWidth = lw * 0.7;
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      let px = rnd() * cw;
      let py = rnd() * ch;
      g.moveTo(px, py);
      for (let j = 0; j < 4; j++) {
        px += (rnd() - 0.3) * cell * 0.6;
        py += (rnd() - 0.5) * cell * 0.5;
        g.lineTo(px, py);
      }
      g.stroke();
    }
    g.fillStyle = "rgba(20,22,37,0.12)";
    g.fillRect(cell, 0, cell, cell);
    g.fillRect(0, cell, cell, cell);
    g.strokeStyle = "rgba(20,22,37,0.7)";
    g.lineWidth = lw;
    g.strokeRect(0, 0, cell, cell);
    g.strokeRect(cell, 0, cell, cell);
    g.strokeRect(0, cell, cell, cell);
    g.strokeRect(cell, cell, cell, cell);
  } else if (ti === 2) {
    const ph = cell / 2;
    for (let r = 0; r < 4; r++) {
      g.fillStyle = r % 2 ? "#6b4a2e" : "#5f4127";
      g.fillRect(0, r * ph, cw, ph);
      g.strokeStyle = "rgba(20,22,37,0.25)";
      g.lineWidth = lw * 0.5;
      g.beginPath();
      g.moveTo(0, r * ph + ph * 0.4);
      g.lineTo(cw, r * ph + ph * 0.45);
      g.stroke();
      g.strokeStyle = PAL.ink;
      g.lineWidth = lw;
      g.beginPath();
      g.moveTo(0, r * ph);
      g.lineTo(cw, r * ph);
      const off = ((r * 1.7) % 4) * cell;
      g.moveTo(off % cw, r * ph);
      g.lineTo(off % cw, (r + 1) * ph);
      g.moveTo((off + cell * 2.3) % cw, r * ph);
      g.lineTo((off + cell * 2.3) % cw, (r + 1) * ph);
      g.stroke();
    }
  } else if (ti === 3) {
    g.fillStyle = "#4a5470";
    g.fillRect(0, 0, cw, ch);
    const d = cell / 2;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        g.save();
        g.translate(c * d + d / 2, r * d + d / 2);
        g.rotate((r + c) % 2 ? 0.7 : -0.7);
        g.fillStyle = "rgba(20,22,37,0.5)";
        g.fillRect(-d * 0.28, -d * 0.04, d * 0.56, d * 0.16);
        g.fillStyle = "rgba(228,235,243,0.35)";
        g.fillRect(-d * 0.28, -d * 0.1, d * 0.56, d * 0.12);
        g.restore();
      }
    }
    g.strokeStyle = "rgba(20,22,37,0.6)";
    g.lineWidth = lw;
    g.strokeRect(0, 0, cw, ch);
  } else if (ti === 4) {
    g.fillStyle = "#7a1f35";
    g.fillRect(0, 0, cw, ch);
    g.fillStyle = "rgba(244,182,61,0.55)";
    for (let i = 0; i < 2; i++) {
      const cx = i ? cell * 1.5 : cell * 0.5;
      const cy = i ? cell * 1.5 : cell * 0.5;
      g.beginPath();
      g.moveTo(cx, cy - cell * 0.25);
      g.lineTo(cx + cell * 0.18, cy);
      g.lineTo(cx, cy + cell * 0.25);
      g.lineTo(cx - cell * 0.18, cy);
      g.closePath();
      g.fill();
    }
    g.fillStyle = "rgba(20,22,37,0.25)";
    g.beginPath();
    circ(g, cell * 1.5, cell * 0.5, cell * 0.06);
    circ(g, cell * 0.5, cell * 1.5, cell * 0.06);
    g.fill();
  } else {
    g.fillStyle = "#3b4466";
    g.fillRect(0, 0, cw, ch);
    g.fillStyle = "rgba(169,182,200,0.25)";
    for (let i = 0; i < 40; i++) g.fillRect(rnd() * cw, rnd() * ch, 1.2, 1.2);
    g.fillStyle = "rgba(8,10,28,0.25)";
    for (let i = 0; i < 30; i++) g.fillRect(rnd() * cw, rnd() * ch, 1.5, 1.5);
    g.strokeStyle = "rgba(20,22,37,0.5)";
    g.lineWidth = lw;
    g.strokeRect(0, 0, cw, ch);
  }
  p = ctx.createPattern(L.c, "repeat");
  if (p && p.setTransform && typeof DOMMatrix !== "undefined") {
    p.setTransform(new DOMMatrix([1 / L.s, 0, 0, 1 / L.s, 0, 0]));
  }
  if (FLOORS.size > 32) FLOORS.clear();
  FLOORS.set(key, p);
  return p;
}
export function floor(ctx, x, y, w, h, o = NONE) {
  const cell = clamp(Math.round(o.cell || 32), 4, 1000);
  const p = floorPattern(ctx, o.tone || "tile", cell);
  ctx.save();
  ctx.translate(x, y);
  if (p) {
    ctx.fillStyle = p;
    ctx.fillRect(0, 0, w, h);
  }
  if (o.shade !== false) htBlit(ctx, 0, 0, w, h, "rgba(8,10,28,0.55)", clamp(cell * 0.25, 4, 14), 0.785, 0.05, 0.6, "radial");
  if (o.border !== false) {
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ink(ctx);
    ctx.stroke();
  }
  ctx.restore();
}
