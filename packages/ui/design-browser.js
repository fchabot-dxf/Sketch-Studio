// packages/ui/design-browser.js — the ONE mount path of the Design tab's BROWSER (task 586, replacing 577b's right-hand side panel): the
// shared SKETCHES tree with each sketch's expandable constraint list (createDesignInfoPanel, showSketchTree) in a small card that FLOATS over
// the TOP-LEFT of the canvas, like Fusion's BROWSER. All four hosts (SketchStudio, Shaper, Pen Plotter, Trace) mount it through this function.
//
//   const browser = mountDesignBrowser({ container, state, engine });
//   browser.tick()    call from the host's render loop: refreshes the tree when something it shows changed (cheap signature)
//   browser.panel     the createDesignInfoPanel instance     browser.el  the card     browser.toggleEl  the phone corner button
// container: the element that holds the canvas (a sibling of the canvas <svg>, so the pointer events inside the card never reach the canvas,
// and the ones outside it do). It becomes the card's positioning parent (class sk-browser-host).
// Collapsed: the card shrinks to its header bar. The state is the per-user setting BROWSER_COLLAPSED (SettingsManager, local), not a document field.
// Phones (<= 640 px, the one phone breakpoint, tasks 562 / 581): the SAME floating card is hidden by default and toggled by the layers icon
// button in the canvas's top-right corner (browser.toggleEl, TASK 618 / 623); tapping the layers button again or the card's collapse arrow hides it.
// Phone open/close is ephemeral and separate from desktop's BROWSER_COLLAPSED so phones always start hidden and desktop's setting is untouched.
// Phone LANDSCAPE (the short viewport, #ui/short-viewport.js, TASK 602): the card starts COLLAPSED (the canvas is short), and collapses again each time the
// phone turns into landscape; the user can expand it (that choice is stored like any other). Turning back to portrait / a tall window brings back the stored
// setting. Expanded, it stays inside the canvas (max-height) and scrolls. Its controls are 44 px finger targets there.
// Position: 8 px in from the canvas's top-left corner. The axis numbers (#ui/canvas-grid.js) are drawn along the X and Y axes at the origin,
// not at a fixed screen corner, so they only sit under the card when the user pans an axis there; the card is a Fusion-style overlay.

import { createDesignInfoPanel } from '#ui/design-info-panel.js';
import { ensureIconSymbols } from '#ui/cursor-manager.js';
import { sketchesSignature } from '#core/sketch-model.js';
import SettingsManager from '#core/settings-manager.js';
import { SHORT_VIEWPORT_QUERY, isShortViewport, onShortViewportChange } from '#ui/short-viewport.js';

export const BROWSER_PHONE_BREAKPOINT = 641; // phone toggle below this width: the app's one phone breakpoint is max-width 640

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined' || !document.head) return;
  if (document.getElementById('sk-browser-styles')) { stylesInjected = true; return; }
  const s = document.createElement('style'); s.id = 'sk-browser-styles';
  s.textContent = `
.sk-browser-host { position: relative; }
.sk-browser { display: flex; flex-direction: column; box-sizing: border-box; font: 13px system-ui, sans-serif;
  position: absolute; top: 8px; left: 8px; z-index: 20; width: 248px; max-height: calc(100% - 16px); backdrop-filter: blur(3px);
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
/* TASK 618 / 623: the canvas's top-right corner (the Sketches button, shown only on phones < 641 px) */
.sk-canvas-corner { position: absolute; top: 8px; right: 8px; z-index: 20; display: flex; gap: 8px; }
.sk-browser-corner-btn { display: none; align-items: center; justify-content: center; width: 32px; height: 32px; padding: 0;
  border: 1px solid var(--sk-browser-line, #cbd5e1); border-radius: 6px; cursor: pointer; color: var(--sk-browser-fg, #1f2937);
  background: var(--sk-browser-solid, #f8fafc); box-shadow: 0 1px 2px rgba(0,0,0,0.25); }
.sk-browser-corner-btn svg { width: 22px; height: 22px; pointer-events: none; }
@media (max-width: ${BROWSER_PHONE_BREAKPOINT - 1}px) {
  .sk-browser:not(.sk-browser-open) { display: none; }
  .sk-browser { max-width: calc(100% - 68px); } /* clear of the 44 px corner button at right: 8px */
  .sk-browser-corner-btn { display: inline-flex; }
}
@media (pointer: coarse) {
  .sk-browser-corner-btn { width: 44px; height: 44px; }
  .sk-browser-corner-btn svg { width: 28px; height: 28px; }
  .sk-browser-head { min-height: 44px; padding: 0 52px 0 2px; }
  .sk-browser .sk-tree-hdr { top: 0; right: 4px; }
  .sk-browser .sk-browser-toggle, .sk-browser .sk-tree-add, .sk-browser .sk-sketch-eye, .sk-browser .sk-sketch-radio { min-width: 44px; min-height: 44px;
    display: inline-flex; align-items: center; justify-content: center; }
  .sk-browser .sk-sketch-head, .sk-browser .sk-info-row { min-height: 44px; }
  .sk-browser .sk-sketch-name { padding: 12px 2px; }
}
@media ${SHORT_VIEWPORT_QUERY} {
  .sk-browser-head { min-height: 44px; }
}
`;
  document.head.appendChild(s);
  stylesInjected = true;
}

