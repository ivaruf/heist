/*
 * shop.js — the tool shop: a back room, a counter, and a dealer who has
 * opinions about your shopping (DESIGN.md §7).
 *
 * WHAT IT IS. One DOM screen inside the shell's empty <section id="shop">.
 * Left (or top, on a portrait phone) is the counter: the panel title, the
 * shopkeeper drawn live on a canvas by art.drawShopkeeper, his speech bubble,
 * the funds plate and Back. Right (or below) are the wares: twelve tiles in
 * one grid, grouped under four plain headings — lock tools, trap tools, tools
 * that help everywhere, and gadgets.
 *
 * WHERE THE VOICE LIVES. The menu words are the hub glossary's and nothing
 * else: "Butikk"/"Shop", "Tilbake"/"Back", "Kjøp"/"Buy". All the character is
 * in the shopkeeper's patter — a greeting when you come in, a line when you
 * buy, a sniff when you can't afford it or already own the best, and an idle
 * remark now and then while you browse. The patter is stored as a key and its
 * arguments, never as a rendered sentence, so a language switch re-says the
 * same line in the other language instead of leaving a stale one behind.
 *
 * UNAFFORDABLE IS VISIBLE (hub §1, DESIGN §7). A tile you cannot buy keeps its
 * price and says how much is missing, right on its button. The button is
 * aria-disabled rather than disabled on purpose: a disabled button swallows
 * the tap, and a child who taps "120 kr — need 40 more" deserves the
 * shopkeeper's answer ("do another job and come back") rather than silence.
 * The tap changes nothing but the patter.
 *
 * THE ONE GRID (hub §2 "anything that is one logical group is laid out as
 * one"). Every tile is the same shape — icon | words | buy button — and every
 * buy button is the same fixed width, so in a column of tiles the buttons
 * share an edge and the words share a gutter. The four groups sit in one
 * grid with their headings spanning it, so a tool tile and a gadget tile line
 * up as well. The tiles are peers (things you choose between) and get equal
 * widths; the grid stretches each row of tiles to one height.
 *
 * NEVER SCROLLS AWAY. The page itself does not scroll: funds and Back live in
 * the counter, which never moves, and only the wares column scrolls inside
 * itself when twelve tiles do not fit — the integrator's ruling for a
 * landscape phone. The section keeps overflow:auto as a safety net only.
 *
 * ANIMATION. The shopkeeper canvas runs a requestAnimationFrame loop only
 * while the shop is shown; hideShop stops it. Canvases are sized by
 * devicePixelRatio capped at 2 (hub §10), from a ResizeObserver rather than
 * per frame, and the per-frame path allocates nothing.
 */

import * as art from './art.js';
import { t, addStrings, money } from './i18n.js';
import { save, commit } from './save.js';
import { sfx } from './audio.js';
import { TOOLS, ITEMS, toolTier } from './tools.js';

// ---------------------------------------------------------------- the words

// Patter pools: how many lines each pool has. A pool's lines are keys
// `shop.<pool>.<i>`; say() picks one, never the same twice running.
const POOLS = { hi: 3, buy: 4, poor: 3, max: 2, full: 1, idle: 6 };

