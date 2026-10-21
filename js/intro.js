/*
 * intro.js — the three-second sting that plays when the game opens.
 *
 * A comic panel on a night printed in halftone: a steel safe pops onto the
 * page and its cream dial spins the way a combination is dialled — right,
 * back left, right again — and at each stop a tumbler clicks and one of the
 * three lamps over the door lights mustard. Third click, the door swings
 * open on its hinge onto a gold glow, and a red comic starburst bursts out
 * of the safe with a mustard POW inside it and cream speed lines round it.
 * Then the burst flies to the exact place of the red burst behind the HEIST
 * wordmark on the start screen, tilted as that one is, while the curtain
 * fades — so the hand-off is the burst landing behind the title rather than
 * one picture swapped for another. Nothing in it is lettered, so it has
 * nothing to translate: the POW is a shape, and the word is the wordmark's.
 *
 * WHAT IT MAY NOT DO
 *   - Cost anyone a run (hub §1). It only ever plays at page load, over the
 *     start screen, and any tap or key skips straight to the hand-off.
 *   - Let the skipping press through. A key is swallowed in the capture
 *     phase on window — this script runs async from the top of <body>, long
 *     before the module graph has loaded, so its listener is registered
 *     before js/main.js's own capture-phase Escape handler (and
 *     js/audio.js's capture-phase unlock, and js/heist.js's keys) and runs
 *     first — because the press that skips must not also be the start
 *     screen's Escape (which is the way out to the arcade) or Enter on Play.
 *     A tap lands on the curtain itself, which covers every button.
 *   - Delay the game. It is a curtain over the page, not a gate in front of
 *     it: the modules, the city canvas and the start screen boot underneath
 *     while it plays.
 *   - Play for someone who has asked for less motion. prefers-reduced-motion
 *     means the script does nothing at all.
 *
 * A classic script, self-contained, importing nothing, for the reason
 * touch-guard.js stands apart: if anything in the module graph fails, the
 * curtain must still lift. Every frame runs inside a try, a hard timeout
 * removes the curtain whatever happens, and a failure of this file leaves the
 * game exactly as it was without it.
 *
 * Canvas 2D, devicePixelRatio capped at 2, shapes and patterns made once and
 * no allocation in the frame loop (hub §10). The look is css/style.css's and
 * tools/make-icons.py's: ink outlines, hard offset shadows, halftone dots,
 * the safe dial of the icon and the wordmark's own starburst polygon.
 */
