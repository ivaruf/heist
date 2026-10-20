/*
 * tools.js — what the thief carries: the tool catalogue, the gadgets, and the
 * one function that turns "what you own" into "how kind the locks are".
 *
 * TWO KINDS OF THING ARE SOLD (DESIGN.md §4):
 *   TOOLS   permanent, three tiers each above the free starting kit (tier 0).
 *           Seven belong to one challenge kind — four lock puzzles and three
 *           traps — and make that one kinder. Two are general: sneakers make
 *           every mistake cost less time, the scanner makes the police slower.
 *   ITEMS   one-shot gadgets carried into a run and spent when used.
 *
 * THE PERK LINES ARE A PROMISE. The puzzle and trap lanes implement exactly
 * the §4 table and nothing else, so every perk string below says what that
 * table says, in words a child can read, and no more. If a perk ever needs to
 * change, the table in DESIGN.md changes first.
 *
 * PRICES, AND WHY THEY ARE WHAT THEY ARE. The numbers sit against the job
 * list in jobs.js (whose purpose block has the full balance rationale and the
 * simulated spending paths). The shape:
 *   tier 1  110–450    about one early job's take. The cheapest tiers belong
 *                      to the kinds you meet first (chalk, picks, stethoscope)
 *                      so the very first purchase is possible from the 150
 *                      starting funds plus the first take, and it helps at
 *                      once. Tools for kinds met later cost more, because they
 *                      are bought later with more in the pocket.
 *   tier 2  380–1300   a casino-era purchase: one good job's take.
 *   tier 3  1100–3000  a bank job or two. Owning every tier of everything
 *                      costs 23,650, and clearing every job once earns about
 *                      13,500 — so nobody buys the whole shop on one pass, and
 *                      what you buy is a real choice: shore up the kind you
 *                      are worst at, or go general.
 *   general            sneakers and the scanner help on every challenge, so
 *                      they cost about twice a kind tool at each tier. In the
 *                      balance model they were the strongest buy even so —
 *                      heat dominates late jobs — which is why they are the
 *                      dearest things on the shelf rather than cheap.
 *   gadgets 60–180     cheap enough to carry a couple into a hard job, dear
 *                      enough that grinding them is worse than buying a tool.
 *
 * This is an in-fiction economy (hub §7): gameplay only, connected to nothing
 * outside the game, and nothing here can be bought with anything but the take.
 *
 * ROBUSTNESS. `save` comes from localStorage, which every game on the origin
 * shares and anything may have written into. modsFor and toolTier therefore
 * trust nothing: an unknown tool id is ignored, a tier that is not a finite
 * number reads as 0, a tier out of range is clamped to 0..3 and floored.
 */

import { addStrings } from './i18n.js';

// One tier: price in the take's units, and two i18n keys. Keys follow one
// pattern so the string table below and the catalogue cannot drift apart.
const tier = (id, n, price) => ({
  price,
  nameKey: `tool.${id}.${n}.name`,
  perkKey: `tool.${id}.${n}.perk`,
});

// `kitKey` is an extra field beyond the §4 shape: the name of the tier-0 kit
// (Hairpin, bare ear...) so the shop can say what you hold before you buy.
const tool = (id, puzzle, prices) => ({
  id,
  puzzle,
  kitKey: `tool.${id}.0.name`,
  tiers: prices.map((p, i) => tier(id, i + 1, p)),
});

// Ordered roughly by when the player first needs them, which is also the
// order the shop should list them in: the first lock you meet is the first
// tool on the shelf.
export const TOOLS = [
  tool('picks', 'pins', [120, 400, 1200]),
  tool('stethoscope', 'dial', [140, 450, 1300]),
  tool('chalk', 'tiles', [110, 380, 1100]),
  tool('goggles', 'lasers', [150, 480, 1400]),
  tool('powder', 'keypad', [200, 550, 1500]),
  tool('jammer', 'cameras', [220, 600, 1600]),
  tool('tester', 'wires', [250, 650, 1700]),
  tool('sneakers', null, [400, 1200, 2800]),
  tool('scanner', null, [450, 1300, 3000]),
];