addStrings({
  nb: {
    'shop.title': 'Butikk',
    'shop.back': 'Tilbake',
    'shop.buy': 'Kjøp',
    'shop.maxed': 'Maks',
    'shop.full': 'Fullt',
    'shop.short': (s) => `mangler ${s}`,
    'shop.group.locks': 'Til låser',
    'shop.group.traps': 'Til feller',
    'shop.group.general': 'Til alt',
    'shop.group.items': 'Dingser',
    'shop.kit': 'Startutstyr',
    'shop.now': (name) => `Nå: ${name}`,
    'shop.top': 'Det beste som finnes',
    'shop.tier': (n, m) => `Nivå ${n} av ${m}`,
    'shop.carry': (n, m) => `Du har ${n} av ${m}`,
    'shop.funds': (s) => `Penger: ${s}`,
    'shop.keeper': 'Butikkeieren bak disken',
    'shop.aria.buy': (name, price) => `Kjøp ${name} for ${price}`,
    'shop.aria.short': (name, price, s) => `${name} koster ${price}. Du mangler ${s}.`,
    'shop.aria.maxed': (name) => `${name}: høyeste nivå`,
    'shop.aria.full': (name) => `${name}: lommene er fulle`,

    'shop.hi.0': 'Psst! Kom inn, kom inn. Ingen så deg, vel?',
    'shop.hi.1': 'Å, min beste kunde! Hva skal det være i dag?',
    'shop.hi.2': 'Velkommen til bakrommet. Ikke si det til noen.',
    'shop.buy.0': 'Kjempebra kjøp! Bruk det lurt.',
    'shop.buy.1': 'Ha-ha! Nå blir låsene redde for deg.',
    'shop.buy.2': 'Pengene i skuffen, varen i lomma. Sånn liker jeg det.',
    'shop.buy.3': 'Ikke si til politiet hvor du har det fra!',
    'shop.poor.0': (s) => `Hmm. Du mangler ${s}. Ta en jobb til og kom tilbake!`,
    'shop.poor.1': (s) => `Her får du ikke låne, kompis. Det mangler ${s}.`,
    'shop.poor.2': (s) => `Lommene dine er litt lette. ${s} til, så er vi enige.`,
    'shop.max.0': 'Du har allerede det beste jeg har. Bedre finnes ikke!',
    'shop.max.1': 'Mer enn det kan jeg ikke selge deg. Selv jeg har grenser.',
    'shop.full.0': (n) => `Du kan bare bære ${n} av gangen. Lommene dine er fulle!`,
    'shop.idle.0': 'Psst … har du hørt om banken i Storgata? Mye gull der.',
    'shop.idle.1': 'En god tyv øver på de lette jobbene først.',
    'shop.idle.2': 'Smultringer i veien? Politiet stopper ALLTID for smultringer.',
    'shop.idle.3': 'Lytt nøye til safen. Den klikker når du er nær.',
    'shop.idle.4': 'Dette her? Nei da, jeg bare fant det. Ærlig talt.',
    'shop.idle.5': 'Ta den tiden du trenger. Butikken min stenger aldri.',
  },
  en: {
    'shop.title': 'Shop',
    'shop.back': 'Back',
    'shop.buy': 'Buy',
    'shop.maxed': 'Maxed',
    'shop.full': 'Full',
    'shop.short': (s) => `need ${s} more`,
    'shop.group.locks': 'Lock tools',
    'shop.group.traps': 'Trap tools',
    'shop.group.general': 'For everything',
    'shop.group.items': 'Gadgets',
    'shop.kit': 'Starting kit',
    'shop.now': (name) => `Now: ${name}`,
    'shop.top': 'The best there is',
    'shop.tier': (n, m) => `Level ${n} of ${m}`,
    'shop.carry': (n, m) => `You carry ${n} of ${m}`,
    'shop.funds': (s) => `Money: ${s}`,
    'shop.keeper': 'The shopkeeper behind the counter',
    'shop.aria.buy': (name, price) => `Buy ${name} for ${price}`,
    'shop.aria.short': (name, price, s) => `${name} costs ${price}. You need ${s} more.`,
    'shop.aria.maxed': (name) => `${name}: top level`,
    'shop.aria.full': (name) => `${name}: pockets full`,

    'shop.hi.0': 'Psst! Come in, come in. Nobody saw you, right?',
    'shop.hi.1': "Ah, my best customer! What'll it be today?",
    'shop.hi.2': "Welcome to the back room. Don't tell anyone.",
    'shop.buy.0': 'Great buy! Use it wisely.',
    'shop.buy.1': 'Ha-ha! Now the locks will be scared of you.',
    'shop.buy.2': 'Money in the drawer, goods in your pocket. Just how I like it.',
    'shop.buy.3': "Don't tell the cops where you got it!",
    'shop.poor.0': (s) => `Hmm. You're ${s} short. Do another job and come back!`,
    'shop.poor.1': (s) => `No lending here, pal. You're ${s} short.`,
    'shop.poor.2': (s) => `Your pockets are a bit light. ${s} more and it's a deal.`,
    'shop.max.0': "You already have the best I've got. There is no better!",
    'shop.max.1': "I can't sell you more than that. Even I have limits.",
    'shop.full.0': (n) => `You can only carry ${n} at a time. Your pockets are full!`,
    'shop.idle.0': 'Psst… heard about the bank on High Street? Lots of gold in there.',
    'shop.idle.1': 'A good thief practises on the easy jobs first.',
    'shop.idle.2': 'Donuts on the road? The cops ALWAYS stop for donuts.',
    'shop.idle.3': "Listen closely to the safe. It clicks when you're close.",
    'shop.idle.4': 'This? Oh, I just found it. Honest.',
    'shop.idle.5': 'Take all the time you need. My shop never closes.',
  },
});

// ------------------------------------------------------------- the catalogue

