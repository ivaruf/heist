/*
 * main.js — HEIST's shell: boot, the screens, the corner, the one menu
 * panel, the job board, and Escape (DESIGN.md §8).
 *
 * THE SCREENS (DESIGN.md §1), one showing at a time, by `screen`:
 *   start    wordmark, funds, Play, Shop, Update ready, back to arcade last;
 *            the city at night drawn behind by heist.js
 *   jobs     the job board: a card per job, Shop, Back
 *   shop     js/shop.js's own screen (mountShop once; showShop/hideShop)
 *   run      the canvas and the gadget HUD, owned by js/heist.js
 *   getaway  the take, the time bonus, the new funds
 *   busted   the thief in cuffs and a gentle line; nothing lost but gadgets
 * The MENU PANEL (#menu) is not a screen but an overlay on whichever one is
 * up, with two faces (hub §2, "The corner"): in a run it is Pause — Resume,
 * Restart, Give up — and it stops the clock, because HEIST is solo and always
 * yours to pause; anywhere else it is Settings with a Back. Both faces carry
 * MUSIC, EFFECTS, the language row and the way back to the arcade, last.
 *
 * GIVE UP is asked inside the panel (#giveup-confirm), never with confirm():
 * the viewer may refuse dialogs, and a question in the game's own look is a
 * question the player actually reads. Escape answers it "no".
 *
 * ESCAPE GOES ONE STEP BACK (hub §2), decided in escape() and nowhere else:
 *   a text field has focus     -> leave the field (HEIST has none today)
 *   the give-up question is up -> no
 *   menu open, Settings face   -> its Back
 *   menu open, Pause face      -> close it; the run carries on
 *   a run in play              -> open the menu, paused
 *   getaway / busted card      -> the job board, the cards' own way back
 *   shop                       -> its Back, wherever it was opened from
 *   job board                  -> its Back, the start screen
 *   start screen               -> the back-to-arcade button, only if shown
 * The listener is on window's CAPTURE phase and stops the event there, so
 * neither heist.js's key forwarding nor the shop nor a puzzle ever sees an
 * Escape; preventDefault for the browser's own; auto-repeat is eaten, so a
 * held key cannot walk three screens and out of the game.
 *
 * THE CORNER: menu (here), sound (here: a live mute, one tap, nothing opened,
 * nothing paused), fullscreen (js/screen.js, self-contained). The menu plate
 * opens the panel's face for where you are; pressed again it closes it.
 *
 * THE WAY OUT is wired as in minimaze/js/ui.js: shown only once
 * window.ArcadeExit has turned up and says there is somewhere to go, worded
 * by verb() so the label never promises what quit() will not do.
 *
 * LANGUAGE IS LIVE: setLang repaints [data-i18n]; everything built from data
 * (the board, the funds, the getaway lines, the mute and exit labels) is
 * repainted from `arcade:lang` below. Nothing is shown, hidden or paused by a
 * switch, so a menu that was open stays open over the same paused lock.
 */

import { t, setLang, paintStatic, money } from './i18n.js';
import { save } from './save.js';
import { sfx, volume, setVolume, isMuted, setMuted } from './audio.js';
import * as art from './art.js';
import { JOBS, isUnlocked } from './jobs.js';
import { modsFor } from './tools.js';
import { mountShop, showShop, hideShop } from './shop.js';
import { createHeist } from './heist.js';

const $ = (id) => document.getElementById(id);

const screens = {
  start: $('start'),
  jobs: $('jobs'),
  getaway: $('getaway'),
  busted: $('busted'),
};
const menu = $('menu');

let screen = 'start';
let shopShown = false;
let shopFrom = 'start'; // where the shop's Back goes
let menuFace = null; // null (closed) | 'pause' | 'settings'
let confirming = false;
let lastJob = null;
let lastResult = null; // the getaway card's numbers, kept for a language switch

// ---------------------------------------------------------------- the run

const heist = createHeist({
  canvas: $('view'),
  hud: $('hud'),
  hudItems: $('hud-items'),
  corner: $('corner'),
  onGetaway(result) {
    lastResult = result;
    paintGetaway();
    show('getaway');
  },
  onBusted() {
    show('busted');
  },
});

function startJob(job) {
  lastJob = job;
  closeMenu(false);
  show('run');
  heist.start(job);
}

// ---------------------------------------------------------------- routing

function show(name) {
  screen = name;
  for (const [k, el] of Object.entries(screens)) el.hidden = k !== name;
  if (name === 'shop') {
    shopShown = true;
    showShop();
  } else if (shopShown) {
    shopShown = false;
    hideShop();
  }
  // Leaving an end card (or anything that is not the run) drops the finished
  // run, so the city comes back behind the menus.
  if (name !== 'run' && name !== 'getaway' && name !== 'busted' && heist.job()) heist.abort();
  heist.setCardArt(
    name === 'getaway' ? $('getaway-art') : name === 'busted' ? $('busted-art') : null,
    name === 'getaway' ? 'cheer' : 'busted',
  );
  if (name === 'start' || name === 'jobs') paintFunds();
  if (name === 'jobs') buildJobs();
  const el = screens[name];
  const first = el && el.querySelector('button:not([hidden]):not([disabled])');
  if (first) first.focus({ preventScroll: true });
}

