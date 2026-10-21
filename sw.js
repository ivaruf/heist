// HEIST service worker: a versioned precache, so a job can be cracked on a
// plane, in a tunnel, and through a deploy that lands mid-heist. Copied from
// minimaze/sw.js.
//
// UPDATE MODEL ("opt-in", hub CLAUDE.md §3). Bump VERSION on every committed
// batch that deploys, and keep it HERE, as a literal in this file: the browser
// decides a worker has changed by comparing this script's bytes, so a version
// kept in some imported file leaves sw.js identical between releases and an
// installed copy never hears of one. The page registers with
// { updateViaCache: 'none' } and calls reg.update() at launch and whenever it
// comes back into view. The new worker precaches the whole list below and then
// WAITS: js/update.js shows the UPDATE READY button on the start screen, and
// only that tap posts SKIP_WAITING. There is deliberately no skipWaiting() in
// install — taking over unasked would swap the modules under a lock that is
// one pin from open ("a deploy must never destroy a run in progress", hub §1).
//
// GET_VERSION lets the page print the build that is actually serving it, which
// during a botched release is the one question you cannot answer by looking.
//
// The cache name is prefixed with the slug and the cleanup filter below only
// ever deletes keys that carry that prefix: every game in this hub shares one
// origin and therefore one CacheStorage, so a sloppy filter evicts a
// neighbour's offline copy.
//
// All paths are RELATIVE: the game is served from /heist/ and is also framed
// by the arcade from a sibling directory.

const VERSION = 'v0.1.3'; // the first jobs open on floors, lasers and cameras, not always the back door
const CACHE = `heist-${VERSION}`;

// Every shipped file, of every lane (DESIGN.md §2). install blocks until all of
// it is cached, so this list is the whole game: a file missing from it works
// online and silently vanishes offline, and a file listed but not deployed
// fails the install outright and leaves the player on the previous version.
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './css/shop.css',
  './js/update.js',
  './js/touch-guard.js',
  './js/intro.js',
  './js/screen.js',
  './js/main.js',
  './js/heist.js',
  './js/i18n.js',
  './js/save.js',
  './js/audio.js',
  './js/art.js',
  './js/tools.js',
  './js/jobs.js',
  './js/shop.js',
  './js/puzzles/index.js',
  './js/puzzles/dial.js',
  './js/puzzles/pins.js',
  './js/puzzles/keypad.js',
  './js/puzzles/wires.js',
  './js/traps/index.js',
  './js/traps/lasers.js',
  './js/traps/cameras.js',
  './js/traps/tiles.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
  './icons/icon-maskable-512.png',
];

// `cache: 'reload'` on everything the install stores. Without it the precache
// reads through the browser's HTTP cache, which may still hold yesterday's copy
// of a file, so a new version could be filed with some of the old files in it —
// on 2026-10-11 dam_break ran a new screens.js against a stale sound.js and the
// menu never wired up. The arcade learned this first (arcade/sw.js, `fresh`).
const fresh = (url) => new Request(url, { cache: 'reload' });

self.addEventListener('install', (event) => {
  // No skipWaiting() here: after precaching, the new worker stays WAITING until
  // the player accepts the update from the start screen.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS.map(fresh))));
});

self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type === 'SKIP_WAITING') self.skipWaiting();
  if (msg.type === 'GET_VERSION' && event.ports[0]) event.ports[0].postMessage({ version: VERSION });
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        // 'heist-' only. Every other game keeps its caches on this same
        // origin and none of them are ours to delete.
        keys.filter((k) => k.startsWith('heist-') && k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  // Cache-first out of the current versioned precache, so every module in one
  // session comes from ONE deploy: the shell, the puzzles and the art can never
  // be from different builds. New versions arrive as a whole new cache through
  // install/activate above, never file by file.
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      }).catch(() => (request.mode === 'navigate' ? caches.match('./index.html') : undefined));
    })
  );
});