// Which heading a tool sits under. The four lock puzzles of §6; any other
// non-null kind is a trap (lasers, cameras, tiles), so a fourth trap added to
// tools.js lands in the right group without touching this file.
const LOCK_KINDS = new Set(['dial', 'pins', 'keypad', 'wires']);
const groupOf = (tool) => (!tool.puzzle ? 'general' : LOCK_KINDS.has(tool.puzzle) ? 'locks' : 'traps');
const GROUPS = ['locks', 'traps', 'general'];

// ------------------------------------------------------------------- state

const MAX_TIER = 3;
const MOOD_HOLD = 2.4; // seconds a happy/skeptical face is held after a reaction
const IDLE_EVERY = 15; // seconds of quiet before an idle remark

let root = null;
let onBackCb = null;
const ui = {}; // the counter's elements
const heads = []; // { el, key }
const rows = []; // one per ware, see buildTile

let visible = false;
let raf = 0;
let mood = 'idle';
let moodUntil = 0;
let lastTalk = 0;
// The current line as key + arguments, so a language switch can re-say it.
const line = { pool: 'hi', i: 0, args: [] };
const lastPick = {};

// The shopkeeper canvas, sized by the ResizeObserver, read by the loop.
const keeper = { ctx: null, d: 1, rect: { x: 0, y: 0, w: 0, h: 0 } };
const warned = new Set();

const nowSec = () => performance.now() / 1000;
const funds = () => {
  const f = Number(save && save.funds);
  return Number.isFinite(f) ? f : 0;
};
const itemCount = (id) => {
  const n = Number(save && save.items && save.items[id]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

// An art helper that throws must cost a picture, never the shop. Named once.
function guard(what, fn) {
  try {
    fn();
  } catch (e) {
    if (!warned.has(what)) {
      warned.add(what);
      console.warn(`shop: ${what} failed`, e);
    }
  }
}

function el(tag, cls, parent) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (parent) parent.appendChild(n);
  return n;
}

// ------------------------------------------------------------------- build

/** Build the shop inside the shell's empty section. Once. */
export function mountShop(section, { onBack } = {}) {
  if (root) return;
  root = section;
  onBackCb = onBack;
  root.setAttribute('aria-labelledby', 'shop-title');

  const wrap = el('div', 'shop-wrap', root);

  // --- the counter: title, bubble, shopkeeper, funds, Back (last).
  const counter = el('div', 'card shop-counter', wrap);
  ui.title = el('h2', 'shop-title', counter);
  ui.title.id = 'shop-title';
  ui.bubble = el('p', 'shop-bubble', counter);
  ui.bubble.setAttribute('aria-live', 'polite');
  const stage = el('div', 'shop-keeper', counter);
  ui.canvas = el('canvas', 'shop-keeper-canvas', stage);
  ui.canvas.setAttribute('role', 'img');
  keeper.ctx = ui.canvas.getContext('2d');
  ui.funds = el('div', 'funds shop-funds', counter);
  ui.back = el('button', 'btn ghost shop-back', counter);
  ui.back.type = 'button';
  ui.back.addEventListener('click', () => {
    sfx('ui');
    if (onBackCb) onBackCb();
  });

  // --- the wares: one grid, four headed groups.
  const wares = el('div', 'card shop-wares', wrap);
  const grid = el('div', 'shop-grid', wares);
  for (const g of GROUPS) {
    const tools = TOOLS.filter((tl) => groupOf(tl) === g);
    if (!tools.length) continue;
    heads.push({ el: el('h3', 'shop-group', grid), key: `shop.group.${g}` });
    for (const tool of tools) rows.push(buildTile(grid, 'tool', tool));
  }
  heads.push({ el: el('h3', 'shop-group', grid), key: 'shop.group.items' });
  for (const item of ITEMS) rows.push(buildTile(grid, 'item', item));

  // Size canvases from layout, not per frame. Fallback: window resize.
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => {
      sizeKeeper();
      drawIcons();
    }).observe(wrap);
  } else {
    window.addEventListener('resize', () => {
      sizeKeeper();
      drawIcons();
    });
  }

  // Repaint every word on a language switch, without closing anything.
  document.addEventListener('arcade:lang', paint);
}

