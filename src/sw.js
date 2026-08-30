/**
 * sw.js — offline support, so an installed Sdrawkcab still works on a phone
 * with no signal. There is no backend and nothing to sync: the whole game is
 * this handful of files plus your microphone.
 *
 * Bump CACHE when the shell changes. Old caches are deleted on activate.
 */
// Bumped whenever the caching strategy changes. Every other cache is deleted
// on activate, which is also how a client carrying a poisoned or mixed-version
// cache from an earlier worker gets rescued.
const CACHE = 'sdrawkcab-v8';

// Fonts and images are content-stable: if one ever changes it changes name.
// Everything else is code, and code must never be served stale.
const IMMUTABLE = /\/assets\/(fonts|[^/]+\.(png|svg))/;

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './fonts.css',
  './app.webmanifest',
  './js/main.js',
  './js/game.js',
  './js/audio.js',
  './js/dsp.js',
  './js/viz.js',
  './js/copy.js',
  './js/sfx.js',
  './js/confetti.js',
  './audio/take-capture.worklet.js',
  './assets/icon.svg',
  './assets/icon-192.png',
  './assets/apple-touch-icon.png',
  './assets/fonts/archivo-black-latin.woff2',
  './assets/fonts/space-grotesk-latin.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // Individually, so one missing file cannot fail the whole install and
      // leave the app with no service worker at all.
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations go to the network first so a new deploy is picked up on the
  // next visit rather than being pinned to whatever was cached first.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Only cache a real page. Without the ok check a 404 or a 502 — or a
          // captive portal's sign-in page — gets stored as the offline app
          // shell, and the game is replaced by that error page for good.
          if (response && response.ok && !response.redirected) {
            const copy = response.clone();
            // Tied to the event: a floating promise can be cut off when the
            // service worker is terminated after respondWith settles.
            event.waitUntil(caches.open(CACHE).then((cache) => cache.put('./index.html', copy)));
          }
          return response;
        })
        // './' is precached at install and is never overwritten here, so it is
        // the trustworthy fallback even for a client already carrying a bad
        // './index.html' from an earlier version of this worker.
        .catch(() => caches.match('./index.html')
          .then((r) => r || caches.match('./'))
          .then((r) => r || Response.error())),
    );
    return;
  }

  // Immutable assets: cache first, because they never change in place.
  if (IMMUTABLE.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)));
        }
        return response;
      })),
    );
    return;
  }

  // Code and markup: network first, cache only as the offline fallback.
  //
  // This used to be stale-while-revalidate, which is wrong for an app whose
  // modules import each other. Each file revalidates independently, so after a
  // deploy a returning phone could run some modules from the new version and
  // some from the old — and a cross-module contract that changed in between
  // then throws a bare TypeError with no useful message. The app is about 60KB
  // of JS and CSS; there is nothing to gain by serving any of it stale.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)));
        }
        return response;
      })
      .catch(() => caches.match(request)),
  );
});