(function () {
  "use strict";

  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  } catch (e) {
    /* No matchMedia: play it. */
  }

  // css/style.css's tokens, copied rather than read because this file
  // imports nothing; if the palette moves, the sting keeps the old colours
  // until somebody updates these lines.
  var INK = "#141625";
  var NIGHT = "#0b1029";
  var NAVY = "#1c2a5e";
  var NAVY_HI = "#2d4189";
  var NAVY_LO = "#141d45";
  var MUSTARD = "#f4b63d";
  var MUSTARD_DK = "#c98a1c";
  var CREAM = "#fbe9c0";
  var RED = "#e5373d";
  var RED_DK = "#a31f2a";
  var STEEL = "#a9b6c8";
  var STEEL_DK = "#7d8aa0";

  // The timeline, in milliseconds. POP: the safe lands on the page. DIAL:
  // keyframes [time, turns] the dial eases between; the three CLICKS are the
  // stops that count. DOOR: it swings open. BURST: the starburst bursts out.
  // LAND starts the hand-off, which takes LAND_MS (or SKIP_MS when skipped).
  var POP = 300;
  var DIAL = [250, 0, 820, 1.55, 900, 1.55, 1280, 0.72, 1350, 0.72, 1640, 1.1];
  var CLICKS = [820, 1280, 1640];
  var DOOR = 1720;
  var DOOR_MS = 380;
  var BURST = 1960;
  var BURST_MS = 440;
  var LAND = 2620;
  var LAND_MS = 650;
  var SKIP_MS = 360;

  // The wordmark's ::before starburst, css/style.css, as fractions of its box.
  var STAR = new Float32Array([
    0.5, 0, 0.58, 0.18, 0.74, 0.04, 0.74, 0.24, 0.96, 0.16, 0.86, 0.36, 1, 0.5, 0.86, 0.62,
    0.98, 0.84, 0.74, 0.76, 0.72, 0.98, 0.58, 0.82, 0.48, 1, 0.4, 0.82, 0.22, 0.96, 0.24, 0.74,
    0.02, 0.82, 0.14, 0.62, 0, 0.48, 0.14, 0.36, 0.04, 0.14, 0.26, 0.24, 0.28, 0.02, 0.42, 0.18,
  ]);
  // The POW inside it: a smaller, spikier burst of twelve points, made once.
  var POW_N = 12;
  var POW = new Float32Array(POW_N * 4);
  for (var i = 0; i < POW_N * 2; i++) {
    var a = (i / (POW_N * 2)) * Math.PI * 2 - Math.PI / 2;
    var r = i % 2 ? 0.55 : i % 4 ? 0.9 : 1;
    POW[i * 2] = Math.cos(a) * r;
    POW[i * 2 + 1] = Math.sin(a) * r;
  }
  // Speed lines: angle, inner radius and length factors, a little uneven so
  // they read as drawn rather than plotted.
  var LINES = 18;
  var SPEED = new Float32Array(LINES * 3);
  for (var j = 0; j < LINES; j++) {
    SPEED[j * 3] = (j / LINES) * Math.PI * 2 + ((j * 37) % 7) * 0.02;
    SPEED[j * 3 + 1] = 0.55 + ((j * 13) % 5) * 0.04;
    SPEED[j * 3 + 2] = 0.25 + ((j * 29) % 6) * 0.05;
  }

  var canvas = document.createElement("canvas");
  canvas.id = "intro";
  canvas.setAttribute("aria-hidden", "true");
  var ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Two halftone tiles, made once: the night's faint cream dots (style.css
  // --dots, 8px) and the darker print dots on the red burst.
  function dotTile(colour, r) {
    var c = document.createElement("canvas");
    c.width = c.height = 8;
    var g = c.getContext("2d");
    if (g) {
      g.fillStyle = colour;
      g.beginPath();
      g.arc(4, 4, r, 0, Math.PI * 2);
      g.fill();
    }
    return c;
  }
  var nightDots = dotTile("rgba(251, 233, 192, 0.09)", 1.5);
  var redDots = dotTile("rgba(20, 22, 37, 0.22)", 1.9);
  var nightFill = null;
  var redFill = null;
  var glow = null;

  var W = 0;
  var H = 0;
  var dpr = 1;
  var S = 0; // the safe door's side, CSS pixels
  var u = 1; // one comic "pixel" of line and shadow, scaled with the safe

  function size() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    S = Math.max(120, Math.min(W * 0.62, H * 0.5, 300));
    u = S / 240;
    try {
      nightFill = ctx.createPattern(nightDots, "repeat");
      redFill = ctx.createPattern(redDots, "repeat");
    } catch (e) {
      nightFill = redFill = null;
    }
    // The gold inside the safe, centred on the door; drawn about (0, 0).
    glow = ctx.createRadialGradient(0, 0, 0, 0, 0, S * 0.6);
    glow.addColorStop(0, "#fff3c4");
    glow.addColorStop(0.35, MUSTARD);
    glow.addColorStop(1, INK);
  }

  function clamp01(x) {
    return x < 0 ? 0 : x > 1 ? 1 : x;
  }
  function easeOutBack(x) {
    var c = 1.9;
    return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
  }
  function easeInOut(x) {
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  }
  function easeOut(x) {
    return 1 - Math.pow(1 - x, 3);
  }

  // The dial's angle in turns at time t: eased between keyframes.
  function dialTurns(t) {
    if (t <= DIAL[0]) return DIAL[1];
    for (var k = 2; k < DIAL.length; k += 2) {
      if (t < DIAL[k]) {
        var p = (t - DIAL[k - 2]) / (DIAL[k] - DIAL[k - 2]);
        return DIAL[k - 1] + (DIAL[k + 1] - DIAL[k - 1]) * easeOut(p);
      }
    }
    return DIAL[DIAL.length - 1];
  }

  // Where the burst lives on the start screen: the wordmark's own box, which
  // its ::before fills (inset: 0). The element is rotated -4deg, so its
  // bounding rectangle is a little larger than the box; the centre is the
  // same either way, and the untransformed size is offsetWidth/Height.
  var target = null;
  function findTarget() {
    var mark = document.querySelector("#start .wordmark");
    if (!mark) return null;
    var b = mark.getBoundingClientRect();
    var w = mark.offsetWidth;
    var h = mark.offsetHeight;
    if (w < 8 || h < 8) return null;
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: w, h: h };
  }

  var t0 = 0;
  var landAt = LAND;
  var landMs = LAND_MS;
  var done = false;
  var raf = 0;

  function finish() {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", size);
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
  }

  function skip() {
    var now = performance.now() - t0;
    if (now >= landAt) return;
    landAt = now;
    landMs = SKIP_MS;
  }

  function onKey(e) {
    // Skip, and let the press go no further: see the header.
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!e.repeat) skip();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  // A comic shape: the hard ink shadow, the fill, the ink line. The shadow
  // is the canvas's own with no blur, because a path is fixed in place when
  // it is built and translating afterwards would not move it; shadow offsets
  // are in device pixels, ignoring the transform, hence the dpr.
  function comic(fill, shadow) {
    ctx.fillStyle = fill;
    if (shadow) {
      ctx.shadowColor = INK;
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = ctx.shadowOffsetY = shadow * u * dpr;
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.shadowOffsetX = ctx.shadowOffsetY = 0;
    } else {
      ctx.fill();
    }
    ctx.lineWidth = 3 * u;
    ctx.strokeStyle = INK;
    ctx.stroke();
  }
  function circle(x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }

  // The safe, about the stage centre (the caller has translated there).
  // `turns` is the dial, `lit` how many lamps are on, `open` 0..1 the door.
  function drawSafe(turns, lit, open, sinceClick) {
    var h = S / 2;
    // The housing: navy, taller than the door to carry the three lamps.
    roundRect(-h - S * 0.07, -h - S * 0.2, S * 1.14, S * 1.28, 14 * u);
    comic(NAVY_HI, 6);
    // The opening, dark with gold behind, glowing as the door opens.
    roundRect(-h, -h, S, S, 8 * u);
    ctx.fillStyle = INK;
    ctx.fill();
    if (open > 0) {
      ctx.save();
      ctx.globalAlpha *= open;
      ctx.fillStyle = glow;
      ctx.fill();
      ctx.restore();
    }
    // Lamps: one per tumbler, lit mustard as each clicks.
    for (var k = 0; k < 3; k++) {
      circle((k - 1) * S * 0.14, -h - S * 0.1, S * 0.04);
      comic(k < lit ? MUSTARD : NAVY_LO, 0);
    }

    // The door, swung on its left-edge hinge by squashing it towards the
    // hinge: cos of the swing is all the perspective three-tenths of a
    // second needs.
    var sw = Math.cos(open * Math.PI * 0.46);
    ctx.save();
    ctx.translate(-h, 0);
    ctx.scale(sw, 1);
    ctx.translate(h, 0);
    roundRect(-h, -h, S, S, 8 * u);
    comic(STEEL, 0);
    roundRect(-h + S * 0.07, -h + S * 0.07, S * 0.86, S * 0.86, 6 * u);
    ctx.lineWidth = 2 * u;
    ctx.strokeStyle = STEEL_DK;
    ctx.stroke();
    // Rivets in the corners.
    for (var q = 0; q < 4; q++) {
      circle((q % 2 ? 1 : -1) * S * 0.39, (q < 2 ? -1 : 1) * S * 0.39, S * 0.025);
      comic(STEEL_DK, 0);
    }
    // The dial: cream face, ink ticks, a mustard knob, the icon's drawing.
    var R = S * 0.3;
    // A tumbler's click jolts the dial a hair.
    var jolt = sinceClick >= 0 && sinceClick < 90 ? Math.sin((sinceClick / 90) * Math.PI) * 2 * u : 0;
    ctx.save();
    ctx.translate(0, jolt);
    circle(0, 0, R);
    comic(CREAM, 5);
    ctx.rotate(turns * Math.PI * 2);
    ctx.strokeStyle = INK;
    ctx.lineCap = "round";
    for (var m = 0; m < 40; m++) {
      var big = m % 5 === 0;
      var ang = (m / 40) * Math.PI * 2;
      var c = Math.cos(ang);
      var s = Math.sin(ang);
      var r0 = R * (big ? 0.72 : 0.82);
      ctx.lineWidth = (big ? 3 : 1.6) * u;
      ctx.beginPath();
      ctx.moveTo(c * r0, s * r0);
      ctx.lineTo(c * R * 0.92, s * R * 0.92);
      ctx.stroke();
    }
    // The zero mark, red, so the spin reads as a spin.
    ctx.fillStyle = RED;
    circle(0, -R * 0.62, R * 0.07);
    ctx.fill();
    circle(0, 0, R * 0.36);
    comic(MUSTARD, 0);
    // The knob's grip bar, which turns with it.
    roundRect(-R * 0.08, -R * 0.3, R * 0.16, R * 0.6, R * 0.06);
    comic(MUSTARD_DK, 0);
    ctx.restore();
    // The pointer, fixed on the door above the dial.
    ctx.beginPath();
    ctx.moveTo(-S * 0.035, -R - S * 0.075);
    ctx.lineTo(S * 0.035, -R - S * 0.075);
    ctx.lineTo(0, -R - S * 0.015);
    ctx.closePath();
    comic(RED, 0);
    ctx.restore();

    // The click itself: three short ink-and-cream ticks off the pointer.
    if (sinceClick >= 0 && sinceClick < 160) {
      var f = sinceClick / 160;
      ctx.save();
      ctx.globalAlpha *= 1 - f;
      ctx.strokeStyle = CREAM;
      ctx.lineWidth = 3 * u;
      var py = -R - S * 0.05;
      for (var z = -1; z <= 1; z++) {
        var za = -Math.PI / 2 + z * 0.7;
        var d0 = S * (0.06 + 0.05 * f);
        ctx.beginPath();
        ctx.moveTo(Math.cos(za) * d0, py + Math.sin(za) * d0);
        ctx.lineTo(Math.cos(za) * (d0 + S * 0.06), py + Math.sin(za) * (d0 + S * 0.06));
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // The starburst in a w×h box centred on (0, 0): red-dk with print dots
  // and an ink line, as behind the wordmark.
  function drawStar(w, h) {
    ctx.beginPath();
    for (var k = 0; k < STAR.length; k += 2) {
      var x = (STAR[k] - 0.5) * w;
      var y = (STAR[k + 1] - 0.5) * h;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    comic(RED_DK, 6);
    if (redFill) {
      ctx.fillStyle = redFill;
      ctx.fill();
    }
  }
  function drawPow(r) {
    ctx.beginPath();
    for (var k = 0; k < POW.length; k += 2) {
      if (k === 0) ctx.moveTo(POW[k] * r, POW[k + 1] * r * 0.62);
      else ctx.lineTo(POW[k] * r, POW[k + 1] * r * 0.62);
    }
    ctx.closePath();
    comic(MUSTARD, 0);
  }

  function frame(now) {
    if (done) return;
    try {
      if (!t0) t0 = now;
      var t = now - t0;
      var land = clamp01((t - landAt) / landMs);
      if (land >= 1) {
        finish();
        return;
      }
      var k = easeInOut(land);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // The curtain: night, printed in halftone, thinning away at the end.
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = NIGHT;
      ctx.fillRect(0, 0, W, H);
      if (nightFill) {
        ctx.fillStyle = nightFill;
        ctx.fillRect(0, 0, W, H);
      }

      var cx = W / 2;
      var cy = H / 2 + S * 0.06;

      // The safe: pops in, dials, opens; gone fast once the hand-off starts.
      var safeA = clamp01(t / (POP * 0.5)) * (1 - clamp01(land * 3));
      if (safeA > 0) {
        var lit = 0;
        var since = -1;
        for (var c = 0; c < CLICKS.length; c++) {
          if (t >= CLICKS[c]) {
            lit = c + 1;
            since = t - CLICKS[c];
          }
        }
        ctx.save();
        ctx.translate(cx, cy);
        var pop = land > 0 ? 1 : easeOutBack(clamp01(t / POP));
        ctx.scale(pop, pop);
        ctx.globalAlpha = safeA;
        drawSafe(dialTurns(t), lit, easeOut(clamp01((t - DOOR) / DOOR_MS)), since);
        ctx.restore();
      }

      // The burst: out of the safe with an overshoot, rests, then flies to
      // the wordmark and lies down behind it.
      var bi = (t - BURST) / BURST_MS;
      if (land > 0 && bi < 1) bi = 1; // a skip before the burst lands it whole
      if (bi > 0) {
        var s = easeOutBack(clamp01(bi));
        var bw = Math.min(W * 0.92, S * 2.1);
        var bh = bw * 0.42;
        var bx = cx;
        var by = cy;
        var rot = 0;
        var alpha = clamp01(bi * 3);
        if (land > 0) {
          if (target === null) target = findTarget() || false;
          if (target) {
            bx += (target.x - bx) * k;
            by += (target.y - by) * k;
            bw += (target.w - bw) * k;
            bh += (target.h - bh) * k;
            rot = ((-4 * Math.PI) / 180) * k;
            // The last part of the flight is a cross-fade onto the real
            // burst, which the thinning curtain is uncovering underneath.
            alpha *= 1 - clamp01((land - 0.55) / 0.45);
          } else {
            alpha *= 1 - k; // no wordmark on screen to land on: just fade
          }
        }
        ctx.save();
        ctx.translate(bx, by);
        ctx.rotate(rot);

        // Speed lines round it, only while it bursts.
        var sl = clamp01(bi * 1.4) * (1 - clamp01(land * 4));
        if (sl > 0) {
          ctx.globalAlpha = sl * 0.9;
          ctx.strokeStyle = CREAM;
          ctx.lineCap = "round";
          ctx.lineWidth = 3 * u;
          var reach = Math.hypot(bw, bh) * 0.5;
          for (var n = 0; n < LINES; n++) {
            var an = SPEED[n * 3];
            var r0 = reach * (SPEED[n * 3 + 1] + 0.35 * easeOut(clamp01(bi)));
            var r1 = r0 + reach * SPEED[n * 3 + 2];
            var ca = Math.cos(an);
            var sa = Math.sin(an) * 0.7;
            ctx.beginPath();
            ctx.moveTo(ca * r0, sa * r0);
            ctx.lineTo(ca * r1, sa * r1);
            ctx.stroke();
          }
        }

        ctx.globalAlpha = alpha;
        ctx.scale(s, s);
        drawStar(bw, bh);
        // The POW shrinks away in the hand-off, so what lands is the burst
        // the start screen has.
        var pw = 1 - clamp01(land * 2.5);
        if (pw > 0) drawPow(bh * 0.62 * pw);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    } catch (e) {
      finish();
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  function start() {
    size();
    window.addEventListener("resize", size);
    window.addEventListener("keydown", onKey, true);
    canvas.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      skip();
    });
    document.body.appendChild(canvas);
    raf = requestAnimationFrame(frame);
    // Whatever happens to the frame loop, the curtain does not outstay this.
    setTimeout(finish, 6000);
  }

  // Loaded from the top of <body>, so the body exists even though the rest
  // of the page may not have been parsed yet.
  start();
})();
