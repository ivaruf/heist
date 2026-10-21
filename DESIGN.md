# HEIST — design and multi-agent contract

**HEIST — Crack it before the cops come.** (nb: *Knekk den før politiet kommer.*)

You are a master thief. Each job is a building (a kiosk, a pawnshop, a bank,
the central vault) with one to five locks between you and the loot. The
moment you touch the first lock the silent alarm trips and a police car sets
off towards you. Open every lock before it arrives and you get away with the
take; run out of time and you are **busted**. Between jobs you spend the take
in the tool shop on better tools, which make the puzzles kinder, and on
one-shot gadgets that get you out of a tight spot. Getting richer and getting
better at cracking are two ways up the same hill, and the player chooses the
mix.

The look is **comic book at night**: heavy ink outlines, flat colour, halftone
shading, starburst sound words ("KLIKK!"), a navy-and-mustard palette with
siren red and blue arriving as the police get close. Funny, never sloppy.

This file is the contract the first build was made against: five lanes, each
owning its files outright (hub CLAUDE.md §12). When two lanes disagree, the
fix is ratified here, not just in the code.

---

## 1. The loop

```
start screen ──Play──▶ job board ──pick a job──▶ the run ──▶ getaway card ─▶ job board
     │                    │                         │
     └──Shop──▶ shop ◀─────┘                         └──▶ busted card ──▶ job board
```

- **Start screen**: the HEIST wordmark over a comic panel of the city at
  night. Buttons: **Play** (`Spill`), **Shop** (`Butikk`), then the way back
  to the arcade, last. Funds shown.
- **Job board** (`Jobs` / `Oppdrag`): every job as a card — venue art, name,
  number of locks, time limit, payout, done/best. Jobs unlock in order; done
  jobs can be replayed for less (§5). A **Shop** button and **Back**.
- **The run**: the venue behind, the current lock in the middle, the police
  meter across the top (a car driving along a road towards the building), the
  lock counter (`2/4`), the take, and the consumable buttons along the bottom.
  Open a lock → a comic "KA-CHUNK!" beat → the next lock slides in.
- **The clock** starts on the first lock and only runs while playing (the
  menu pauses it — this game is solo, always yours to pause). Each job has a
  time limit in seconds. A **mistake** (wrong code, overset pins, wrong wire,
  trying a wrong combination) costs **heat**: seconds knocked off the clock,
  `heatSeconds × severity × mods.heatScale`. The meter shows heat as a jolt.
- **Getaway**: all locks open → the getaway card: the take, the time bonus,
  the new funds. **Busted**: the clock runs out → the thief in cuffs, no take,
  and **nothing else lost** — owned tools stay, funds stay, only the
  consumables used in that run are gone. No bail, no fine. Losing time is the
  cost; a kid who is stuck can always replay an easy job for money.

No dark patterns (hub §1): no energy, no daily anything, no real money
anywhere. The time limit is the puzzle's pressure, not a waiting timer. The
take is an in-fiction economy and connects to nothing outside the game (§7).

---

## 2. Lanes and files

| Lane | Owner of | Files |
| --- | --- | --- |
| **S — shell** | boot, screens, corner, menu, Escape, the run, audio, save, i18n, SW | `index.html`, `manifest.webmanifest`, `sw.js`, `README.md`, `js/main.js`, `js/heist.js`, `js/i18n.js`, `js/save.js`, `js/audio.js`, `js/screen.js`, `js/update.js`, `js/touch-guard.js`, `js/intro.js` |
| **P — safe cracking** | the four lock puzzles | `js/puzzles/index.js`, `js/puzzles/dial.js`, `js/puzzles/pins.js`, `js/puzzles/keypad.js`, `js/puzzles/wires.js` |
| **E — tools and jobs** | the tool and gadget catalogue, the mods they produce, the job list, payouts, the difficulty curve | `js/tools.js`, `js/jobs.js` |
| **K — shop** | the tool shop screen | `js/shop.js`, `css/shop.css` |
| **T — traps** | the alarm and trap challenges that sit between locks | `js/traps/index.js`, `js/traps/lasers.js`, `js/traps/cameras.js`, `js/traps/tiles.js` |
| **A — art** | the whole look: palette, type, every drawing helper, all CSS except the shop's, the icons | `js/art.js`, `css/style.css`, `tools/make-icons.py`, `icons/*` |

