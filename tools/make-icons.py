#!/usr/bin/env python3
"""
make-icons.py — HEIST's app icons, drawn procedurally. This script is the
source of truth; the PNGs in icons/ are its output (hub CLAUDE.md §4).

THE MOTIF: a safe dial wearing a bandit's mask. A cream combination dial
with ink tick marks round its rim sits on a red comic starburst over a
navy night printed in halftone dots; a black domino mask is tied across
the top of the dial, so its two eye holes look out at you and the dial's
mustard knob becomes the nose. It is the whole game in one picture — the
lock, the thief, the comic book — and it reads as a face at 48px.

Pillow only: no network, no fonts (nothing is lettered). Everything is
drawn at 4x and downsampled with LANCZOS for clean edges. Writes:

  icons/icon-192.png            any-purpose, 192
  icons/icon-512.png            any-purpose, 512
  icons/icon-maskable-512.png   maskable: the motif shrunk into the inner
                                ~62% so a circular or squircle mask never
                                clips the dial
  icons/icon-180.png            apple-touch-icon

Run from the game's directory:  python3 tools/make-icons.py
"""

import math
import os

from PIL import Image, ImageChops, ImageDraw

INK = (20, 22, 37)
NIGHT = (11, 16, 41)
NAVY = (28, 42, 94)
NAVY_HI = (45, 65, 137)
MUSTARD = (244, 182, 61)
MUSTARD_DK = (201, 138, 28)
CREAM = (251, 233, 192)
PAPER = (255, 246, 224)
RED = (229, 55, 61)
RED_DK = (163, 31, 42)
STEEL = (169, 182, 200)

SS = 4  # supersampling factor


def circle(d, cx, cy, r, fill=None, outline=None, width=0):
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=fill, outline=outline, width=width)


def inked_circle(d, cx, cy, r, fill, ink):
    """A flat disc with an ink outline: ink disc first, fill disc inside."""
    circle(d, cx, cy, r + ink, fill=INK)
    circle(d, cx, cy, r, fill=fill)


def star_points(cx, cy, r_out, r_in, spikes, rot=0.0, jitter=0.0):
    pts = []
    for i in range(spikes * 2):
        a = rot + i * math.pi / spikes
        r = r_out if i % 2 == 0 else r_in
        if i % 2 == 0 and jitter:
            r *= 1 + jitter * math.sin(i * 2.7)
        pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
    return pts


def halftone(d, x0, y0, x1, y1, step, rmax, color, falloff):
    """A dot screen at 45 degrees; falloff(x, y) -> 0..1 scales each dot."""
    s = step
    y = y0
    row = 0
    while y < y1 + s:
        x = x0 + (s / 2 if row % 2 else 0)
        while x < x1 + s:
            r = rmax * falloff(x, y)
            if r > 0.6:
                circle(d, x, y, r, fill=color)
            x += s
        y += s / 2
        row += 1


def _mul(a, b):
    """Pixelwise product of two L images: a mask inside a mask."""
    return ImageChops.multiply(a, b)


