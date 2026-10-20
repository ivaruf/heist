/*
 * i18n.js — which language HEIST speaks, and the shell's own words.
 *
 * The hub's contract (CLAUDE.md §2, "Two languages, Norwegian first"):
 * bokmål and English, Norwegian by default whatever the browser prefers,
 * one choice for the whole arcade stored as `arcade.lang.v1`, switched live
 * from the language row in the menu panel. Same shape as minimaze/js/i18n.js
 * and kitchens/js/i18n.js, plus the two things a five-lane build needs
 * (DESIGN.md §3.1):
 *
 *   t(key, ...args)     the current language, else English, else the key
 *                       itself (warning once per missing key)
 *   getLang()           "nb" | "en"
 *   setLang(lang)       validate, store, set <html lang>, repaint, then
 *                       dispatch `arcade:lang` on document
 *   paintStatic(root)   [data-i18n] -> textContent,
 *                       [data-i18n-label] -> aria-label and title,
 *                       [data-i18n-aria] -> aria-label only,
 *                       [data-lang] buttons -> aria-pressed
 *   addStrings(table)   { nb: {...}, en: {...} } merged into STRINGS. Every
 *                       lane registers its own words at module load under its
 *                       own prefix (P pz.*, E tool.* item.* job.* venue.*,
 *                       K shop.*), so nobody edits anybody else's table.
 *                       Later registrations win per key. Painting the DOM
 *                       afterwards is the caller's business: main.js calls
 *                       paintStatic() once every module has loaded.
 *   money(n)            the take as the player reads it: nb "1 200 kr"
 *                       (a no-break space between the thousands, so a price
 *                       never wraps in the middle), en "$1,200"
 *
 * The shell owns everything unprefixed plus ui.*, run.* and menu.*. Menu
 * words follow the hub glossary exactly (Spill, Tilbake, Innstillinger, …);
 * the game's voice lives in the run's sound words and the verdict lines.
 *
 * js/update.js, js/screen.js and the crash bar in index.html import nothing,
 * this file included: they keep their own few words, read <html lang> and
 * listen for `arcade:lang`.
 */

const KEY = 'arcade.lang.v1';

function initial() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'nb' || saved === 'en') return saved;
  } catch {
    // No storage: the default stands.
  }
  return 'nb';
}

let lang = initial();
document.documentElement.lang = lang;

export const getLang = () => lang;

