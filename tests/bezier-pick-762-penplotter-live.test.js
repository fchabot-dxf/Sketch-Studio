// tests/bezier-pick-762-penplotter-live.test.js — TASK 762 in Pen Plotter, the smoke (desktop 1280 x 800, real mouse and keys;
// tests/helpers/bezier-pick-dom-live.js): the Bezier tool closes on its first anchor (the snap marker there, the tinted closed outline); the hover and a
// click on a bezier BODY light / select it; Trim pressed on that body says why it cannot trim it. Read from what the page draws.
import { runBezierDomScenario, HOSTS } from './helpers/bezier-pick-dom-live.js';

const out = await runBezierDomScenario(HOSTS.penplotter, { shots: false });
if (out) console.log('bezier-pick-762-penplotter-live: ALL CHECKS PASSED ' + JSON.stringify(out));
