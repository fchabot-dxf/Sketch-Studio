// packages/ui/app-footer.js: the ONE app footer (TASK 618), mounted by every host: a thin row under the work area.
//   left:  Undo, Redo (history-control.js: the same dispatch as Ctrl+Z / Ctrl+Y in the showing stage),
//          Delete (red filled circle + white X: the exact Delete key path handleDelete), Clear sketch (outlined trash can, near-black ink, after a small gap: one-step undoable clear of active sketch after confirm)
//   right: Recenter (every host whose Design / Explore surface the footer is told about; Construction moved to .sk-canvas-corner in design-browser.js in TASK 619)
// mountAppFooter({ router, view, footer }) -> { el, refresh, destroy }
//   router: the host's history router (createHistoryRouter).
//   view(): { svg, state } of the Design surface that shows now, { fit } for Shaper's Explore, or null while the stage has none (Pen Plotter's Toolpath, ...):
//     Delete / Clear sketch show only while a sketch (`v.state`) is shown; Recenter shows whenever `v` is truthy. Recenter is pan-zoom.js fitViewToExtents (or `v.fit()`).
//   footer: an element the host already has (SketchStudio's status bar): the groups go into it. Without one a footer is created at the page's bottom
//     (position fixed; body gets class sk-has-footer and the height is --sk-footer-h, which a host with absolutely placed views subtracts).
import { mountHistoryButtons } from '#ui/history-control.js';
import { ensureIconSymbols } from '#ui/cursor-manager.js';
import { fitViewToExtents } from '#ui/input-handlers/pan-zoom.js';
import { handleDelete } from '#ui/input-manager.js';
import { activeSketchName, canClearActiveSketch, clearActiveSketch, hasSelection } from '#core/delete-manager.js';
import { DEFAULT_SKETCH_ID } from '#core/sketch-model.js';

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined' || !document.head) return;
  const s = document.createElement('style');
  s.id = 'sk-footer-styles';
  s.textContent = `
:root { --sk-footer-h: 40px; --sk-footer-btn-w: 32px; --sk-footer-btn-h: 32px; --sk-footer-btn-icon: 22px; --sk-footer-danger: var(--sk-error, #ef4444); --sk-footer-danger-gap: 6px; }
:where(:root) { --sk-footer-ink: #111827; }
@media (pointer: coarse) {
  :root { --sk-footer-btn-w: 56px; --sk-footer-btn-h: 44px; --sk-footer-btn-icon: 28px; --sk-footer-h: var(--sk-footer-btn-h); }
  body .sk-footer { padding: 0 2px; gap: 2px; border-top: 0; box-shadow: inset 0 1px 0 var(--sk-header-sep, #cbd5e1); }
  body .sk-statusbar { height: var(--sk-footer-h); min-height: 0; padding: 0 2px !important; gap: 2px; border-top-width: 0 !important; box-shadow: inset 0 1px 0 var(--sk-header-sep, #cbd5e1); }
  body .sk-history { gap: 1px; }
  body .sk-footer-start { gap: 4px; }
  body .sk-footer-end { gap: 2px; }
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
.sk-footer-start { display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto; }
.sk-footer-actions { display: inline-flex; align-items: center; gap: var(--sk-footer-danger-gap); flex: 0 0 auto; }
.sk-footer-actions[hidden], .sk-footer-btn[hidden] { display: none; }
.sk-footer-btn.danger { color: var(--sk-footer-danger); }
.sk-footer-btn.danger:disabled { color: var(--sk-muted, #9ca3af); opacity: 0.5; }
.sk-footer-btn.ink { color: var(--sk-footer-ink); }
.sk-footer-end { display: inline-flex; align-items: center; gap: 4px; margin-left: auto; flex: 0 0 auto; }
body.sk-has-footer { padding-bottom: var(--sk-footer-h); box-sizing: border-box; }
.sk-footer-confirm-backdrop { position: fixed; inset: 0; z-index: 9600; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; padding: 16px; }
.sk-footer-confirm { box-sizing: border-box; width: 100%; max-width: 340px; padding: 16px; border-radius: 10px; box-shadow: 0 8px 30px rgba(0,0,0,0.35);
  background: var(--sk-sidebar-bg, var(--sk-header-bg, #fff)); color: var(--sk-sidebar-fg, var(--sk-header-fg, #1e293b));
  border: 1px solid var(--sk-sidebar-sep, var(--sk-header-sep, #cbd5e1)); font: 14px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif; display: flex; flex-direction: column; gap: 14px; }
.sk-footer-confirm-btns { display: flex; justify-content: flex-end; gap: 8px; }
.sk-footer-confirm-btns button { min-width: 76px; min-height: 36px; padding: 6px 14px; border-radius: 6px; border: 1px solid var(--sk-header-sep, rgba(127,127,127,0.35)); background: transparent; color: inherit; font: inherit; font-weight: 600; cursor: pointer; }
.sk-footer-confirm-btns button.ok { background: var(--sk-footer-danger); border-color: transparent; color: #fff; }
@media (pointer: coarse) { .sk-footer-confirm-btns button { min-height: 44px; } }
`;
  document.head.appendChild(s);
  stylesInjected = true;
}