function paintFunds() {
  const m = money(save.funds);
  $('start-funds').textContent = m;
  $('jobs-funds').textContent = m;
  $('start-funds').setAttribute('aria-label', t('ui.funds', m));
  $('jobs-funds').setAttribute('aria-label', t('ui.funds', m));
}

function paintGetaway() {
  if (!lastResult) return;
  $('getaway-take').textContent = t('run.takeLine', money(lastResult.take));
  $('getaway-bonus').textContent = t('run.bonus', money(lastResult.bonus));
  $('getaway-replay').hidden = !lastResult.replay;
  $('getaway-funds').textContent = t('run.total', money(save.funds));
}

// ---------------------------------------------------------------- the job board

const VENUE_W = 160;
const VENUE_H = 90;
const venueRect = { x: 0, y: 0, w: VENUE_W, h: VENUE_H };

function buildJobs() {
  const list = $('job-list');
  const focused = document.activeElement;
  const refocus = focused && focused.parentElement === list ? [...list.children].indexOf(focused) : -1;
  list.textContent = '';
  const mods = modsFor(save);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  for (const job of JOBS) {
    const open = isUnlocked(job, save);
    const rec = save.jobs[job.id];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'job' + (rec && rec.done ? ' done' : '') + (open ? '' : ' locked');
    b.disabled = !open;

    const pic = document.createElement('canvas');
    pic.width = Math.round(VENUE_W * dpr);
    pic.height = Math.round(VENUE_H * dpr);
    pic.setAttribute('aria-hidden', 'true');
    const pctx = pic.getContext('2d');
    pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    try {
      art.drawVenue(pctx, venueRect, job.venue, 0, 0);
    } catch (err) {
      console.warn('HEIST: could not draw venue', job.venue, err);
    }

    const name = document.createElement('strong');
    name.textContent = t(job.nameKey);
    const venue = document.createElement('small');
    venue.textContent = t(`venue.${job.venue}`);
    const facts = document.createElement('small');
    facts.textContent = [
      t('ui.locks', job.locks.length),
      t('ui.time', Math.round(job.time * mods.timeScale)),
      t('ui.payout', money(job.payout)),
    ].join(' · ');
    const status = document.createElement('small');
    status.textContent = rec && rec.done ? t('ui.done', Math.floor(rec.best)) : open ? '' : t('ui.locked');

    b.append(pic, name, venue, facts, status);
    b.addEventListener('click', () => startJob(job));
    list.appendChild(b);
  }
  if (refocus >= 0 && list.children[refocus]) list.children[refocus].focus({ preventScroll: true });
}

// ---------------------------------------------------------------- the menu panel

function paintFace() {
  const inRun = menuFace === 'pause';
  const title = $('menu-title');
  title.dataset.i18n = inRun ? 'ui.paused' : 'ui.settings';
  title.textContent = t(title.dataset.i18n);
  $('menu-tag').hidden = !inRun;
  $('menu-resume').hidden = !inRun || confirming;
  $('menu-restart').hidden = !inRun || confirming;
  $('menu-giveup').hidden = !inRun || confirming;
  $('giveup-confirm').hidden = !confirming;
  $('menu-back').hidden = inRun;
}

function openMenu(face) {
  menuFace = face;
  confirming = false;
  if (face === 'pause') heist.pause();
  paintFace();
  menu.hidden = false;
  const first = menu.querySelector('button:not([hidden])');
  if (first) first.focus({ preventScroll: true });
}

/** Close the panel; resume the run when it was the Pause face. */
function closeMenu(resume = true) {
  if (!menuFace) return;
  const wasPause = menuFace === 'pause';
  menuFace = null;
  confirming = false;
  menu.hidden = true;
  if (wasPause && resume) heist.resume();
  // Back to the play surface: keys go to the lock, not to a hidden button.
  const a = document.activeElement;
  if (a && menu.contains(a)) a.blur();
}

function ask(on) {
  confirming = on;
  paintFace();
  (on ? $('giveup-no') : $('menu-giveup')).focus({ preventScroll: true });
}

$('menu-resume').addEventListener('click', () => closeMenu());
$('menu-restart').addEventListener('click', () => {
  const job = heist.job();
  if (job) startJob(job);
});
$('menu-giveup').addEventListener('click', () => ask(true));
$('giveup-no').addEventListener('click', () => ask(false));
$('giveup-yes').addEventListener('click', () => {
  closeMenu(false);
  heist.abort();
  show('jobs');
});
$('menu-back').addEventListener('click', () => closeMenu());

// The menu plate: the panel's face for where you are, or closed again.
$('menu-btn').addEventListener('click', () => {
  if (menuFace) closeMenu();
  else openMenu(screen === 'run' && heist.running() ? 'pause' : 'settings');
});

