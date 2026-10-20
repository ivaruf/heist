# HEIST — Crack it before the cops come.

*Knekk den før politiet kommer.*

A comic-book safecracking game for the arcade at
`https://ivaruf.github.io/heist/`. Pick a job, crack its locks and slip past
its traps before the police car reaches the building, then spend the take on
better tools in the shop. Busted costs you nothing but the gadgets you used.

Free, no ads, no accounts, no tracking. Everything is kept in your own
browser's `localStorage`.

## Playing

Pointer (mouse, touch) or keyboard. Escape goes one step back; in a job it
opens the menu, which pauses the clock. Norwegian (bokmål) first, English
one tap away in the menu.

## Running it

Plain ES modules, no build step, no dependencies. Serve the directory over
HTTP, for example:

```sh
python3 -m http.server
```

and open `http://localhost:8000/`. It does not work from `file://`.

## Layout

See `DESIGN.md` for the design and the multi-agent contract: which lane owns
which file, and the shared APIs between them (`js/i18n.js`, `js/save.js`,
`js/audio.js`, `js/art.js`, the puzzles, the traps, tools and jobs, the
shop).

- `index.html` — every screen as markup, the corner, the crash bar
- `js/main.js` — screens, menu, job board, Escape; `js/heist.js` — a run
- `sw.js` — offline precache with an opt-in update button; bump `VERSION`
  on every release

## Storage keys

`heist.save.v1`, `heist.vol.music.v1`, `heist.vol.sfx.v1`,
`heist.muted.v1`, and the hub's shared `arcade.lang.v1`. Never rename them.

## Sound

Every cue is synthesised at runtime as a placeholder (`js/audio.js`); they are
to be replaced by Sonic Pi renders behind the same names. There is no music
yet.

## Tests

There is no automated test suite. Changes are checked with `node --check`
and played by hand.
