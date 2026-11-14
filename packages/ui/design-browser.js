// packages/ui/design-browser.js — the ONE mount path of the Design tab's BROWSER (task 586, replacing 577b's right-hand side panel): the
// shared SKETCHES tree with each sketch's expandable constraint list (createDesignInfoPanel, showSketchTree) in a small card that FLOATS over
// the TOP-LEFT of the canvas, like Fusion's BROWSER. All four hosts (SketchStudio, Shaper, Pen Plotter, Trace) mount it through this function.
//
//   const browser = mountDesignBrowser({ container, state, engine, toggleHost });
//   browser.tick()    call from the host's render loop: refreshes the tree when something it shows changed (cheap signature)
//   browser.panel     the createDesignInfoPanel instance     browser.el  the card     browser.drawer  the phone drawer
// container: the element that holds the canvas (a sibling of the canvas <svg>, so the pointer events inside the card never reach the canvas,
// and the ones outside it do). It becomes the card's positioning parent (class sk-browser-host).
// Collapsed: the card shrinks to its header bar. The state is the per-user setting BROWSER_COLLAPSED (SettingsManager, local), not a document field.
// Phones (<= 640 px, the one phone breakpoint, tasks 562 / 581): the card does not fit over the canvas, so the SAME element becomes a
// slide-over drawer (createMobileDrawer, breakpoint 641) opened by a header button (browser.drawer.toggleEl, placed in toggleHost).
// Phone LANDSCAPE (the short viewport, #ui/short-viewport.js, TASK 602): the card starts COLLAPSED (the canvas is short), and collapses again each time the
// phone turns into landscape; the user can expand it (that choice is stored like any other). Turning back to portrait / a tall window brings back the stored
// setting. Expanded, it stays inside the canvas (max-height) and scrolls. Its controls are 44 px finger targets there.
// Position: 8 px in from the canvas's top-left corner. The axis numbers (#ui/canvas-grid.js) are drawn along the X and Y axes at the origin,
// not at a fixed screen corner, so they only sit under the card when the user pans an axis there; the card is a Fusion-style overlay.

import { createDesignInfoPanel } from '#ui/design-info-panel.js';
import { createMobileDrawer } from '#ui/mobile-drawer.js';
import { sketchesSignature } from '#core/sketch-model.js';
import SettingsManager from '#core/settings-manager.js';
import { SHORT_VIEWPORT_QUERY, isShortViewport, onShortViewportChange } from '#ui/short-viewport.js';