**One file, one owner.** Never edit another lane's file. If you need
something from another lane that this contract does not give you, write it
down in your final report; the integrator settles it here.

Everything is plain ES modules over HTTP, relative imports with `.js`, no
build step, no dependencies, no import maps (hub §2). Canvas 2D + DOM.

---

## 3. Shared vocabulary

### 3.1 i18n (S owns `js/i18n.js`)

```js
import { t, getLang, setLang, paintStatic, addStrings, money } from './i18n.js';
```

- `t(key, ...args)` — current language, else English, else the key (warn once).
  A value may be a function: `'jobs.locks': (n) => n === 1 ? '1 lock' : `${n} locks``.
- `addStrings({ nb: {...}, en: {...} })` — every lane registers its own words
  at module load, under **its own key prefix**, so no lane edits another's
  table: P `pz.*`, T `trap.*`, E `tool.*` `item.*` `job.*` `venue.*`, K `shop.*`.
  S owns everything unprefixed and `ui.*`, `run.*`, `menu.*`.
- `money(n)` — the take as the player reads it: nb `1 200 kr`, en `$1,200`.
- `arcade:lang` is dispatched on `document` after every switch; anything that
  caches text listens for it. Canvas text is simply re-read through `t()` on
  the next frame.
- Real bokmål, as said to a child of eight. The hub glossary is binding for
  menu words (Play/Spill, Back/Tilbake, Settings/Innstillinger, …). Flavour —
  the shopkeeper's patter, the sound words, the verdict lines — is where the
  voice lives.

### 3.2 Save (S owns `js/save.js`)

```js
import { save, commit } from './save.js';
// save = {
//   funds: number,                         // starts at 150
//   tools: { [toolId]: tier },             // 0 or missing = the starting kit
//   items: { [itemId]: count },            // consumables carried
//   jobs:  { [jobId]: { done: true, best: secondsLeft } },
// }
commit();   // write it; every read/write in try/catch, non-finite rejected on load
```

Keys: `heist.save.v1`, `heist.vol.music.v1`, `heist.vol.sfx.v1`,
`heist.muted.v1`. Never rename them (hub §6).

### 3.3 Sound (S owns `js/audio.js`)

```js
import { sfx } from './audio.js';
sfx(name, opts?)   // never throws, does nothing before the first gesture
```

Names: `tick` (dial passing a number; `{ rate }`), `click` (a true gate;
`{ strength: 0..1 }`), `pin` (a pin sets), `drop` (pins fall), `beep`
(keypad), `buzz` (wrong), `chime` (right), `snip` (wire cut), `clunk` (lock
opens), `coins` (money), `siren` (S only), `busted` (S only), `drill`,
`smoke`, `donut`, `ui` (a button).

v1 synthesises these at runtime as placeholders — the lock clicks track live
dial positions, which is the case runtime audio exists for (hub §9); the rest
are to be composed in Sonic Pi later behind the same names. No music in v1;
the MUSIC slider exists, persists, and its hint line says so.

### 3.4 Art (A owns `js/art.js`)

Every lane draws through these so the game looks like one book. All
coordinates are CSS pixels; the caller has already scaled for DPR.

