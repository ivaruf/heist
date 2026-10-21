/*
 * jobs.js — every job in the game, in the order they open, and what each one
 * pays. This file is the difficulty curve.
 *
 * A JOB IS A WALK THROUGH A BUILDING. Its `locks` list is the route: the back
 * door (pins), a corridor (lasers, cameras, a pressure floor), the office
 * door, the safe at the end. Puzzles (§6) and traps (§6a) share the slot, so
 * a list reads as a story — "pick the door, cross the laser hall, crack the
 * safe" — and the last entry is always the prize: a safe, a keypad or an
 * alarm box, never a corridor. (The drill cannot be used on the last lock,
 * so the prize is the one thing you always crack yourself.)
 *
 * EVERY KIND IS MET GENTLY FIRST. Each of the seven kinds makes its debut at
 * difficulty 1, in a job with time to spare, and is the only newcomer in
 * it: tiles and dial in kiosk-1, pins in kiosk-2, lasers in pawnshop-1,
 * keypad in jeweller-1, cameras in jeweller-2, wires in casino-1. After its
 * debut a kind climbs about one difficulty point per venue.
 *
 * AND NO TWO EARLY JOBS OPEN ALIKE. The first build opened all six of the
 * first jobs on the back door, and the owner's playtest said it plainly: it
 * should not "just be lockpicking". So the openers run floor, door, lasers,
 * floor, lasers, cameras, and pins turn up in only three of the first six.
 *
 * THE CURVE, VENUE BY VENUE (first clears, before the time bonus):
 *   kiosk      2 jobs  100 + 140       = 240    2–3 challenges, d1–2
 *   pawnshop   2 jobs  190 + 250       = 440    2–3 challenges, d1–2
 *   jeweller   3 jobs  320 + 400 + 480 = 1200   2–4 challenges, d1–4
 *   casino     3 jobs  560 + 680 + 800 = 2040   3–4 challenges, d1–5
 *   bank       3 jobs  1000+1250+1500  = 3750   4 challenges, d5–7, every kind
 *   vault      2 jobs  2100 + 3000     = 5100   5 challenges, d7–10
 *   Total, every job once: 12,770 + time bonuses (≈ 13.5k) + the 150 start.
 *
 * AGAINST THE SHOP (tools.js): a tier-1 tool costs 110–450, about one early
 * take; tier 2 380–1300, one good casino job; tier 3 1100–3000, a bank job or
 * two. Owning everything is 23,650 — well over the ~13,500 a full clear pays
 * (with a typical quarter of the clock left) — so a single pass buys roughly
 * the tier-1 and tier-2 shelf plus a few tier-3s, and the player has to
 * choose. Replays pay 40% (below), so grinding is possible but slow, and the
 * next new job always pays more than replaying the last: casino-3 pays 800
 * and more, its replay about 340.
 *
 * THE INTENDED PATH (§5 target), checked against a crude player model — each
 * challenge takes a + b·difficulty seconds and draws (0.3 + 0.2·difficulty)
 * mistakes, each tool tier making it ~13% quicker and ~22% less error-prone,
 * all scaled by a skill factor k (1 = average). The model is a guess at how
 * long the real puzzles take; the shape is the point, and the owner's
 * playtest is what tunes the `time` column. Under it:
 *   - k=1, buys NOTHING: kiosk, pawnshop and jeweller clear with 10–45 s to
 *     spare; busted at casino-2. (§5: "can finish the first two venues".)
 *   - k=1, buys the tool for each kind as it appears: reaches the bank on
 *     tier 1–2 with ~1,400 in hand, clears it with ~25 s to spare, and
 *     scrapes the vault (4–7 s) on mostly tier 3s.
 *   - k=1, buys sneakers and scanner first, kind tools after: clears
 *     everything with 40–80 s to spare. General tools are the strong buy.
 *   - k=1.3 (sharp), buys nothing: clears the bank, busted at vault-1.
 *   - k=1.6 (expert), buys nothing: clears vault-1, busted at vault-2.
 *   - k=0.8 (struggling), kind tools only: stuck at the vault even at tier 3;
 *     with sneakers and scanner as well, clears it. The vault wants both.
 *   - Gadgets alone (no tools, donuts and smoke bought for each hard job)
 *     carry k=1 through the bank and a sharp player through the vault.
 *     That is allowed: it is still spending the take on getting better.
 *
 * TIME AND HEAT. `time` is the clock before mods.timeScale; each kind's debut
 * job has about twice the time an average player needs, the jeweller about
 * 1.1×, and from the casino on an average player without tools runs short.
 * `heatSeconds` is a severity-1 mistake; wires and lasers mistakes are
 * severity 2, so a careless cut in the bank costs 20 s of a 180 s clock.
 * Heat rises slowly (5 → 13) so that late mistakes hurt more, which is what
 * makes sneakers worth their price in the second half.
 *
 * Busted costs nothing but the attempt (§1): no take, nothing lost.
 */