export const BROWSER_PHONE_BREAKPOINT = 641; // drawer below this width: the app's one phone breakpoint is max-width 640

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined' || !document.head) return;
  if (document.getElementById('sk-browser-styles')) { stylesInjected = true; return; }
  const s = document.createElement('style'); s.id = 'sk-browser-styles';
  s.textContent = `
.sk-browser-host { position: relative; }
.sk-browser { display: flex; flex-direction: column; box-sizing: border-box; font: 13px system-ui, sans-serif;
  background: var(--sk-browser-bg, rgba(255,255,255,0.94)); color: var(--sk-browser-fg, #1f2937);
  border: 1px solid var(--sk-browser-line, #cbd5e1); border-radius: 8px; box-shadow: 0 2px 10px rgba(15,23,42,0.18); }
.sk-browser-head { display: flex; align-items: center; gap: 6px; padding: 5px 40px 5px 8px; min-height: 28px; }
.sk-browser-toggle { background: transparent; border: 0; color: inherit; opacity: 0.65; cursor: pointer; font: 14px system-ui, sans-serif; padding: 2px 4px; line-height: 1; }
.sk-browser-toggle:hover { opacity: 1; }
.sk-browser-title { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; opacity: 0.7; }
.sk-browser-info { flex: 1 1 auto; overflow: auto; min-height: 0; padding: 0 8px 8px; }
.sk-browser.collapsed .sk-browser-info { display: none; }
.sk-browser.collapsed .sk-tree-hdr { display: none; }
/* the tree's own header (title + the new-sketch "+") is folded into the card's header bar: title hidden, "+" pinned at the bar's right */
.sk-browser .sk-tree-hdr { position: absolute; top: 3px; right: 8px; padding: 0; }
.sk-browser .sk-tree-title { display: none; }
@media (min-width: ${BROWSER_PHONE_BREAKPOINT}px) {
  .sk-browser { position: absolute; top: 8px; left: 8px; z-index: 20; width: 248px; max-height: calc(100% - 16px); backdrop-filter: blur(3px); }
}
@media ${SHORT_VIEWPORT_QUERY} {
  .sk-browser-head { min-height: 44px; padding: 0 52px 0 2px; }
  .sk-browser .sk-tree-hdr { top: 0; right: 4px; }
  .sk-browser .sk-browser-toggle, .sk-browser .sk-tree-add, .sk-browser .sk-sketch-eye, .sk-browser .sk-sketch-radio { min-width: 44px; min-height: 44px;
    display: inline-flex; align-items: center; justify-content: center; }
}
@media (max-width: ${BROWSER_PHONE_BREAKPOINT - 1}px) {
  .sk-browser { border-radius: 0; background: var(--sk-browser-solid, #f8fafc); }
  .sk-browser-head { padding: 8px 76px 8px 12px; }
  .sk-browser .sk-tree-hdr { top: 7px; right: 40px; } /* left of the drawer's close X */
}
`;
  document.head.appendChild(s);
  stylesInjected = true;
}

export function mountDesignBrowser({ container, state, engine, toggleHost = null, label = 'Sketches' } = {}) {
  if (!container) throw new Error('mountDesignBrowser: container is required');
  injectStyles();
  container.classList.add('sk-browser-host');
  const el = document.createElement('aside'); el.className = 'sk-browser'; el.setAttribute('aria-label', label);
  const head = document.createElement('div'); head.className = 'sk-browser-head';
  const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'sk-browser-toggle'; toggle.setAttribute('aria-label', 'Collapse or expand the browser');
  const title = document.createElement('span'); title.className = 'sk-browser-title'; title.textContent = label;
  head.append(toggle, title);
  const info = document.createElement('div'); info.className = 'sk-browser-info';
  el.append(head, info);
  container.appendChild(el);
  const panel = createDesignInfoPanel({ state, engine, showSketchTree: true });
  panel.render(info);

  const apply = (c) => {
    el.classList.toggle('collapsed', c);
    toggle.textContent = c ? '▸' : '▾';
    toggle.title = c ? 'Expand' : 'Collapse';
  };
  const stored = () => SettingsManager.get('BROWSER_COLLAPSED') === true;
  apply(isShortViewport() || stored());
  onShortViewportChange((short) => apply(short || stored())); // a rotation: landscape collapses, portrait brings back the stored state (never written here)
  toggle.addEventListener('click', () => { const c = !el.classList.contains('collapsed'); apply(c); SettingsManager.set('BROWSER_COLLAPSED', c); });

  const drawer = createMobileDrawer({ panelEl: el, label, breakpoint: BROWSER_PHONE_BREAKPOINT, hideOnMobile: [toggle], side: 'right' });
  if (toggleHost) toggleHost.appendChild(drawer.toggleEl);

  let lastSig = '';
  const tick = () => {
    let vsum = 0; for (const c of state.constraints) if (typeof c.value === 'number') vsum += c.value;
    const sig = state.constraints.length + ':' + ((state.shapes && state.shapes.length) || 0) + ':' + ((state.joints && state.joints.size) || 0) + ':' + vsum.toFixed(1)
      + ':' + (state.selectedConstraints ? state.selectedConstraints.size : 0) + ':' + sketchesSignature(state);
    if (sig !== lastSig) { lastSig = sig; panel.refresh(); }
  };
  return { el, panel, drawer, tick, refresh: () => panel.refresh() };
}