```js
import * as art from './art.js';

art.PAL            // { ink, paper, night, navy, mustard, cream, steel, steelDark,
                   //   brass, red, blue, green, amber, skin, shadow, ... } named colours
art.FONT           // the comic lettering stack, system fonts only (no web fonts, hub §1)
art.LINE           // the standard ink width (px) at 1x; outlines use it

art.ink(ctx, width = art.LINE)                    // stroke = ink, round joins/caps
art.panel(ctx, x, y, w, h, { fill, r, shadow })   // ink-bordered comic panel with offset drop shadow
art.halftone(ctx, x, y, w, h, { color, spacing, angle, from, to })  // dot shading, fading from→to (0..1 radius)
art.metal(ctx, x, y, w, h, { r, tone })           // brushed steel face (tone 'steel'|'brass'|'dark')
art.burst(ctx, x, y, text, { size, fill, rot, life })   // starburst sound word; life 0..1 scales it in/out
art.caption(ctx, x, y, text, { size, align, fill, stroke })  // outlined comic lettering
art.bolt(ctx, x, y, r)                            // a rivet / screw head

art.drawVenue(ctx, rect, venueId, now, alarm)     // the building behind the lock; alarm 0..1 brings in red/blue wash
art.drawPoliceMeter(ctx, rect, frac, now, jolt)   // road strip: car at frac 0 (far) → 1 (arrived); jolt 0..1 shakes it
art.drawThief(ctx, x, y, size, pose, now)         // pose: 'idle' | 'work' | 'cheer' | 'busted'
art.drawShopkeeper(ctx, rect, now, mood)          // mood: 'idle' | 'happy' | 'skeptical'
art.drawItem(ctx, id, x, y, size, tier)           // icon for any tool or item id in §4 (centred at x,y)
art.drawCity(ctx, rect, now)                      // the start screen's night skyline
art.drawThiefTop(ctx, x, y, size, angle, now, moving)  // the thief seen from above, for traps
```

Settled during the build:

- `caption` — `y` is the vertical **centre** of the text unless the caller
  passes `baseline: 'alphabetic'` (`heist.js` does, it lays text out from
  the baseline).
- `burst` — `life` is progress 0..1: pops in over the first 30%, then holds.
  A caller that wants it to shrink back out passes a rising-then-falling
  envelope, as `js/puzzles/index.js` does.
- `drawThief` — `(x, y)` is the centre, `size` about the full height.
  `drawThiefTop` — `(x, y)` the centre, `size` the shoulder width, `angle`
  as `atan2`.
- Added beyond the list: `floor(ctx, x, y, w, h, { tone, cell, shade, border })`
  for the trap rooms, `bubble(ctx, x, y, w, h, tx, ty, { fill })`,
  `font(size, weight)`, `textWidth(ctx, text, size)`, `rrect(...)`.
- One "KA-CHUNK!" per opened lock, and it is the shell's open beat: the
  puzzles do not draw their own.

`venueId` is one of `kiosk`, `pawnshop`, `jeweller`, `casino`, `bank`,
`vault`. `rect` is `{ x, y, w, h }`.

**CSS** (A owns `css/style.css`) defines the tokens as custom properties on
`:root` — `--ink`, `--paper`, `--night`, `--navy`, `--mustard`, `--cream`,
`--red`, `--blue`, `--green`, `--line`, `--font`, `--radius`,
`--shadow` (the offset comic shadow) — and the shared components every
screen is built from. Markup uses only this vocabulary:

| class / id | what |
| --- | --- |
| `.screen` | a full-viewport DOM screen over the canvas; `[hidden]` hides |
| `.card` | a comic panel (ink border, offset shadow) holding a column |
| `.col` | the column inside a card; a grid, `justify-items: stretch` |
| `.btn` | primary button (mustard fill, ink border) |
| `.btn.ghost` | secondary button (outline) |
| `.btn.exit` | the back-to-arcade button: ghost, back glyph, sentence case, last, extra space above |
| `.btn-row` | a row of equal peers (`flex: 1 1 0`) |
| `.wordmark` | the HEIST title lettering |
| `.tag` | a one-line subtitle / hint |
| `.funds` | the money plate (coin + number) |
| `#corner`, `.icon-button` | the three corner plates (hub §2 glyphs) |
| `.vol-row`, `.lang-row`, `.seg`, `.seg-btn`, `.flag` | settings rows |
| `.hud`, `.hud-items`, `.item-btn`, `.count` | in-run DOM HUD (consumables along the bottom) |
| `.jobs`, `.job`, `.job.locked`, `.job.done` | the job board grid and its cards |
| `.update` | the UPDATE READY button |
| `.toast` | a short comic caption box |

