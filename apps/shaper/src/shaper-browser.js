// apps/shaper/src/shaper-browser.js — TASK 881: the floating SKETCHES browser over Shaper's Design canvas, moved here unchanged from design-canvas.js
// (TASK 610 / 619) so a page without the Design view (the Fusion panel build) does not load #ui/design-browser.js. The website's main.js and the node
// test kit (tests/helpers/node-app.js) mount it.

import { mountDesignBrowser } from '#ui/design-browser.js'; // task 586: the floating SKETCHES browser over the canvas

/** TASK 610 / 619: the floating SKETCHES browser + Construction toggle over Shaper's Design canvas (verified safe: loop-finder.js:116,198 excludes isConstruction from loops/chains/cut export). */
export function mountShaperBrowser({ state, engine }) {
  return mountDesignBrowser({ container: document.getElementById('design-body'), state, engine, construction: true });
}