export function mountDesignBrowser({ container, state, engine, label = 'Sketches' } = {}) {
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

  const phoneMq = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(`(max-width: ${BROWSER_PHONE_BREAKPOINT - 1}px)`) : null;
  const isPhone = () => !!phoneMq && phoneMq.matches;

  const apply = (c) => {
    el.classList.toggle('collapsed', c);
    toggle.textContent = c ? '▸' : '▾';
    toggle.title = c ? 'Expand' : 'Collapse';
  };
  const stored = () => SettingsManager.get('BROWSER_COLLAPSED') === true;
  apply(isShortViewport() || stored());
  onShortViewportChange((short) => apply(short || stored())); // a rotation: landscape collapses, portrait brings back the stored state (never written here)

  // TASK 618 / 623: on phones (< 641 px) the same floating card starts hidden and is toggled by the layers icon button in .sk-canvas-corner
  ensureIconSymbols(['icon-layers']);
  const toggleEl = document.createElement('button');
  toggleEl.type = 'button';
  toggleEl.className = 'sk-browser-corner-btn';
  toggleEl.title = label;
  toggleEl.setAttribute('aria-label', label);
  toggleEl.setAttribute('aria-expanded', 'false');
  toggleEl.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-layers"/></svg>';
  const corner = document.createElement('div'); corner.className = 'sk-canvas-corner';
  corner.appendChild(toggleEl); container.appendChild(corner);

  let phoneOpen = false;
  const syncBtn = () => {
    toggleEl.setAttribute('aria-expanded', String(phoneOpen));
    toggleEl.classList.toggle('active', phoneOpen);
  };
  const openPhone = () => {
    phoneOpen = true;
    el.classList.add('sk-browser-open');
    apply(false); // show expanded card when opened on phone; never writes BROWSER_COLLAPSED
    syncBtn();
  };
  const closePhone = () => {
    phoneOpen = false;
    el.classList.remove('sk-browser-open');
    syncBtn();
  };
  if (phoneMq) phoneMq.addEventListener('change', (e) => { if (!e.matches) { closePhone(); apply(isShortViewport() || stored()); } });

  toggleEl.addEventListener('click', (e) => { e.stopPropagation(); phoneOpen ? closePhone() : openPhone(); });
  toggle.addEventListener('click', () => {
    if (isPhone()) { closePhone(); return; }
    const c = !el.classList.contains('collapsed'); apply(c); SettingsManager.set('BROWSER_COLLAPSED', c);
  });

  let lastSig = '';
  const tick = () => {
    let vsum = 0; for (const c of state.constraints) if (typeof c.value === 'number') vsum += c.value;
    const sig = state.constraints.length + ':' + ((state.shapes && state.shapes.length) || 0) + ':' + ((state.joints && state.joints.size) || 0) + ':' + vsum.toFixed(1)
      + ':' + (state.selectedConstraints ? state.selectedConstraints.size : 0) + ':' + sketchesSignature(state);
    if (sig !== lastSig) { lastSig = sig; panel.refresh(); }
  };
  return { el, panel, toggleEl, close: closePhone, tick, refresh: () => panel.refresh() };
}