The shop (K) styles its own internals in `css/shop.css` **using only the
tokens and these components** — no new colours, no new fonts. If the shop
needs a token that does not exist, it reports it rather than inventing one.

---

## 4. Tools and gadgets (E owns `js/tools.js`)

Two kinds of thing are sold. **Tools** are permanent and come in tiers;
tier 0 is the starting kit. **Gadgets** are one-shot consumables carried into
a run.

```js
import { TOOLS, ITEMS, modsFor, toolTier } from './tools.js';
TOOLS = [{ id, puzzle /* 'dial'|'pins'|'keypad'|'wires'|null */, tiers: [
           { price, nameKey, perkKey }   // tiers[0] is tier 1; length 3
         ] }]
ITEMS = [{ id, price, max, effect, nameKey, descKey }]
modsFor(save) -> MODS      // always fully populated, defaults when nothing owned
toolTier(save, id) -> 0..3
```

### The tools, and exactly what each tier does

P implements these behaviours; E writes the names, perks and prices. Neither
changes the table without changing this file.

| id | puzzle | tier 0 (kit) | tier 1 | tier 2 | tier 3 |
| --- | --- | --- | --- | --- | --- |
| `stethoscope` | dial | bare ear: a faint click exactly on each gate number | **Stethoscope**: the click is loud and the dial ripples on it | **Electronic stethoscope**: the dial glows warm within 2 numbers of a gate, hot on it | **Safe sense**: gates you have found are written on the notepad for you |
| `picks` | pins | **Hairpin**: narrow shear line, pins overset easily | **Pick set**: shear line twice as wide | **Pro set**: a pin glints when it sits at the shear line | **Pick gun**: the binding pin is marked, so you always know which is next |
| `powder` | keypad | none: just the feedback lights after a guess | **Fingerprint powder**: the keys in the code are smudged | **UV torch**: smudges show wear, most worn = pressed first | **Code reader**: one digit of the code is shown in place |
| `tester` | wires | none: trace the wires by eye | **Wire tester**: tap a terminal to light its whole wire for a moment | **Colour-coded**: no two wires share a colour | **Trace scope**: the next wire to cut pulses |
| `sneakers` | null | — | heat ×0.75 | heat ×0.5 | heat ×0.3 |
| `scanner` | null | — | police take +10% longer | +20% | +35% |
| `goggles` | lasers | beams faint, and blink out of sight for a moment every few seconds | **Night goggles**: beams always clearly visible | **Thermal goggles**: a ghost shows where each moving beam will be in 1 s | **Laser mirror**: the first beam you touch in a room is reflected harmlessly |
| `jammer` | cameras | camera cones drawn soft, edges vague | **Camera map**: cones drawn with exact hard edges | **Signal jammer**: cameras sweep 25% slower | **Loop tape**: tap a camera to freeze it for 3 s, once per room |
| `chalk` | tiles | the safe path is flashed once, briefly | **Chalk**: the path is shown twice as long | **Replay**: one extra showing per room, on demand | **Chalk marks**: the first three safe tiles stay marked |

```js
MODS = {
  dial: 0..3, pins: 0..3, keypad: 0..3, wires: 0..3,  // the tool tier for that puzzle
  lasers: 0..3, cameras: 0..3, tiles: 0..3,            // ...and for that trap
  heatScale: number,    // 1 at tier 0
  timeScale: number,    // multiplies the job's time limit; 1 at tier 0
}
```

### The gadgets

| id | effect | what S does |
| --- | --- | --- |
| `smoke` | `{ addTime: 15 }` | smoke bomb: 15 s back on the clock |
| `donut` | `{ addTime: 30 }` | a box of donuts left on the police car's route: 30 s |
| `drill` | `{ solveLock: 4 }` | drills the current lock open in 4 s (clock keeps running); not on the last lock of a job |