// One tile: icon | name, perk, meta | buy. The meta line holds the tier pips
// and "Now: Hairpin" for a tool, "You carry 1 of 3" for a gadget; `.shop-count`
// is the short "1/3" a landscape phone shows instead.
function buildTile(grid, kind, def) {
  const tile = el('div', 'shop-ware', grid);
  tile.dataset.kind = kind;
  tile.dataset.id = def.id;
  const icon = el('canvas', 'shop-icon', tile);
  icon.setAttribute('aria-hidden', 'true');
  const name = el('span', 'shop-name', tile);
  const perk = el('span', 'shop-perk', tile);
  const meta = el('span', 'shop-meta', tile);
  const pips = [];
  if (kind === 'tool') {
    const row = el('span', 'shop-pips', meta);
    row.setAttribute('role', 'img'); // labelled "Level 1 of 3" in paintTool
    for (let i = 0; i < MAX_TIER; i++) {
      const p = el('span', 'shop-pip', row);
      p.setAttribute('aria-hidden', 'true');
      pips.push(p);
    }
  }
  const note = el('span', 'shop-note', meta);
  const count = el('span', 'shop-count', meta);
  const buy = el('button', 'btn shop-buy', tile);
  buy.type = 'button';
  const word = el('span', 'shop-buy-word', buy);
  const price = el('span', 'shop-price', buy);
  const r = { kind, def, tile, icon, name, perk, pipRow: pips.length ? pips[0].parentNode : null, pips, note, count, buy, word, price, iconTier: -1 };
  buy.addEventListener('click', () => (kind === 'tool' ? buyTool(r) : buyItem(r)));
  return r;
}

// ------------------------------------------------------------------- paint

/** Every word and number from save and the current language. */
function paint() {
  if (!root) return;
  const f = funds();
  ui.title.textContent = t('shop.title');
  ui.back.textContent = t('shop.back');
  ui.funds.textContent = money(f);
  ui.funds.setAttribute('aria-label', t('shop.funds', money(f)));
  ui.canvas.setAttribute('aria-label', t('shop.keeper'));
  for (const h of heads) h.el.textContent = t(h.key);
  for (const r of rows) (r.kind === 'tool' ? paintTool : paintItem)(r, f);
  ui.bubble.textContent = t(`shop.${line.pool}.${line.i}`, ...line.args);
  drawIcons();
}

function paintTool(r, f) {
  const { def } = r;
  const tier = toolTier(save, def.id);
  const top = def.tiers.length; // 3
  const maxed = tier >= top;
  // What is on the shelf: the next tier, or the one you have if it is the top.
  const shelf = def.tiers[maxed ? top - 1 : tier];
  const name = t(shelf.nameKey);
  r.name.textContent = name;
  r.perk.textContent = t(shelf.perkKey);
  // What you hold now. tools.js offers kitKey for tier 0; fall back politely.
  const held = maxed
    ? t('shop.top')
    : t('shop.now', tier ? t(def.tiers[tier - 1].nameKey) : def.kitKey ? t(def.kitKey) : t('shop.kit'));
  r.note.textContent = held;
  r.pipRow.setAttribute('aria-label', t('shop.tier', tier, top));
  for (let i = 0; i < r.pips.length; i++) r.pips[i].classList.toggle('on', i < tier);
  r.tile.classList.toggle('maxed', maxed);
  r.iconTier = maxed ? top : tier + 1; // draw what is for sale
  setBuy(r, maxed ? 'max' : f >= shelf.price ? 'ok' : 'poor', shelf.price, f, name);
}

function paintItem(r, f) {
  const { def } = r;
  const n = itemCount(def.id);
  const full = n >= def.max;
  const name = t(def.nameKey);
  r.name.textContent = name;
  r.perk.textContent = t(def.descKey);
  r.note.textContent = t('shop.carry', n, def.max);
  r.count.textContent = `${n}/${def.max}`;
  r.tile.classList.toggle('maxed', full);
  r.iconTier = 0;
  setBuy(r, full ? 'full' : f >= def.price ? 'ok' : 'poor', def.price, f, name);
}

// The buy button in its four states. Its width never changes (CSS), so the
// column of buttons keeps one edge whatever each one says.
function setBuy(r, state, price, f, name) {
  const off = state !== 'ok';
  const p = money(price);
  r.buy.classList.toggle('ghost', off);
  r.buy.setAttribute('aria-disabled', off ? 'true' : 'false');
  r.tile.classList.toggle('poor', state === 'poor');
  let label;
  if (state === 'ok') {
    r.word.textContent = t('shop.buy');
    r.price.textContent = p;
    label = t('shop.aria.buy', name, p);
  } else if (state === 'poor') {
    // The price stays the headline; the reason sits under it.
    const short = money(price - f);
    r.word.textContent = p;
    r.price.textContent = t('shop.short', short);
    label = t('shop.aria.short', name, p, short);
  } else {
    r.word.textContent = t(state === 'max' ? 'shop.maxed' : 'shop.full');
    r.price.textContent = '';
    label = t(state === 'max' ? 'shop.aria.maxed' : 'shop.aria.full', name);
  }
  r.price.hidden = !r.price.textContent;
  r.buy.setAttribute('aria-label', label);
  r.buy.title = label;
}

