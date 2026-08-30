/**
 * sw.js — offline support, so an installed Sdrawkcab still works on a phone
 * with no signal. There is no backend and nothing to sync: the whole game is
 * this handful of files plus your microphone.
 *
 * Bump CACHE when the shell changes. Old caches are deleted on activate.
 */
const CACHE = 'sdrawkcab-v1';

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

  // Everything else: serve from cache immediately, refresh in the background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