const STRINGS = {
  nb: {
    // The menu glossary (hub §2). Binding; do not get creative here.
    'ui.play': 'Spill',
    'ui.shop': 'Butikk',
    'ui.jobs': 'Oppdrag',
    'ui.back': 'Tilbake',
    'ui.menu': 'Meny',
    'ui.settings': 'Innstillinger',
    'ui.paused': 'Pause',
    'ui.resume': 'Fortsett',
    'ui.restart': 'Start på nytt',
    'ui.giveup': 'Gi opp',
    'ui.music': 'MUSIKK',
    'ui.sfx': 'EFFEKTER',
    'ui.language': 'Språk',
    'ui.mute': 'Lyd av',
    'ui.unmute': 'Lyd på',
    'ui.exit.arcade': 'Tilbake til arkaden',
    'ui.exit.close': 'Lukk',
    'ui.exit.refused': 'Lukk vinduet selv',

    // The start screen and the menu panel.
    'ui.tag': 'Knekk den før politiet kommer.',
    'ui.funds': (m) => `Kassa: ${m}`,
    'menu.paused.tag': 'Klokka står stille. Låsen venter på deg.',
    'menu.nomusic': 'HEIST har ingen musikk ennå, bare lydeffekter. Nivået blir husket til musikken kommer.',
    'menu.giveup.ask': 'Gi opp jobben? Du mister denne runden, men ingenting annet.',
    'menu.giveup.yes': 'Ja, gi opp',
    'menu.giveup.no': 'Nei, fortsett',

    // The job board.
    'ui.locks': (n) => (n === 1 ? '1 lås' : `${n} låser`),
    'ui.time': (s) => `${s} sek`,
    'ui.payout': (m) => `Bytte ${m}`,
    'ui.done': (s) => `Klart! Best: ${s} sek til overs`,
    'ui.locked': 'Låst. Klar jobben før først.',

    // The run.
    'run.view': 'Låsen',
    'run.lock': (i, n) => `${i}/${n}`, // locks and traps alike, so no noun
    'run.take': (m) => `Bytte ${m}`,
    'run.secs': (s) => `${s} s`,
    'run.start': 'Sett i gang! Første berøring utløser alarmen.',
    'run.open': 'KA-CHUNK!',
    'run.heat': (s) => `−${s} s`,
    'run.burst.smoke': 'PUFF!',
    'run.burst.donut': 'NAM NAM!',
    'run.burst.drill': 'BRRRR!',
    'run.drilling': (s) => `Borer … ${s}`,
    'run.item': (name, n) => `${name}, ${n} igjen`,
    'run.item.lastlock': 'Den siste låsen må du knekke selv.',
    'run.getaway': 'Du slapp unna!',
    'run.takeLine': (m) => `Byttet: ${m}`,
    'run.bonus': (m) => `Tidsbonus: ${m}`,
    'run.total': (m) => `Kassa nå: ${m}`,
    'run.replay': 'En jobb du har gjort før gir mindre bytte.',
    'run.busted': 'Tatt!',
    'run.busted.line': 'Politiet kom først. Du mister ingenting, bare dingsene du brukte. Prøv igjen!',
    'run.again': 'Prøv igjen',
  },
  en: {
    'ui.play': 'Play',
    'ui.shop': 'Shop',
    'ui.jobs': 'Jobs',
    'ui.back': 'Back',
    'ui.menu': 'Menu',
    'ui.settings': 'Settings',
    'ui.paused': 'Paused',
    'ui.resume': 'Resume',
    'ui.restart': 'Restart',
    'ui.giveup': 'Give up',
    'ui.music': 'MUSIC',
    'ui.sfx': 'EFFECTS',
    'ui.language': 'Language',
    'ui.mute': 'Mute',
    'ui.unmute': 'Unmute',
    'ui.exit.arcade': 'Back to arcade',
    'ui.exit.close': 'Close',
    'ui.exit.refused': 'Close this window yourself',

    'ui.tag': 'Crack it before the cops come.',
    'ui.funds': (m) => `Funds: ${m}`,
    'menu.paused.tag': 'The clock is stopped. The lock is waiting for you.',
    'menu.nomusic': 'HEIST has no music yet, only sound effects. The level is kept for when it arrives.',
    'menu.giveup.ask': 'Give up this job? You lose this run, and nothing else.',
    'menu.giveup.yes': 'Yes, give up',
    'menu.giveup.no': 'No, keep going',

    'ui.locks': (n) => (n === 1 ? '1 lock' : `${n} locks`),
    'ui.time': (s) => `${s} s`,
    'ui.payout': (m) => `Take ${m}`,
    'ui.done': (s) => `Done! Best: ${s} s to spare`,
    'ui.locked': 'Locked. Crack the job before first.',

    'run.view': 'The lock',
    'run.lock': (i, n) => `${i}/${n}`,
    'run.take': (m) => `Take ${m}`,
    'run.secs': (s) => `${s} s`,
    'run.start': 'Go on! The first touch trips the alarm.',
    'run.open': 'KA-CHUNK!',
    'run.heat': (s) => `−${s} s`,
    'run.burst.smoke': 'PUFF!',
    'run.burst.donut': 'MUNCH!',
    'run.burst.drill': 'BRRRR!',
    'run.drilling': (s) => `Drilling… ${s}`,
    'run.item': (name, n) => `${name}, ${n} left`,
    'run.item.lastlock': 'The last lock you have to crack yourself.',
    'run.getaway': 'You got away!',
    'run.takeLine': (m) => `The take: ${m}`,
    'run.bonus': (m) => `Time bonus: ${m}`,
    'run.total': (m) => `Funds now: ${m}`,
    'run.replay': 'A job you have done before pays less.',
    'run.busted': 'Busted!',
    'run.busted.line': 'The cops got there first. You lose nothing but the gadgets you used. Have another go!',
    'run.again': 'Try again',
  },
};

/** Merge another lane's words in. Later registrations win per key. */
export function addStrings(table) {
  if (!table || typeof table !== 'object') return;
  for (const l of ['nb', 'en']) {
    if (table[l] && typeof table[l] === 'object') Object.assign(STRINGS[l], table[l]);
  }
}

const warned = new Set();

export function t(key, ...args) {
  let v = STRINGS[lang][key];
  if (v === undefined) v = STRINGS.en[key];
  if (v === undefined) {
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(`HEIST: no words for "${key}"`);
    }
    return key;
  }
  return typeof v === 'function' ? v(...args) : v;
}

/*
 * Money, built by hand rather than through toLocaleString: nb-NO groups with
 * U+202F (narrow no-break space) on some engines and U+00A0 on others, and a
 * glyph a system font lacks would print as a box on an old tablet.
 */
export function money(n) {
  const v = Math.round(Number.isFinite(n) ? n : 0);
  const sign = v < 0 ? '-' : '';
  const digits = String(Math.abs(v));
  const sep = lang === 'nb' ? ' ' : ',';
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += sep;
    out += digits[i];
  }
  return lang === 'nb' ? `${sign}${out} kr` : `${sign}$${out}`;
}

export function paintStatic(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-label]')) {
    const s = t(el.dataset.i18nLabel);
    el.setAttribute('aria-label', s);
    el.title = s;
  }
  // aria-label alone for the canvas: a tooltip over the whole play surface
  // would follow the pointer round the lock.
  for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  for (const b of root.querySelectorAll('[data-lang]')) {
    b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
  }
}

export function setLang(next) {
  if (next !== 'nb' && next !== 'en') return;
  lang = next;
  document.documentElement.lang = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // Not remembered; this visit still switches.
  }
  paintStatic();
  document.dispatchEvent(new CustomEvent('arcade:lang', { detail: lang }));
}
