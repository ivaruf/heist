/*
 * save.js — the thief's ledger: funds, owned tools, carried gadgets, and
 * which jobs are done (DESIGN.md §3.2).
 *
 *   save = {
 *     funds: number,                       starts at 150
 *     tools: { [toolId]: tier },           0 or missing = the starting kit
 *     items: { [itemId]: count },          consumables carried
 *     jobs:  { [jobId]: { done, best } },  best = most seconds left
 *   }
 *   commit()   write it back
 *
 * One live object that every lane reads and mutates, then commit()s. It is
 * exported as a const binding so nobody can swap it out from under another
 * module that already holds it.
 *
 * VALIDATED ON LOAD, field by field. localStorage is one namespace shared by
 * every game on ivaruf.github.io and anything at all may have written to
 * `heist.save.v1`, so a value that is not the shape we wrote is dropped and
 * its default stands: funds that are not a finite non-negative number, tiers
 * outside 0..3, counts that are not whole numbers, a job record without
 * done:true. The key is `heist.save.v1` and must never be renamed (hub §6):
 * renaming it is wiping every player's progress.
 */

const KEY = 'heist.save.v1';
const START_FUNDS = 150;

export const save = { funds: START_FUNDS, tools: {}, items: {}, jobs: {} };

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const whole = (v, lo, hi) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

function load() {
  let raw;
  try {
    raw = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    return; // unreadable: defaults
  }
  if (!isObj(raw)) return;
  if (typeof raw.funds === 'number' && Number.isFinite(raw.funds) && raw.funds >= 0) {
    save.funds = Math.floor(raw.funds);
  }
  if (isObj(raw.tools)) {
    for (const [id, tier] of Object.entries(raw.tools)) if (whole(tier, 0, 3)) save.tools[id] = tier;
  }
  if (isObj(raw.items)) {
    for (const [id, n] of Object.entries(raw.items)) if (whole(n, 0, 999)) save.items[id] = n;
  }
  if (isObj(raw.jobs)) {
    for (const [id, rec] of Object.entries(raw.jobs)) {
      if (!isObj(rec) || rec.done !== true) continue;
      const best = typeof rec.best === 'number' && Number.isFinite(rec.best) && rec.best >= 0 ? rec.best : 0;
      save.jobs[id] = { done: true, best };
    }
  }
}
load();

/** Write the ledger. Private mode or a full quota: not kept, the game goes on. */
export function commit() {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    /* not kept this time */
  }
}