`effect` is one of exactly those two shapes; S interprets them, nothing else.
A run carries at most `max` of each. Items are spent when used, not when the
run starts.

---

## 5. Jobs (E owns `js/jobs.js`)

```js
import { JOBS, payoutFor, isUnlocked } from './jobs.js';
JOBS = [{
  id: 'kiosk-1', venue: 'kiosk', nameKey: 'job.kiosk-1',
  locks: [{ kind: 'pins', difficulty: 1 }, { kind: 'lasers', difficulty: 1 }, { kind: 'dial', difficulty: 1 }],
                       // a "lock" is any challenge: a puzzle kind (§6) or a trap kind (§6a)
  time: 90,            // seconds, before mods.timeScale
  heatSeconds: 6,      // a severity-1 mistake costs this many seconds
  payout: 120,         // the take
}]
payoutFor(job, secondsLeft, replay) -> number   // take + time bonus; a replay of a done job pays less
isUnlocked(job, save) -> boolean                // in order: a job opens when the previous one is done
splitPayout(job, secondsLeft, replay) -> { take, bonus, total }   // the getaway card's lines
```

The last challenge of every job is a lock puzzle, never a trap, so the
player always cracks the final one themselves (the drill cannot be used there).

Six venues (`kiosk`, `pawnshop`, `jeweller`, `casino`, `bank`, `vault`), two
or three jobs each, about 15 in all. Difficulty is a number 1–10 per lock.
Balance target: a player who buys nothing can finish the first two venues; the
bank needs tools or real skill; the vault wants both. Starting funds are 150
and the first tool tier costs about one early job's take.

---

## 6. Puzzles (P owns `js/puzzles/*`)

```js
import { createPuzzle, KINDS } from './puzzles/index.js';
const puzzle = createPuzzle(kind, {
  difficulty,      // 1..10, may be fractional
  tier,            // MODS[kind], 0..3 — implement the table in §4
  rng,             // () => [0,1), seeded per attempt
  sfx,             // §3.3
  events: {
    mistake(severity = 1),   // S turns this into heat
    progress(fraction),      // 0..1, optional, for the HUD
    solved(),                // call once; S plays the open beat and moves on
  },
});

puzzle.update(dt)                // seconds, fixed step 1/60, only while running
puzzle.draw(ctx, rect, now)      // draw inside rect {x,y,w,h}, CSS px; now = seconds
puzzle.pointerDown(p)            // p = { x, y, id } in canvas CSS px
puzzle.pointerMove(p)
puzzle.pointerUp(p)
puzzle.key(e) -> boolean         // keydown (never Escape); true if consumed
puzzle.hint() -> string          // a one-line hint already through t(), shown under the lock
puzzle.forceSolve()              // the drill: open now, with a flourish
puzzle.destroy()
```

The four kinds:

- **`dial`** — the safe. A combination dial 0–99; turn it by dragging round
  it (and arrow keys). The combination is 2–4 numbers (more with difficulty),
  alternating direction. Each gate gives a click as the dial passes it (§4
  table for how loud and how early). Stop on the number and reverse to set it;
  the handle is tried when the last number is set — a wrong combination is a
  mistake and resets the dial.
- **`pins`** — the pin tumbler door lock. 3–7 pins; one binds at a time, in
  an order hidden from the player. Push a pin up to the shear line and
  release to set it. Push the binding pin past the line, or push a pin that
  is not binding too hard, and it oversets: a mistake, and pins drop.
- **`keypad`** — the vault keypad. A 3–5 digit code; enter a guess, get
  lights per digit (green right place, amber in the code elsewhere, dark not
  in it). Each wrong guess is a mistake. Keyboard digits work.
- **`wires`** — the alarm box. 3–7 wires run tangled from numbered
  terminals on the left to lettered ones on the right. The display lights
  letters one at a time; cut the wire that **ends** at the lit letter. A wrong
  cut is a mistake of severity 2.

Every puzzle must be playable with pointer alone (tablet) and with keyboard
alone, legible at a rect of 300×300, and drawn in the art lane's style
through `art.*` — ink outlines, flat fills, halftone shading, sound words via
`art.burst`. No per-frame allocation in `draw` (hub §10).

