/** main.js — boot. */
import { Game } from './game.js';

const game = new Game();
game.init();

// Handy for poking at the game from the console, and for the end-to-end tests.
window.__sdrawkcab = game;

// Offline support. Registered after load so it never competes with the game's
// own assets for bandwidth on a first visit, and failure is silent — a service
// worker is a bonus here, not a requirement.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
