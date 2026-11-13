// packages/ui/design-side-panel.js — the ONE mount path of the Design tab's side panel (task 577b): the shared SKETCHES tree + constraint
// list (createDesignInfoPanel, showSketchTree) in a collapsible right-hand <aside>, which becomes a slide-over drawer below 768 px
// (createMobileDrawer, task 562's layout rules). SketchStudio and Trace mount it through this function; Shaper and Pen Plotter keep their
// older hand-written <aside> and call createDesignInfoPanel with the same arguments (the tree and its controls are the same code).
//
//   const side = mountDesignSidePanel({ container, state, engine, storageKey, toggleHost });
//   side.tick()      call from the host's render loop: refreshes the panel when something it shows changed (cheap signature)
//   side.panel       the createDesignInfoPanel instance     side.el  the <aside>     side.drawer  the mobile drawer
// container: the flex ROW that holds the canvas; the aside is appended to it (flex: 0 0 244px). toggleHost: where the phone-width
// "Panel" button goes (the host's header); omit to place it yourself (side.drawer.toggleEl). Colours come from --sk-side-bg / --sk-side-fg /
// --sk-side-line (light defaults); a dark host sets them.

import { createDesignInfoPanel } from '#ui/design-info-panel.js';
import { createMobileDrawer } from '#ui/mobile-drawer.js';
import { sketchesSignature } from '#core/sketch-model.js';

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined' || !document.head) return;
  if (document.getElementById('sk-side-styles')) { stylesInjected = true; return; }
  const s = document.createElement('style'); s.id = 'sk-side-styles';
  s.textContent = `
.sk-side { flex: 0 0 244px; display: flex; flex-direction: column; min-height: 0; overflow: hidden; box-sizing: border-box;
  background: var(--sk-side-bg, #f8fafc); color: var(--sk-side-fg, #1f2937); border-left: 1px solid var(--sk-side-line, #e2e8f0); transition: flex-basis 0.15s ease; font: 13px system-ui, sans-serif; }
.sk-side.collapsed { flex-basis: 30px; }
.sk-side.collapsed .sk-side-info { display: none; }
.sk-side-toggle { align-self: flex-end; background: transparent; border: 0; color: inherit; opacity: 0.6; cursor: pointer; font: 13px system-ui, sans-serif; padding: 6px 8px; line-height: 1; }
.sk-side-toggle:hover { opacity: 1; }
.sk-side.collapsed .sk-side-toggle { align-self: center; }
.sk-side-info { flex: 1 1 auto; overflow: auto; min-height: 0; padding: 8px; }
`;
  document.head.appendChild(s);
  stylesInjected = true;
}

export function mountDesignSidePanel({ container, state, engine, storageKey = 'design-side-collapsed', toggleHost = null, label = 'Sketches' } = {}) {
  if (!container) throw new Error('mountDesignSidePanel: container is required');
  injectStyles();
  const el = document.createElement('aside'); el.className = 'sk-side'; el.setAttribute('aria-label', label);
  const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'sk-side-toggle'; toggle.setAttribute('aria-label', 'Toggle panel');
  const info = document.createElement('div'); info.className = 'sk-side-info';
  el.append(toggle, info);
  container.appendChild(el);
  const panel = createDesignInfoPanel({ state, engine, showSketchTree: true });
  panel.render(info);

  const setCollapsed = (c) => {
    el.classList.toggle('collapsed', c);
    toggle.textContent = c ? '◀' : '▶';
    toggle.title = c ? 'Expand panel' : 'Collapse panel';
    try { localStorage.setItem(storageKey, c ? '1' : '0'); } catch (_) { /* storage blocked */ }
  };
  let collapsed = false;
  try { collapsed = localStorage.getItem(storageKey) === '1'; } catch (_) { /* storage blocked */ }
  setCollapsed(collapsed);
  toggle.addEventListener('click', () => setCollapsed(!el.classList.contains('collapsed')));

  // below 768 px the aside is a slide-over drawer (the desktop collapse arrow is hidden there); its button goes in the host's header
  const drawer = createMobileDrawer({ panelEl: el, label, hideOnMobile: [toggle], side: 'right' });
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