---

## 6a. Traps (T owns `js/traps/*`)

Alarms and traps are the other half of a heist: between the locks you have
to get *through* the building. A trap is a challenge in exactly the same slot
as a lock — same options, same object, same events — so the shell and the
job list treat them alike.

```js
import { createTrap, TRAP_KINDS } from './traps/index.js';   // TRAP_KINDS = ['lasers','cameras','tiles']
const trap = createTrap(kind, opts);   // opts and the returned object exactly as §6
```

The shell dispatches on kind: `TRAP_KINDS.includes(kind) ? createTrap : createPuzzle`.
`tier` is `MODS[kind]`. Traps are drawn top-down (a floor plan in the comic
style); the thief is `art.drawThiefTop`.

- **`lasers`** — the laser hall. Steer the thief (drag to move / arrow keys)
  across a room from the door to the far exit through static, blinking and
  sweeping beams. Touching a beam is a mistake of severity 2 and puts you back
  at the door. Difficulty: more beams, more movement, faster.
- **`cameras`** — the camera corridor. Hop between pieces of cover (tap the
  next cover spot, or arrow keys) while sweeping security cameras look away;
  caught in a cone → mistake, back to the last cover. Timing.
- **`tiles`** — the pressure floor. A grid of floor tiles; the safe path is
  flashed, then you walk it from memory (tap adjacent tiles / arrow keys). A
  wrong tile is a mistake and the path flashes again. Memory.

Same rules as §6: pointer and keyboard both, legible at 300×300, `art.*`
style, no per-frame allocation, `pz.`-style words under the `trap.` prefix.

---

## 7. The shop (K owns `js/shop.js`, `css/shop.css`)

```js
import { mountShop, showShop, hideShop } from './shop.js';
mountShop(section, { onBack })   // once; section is the empty <section id="shop" class="screen">
showShop()                        // refresh from save and show
hideShop()
```

The shop is a back-room counter: the shopkeeper on a canvas (`art.drawShopkeeper`)
with a speech bubble of patter that reacts to what you do, the funds, and the
wares — each tool with its current tier, the next tier's perk and price, and
each gadget with how many you carry. Buying spends `save.funds`, writes
`save.tools` / `save.items`, `commit()`s, plays `sfx('coins')`. A thing you
cannot afford stays visible, priced, and disabled with a reason, never hidden.
The screen's title is plainly **Shop** / **Butikk**; its way out is **Back**
/ **Tilbake** (it is opened from the start screen or the job board and goes
back there — `onBack` decides). Escape is that Back (S routes it). It must not
scroll on a landscape phone (hub §2) and must work in both languages.

---

## 8. The shell (S)

- `index.html` holds every screen as markup (start, jobs, run HUD, menu,
  getaway, busted, an empty `#shop`), the corner, the crash bar, the
  pre-paint `<html lang>` script, `touch-guard.js` classic and first,
  `../arcade/exit.js` classic, deferred and `data-handled`.
- `main.js` boots, routes screens, owns Escape (hub §2's full table: text
  field, confirm, sub-panel Back, run → menu, menu → close, end card → its
  back, job board/shop → Back, start → arcade; auto-repeat ignored), the
  corner (menu, mute, fullscreen), the one menu panel (Resume / Restart job /
  Give up in a run; MUSIC, EFFECTS, language row, back to arcade on both
  faces), and the job board.
- `heist.js` runs a job: canvas sizing (DPR ≤ 2), the fixed-step loop
  (clamped dt, capped substeps), the lock sequence, the clock and heat, the
  police meter and siren, gadgets, the open beat between locks, getaway and
  busted. It forwards pointer and key input to the current puzzle.
- The service worker is opt-in update, `heist-` prefixed cache and cleanup,
  `cache: 'reload'` precache, `GET_VERSION`, VERSION literal in `sw.js`
  (copy `minimaze/sw.js` and `minimaze/js/update.js`).
