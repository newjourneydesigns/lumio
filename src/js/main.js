/** main.js — boot. */
import { Game } from './game.js';

const game = new Game();
game.init();

// Handy for poking at the game from the console, and for the end-to-end tests.
window.__sdrawkcab = game;