const ICON = (id) => `<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#${id}"/></svg>`;

function askConfirm(message, { okLabel = 'OK', returnFocusTo = null } = {}) {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || !document.body) { resolve(false); return; }
    const backdrop = document.createElement('div');
    backdrop.className = 'sk-footer-confirm-backdrop';
    const box = document.createElement('div');
    box.className = 'sk-footer-confirm';
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    const msgEl = document.createElement('div');
    msgEl.className = 'sk-footer-confirm-msg';
    msgEl.textContent = message;
    const btns = document.createElement('div');
    btns.className = 'sk-footer-confirm-btns';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button'; cancelBtn.className = 'cancel'; cancelBtn.textContent = 'Cancel';
    const okBtn = document.createElement('button');
    okBtn.type = 'button'; okBtn.className = 'ok'; okBtn.textContent = okLabel;
    btns.appendChild(cancelBtn);
    btns.appendChild(okBtn);
    box.appendChild(msgEl);
    box.appendChild(btns);
    backdrop.appendChild(box);

    let done = false;
    const close = (result) => {
      if (done) return;
      done = true;
      if (document.removeEventListener) document.removeEventListener('keydown', onKey, true);
      if (backdrop.remove) backdrop.remove();
      if (returnFocusTo && typeof returnFocusTo.focus === 'function') { try { returnFocusTo.focus(); } catch (_) {} }
      resolve(result);
    };
    function onKey(e) {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); close(false); }
      else if (e.key === 'Tab') {
        const order = [cancelBtn, okBtn];
        const idx = order.indexOf(document.activeElement);
        e.preventDefault();
        order[(idx === -1 ? 0 : (idx + (e.shiftKey ? 1 : 1)) % order.length)].focus();
      }
    }
    cancelBtn.addEventListener('click', () => close(false));
    okBtn.addEventListener('click', () => close(true));
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(false); });
    if (document.addEventListener) document.addEventListener('keydown', onKey, true);
    document.body.appendChild(backdrop);
    if (typeof cancelBtn.focus === 'function') cancelBtn.focus();
  });
}

