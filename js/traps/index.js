/*
 * traps/index.js — the alarms and traps between the locks.
 *
 * The lock puzzles are cerebral and tactile; a heist also has to get *through*
 * the building, and that is what these are. Three kinds, each testing a
 * different thing so a job feels like a route rather than a row of safes:
 *
 *   lasers  — movement: steer past static, blinking and sweeping beams.
 *   cameras — timing: hop between crates while the cameras look away.
 *   tiles   — memory: walk a safe path across a pressure floor once shown it.
 *
 * A trap sits in exactly the same slot as a lock (DESIGN §6a): the same
 * options in, the same object out, the same events. The shell dispatches with
 * `TRAP_KINDS.includes(kind) ? createTrap : createPuzzle` and needs to know
 * nothing more. Mistake severities: lasers 2 (a zap is a real setback),
 * cameras 1, tiles 1.
 *
 * This file also registers the few words all three share.
 */

import { addStrings } from '../i18n.js';
import { createLasers } from './lasers.js';
import { createCameras } from './cameras.js';
import { createTiles } from './tiles.js';

addStrings({
  nb: { 'trap.exit': 'UTGANG', 'trap.phew': 'PUH!' },
  en: { 'trap.exit': 'EXIT', 'trap.phew': 'PHEW!' },
});

export const TRAP_KINDS = ['lasers', 'cameras', 'tiles'];

const MAKERS = { lasers: createLasers, cameras: createCameras, tiles: createTiles };

/** opts: { difficulty 1..10, tier 0..3, rng, sfx, events: { mistake, progress, solved } } */
export function createTrap(kind, opts) {
  const make = MAKERS[kind];
  if (!make) throw new Error(`unknown trap kind: ${kind}`);
  return make(opts);
}
