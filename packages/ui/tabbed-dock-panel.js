// packages/ui/tabbed-dock-panel.js — the shared, app-AGNOSTIC dock widget (per docs/architecture/UI_SHELL.md).
// Pure chrome: no solver / no cut-paths. Both shells (SketchStudio, Shaper) fill its tabs over the shared core.
// Floating + translucent over the canvas · dockable (drag to a screen edge → snaps to a docked strip) ·
// drag-resizable (corner; content that uses an auto-fill grid reflows one icon at a time, floor = 1 wide) ·
// tabbed (horizontal strip) · persists pos/size/active-tab via localStorage + persistKey.
// (DEBT-1: localStorage is fine for v1; swap to an injected persistence adapter later.)
// Themed via --sk-dock-* (falling back to --sk-* / neutral) so each shell's :root retints it. Self-contained:
// injects its own <style> once; imports nothing.

const DOCK_EDGE = 24;        // px proximity to a screen edge that triggers docking
const MIN_W = 56, MIN_H = 80; // resize floor (~1 icon wide)
let stylesInjected = false;

function injectStyles() {
  if (stylesInjected || typeof document === 'undefined' || !document.head) return;
  if (document.getElementById('sk-dock-styles')) { stylesInjected = true; return; }
  const s = document.createElement('style');
  s.id = 'sk-dock-styles';
  s.textContent = `
.sk-dock { position: fixed; z-index: 9000; display: flex; flex-direction: column;
  background: var(--sk-dock-bg, rgba(22,24,28,0.82)); color: var(--sk-dock-text, #e6e6e6);
  border: 1px solid var(--sk-dock-border, rgba(255,255,255,0.14)); border-radius: 10px;
  box-shadow: 0 8px 30px rgba(0,0,0,0.35); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  min-width: ${MIN_W}px; min-height: ${MIN_H}px; font: 12px system-ui, sans-serif; overflow: hidden; }
.sk-dock.sk-dock-hint { outline: 2px dashed var(--sk-dock-accent, var(--sk-selection, #4c9aff)); outline-offset: -2px; }
.sk-dock[data-dock="left"]   { border-radius: 0 10px 10px 0; }
.sk-dock[data-dock="right"]  { border-radius: 10px 0 0 10px; }
.sk-dock[data-dock="top"]    { border-radius: 0 0 10px 10px; }
.sk-dock[data-dock="bottom"] { border-radius: 10px 10px 0 0; }
.sk-dock-header { display: flex; align-items: center; cursor: move; padding: 3px; gap: 3px; flex: 0 0 auto;
  border-bottom: 1px solid var(--sk-dock-border, rgba(255,255,255,0.1)); touch-action: none; }
.sk-dock-detached .sk-dock-header { justify-content: center; padding: 5px; }
.sk-dock-detached .sk-dock-header::before { content: ''; width: 28px; height: 3px; border-radius: 2px;
  background: var(--sk-dock-border, rgba(255,255,255,0.28)); }
.sk-dock-tabs { display: flex; gap: 3px; flex: 1; overflow-x: auto; scrollbar-width: none; }
.sk-dock-tabs::-webkit-scrollbar { display: none; }
.sk-dock-tab { background: transparent; color: inherit; border: 0; border-radius: 6px; padding: 4px 9px;
  cursor: pointer; font: inherit; white-space: nowrap; opacity: 0.68; display: inline-flex; align-items: center; gap: 5px; }
.sk-dock-tab:hover { background: var(--sk-dock-hover, rgba(255,255,255,0.08)); opacity: 0.9; }
.sk-dock-tab.active { background: var(--sk-dock-accent, var(--sk-selection, #4c9aff)); color: #fff; opacity: 1; }
.sk-dock-body { flex: 1 1 auto; overflow: auto; padding: 8px; min-height: 0; }
.sk-dock-resize { position: absolute; right: 0; bottom: 0; width: 16px; height: 16px; cursor: nwse-resize;
  touch-action: none; background: linear-gradient(135deg, transparent 45%, var(--sk-dock-border, rgba(255,255,255,0.35)) 45%); }
.sk-dock[data-dock] .sk-dock-resize { display: none; }
`;
  document.head.appendChild(s);
  stylesInjected = true;
}

function loadState(key) { try { return JSON.parse((localStorage.getItem(key)) || 'null') || {}; } catch (_) { return {}; } }
function saveState(key, st) { try { localStorage.setItem(key, JSON.stringify(st)); } catch (_) { /* storage blocked */ } }

function nearEdge(x, y) {
  const w = window.innerWidth, h = window.innerHeight;
  if (x <= DOCK_EDGE) return 'left';
  if (x >= w - DOCK_EDGE) return 'right';
  if (y <= DOCK_EDGE) return 'top';
  if (y >= h - DOCK_EDGE) return 'bottom';
  return null;
}

/**
 * createTabbedDockPanel({ tabs, persistKey })
 *   tabs: [{ label, icon?, render(container) }]
 *   persistKey: localStorage key for pos/size/active-tab/dock
 * Returns { el, setActiveTab(i), getState(), destroy() }.
 */