export function mountAppFooter({ router, view = () => null, footer = null }) {
  injectStyles();
  ensureIconSymbols(['icon-recenter', 'icon-circle-x', 'icon-trash']);
  let el = footer;
  if (!el) {
    el = document.createElement('footer'); el.className = 'sk-footer';
    document.body.classList.add('sk-has-footer');
    document.body.appendChild(el);
  }
  const start = document.createElement('span'); start.className = 'sk-footer-start';
  const end = document.createElement('span'); end.className = 'sk-footer-end';
  el.insertBefore(start, el.firstChild || null);
  el.appendChild(end);

  const history = mountHistoryButtons({ router, header: start });
  const actions = document.createElement('span'); actions.className = 'sk-footer-actions';
  start.appendChild(actions);

  const mk = (parent, id, label, icon, extraClass = '') => {
    const b = document.createElement('button');
    b.type = 'button'; b.id = id;
    b.className = 'sk-footer-btn' + (extraClass ? ' ' + extraClass : '');
    b.title = label; b.setAttribute('aria-label', label);
    b.innerHTML = ICON(icon);
    parent.appendChild(b);
    return b;
  };

  const deleteBtn = mk(actions, 'btn-delete-selection', 'Delete', 'icon-circle-x', 'danger');
  deleteBtn.addEventListener('click', () => {
    const v = view(); if (!v || !v.state) return;
    handleDelete(v.state);
    refresh();
  });

  const clearBtn = mk(actions, 'btn-clear-sketch', 'Clear sketch', 'icon-trash', 'ink');
  clearBtn.addEventListener('click', async () => {
    const v = view(); if (!v || !v.state || !canClearActiveSketch(v.state)) return;
    const ok = await askConfirm(`Clear sketch '${activeSketchName(v.state)}'? This can be undone.`, { okLabel: 'Clear', returnFocusTo: clearBtn });
    if (!ok) return;
    const cur = view(); if (!cur || !cur.state) return;
    clearActiveSketch(cur.state);
    refresh();
  });

  const recenterBtn = mk(end, 'btn-recenter-view', 'Recenter view', 'icon-recenter');
  recenterBtn.addEventListener('click', () => {
    const v = view(); if (!v) return;
    if (typeof v.fit === 'function') { v.fit(); return; }
    if (v.state && v.state.view) fitViewToExtents(v.svg, v.state.view, v.state);
  });

  const sigOf = () => {
    const v = view();
    if (!v) return 'none';
    const st = v.state;
    if (!st) return 'fit';
    const id = st.activeSketchId || DEFAULT_SKETCH_ID;
    const sk = Array.isArray(st.sketches) ? st.sketches.find((s) => s.id === id) : null;
    return [
      (st.shapes && st.shapes.length) || 0,
      (st.joints && st.joints.size) || 0,
      (st.constraints && st.constraints.length) || 0,
      (st.selectedShapes && st.selectedShapes.size) || 0,
      (st.selectedJoints && st.selectedJoints.size) || 0,
      (st.selectedConstraints && st.selectedConstraints.size) || 0,
      id,
      sk && sk.locked === true ? 1 : 0,
    ].join('|');
  };

  let lastSig = '';
  const refresh = () => {
    const v = view();
    const shown = !!v;
    const hasSketch = !!(v && v.state);
    actions.hidden = !hasSketch;
    deleteBtn.hidden = !hasSketch;
    deleteBtn.disabled = !hasSketch || !hasSelection(v.state);
    clearBtn.hidden = !hasSketch;
    clearBtn.disabled = !hasSketch || !canClearActiveSketch(v.state);
    recenterBtn.hidden = !shown;
    lastSig = sigOf();
  };

  const off = router.onChange(refresh);
  let queued = false;
  const scheduleRefresh = () => {
    if (queued) return;
    queued = true;
    const run = () => { queued = false; refresh(); };
    if (typeof queueMicrotask === 'function') queueMicrotask(run);
    else Promise.resolve().then(run);
  };
  const docEvs = ['pointerdown', 'pointerup', 'touchend', 'keyup'];
  if (typeof document !== 'undefined' && document.addEventListener) {
    for (const ev of docEvs) document.addEventListener(ev, scheduleRefresh, false);
  }
  let rafId = null;
  const tick = () => {
    const s = sigOf();
    if (s !== lastSig) refresh();
    rafId = requestAnimationFrame(tick);
  };
  if (typeof requestAnimationFrame === 'function') rafId = requestAnimationFrame(tick);

  refresh();
  return {
    el,
    refresh,
    destroy: () => {
      off();
      if (rafId != null && typeof cancelAnimationFrame === 'function') { cancelAnimationFrame(rafId); rafId = null; }
      if (typeof document !== 'undefined' && document.removeEventListener) {
        for (const ev of docEvs) document.removeEventListener(ev, scheduleRefresh, false);
      }
      history.destroy();
      if (start.remove) start.remove();
      if (end.remove) end.remove();
      if (!footer && el.remove) el.remove();
    },
  };
}
