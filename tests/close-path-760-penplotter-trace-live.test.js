// tests/close-path-760-penplotter-trace-live.test.js — TASK 760: Close path smoke in Pen Plotter and Trace (desktop 1280 x 800, real mouse and keys;
// tests/helpers/close-path-live.js closePathSmoke): the import's ONE offer notice ("1 outline is almost closed (largest gap 0.08 mm) · 1 open path left
// open" + Close them), the Close path button right after Break, Shift+C marks the 4 open ends, Close them adds the one closing line, 2 ends left open.
import { closePathSmoke, HOSTS } from './helpers/close-path-live.js';

await closePathSmoke(HOSTS.penplotter);
await closePathSmoke(HOSTS.trace);
console.log('close-path-760-penplotter-trace-live: ok');