// What the general tools do at each tier (index = tier). Exactly the §4 table.
const HEAT_SCALE = [1, 0.75, 0.5, 0.3];
const TIME_SCALE = [1, 1.1, 1.2, 1.35];

// The gadgets. `effect` is one of the two shapes S interprets and nothing
// else. `max` is how many one run may carry: the drill is one, because two
// drills would skip half a short job and turn the puzzle into a purchase.
export const ITEMS = [
  { id: 'smoke', price: 60, max: 3, effect: { addTime: 15 }, nameKey: 'item.smoke.name', descKey: 'item.smoke.desc' },
  { id: 'donut', price: 110, max: 2, effect: { addTime: 30 }, nameKey: 'item.donut.name', descKey: 'item.donut.desc' },
  { id: 'drill', price: 180, max: 1, effect: { solveLock: 4 }, nameKey: 'item.drill.name', descKey: 'item.drill.desc' },
];

const KNOWN = new Set(TOOLS.map((t) => t.id));

// The tier the save says you own, made safe. Unknown ids and garbage are 0.
export function toolTier(save, id) {
  if (!KNOWN.has(id)) return 0;
  let raw;
  try {
    raw = save && save.tools && typeof save.tools === 'object' ? save.tools[id] : 0;
  } catch {
    return 0;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(3, Math.floor(n)));
}

// MODS (§4): always every field, defaults when nothing is owned. The shell
// calls this once per run start, so a purchase takes effect on the next job.
export function modsFor(save) {
  const mods = {
    dial: 0, pins: 0, keypad: 0, wires: 0,
    lasers: 0, cameras: 0, tiles: 0,
    heatScale: HEAT_SCALE[toolTier(save, 'sneakers')],
    timeScale: TIME_SCALE[toolTier(save, 'scanner')],
  };
  for (const t of TOOLS) if (t.puzzle) mods[t.puzzle] = toolTier(save, t.id);
  return mods;
}

/*
 * The words. Tool names are things in the fiction, so they get flavour; the
 * perk lines are plain, because they are the rules. Bokmål as said to a child
 * of eight. Tier 0 has a name and no perk: it is what you start with.
 */
