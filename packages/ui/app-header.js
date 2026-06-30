// packages/ui/app-header.js — the shared, configurable app header shell (S7c-2a).
// App-agnostic chrome: a host hands it the app's tabs + actions; it renders a tab strip (the host routes the view
// on change) + a right-aligned actions area with a built-in Style button (opens the shared style panel, wired by
// the host in S7c-2c) + per-app action buttons (e.g. Debug). Themed via --sk-* (light defaults → SketchStudio; a
// dark :root → Shaper) from the SAME component. Self-contained: injects its <style> once; imports nothing.
// Both shells use this: SketchStudio (tabs Design|Export) first; Shaper folds its S6 mode-nav in later.

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined' || !document.head) return;
  if (document.getElementById('sk-header-styles')) { stylesInjected = true; return; }
  const s = document.createElement('style');
  s.id = 'sk-header-styles';
  s.textContent = `
.sk-header { display: flex; align-items: center; gap: 8px; padding: 4px 10px; box-sizing: border-box;
  background: var(--sk-header-bg, #fff); border-bottom: 1px solid var(--sk-header-sep, #e2e8f0);
  color: var(--sk-header-fg, #334155); font: 13px system-ui, sans-serif; }
.sk-header * { box-sizing: border-box; }
.sk-header-tabs { display: flex; gap: 4px; align-items: center; }
.sk-header-tab { background: transparent; color: inherit; border: 0; border-radius: 6px; padding: 6px 14px;
  cursor: pointer; font: inherit; opacity: 0.7; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.sk-header-tab:hover { background: var(--sk-header-hover, rgba(0,0,0,0.05)); opacity: 0.95; }
.sk-header-tab.active { background: var(--sk-selection, #3B82F6); color: #fff; opacity: 1; }
.sk-header-spacer { flex: 1 1 auto; }
.sk-header-actions { display: flex; gap: 6px; align-items: center; }
.sk-header-action, .sk-header-style { background: transparent; color: inherit; cursor: pointer; font: inherit;
  border: 1px solid var(--sk-header-sep, #cbd5e1); border-radius: 6px; padding: 5px 12px; opacity: 0.85;
  display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.sk-header-action:hover, .sk-header-style:hover { background: var(--sk-header-hover, rgba(0,0,0,0.05)); opacity: 1; }
.sk-header-ic { display: inline-flex; align-items: center; }
`;
  document.head.appendChild(s);
  stylesInjected = true;
}

/**
 * createAppHeader({ tabs, actions, onTabChange, activeTab, onStyle, styleButton, styleLabel, styleIcon })
 *   → { el, render(container), setActiveTab(id), getActiveTab(), destroy }
 *   tabs: [{ id, label, icon? }]    — a tab strip; click → setActiveTab(id) + onTabChange(id) (host routes views).
 *   actions: [{ id, label, icon?, title?, onClick }] — per-app buttons (e.g. Debug), right-aligned.
 *   onTabChange(id): fired on a USER tab click (NOT on the programmatic setActiveTab, to avoid router loops).
 *   activeTab: initial active id (defaults to the first tab).
 *   onStyle(): the built-in Style button's click (host opens the shared style panel). styleButton:false hides it.
 *   icon strings are raw inline markup / text / emoji (kept app-agnostic; the host supplies them).
 */
export function createAppHeader({ tabs = [], actions = [], onTabChange = null, activeTab = null,
  onStyle = null, styleButton = true, styleLabel = 'Style', styleIcon = '⚙', leading = null } = {}) {
  injectStyles();

  const el = document.createElement('header'); el.className = 'sk-header';
  const tabsEl = document.createElement('nav'); tabsEl.className = 'sk-header-tabs';
  const spacer = document.createElement('span'); spacer.className = 'sk-header-spacer';
  const actionsEl = document.createElement('div'); actionsEl.className = 'sk-header-actions';
  if (leading) el.appendChild(leading); // SWITCH-1: an optional brand/app-switcher slot, before the tabs
  el.append(tabsEl, spacer, actionsEl);

  let activeId = activeTab != null ? activeTab : (tabs[0] && tabs[0].id);

  function setActive(id, fire) {
    activeId = id;
    tabBtns.forEach((b) => b.classList.toggle('active', b.dataset.tab === id));
    if (fire && typeof onTabChange === 'function') { try { onTabChange(id); } catch (_) {} }
  }

  const tabBtns = tabs.map((t) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'sk-header-tab'; b.dataset.tab = t.id;
    b.innerHTML = (t.icon ? `<span class="sk-header-ic">${t.icon}</span>` : '') + `<span>${t.label || ''}</span>`;
    b.addEventListener('click', () => setActive(t.id, true)); // user click → route
    tabsEl.appendChild(b);
    return b;
  });

  if (styleButton) {
    const sb = document.createElement('button'); sb.type = 'button'; sb.className = 'sk-header-style'; sb.dataset.action = 'style';
    sb.title = styleLabel;
    sb.innerHTML = (styleIcon ? `<span class="sk-header-ic">${styleIcon}</span>` : '') + `<span>${styleLabel}</span>`;
    sb.addEventListener('click', () => { if (typeof onStyle === 'function') { try { onStyle(); } catch (_) {} } });
    actionsEl.appendChild(sb);
  }
  (actions || []).forEach((a) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'sk-header-action';
    if (a.id) b.id = a.id; b.dataset.action = a.id || ''; b.title = a.title || a.label || '';
    b.innerHTML = (a.icon ? `<span class="sk-header-ic">${a.icon}</span>` : '') + `<span>${a.label || ''}</span>`;
    b.addEventListener('click', () => { try { a.onClick && a.onClick(); } catch (_) {} });
    actionsEl.appendChild(b);
  });

  if (activeId != null) setActive(activeId, false); // initial highlight, no route

  return {
    el,
    render: (container) => { if (container) container.appendChild(el); return el; },
    setActiveTab: (id) => setActive(id, false), // programmatic (host sync) — does NOT fire onTabChange
    getActiveTab: () => activeId,
    destroy: () => { try { el.remove(); } catch (_) {} },
  };
}
