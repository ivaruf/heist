/*
 * update.js — registering the service worker, and the one button that accepts
 * a new build. Copied from minimaze/js/update.js (itself lobbots').
 *
 * DELIBERATELY SELF-CONTAINED. It imports nothing and exports nothing, and no
 * other module knows it exists. index.html loads it as its own module script,
 * BEFORE js/main.js, so that a game which fails to boot can still be updated
 * out of whatever broke it — a module graph aborts as a whole when one import
 * fails (hub CLAUDE.md §2), and an update button living inside main.js's graph
 * would die with it.
 *
 * THE CONTRACT WITH sw.js
 *   Registered with { updateViaCache: 'none' } and update() called at launch
 *   and again whenever the page comes back into view — an installed window can
 *   sit open for days without a navigation, and without the second check it
 *   would never notice a release. A new worker precaches and then WAITS. This
 *   file shows #update when one is waiting; the tap is the ONLY thing in the
 *   game that posts SKIP_WAITING, and the reload happens only after a takeover
 *   WE asked for — or three seconds after the tap regardless, because
 *   controllerchange never comes after a hard refresh (hub §3).
 *
 * WHY THE BUTTON IS ON THE START SCREEN
 *   #start is hidden for the whole of a job, so the button is unreachable
 *   while the police are on their way. That is the mechanism behind "a deploy
 *   must never destroy a run in progress" (hub §1): not a check inside the
 *   click handler, but a control that is not on screen until the player is
 *   back at the start.
 *
 * WHY THE FIRST INSTALL IS NOT AN UPDATE
 *   On a first visit the worker installs with no controller to replace and
 *   activates at once. Offering "update ready" there would be a button that
 *   reloads the page for no reason, so every path below checks that a
 *   controller already exists before treating an installed worker as news.
 *
 * The button's two lines are its <strong> and <small>; #build is the version
 * line under the start screen's column.
 */

const button = document.getElementById("update");
const buildLine = document.getElementById("build");

/*
 * Its own words in both languages: this file imports nothing, js/i18n.js
 * included. It reads <html lang> (set before first paint by index.html) and
 * repaints on `arcade:lang`, which js/i18n.js dispatches on every switch.
 */
const WORDS = {
  nb: {
    title: "Ny versjon klar",
    sub: "Trykk for å hente den",
    fetching: "Henter den nye versjonen …",
    build: (v) => `Versjon ${v}`,
  },
  en: {
    title: "Update ready",
    sub: "Tap to take it",
    fetching: "Fetching the new build…",
    build: (v) => `Build ${v}`,
  },
};
const words = () => WORDS[document.documentElement.lang] || WORDS.nb;
let version = null;

function paint() {
  const w = words();
  if (button) {
    const title = button.querySelector("strong");
    const sub = button.querySelector("small");
    if (title) title.textContent = w.title;
    if (sub) sub.textContent = accepted ? w.fetching : w.sub;
  }
  if (buildLine && version) buildLine.textContent = w.build(version);
}
document.addEventListener("arcade:lang", paint);

/*
 * Did WE ask for the takeover? `controllerchange` also fires for reasons that
 * are none of our business — another tab of the same game accepting the update,
 * most obviously — and reloading on those would be exactly the mid-job reload
 * the waiting worker exists to prevent. Only our own tap sets this.
 */
let accepted = false;

/** Show the button, wired to the specific worker that is waiting. */
function offer(worker) {
  if (!button || !worker) return;
  paint();
  button.hidden = false;
  button.onclick = () => {
    accepted = true;
    button.disabled = true;
    paint();
    worker.postMessage({ type: "SKIP_WAITING" });
    // controllerchange never comes after a hard refresh (the page is
    // uncontrolled) or if this worker has gone redundant, and then the button
    // would sit at "updating" forever. The tap was a request to reload, so a
    // reload follows anyway (maxgear/js/main.js, dam_break/src/main.js).
    setTimeout(() => location.reload(), 3000);
  };
}

/**
 * Ask the worker which build is actually serving this session and print it.
 * The string baked into a page is the build the page came from, which during a
 * botched release is the one question you cannot answer by looking. A
 * MessageChannel gives the worker somewhere to reply.
 */
function showBuild() {
  const worker = navigator.serviceWorker.controller;
  if (!worker || !buildLine) return;
  try {
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => {
      const v = event.data && event.data.version;
      if (!v) return;
      version = v;
      paint();
      buildLine.hidden = false;
    };
    worker.postMessage({ type: "GET_VERSION" }, [channel.port2]);
  } catch {
    // No version line. The game is entirely unaffected, which is the point.
  }
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!accepted) return;
    // The new worker is in charge. Reload so every module in this session comes
    // from the same build — and we can only be here from the start screen,
    // because that is the only place the button exists.
    location.reload();
  });

  navigator.serviceWorker
    .register("sw.js", { updateViaCache: "none" })
    .then((reg) => {
      // Already waiting when we arrived: a previous visit precached it and the
      // player closed the tab before accepting.
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);

      reg.addEventListener("updatefound", () => {
        const fresh = reg.installing;
        if (!fresh) return;
        fresh.addEventListener("statechange", () => {
          if (fresh.state === "installed" && navigator.serviceWorker.controller) {
            offer(fresh);
          }
        });
      });

      // Check for a new sw.js now rather than waiting for the browser to think
      // of it, and again each time the window comes back. Harmless when there
      // is nothing new; it is one conditional GET.
      reg.update().catch(() => {});
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") reg.update().catch(() => {});
      });
    })
    .catch((err) => {
      // An insecure origin, a private window that blocks workers, a user who
      // has turned them off. The game runs perfectly without one — it simply
      // loses offline play and the install prompt.
      console.warn("HEIST: no service worker this session", err);
    });

  if (navigator.serviceWorker.controller) showBuild();
  else navigator.serviceWorker.ready.then(showBuild).catch(() => {});
}