import { addStrings } from './i18n.js';

// A replay of a job already done pays this share of what it would have paid.
// Low enough that the next new job is always the better money; high enough
// that a stuck player can earn their way to a tool by replaying.
export const REPLAY_RATE = 0.4;

// The best possible time bonus, as a share of the take, for finishing with
// the whole clock left. Modest on purpose: speed is rewarded, but a slow,
// careful clear still earns the bulk of the money.
export const BONUS_RATE = 0.25;

const L = (kind, difficulty) => ({ kind, difficulty });

const job = (id, venue, locks, time, heatSeconds, payout) => ({
  id, venue, nameKey: `job.${id}`, locks, time, heatSeconds, payout,
});

export const VENUES = ['kiosk', 'pawnshop', 'jeweller', 'casino', 'bank', 'vault'];

export const JOBS = [
  // THE CORNER KIOSK — a creaky floor and a little safe. Tiles and dial debut.
  job('kiosk-1', 'kiosk', [L('tiles', 1), L('dial', 1)], 90, 5, 100),
  // The back door: pins debut, with the floor and the safe again behind it.
  job('kiosk-2', 'kiosk', [L('pins', 1), L('tiles', 2), L('dial', 2)], 110, 5, 140),

  // THE PAWNSHOP — lasers debut in the back room.
  job('pawnshop-1', 'pawnshop', [L('lasers', 1), L('dial', 2)], 100, 6, 190),
  job('pawnshop-2', 'pawnshop', [L('tiles', 2), L('lasers', 2), L('pins', 2)], 130, 6, 250),

  // THE JEWELLER — display cases on keypads. Keypad, then cameras, debut.
  job('jeweller-1', 'jeweller', [L('lasers', 2), L('keypad', 1)], 110, 7, 320),
  job('jeweller-2', 'jeweller', [L('cameras', 1), L('pins', 3), L('keypad', 2)], 135, 7, 400),
  job('jeweller-3', 'jeweller', [L('lasers', 3), L('keypad', 3), L('cameras', 2), L('dial', 4)], 160, 8, 480),

  // THE CASINO — the alarm boxes. Wires debut, guarded by cameras.
  job('casino-1', 'casino', [L('cameras', 3), L('keypad', 4), L('wires', 1)], 130, 8, 560),
  job('casino-2', 'casino', [L('tiles', 3), L('wires', 3), L('pins', 4), L('keypad', 4)], 140, 9, 680),
  job('casino-3', 'casino', [L('cameras', 4), L('wires', 4), L('lasers', 4), L('dial', 5)], 165, 9, 800),

  // THE BANK — everything, four deep.
  job('bank-1', 'bank', [L('pins', 5), L('wires', 5), L('lasers', 5), L('dial', 6)], 180, 10, 1000),
  job('bank-2', 'bank', [L('cameras', 6), L('tiles', 5), L('keypad', 6), L('dial', 6)], 180, 10, 1250),
  job('bank-3', 'bank', [L('pins', 7), L('lasers', 7), L('wires', 6), L('keypad', 7)], 210, 11, 1500),

  // THE CENTRAL VAULT — five hard ones in a row.
  job('vault-1', 'vault', [L('tiles', 7), L('cameras', 8), L('dial', 8), L('wires', 8), L('keypad', 8)], 240, 12, 2100),
  job('vault-2', 'vault', [L('lasers', 9), L('pins', 9), L('cameras', 9), L('wires', 9), L('dial', 10)], 260, 13, 3000),
];