addStrings({
  nb: {
    'tool.picks.0.name': 'Hårnål',
    'tool.picks.1.name': 'Dirkesett',
    'tool.picks.1.perk': 'Streken der stiftene skal stå, blir dobbelt så bred.',
    'tool.picks.2.name': 'Proffsett',
    'tool.picks.2.perk': 'En stift blinker når den står akkurat på streken.',
    'tool.picks.3.name': 'Dirkepistol',
    'tool.picks.3.perk': 'Stiften som sitter fast, er merket, så du alltid vet hvilken som er neste.',

    'tool.stethoscope.0.name': 'Bare øret',
    'tool.stethoscope.1.name': 'Stetoskop',
    'tool.stethoscope.1.perk': 'Klikket blir høyt, og skiven dirrer når det klikker.',
    'tool.stethoscope.2.name': 'Elektronisk stetoskop',
    'tool.stethoscope.2.perk': 'Skiven gløder varmt når du er to tall unna et hakk, og glohett rett på.',
    'tool.stethoscope.3.name': 'Safesansen',
    'tool.stethoscope.3.perk': 'Hakkene du har funnet, blir skrevet i notatblokka for deg.',

    'tool.chalk.0.name': 'Godt minne',
    'tool.chalk.1.name': 'Kritt',
    'tool.chalk.1.perk': 'Den trygge veien vises dobbelt så lenge.',
    'tool.chalk.2.name': 'Repriseknapp',
    'tool.chalk.2.perk': 'Du kan se veien én gang til i hvert rom, når du vil.',
    'tool.chalk.3.name': 'Krittmerker',
    'tool.chalk.3.perk': 'De tre første trygge flisene forblir merket.',

    'tool.goggles.0.name': 'Bare øynene',
    'tool.goggles.1.name': 'Nattbriller',
    'tool.goggles.1.perk': 'Du ser alltid laserstrålene tydelig.',
    'tool.goggles.2.name': 'Varmebriller',
    'tool.goggles.2.perk': 'Et skyggebilde viser hvor hver stråle som flytter seg, er om ett sekund.',
    'tool.goggles.3.name': 'Laserspeil',
    'tool.goggles.3.perk': 'Den første strålen du kommer borti i hvert rom, blir sendt bort uten fare.',

    'tool.powder.0.name': 'Ingenting',
    'tool.powder.1.name': 'Fingeravtrykkspulver',
    'tool.powder.1.perk': 'Tastene som er i koden, har fingermerker.',
    'tool.powder.2.name': 'UV-lykt',
    'tool.powder.2.perk': 'Merkene viser slitasje: den mest slitte tasten trykkes først.',
    'tool.powder.3.name': 'Kodeleser',
    'tool.powder.3.perk': 'Ett av sifrene i koden vises på riktig plass.',

    'tool.jammer.0.name': 'Ingenting',
    'tool.jammer.1.name': 'Kamerakart',
    'tool.jammer.1.perk': 'Det kameraene ser, tegnes med skarpe kanter.',
    'tool.jammer.2.name': 'Signalforstyrrer',
    'tool.jammer.2.perk': 'Kameraene snur seg 25 % saktere.',
    'tool.jammer.3.name': 'Løkkebånd',
    'tool.jammer.3.perk': 'Trykk på et kamera for å fryse det i 3 sekunder, én gang i hvert rom.',

    'tool.tester.0.name': 'Ingenting',
    'tool.tester.1.name': 'Ledningstester',
    'tool.tester.1.perk': 'Trykk på en klemme, så lyser hele ledningen et øyeblikk.',
    'tool.tester.2.name': 'Fargekoder',
    'tool.tester.2.perk': 'Ingen ledninger har samme farge.',
    'tool.tester.3.name': 'Sporskop',
    'tool.tester.3.perk': 'Ledningen du skal klippe nå, blinker.',

    'tool.sneakers.0.name': 'Vanlige sko',
    'tool.sneakers.1.name': 'Joggesko',
    'tool.sneakers.1.perk': 'En tabbe koster en firedel mindre tid.',
    'tool.sneakers.2.name': 'Ninjasokker',
    'tool.sneakers.2.perk': 'En tabbe koster halvparten så mye tid.',
    'tool.sneakers.3.name': 'Skyggetøfler',
    'tool.sneakers.3.perk': 'En tabbe koster bare tre tideler så mye tid.',

    'tool.scanner.0.name': 'Ingenting',
    'tool.scanner.1.name': 'Politiradio',
    'tool.scanner.1.perk': 'Politiet bruker 10 % lenger tid på å komme.',
    'tool.scanner.2.name': 'Stor antenne',
    'tool.scanner.2.perk': 'Politiet bruker 20 % lenger tid på å komme.',
    'tool.scanner.3.name': 'Falsk melding',
    'tool.scanner.3.perk': 'Politiet bruker 35 % lenger tid på å komme.',

    'item.smoke.name': 'Røykbombe',
    'item.smoke.desc': 'Gir deg 15 sekunder ekstra på klokka.',
    'item.donut.name': 'Smultringeske',
    'item.donut.desc': 'Legges i veien for politibilen. Gir deg 30 sekunder ekstra.',
    'item.drill.name': 'Boremaskin',
    'item.drill.desc': 'Borer opp låsen du står ved på 4 sekunder. Virker ikke på den siste.',
  },
  en: {
    'tool.picks.0.name': 'Hairpin',
    'tool.picks.1.name': 'Pick set',
    'tool.picks.1.perk': 'The shear line is twice as wide.',
    'tool.picks.2.name': 'Pro set',
    'tool.picks.2.perk': 'A pin glints when it sits at the shear line.',
    'tool.picks.3.name': 'Pick gun',
    'tool.picks.3.perk': 'The binding pin is marked, so you always know which is next.',

    'tool.stethoscope.0.name': 'Bare ear',
    'tool.stethoscope.1.name': 'Stethoscope',
    'tool.stethoscope.1.perk': 'The click is loud, and the dial ripples on it.',
    'tool.stethoscope.2.name': 'Electronic stethoscope',
    'tool.stethoscope.2.perk': 'The dial glows warm within 2 numbers of a gate, and hot right on it.',
    'tool.stethoscope.3.name': 'Safe sense',
    'tool.stethoscope.3.perk': 'Gates you have found are written on the notepad for you.',

    'tool.chalk.0.name': 'Good memory',
    'tool.chalk.1.name': 'Chalk',
    'tool.chalk.1.perk': 'The safe path is shown twice as long.',
    'tool.chalk.2.name': 'Replay',
    'tool.chalk.2.perk': 'One extra look at the path in each room, whenever you want it.',
    'tool.chalk.3.name': 'Chalk marks',
    'tool.chalk.3.perk': 'The first three safe tiles stay marked.',

    'tool.goggles.0.name': 'Bare eyes',
    'tool.goggles.1.name': 'Night goggles',
    'tool.goggles.1.perk': 'Laser beams are always clearly visible.',
    'tool.goggles.2.name': 'Thermal goggles',
    'tool.goggles.2.perk': 'A ghost shows where each moving beam will be in 1 second.',
    'tool.goggles.3.name': 'Laser mirror',
    'tool.goggles.3.perk': 'The first beam you touch in each room is reflected harmlessly.',

    'tool.powder.0.name': 'Nothing',
    'tool.powder.1.name': 'Fingerprint powder',
    'tool.powder.1.perk': 'The keys in the code are smudged.',
    'tool.powder.2.name': 'UV torch',
    'tool.powder.2.perk': 'Smudges show wear: the most worn key was pressed first.',
    'tool.powder.3.name': 'Code reader',
    'tool.powder.3.perk': 'One digit of the code is shown in its place.',

    'tool.jammer.0.name': 'Nothing',
    'tool.jammer.1.name': 'Camera map',
    'tool.jammer.1.perk': 'Camera cones are drawn with exact, hard edges.',
    'tool.jammer.2.name': 'Signal jammer',
    'tool.jammer.2.perk': 'Cameras sweep 25% slower.',
    'tool.jammer.3.name': 'Loop tape',
    'tool.jammer.3.perk': 'Tap a camera to freeze it for 3 seconds, once per room.',

    'tool.tester.0.name': 'Nothing',
    'tool.tester.1.name': 'Wire tester',
    'tool.tester.1.perk': 'Tap a terminal to light up its whole wire for a moment.',
    'tool.tester.2.name': 'Colour-coded',
    'tool.tester.2.perk': 'No two wires share a colour.',
    'tool.tester.3.name': 'Trace scope',
    'tool.tester.3.perk': 'The next wire to cut pulses.',

    'tool.sneakers.0.name': 'Ordinary shoes',
    'tool.sneakers.1.name': 'Sneakers',
    'tool.sneakers.1.perk': 'A mistake costs a quarter less time.',
    'tool.sneakers.2.name': 'Ninja socks',
    'tool.sneakers.2.perk': 'A mistake costs half the time.',
    'tool.sneakers.3.name': 'Shadow slippers',
    'tool.sneakers.3.perk': 'A mistake costs less than a third of the time.',

    'tool.scanner.0.name': 'Nothing',
    'tool.scanner.1.name': 'Police scanner',
    'tool.scanner.1.perk': 'The police take 10% longer to arrive.',
    'tool.scanner.2.name': 'Big antenna',
    'tool.scanner.2.perk': 'The police take 20% longer to arrive.',
    'tool.scanner.3.name': 'Fake radio call',
    'tool.scanner.3.perk': 'The police take 35% longer to arrive.',

    'item.smoke.name': 'Smoke bomb',
    'item.smoke.desc': '15 seconds back on the clock.',
    'item.donut.name': 'Box of donuts',
    'item.donut.desc': "Left on the police car's route: 30 seconds back on the clock.",
    'item.drill.name': 'Drill',
    'item.drill.desc': 'Drills the current lock open in 4 seconds. Not on the last lock.',
  },
});
