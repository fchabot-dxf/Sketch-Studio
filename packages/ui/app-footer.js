// packages/ui/app-footer.js: the ONE app footer (TASK 618), mounted by every host: a thin row under the work area.
//   left:  Undo, Redo (history-control.js: the same dispatch as Ctrl+Z / Ctrl+Y in the showing stage)
//   right: Construction (hosts that declare `construction`: SketchStudio), Recenter (every host whose Design surface the footer is told about)
// mountAppFooter({ router, view, construction, footer }) -> { el, refresh, destroy }
//   router: the host's history router (createHistoryRouter).
//   view(): { svg, state } of the Design surface that shows now, or null while the stage has none (Pen Plotter's Toolpath, Shaper's Explore ...):
//     Construction and Recenter are hidden then. Recenter is pan-zoom.js fitViewToExtents (the app's one view fit).
//   construction: true where the host draws construction geometry with a toggle (the K key and the button); today SketchStudio only.
//   footer: an element the host already has (SketchStudio's status bar): the groups go into it. Without one a footer is created at the page's bottom
//     (position fixed; body gets class sk-has-footer and the height is --sk-footer-h, which a host with absolutely placed views subtracts).
import { mountHistoryButtons } from '#ui/history-control.js';
import { ensureIconSymbols } from '#ui/cursor-manager.js';
import { fitViewToExtents } from '#ui/input-handlers/pan-zoom.js';
import { dbg } from '#core/debug.js';

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined' || !document.head) return;
  const s = document.createElement('style');
  s.id = 'sk-footer-styles';
  s.textContent = `
:root { --sk-footer-h: 40px; --sk-footer-btn-w: 32px; --sk-footer-btn-h: 32px; --sk-footer-btn-icon: 22px; }
@media (pointer: coarse) {
  :root { --sk-footer-btn-w: 56px; --sk-footer-btn-h: 44px; --sk-footer-btn-icon: 28px; --sk-footer-h: var(--sk-footer-btn-h); }
  body .sk-footer { border-top: 0; box-shadow: inset 0 1px 0 var(--sk-header-sep, #cbd5e1); }
  body .sk-statusbar { height: var(--sk-footer-h); min-height: 0; padding: 0 10px !important; border-top-width: 0 !important; box-shadow: inset 0 1px 0 var(--sk-header-sep, #cbd5e1); }
}
/* The short viewport (a phone in landscape, short-viewport.js): a footer row would cost the canvas 45 px of 360, so the footer FLOATS over the canvas's bottom edge, right of the
   tool rail (no background, only the buttons take the pointer) and reserves no height: the canvas keeps its share. */
@media (max-height: 500px) and (orientation: landscape) and (pointer: coarse) {
  :root { --sk-footer-h: 0px; --sk-rail-w: 56px; }
  body .sk-footer, body .sk-statusbar { position: fixed !important; left: var(--sk-rail-w); right: 0; bottom: 0; height: var(--sk-footer-btn-h); padding: 0 8px !important; gap: 6px; background: transparent !important; border: 0 !important; box-shadow: none !important; pointer-events: none; z-index: 30; }
  body .sk-footer, body .sk-statusbar { justify-content: flex-start !important; } /* one cluster at the bottom-left, clear of a host's own right-hand panel (Pen Plotter's Design panel) */
  body .sk-footer-end { margin-left: 0; }
  body .sk-footer .sk-history-btn, body .sk-footer .sk-footer-btn, body .sk-statusbar .sk-history-btn, body .sk-statusbar .sk-footer-btn { pointer-events: auto; background: var(--sk-header-bg, #f1f5f9); box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
}
.sk-footer { position: fixed; left: 0; right: 0; bottom: 0; z-index: 30; display: flex; align-items: center; justify-content: space-between; gap: 8px; box-sizing: border-box;
  height: var(--sk-footer-h); padding: 0 10px; background: var(--sk-header-bg, #f1f5f9); border-top: 1px solid var(--sk-header-sep, #cbd5e1); color: var(--sk-header-fg, #334155); }
.sk-footer-end { display: inline-flex; align-items: center; gap: 4px; margin-left: auto; flex: 0 0 auto; }
body.sk-has-footer { padding-bottom: var(--sk-footer-h); box-sizing: border-box; }
`;
  document.head.appendChild(s);
  stylesInjected = true;
}

const ICON = (id) => `<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#${id}"/></svg>`;

export function mountAppFooter({ router, view = () => null, construction = false, footer = null }) {
  injectStyles();
  ensureIconSymbols(['icon-construction', 'icon-recenter']);
  let el = footer;
  if (!el) {
    el = document.createElement('footer'); el.className = 'sk-footer';
    document.body.classList.add('sk-has-footer');
    document.body.appendChild(el);
  }
  const history = mountHistoryButtons({ router, header: el, before: el.firstChild });
  const end = document.createElement('span'); end.className = 'sk-footer-end';
  el.appendChild(end);

  const mk = (id, label, icon) => {
    const b = document.createElement('button');
    b.type = 'button'; b.id = id; b.className = 'sk-footer-btn'; b.title = label; b.setAttribute('aria-label', label);
    b.innerHTML = ICON(icon);
    end.appendChild(b);
    return b;
  };

  let paintConstruct = null, constructBtn = null;
  if (construction) {
    constructBtn = mk('btn-construct-toggle', 'Construction', 'icon-construction');
    paintConstruct = () => {
      const v = view(); const on = !!(v && v.state.isConstructionMode);
      constructBtn.style.backgroundColor = on ? '#f97316' : '#fed7aa'; // dark orange when active, light orange when idle
      constructBtn.style.color = on ? 'white' : '#9a3412';
      constructBtn.setAttribute('aria-pressed', String(on));
      constructBtn.title = on ? 'Construction: ON (K)' : 'Construction: OFF (K)';
    };
    constructBtn.addEventListener('click', () => {
      const v = view(); if (!v) return;
      const state = v.state;
      if (state.selectedShapes && state.selectedShapes.size > 0) { // shapes selected: toggle THEIR construction state (undoable)
        state.beginUndoGroup('toggle construction');
        for (const sid of state.selectedShapes) { const s = state.shapes.find((x) => x.id === sid); if (s) s.isConstruction = !s.isConstruction; }
        state.saveState();
        state.endUndoGroup();
      } else state.isConstructionMode = !state.isConstructionMode; // else the global mode for the next draws
      paintConstruct();
      dbg.log('ui', '[ui] isConstructionMode set to', state.isConstructionMode);
    });
    document.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.key && e.key.toLowerCase() === 'k' && view()) constructBtn.click();
    });
  }
  const recenterBtn = mk('btn-recenter-view', 'Recenter view', 'icon-recenter');
  recenterBtn.addEventListener('click', () => {
    const v = view(); if (!v) return;
    if (typeof v.fit === 'function') { v.fit(); return; }
    if (v.state && v.state.view) fitViewToExtents(v.svg, v.state.view, v.state);
  });

  const refresh = () => {
    const shown = !!view();
    recenterBtn.hidden = !shown;
    if (constructBtn) { constructBtn.hidden = !shown; if (shown) paintConstruct(); }
  };
  const off = router.onChange(refresh);
  refresh();
  return { el, refresh, destroy: () => { off(); history.destroy(); end.remove(); if (!footer) el.remove(); } };
}