const round5 = (n) => Math.round(n / 5) * 5;

// The take, split, for a getaway card that wants to show the parts. `take` is
// already the replay share on a replay; `bonus` likewise.
export function splitPayout(job, secondsLeft, replay) {
  const base = Number(job && job.payout) || 0;
  const limit = Number(job && job.time) || 1;
  const left = Number.isFinite(secondsLeft) ? secondsLeft : 0;
  // Fraction of the *unmodded* limit left, capped at 1, so a scanner (which
  // lengthens the clock) cannot push the bonus past its ceiling.
  const frac = Math.max(0, Math.min(1, left / limit));
  const share = replay ? REPLAY_RATE : 1;
  const take = round5(base * share);
  const bonus = round5(base * BONUS_RATE * frac * share);
  return { take, bonus, total: take + bonus };
}

export function payoutFor(job, secondsLeft, replay) {
  return splitPayout(job, secondsLeft, replay).total;
}

// Jobs open strictly in order: the first is always open, every other opens
// when the one before it is done. A corrupt save simply opens fewer jobs.
export function isUnlocked(job, save) {
  const i = JOBS.indexOf(job);
  if (i <= 0) return i === 0;
  try {
    const prev = save && save.jobs && save.jobs[JOBS[i - 1].id];
    return !!(prev && prev.done === true);
  } catch {
    return false;
  }
}

/*
 * The words. Venues and jobs are comic capers, named in the fiction; each
 * language gets its own joke rather than a translation of the other's.
 */
addStrings({
  nb: {
    'venue.kiosk': 'Hjørnekiosken',
    'venue.pawnshop': 'Pantelåner-Pelle',
    'venue.jeweller': 'Glitter & Gull',
    'venue.casino': 'Kasino Lykkehjulet',
    'venue.bank': 'Byens Sparebank',
    'venue.vault': 'Sentralhvelvet',

    'job.kiosk-1': 'Godteribrekket',
    'job.kiosk-2': 'Tyggisskatten',
    'job.pawnshop-1': 'Bak disken',
    'job.pawnshop-2': 'Gulltrompeten',
    'job.jeweller-1': 'Glassmonteren',
    'job.jeweller-2': 'Perlekjedet',
    'job.jeweller-3': 'Den blå diamanten',
    'job.casino-1': 'Sjetongbua',
    'job.casino-2': 'Jackpotmaskinen',
    'job.casino-3': 'Sjefens kontor',
    'job.bank-1': 'Nattsafen',
    'job.bank-2': 'Bankboksene',
    'job.bank-3': 'Gullbarrene',
    'job.vault-1': 'Den lange gangen',
    'job.vault-2': 'Det store kuppet',
  },
  en: {
    'venue.kiosk': 'The Corner Kiosk',
    'venue.pawnshop': "Pawnbroker Pete's",
    'venue.jeweller': 'Glitter & Gold',
    'venue.casino': 'The Lucky Wheel Casino',
    'venue.bank': 'City Savings Bank',
    'venue.vault': 'The Central Vault',

    'job.kiosk-1': 'The Sweetie Job',
    'job.kiosk-2': 'The Bubblegum Stash',
    'job.pawnshop-1': 'Behind the Counter',
    'job.pawnshop-2': 'The Golden Trumpet',
    'job.jeweller-1': 'The Display Case',
    'job.jeweller-2': 'The Pearl Necklace',
    'job.jeweller-3': 'The Blue Diamond',
    'job.casino-1': 'The Chip Cage',
    'job.casino-2': 'The Jackpot Machine',
    'job.casino-3': "The Boss's Office",
    'job.bank-1': 'The Night Safe',
    'job.bank-2': 'The Deposit Boxes',
    'job.bank-3': 'The Gold Bars',
    'job.vault-1': 'The Long Corridor',
    'job.vault-2': 'The Big One',
  },
});
