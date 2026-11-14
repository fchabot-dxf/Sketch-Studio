// packages/ui/short-viewport.js — TASK 602: THE short-viewport layout mode (a phone held in LANDSCAPE), declared once.
// A viewport is SHORT when it is at most 500 px tall, wider than tall, and driven by a finger (coarse pointer). Width does not matter and no
// device or browser is sniffed: a phone in landscape (844 x 390, 780 x 360, 915 x 412) matches, a phone in portrait, a tablet and a desktop
// do not. In this mode every host of the shared Design tab gets the same layout (the CSS lives with each component, keyed on this query):
//   - the tool ribbon is a vertical icon rail on the LEFT of the design frame (tool-ribbon.js);
//   - the status bar (class sk-statusbar) folds away; its Log / Tune entries are in the app menu (sketcher.css, the host's menu entries);
//   - a host header (sk-phone-header) is one row with 44 px targets (sketcher.css);
//   - the floating SKETCHES box starts collapsed (design-browser.js).
// Static stylesheets (sketcher.css) cannot import this constant: they spell the same query, and tests/short-viewport-node.test.js checks
// that every copy is identical to this one.

export const SHORT_VIEWPORT_QUERY = '(max-height: 500px) and (orientation: landscape) and (pointer: coarse)';

/** True while the viewport is in the short (phone landscape) mode. */
export function isShortViewport() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(SHORT_VIEWPORT_QUERY).matches;
}

/** Calls cb(isShort) whenever the mode changes (a phone rotates). Returns the unsubscribe function. */
export function onShortViewportChange(cb) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const mq = window.matchMedia(SHORT_VIEWPORT_QUERY);
  const on = (e) => cb(e.matches);
  mq.addEventListener('change', on);
  return () => mq.removeEventListener('change', on);
}