export function createTabbedDockPanel({ tabs = [], persistKey = 'sk-dock', tabStripTarget = null } = {}) {
  injectStyles();

  const root = document.createElement('div'); root.className = 'sk-dock';
  const header = document.createElement('div'); header.className = 'sk-dock-header';
  const tabStrip = document.createElement('div'); tabStrip.className = 'sk-dock-tabs';
  const bodyEl = document.createElement('div'); bodyEl.className = 'sk-dock-body';
  const resizeEl = document.createElement('div'); resizeEl.className = 'sk-dock-resize';
  root.append(header, bodyEl, resizeEl);
  // Tab strip: by default atop the panel (in its header). If a host element is given (e.g. the app's nav header),
  // render the strip THERE — the panel then shows only the active tab's content, its header becoming a thin grip.
  if (tabStripTarget) { root.classList.add('sk-dock-detached'); tabStripTarget.appendChild(tabStrip); }
  else { header.appendChild(tabStrip); }

  const st = Object.assign({ left: 80, top: 80, w: 280, h: 320, tab: 0, dock: null }, loadState(persistKey));
  let activeTab = Math.min(Math.max(0, st.tab | 0), Math.max(0, tabs.length - 1));

  const tabBtns = tabs.map((t, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'sk-dock-tab';
    b.innerHTML = (t.icon ? `<span class="sk-dock-icon">${t.icon}</span>` : '') + `<span>${t.label || ('Tab ' + (i + 1))}</span>`;
    b.addEventListener('click', () => setActiveTab(i));
    tabStrip.appendChild(b);
    return b;
  });

  function setActiveTab(i) {
    if (i < 0 || i >= tabs.length) return;
    activeTab = i; st.tab = i;
    tabBtns.forEach((b, j) => b.classList.toggle('active', j === i));
    bodyEl.innerHTML = '';
    try { tabs[i] && tabs[i].render && tabs[i].render(bodyEl); } catch (_) { /* tab render is app code */ }
    save();
  }

  function applyDock(edge) {
    root.dataset.dock = edge;
    root.style.left = root.style.top = root.style.right = root.style.bottom = '';
    root.style.width = root.style.height = '';
    if (edge === 'left')        { root.style.left = '0';   root.style.top = '0'; root.style.height = '100%'; root.style.width = st.w + 'px'; }
    else if (edge === 'right')  { root.style.right = '0';  root.style.top = '0'; root.style.height = '100%'; root.style.width = st.w + 'px'; }
    else if (edge === 'top')    { root.style.top = '0';    root.style.left = '0'; root.style.width = '100%'; root.style.height = st.h + 'px'; }
    else if (edge === 'bottom') { root.style.bottom = '0'; root.style.left = '0'; root.style.width = '100%'; root.style.height = st.h + 'px'; }
  }
  function applyFloat() {
    delete root.dataset.dock;
    root.style.right = root.style.bottom = '';
    root.style.left = st.left + 'px'; root.style.top = st.top + 'px';
    root.style.width = st.w + 'px'; root.style.height = st.h + 'px';
  }
  function applyLayout() { if (st.dock) applyDock(st.dock); else applyFloat(); }
  function save() { saveState(persistKey, st); }

  // ── Move (header drag) — also docks (near edge) / undocks (drag off the edge) ──
  header.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.sk-dock-tab')) return; // let tab clicks through
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const r = root.getBoundingClientRect();
    const ox = startX - r.left, oy = startY - r.top;
    let pending = null;
    const move = (ev) => {
      if (st.dock) { // undock once dragged past the threshold
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) <= DOCK_EDGE) return;
        st.dock = null; applyFloat();
      }
      st.left = ev.clientX - ox; st.top = ev.clientY - oy;
      root.style.left = st.left + 'px'; root.style.top = st.top + 'px';
      pending = nearEdge(ev.clientX, ev.clientY);
      root.classList.toggle('sk-dock-hint', !!pending);
    };
    const up = () => {
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
      root.classList.remove('sk-dock-hint');
      if (pending) { st.dock = pending; applyDock(pending); }
      save();
    };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  });

  // ── Resize (corner drag) ──
  resizeEl.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX, startY = e.clientY, startW = st.w, startH = st.h;
    const move = (ev) => {
      st.w = Math.max(MIN_W, Math.round(startW + (ev.clientX - startX)));
      st.h = Math.max(MIN_H, Math.round(startH + (ev.clientY - startY)));
      root.style.width = st.w + 'px'; root.style.height = st.h + 'px';
    };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); save(); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  });

  applyLayout();
  setActiveTab(activeTab);
  if (typeof document !== 'undefined' && document.body) document.body.appendChild(root);

  return {
    el: root,
    setActiveTab,
    getState: () => ({ ...st }),
    destroy: () => { try { root.remove(); } catch (_) {} try { tabStrip.remove(); } catch (_) {} },
  };
}