def draw(size, inset):
    """The icon at size*SS, the motif scaled into `inset` of the canvas."""
    N = size * SS
    img = Image.new("RGB", (N, N), NIGHT)
    d = ImageDraw.Draw(img)
    c = N / 2

    # the night: navy toward the bottom, a dot screen thinning downward
    for i in range(N):
        t = i / N
        col = tuple(int(NIGHT[k] + (NAVY[k] - NIGHT[k]) * t) for k in range(3))
        d.line((0, i, N, i), fill=col)
    halftone(d, 0, 0, N, N, N / 22, N / 70, NAVY_HI, lambda x, y: max(0.0, 1 - y / N * 1.2))

    m = N * inset  # the motif's box
    lw = m * 0.022  # ink width

    # the starburst behind the dial
    burst = star_points(c, c, m * 0.5, m * 0.36, 14, rot=-0.2, jitter=0.08)
    d.polygon([(x + m * 0.025, y + m * 0.025) for x, y in burst], fill=INK)
    d.polygon(burst, fill=INK)
    inner = star_points(c, c, m * 0.5 - lw * 1.4, m * 0.36 - lw * 1.4, 14, rot=-0.2, jitter=0.08)
    d.polygon(inner, fill=RED)
    # dots on the burst only: drawn on their own layer, pasted through the
    # burst's shape as a mask (Pillow has no clip path)
    dots = Image.new("RGB", (N, N), RED_DK)
    clip = Image.new("L", (N, N), 0)
    ImageDraw.Draw(clip).polygon(inner, fill=255)
    spots = Image.new("L", (N, N), 0)
    halftone(
        ImageDraw.Draw(spots), c - m / 2, c - m / 2, c + m / 2, c + m / 2, m / 26, m / 70, 255,
        lambda x, y: min(1.0, math.hypot(x - c, y - c) / (m * 0.5)),
    )
    img.paste(dots, (0, 0), _mul(spots, clip))

    # the dial: shadow, rim, face
    R = m * 0.33
    circle(d, c + m * 0.03, c + m * 0.03, R + lw, fill=INK)
    inked_circle(d, c, c, R, STEEL, lw)
    inked_circle(d, c, c, R * 0.86, CREAM, lw * 0.8)
    # ticks round the face
    for i in range(50):
        a = i / 50 * 2 * math.pi - math.pi / 2
        long_tick = i % 5 == 0
        r0 = R * (0.66 if long_tick else 0.74)
        r1 = R * 0.82
        d.line(
            (c + math.cos(a) * r0, c + math.sin(a) * r0, c + math.cos(a) * r1, c + math.sin(a) * r1),
            fill=INK, width=max(1, int(lw * (0.9 if long_tick else 0.5))),
        )
    # the index mark at the top of the rim
    d.polygon(
        [(c - R * 0.09, c - R - lw * 2.6), (c + R * 0.09, c - R - lw * 2.6), (c, c - R * 0.86)],
        fill=RED, outline=INK,
    )

    # the domino mask across the top half, tails flying out to the left
    my = c - R * 0.22
    mh = R * 0.42
    tail = [
        (c - R * 0.9, my - mh * 0.1),
        (c - R * 1.45, my - mh * 0.75),
        (c - R * 1.32, my - mh * 0.05),
        (c - R * 1.5, my + mh * 0.55),
        (c - R * 0.9, my + mh * 0.3),
    ]
    d.polygon(tail, fill=INK)
    mask = []
    for i in range(41):
        t = i / 40
        x = c - R * 1.02 + t * R * 2.04
        y = my - mh * 0.5 + math.sin(t * math.pi) * -mh * 0.12
        mask.append((x, y))
    for i in range(41):
        t = 1 - i / 40
        x = c - R * 1.02 + t * R * 2.04
        dip = abs(math.sin(t * math.pi * 2)) * mh * 0.22
        y = my + mh * 0.5 + dip
        mask.append((x, y))
    d.polygon(mask, fill=INK)
    # eye holes with pupils looking to one side, a glint each
    for s in (-1, 1):
        ex = c + s * R * 0.42
        d.ellipse((ex - R * 0.2, my - R * 0.15, ex + R * 0.2, my + R * 0.15), fill=PAPER)
        circle(d, ex + R * 0.07, my + R * 0.02, R * 0.085, fill=INK)
        circle(d, ex + R * 0.03, my - R * 0.03, R * 0.025, fill=PAPER)

    # the knob in the middle, which the mask turns into a nose
    ky = c + R * 0.28
    circle(d, c + m * 0.012, ky + m * 0.012, R * 0.3 + lw, fill=INK)
    inked_circle(d, c, ky, R * 0.3, MUSTARD, lw * 0.8)
    circle(d, c, ky, R * 0.2, fill=MUSTARD_DK)
    circle(d, c - R * 0.09, ky - R * 0.1, R * 0.06, fill=PAPER)
    # the grip ridges round the knob
    for i in range(12):
        a = i / 12 * 2 * math.pi
        x0, y0 = c + math.cos(a) * R * 0.22, ky + math.sin(a) * R * 0.22
        x1, y1 = c + math.cos(a) * R * 0.29, ky + math.sin(a) * R * 0.29
        d.line((x0, y0, x1, y1), fill=INK, width=max(1, int(lw * 0.5)))

    return img.resize((size, size), Image.LANCZOS)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(here, "..", "icons")
    os.makedirs(out, exist_ok=True)
    draw(192, 0.98).save(os.path.join(out, "icon-192.png"))
    draw(512, 0.98).save(os.path.join(out, "icon-512.png"))
    draw(180, 0.98).save(os.path.join(out, "icon-180.png"))
    # maskable: the safe zone is the central 80% circle; keep the motif in ~62%
    draw(512, 0.62).save(os.path.join(out, "icon-maskable-512.png"))
    print("wrote icon-192, icon-512, icon-180, icon-maskable-512 to", os.path.normpath(out))


if __name__ == "__main__":
    main()