// A tab put away mid-job comes back paused, with the menu up.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && screen === 'run' && heist.running() && !menuFace) openMenu('pause');
});

// ---------------------------------------------------------------- the screens' buttons

$('start-play').addEventListener('click', () => show('jobs'));
$('start-shop').addEventListener('click', () => {
  shopFrom = 'start';
  show('shop');
});
$('jobs-shop').addEventListener('click', () => {
  shopFrom = 'jobs';
  show('shop');
});
$('jobs-back').addEventListener('click', () => show('start'));
$('getaway-jobs').addEventListener('click', () => show('jobs'));
$('getaway-shop').addEventListener('click', () => {
  shopFrom = 'jobs';
  show('shop');
});
$('busted-again').addEventListener('click', () => lastJob && startJob(lastJob));
$('busted-jobs').addEventListener('click', () => show('jobs'));

// A small 'ui' click for the shell's own buttons. The shop plays its own.
for (const el of [...Object.values(screens), menu]) {
  el.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('button')) sfx('ui');
  });
}

mountShop($('shop'), { onBack: () => show(shopFrom) });

// ---------------------------------------------------------------- sound

const soundBtn = $('sound-btn');
function paintMute() {
  const m = isMuted();
  const label = t(m ? 'ui.unmute' : 'ui.mute');
  soundBtn.setAttribute('aria-pressed', String(m));
  soundBtn.setAttribute('aria-label', label);
  soundBtn.title = label;
}
soundBtn.addEventListener('click', () => {
  setMuted(!isMuted());
  paintMute();
});
for (const bus of ['music', 'sfx']) {
  const input = $(`vol-${bus}`);
  const out = $(`vol-${bus}-out`);
  const v = Math.round(volume(bus) * 100);
  input.value = String(v);
  out.value = String(v);
  input.addEventListener('input', () => {
    out.value = input.value;
    setVolume(bus, Number(input.value) / 100); // also lifts the mute, and auditions
    paintMute();
  });
}

// ---------------------------------------------------------------- language

for (const b of document.querySelectorAll('[data-lang]')) {
  b.addEventListener('click', () => setLang(b.dataset.lang));
}
document.addEventListener('arcade:lang', () => {
  paintMute();
  paintExit();
  paintFunds();
  paintGetaway();
  if (screen === 'jobs') buildJobs();
});

// ---------------------------------------------------------------- the way out

const exitBtns = [$('start-exit'), $('menu-exit')];
let exitApi = null;
let exitRefused = false;

function paintExit() {
  if (!exitApi) return;
  let label;
  try {
    label = exitRefused ? t('ui.exit.refused') : exitApi.verb({ arcade: t('ui.exit.arcade'), app: t('ui.exit.close') });
  } catch {
    label = t('ui.exit.arcade');
  }
  for (const b of exitBtns) b.querySelector('span').textContent = label;
}

function quit() {
  if (!exitApi || exitRefused) return;
  Promise.resolve(exitApi.quit())
    .then((how) => {
      // 'refused': the browser would not close a window it did not open.
      if (how !== 'refused') return;
      exitRefused = true;
      for (const b of exitBtns) b.disabled = true;
      paintExit();
    })
    .catch(() => {});
}
for (const b of exitBtns) b.addEventListener('click', quit);

let exitWired = false;
function wireExit() {
  if (exitWired) return;
  const exit = window.ArcadeExit;
  if (!exit) return;
  exitWired = true;
  let shown = false;
  try {
    shown = exit.framed() || exit.standalone();
  } catch {
    shown = false;
  }
  if (!shown) return;
  exitApi = exit;
  for (const b of exitBtns) b.hidden = false;
  paintExit();
}
// exit.js is a deferred classic script from another repo: usually here
// already, perhaps late, perhaps never (a 404 when served on its own).
wireExit();
window.addEventListener('load', wireExit);
setTimeout(wireExit, 1500);

// ---------------------------------------------------------------- Escape

function escape() {
  const a = document.activeElement;
  if (a && a.matches && a.matches('textarea, [contenteditable="true"], input:not([type="range"]):not([type="button"])')) {
    a.blur();
    return;
  }
  if (menuFace) {
    if (confirming) ask(false);
    else closeMenu();
    return;
  }
  switch (screen) {
    case 'run':
      if (heist.running()) openMenu('pause');
      return;
    case 'getaway':
    case 'busted':
      show('jobs');
      return;
    case 'shop':
      show(shopFrom);
      return;
    case 'jobs':
      show('start');
      return;
    case 'start':
      if (exitApi && !exitRefused) quit();
      return;
  }
}
window.addEventListener(
  'keydown',
  (e) => {
    if (e.key !== 'Escape' && e.code !== 'Escape') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!e.repeat) escape();
  },
  true,
);

// ---------------------------------------------------------------- boot

// Every lane registered its words at module load (addStrings), which has
// all happened by now: paint the static text once, in the current language.
paintStatic();
paintMute();
show('start');