// --------------------------------------------------------------- canvases

const dprNow = () => Math.min(2, window.devicePixelRatio || 1);

// Match a canvas's backing store to its CSS box. Returns the CSS size.
function fit(canvas, d) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const W = Math.max(1, Math.round(w * d));
  const H = Math.max(1, Math.round(h * d));
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;
  return { w, h };
}

function sizeKeeper() {
  if (!root || root.hidden) return;
  keeper.d = dprNow();
  const { w, h } = fit(ui.canvas, keeper.d);
  keeper.rect.w = w;
  keeper.rect.h = h;
}

// Icons are static: drawn on paint and on resize, not per frame.
function drawIcons() {
  if (!root || root.hidden) return;
  const d = dprNow();
  for (const r of rows) {
    const { w, h } = fit(r.icon, d);
    if (!w || !h) continue;
    const ctx = r.icon.getContext('2d');
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, w, h);
    guard(`drawItem ${r.def.id}`, () => art.drawItem(ctx, r.def.id, w / 2, h / 2, Math.min(w, h) * 0.9, r.iconTier));
  }
}

function frame(ms) {
  raf = 0;
  if (!visible) return;
  const now = ms / 1000;
  if (mood !== 'idle' && now > moodUntil) mood = 'idle';
  if (now - lastTalk > IDLE_EVERY) say('idle', [], true);
  const { ctx, d, rect } = keeper;
  if (rect.w && rect.h) {
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, rect.w, rect.h);
    guard('drawShopkeeper', () => art.drawShopkeeper(ctx, rect, now, mood));
  }
  raf = requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ patter

// Say a line from a pool. Idle remarks are not announced to a screen reader —
// a voice that pipes up every fifteen seconds unprompted is noise; reactions
// to what the player did are.
function say(pool, args = [], quiet = false) {
  const n = POOLS[pool];
  let i = Math.floor(Math.random() * n);
  if (n > 1 && i === lastPick[pool]) i = (i + 1) % n;
  lastPick[pool] = i;
  line.pool = pool;
  line.i = i;
  line.args = args;
  lastTalk = nowSec();
  ui.bubble.setAttribute('aria-live', quiet ? 'off' : 'polite');
  ui.bubble.textContent = t(`shop.${pool}.${i}`, ...args);
  // Restart the bubble's pop-in (CSS) by toggling the class across a reflow.
  ui.bubble.classList.remove('pop');
  void ui.bubble.offsetWidth;
  ui.bubble.classList.add('pop');
}

function react(pool, face, args) {
  say(pool, args);
  mood = face;
  moodUntil = nowSec() + MOOD_HOLD;
}

// ------------------------------------------------------------------ buying

function buyTool(r) {
  const { def } = r;
  const tier = toolTier(save, def.id);
  if (tier >= def.tiers.length) return react('max', 'skeptical');
  const price = def.tiers[tier].price;
  const f = funds();
  if (f < price) {
    sfx('buzz');
    return react('poor', 'skeptical', [money(price - f)]);
  }
  save.funds = f - price;
  if (!save.tools || typeof save.tools !== 'object') save.tools = {};
  save.tools[def.id] = tier + 1;
  sold();
}

function buyItem(r) {
  const { def } = r;
  const n = itemCount(def.id);
  if (n >= def.max) return react('full', 'skeptical', [def.max]);
  const f = funds();
  if (f < def.price) {
    sfx('buzz');
    return react('poor', 'skeptical', [money(def.price - f)]);
  }
  save.funds = f - def.price;
  if (!save.items || typeof save.items !== 'object') save.items = {};
  save.items[def.id] = n + 1;
  sold();
}

function sold() {
  commit();
  sfx('coins');
  react('buy', 'happy');
  paint();
  // A coin-flip of the funds plate (CSS), so the number visibly changed.
  ui.funds.classList.remove('pop');
  void ui.funds.offsetWidth;
  ui.funds.classList.add('pop');
}

// ------------------------------------------------------------- show / hide

/** Refresh from save, greet, show, and start the shopkeeper. */
export function showShop() {
  if (!root) return;
  root.hidden = false;
  visible = true;
  mood = 'idle';
  say('hi');
  sizeKeeper();
  paint();
  if (!raf) raf = requestAnimationFrame(frame);
}

/** Hide and stop the loop. */
export function hideShop() {
  visible = false;
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  if (root) root.hidden = true;
}
