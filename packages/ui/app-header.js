// packages/ui/app-header.js — the ONE shared, declared app header across all four hosts.
// Desktop holds ONLY: the ☰ app-menu button + the host's stage buttons. Same layout, order, sizes and spacing everywhere;
// each app themes it via --sk-header-* / --sk-selection tokens. Scrolls sideways when narrow. Hidden at the phone breakpoint
// and in short landscape (SHORT_VIEWPORT_QUERY), where stage buttons and the peeking drawer handle live in app-sidebar.js.

import { SHORT_VIEWPORT_QUERY } from './short-viewport.js';

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined' || !document.head) return;
  if (document.getElementById('sk-header-styles')) { stylesInjected = true; return; }
  const s = document.createElement('style');
  s.id = 'sk-header-styles';
  s.textContent = `
.sk-header {
  display: flex; align-items: center; gap: 10px;
  height: var(--sk-header-h, 44px); min-height: var(--sk-header-h, 44px);
  padding: 0 12px; box-sizing: border-box; flex-shrink: 0;
  background: var(--sk-header-bg, #ffffff);
  border-bottom: 1px solid var(--sk-header-sep, #cbd5e1);
  color: var(--sk-header-fg, #334155);
  font: 13px/1.2 system-ui, -apple-system, 'Segoe UI', sans-serif;
  overflow-x: auto; overflow-y: hidden; scrollbar-width: none; -webkit-overflow-scrolling: touch;
}
.sk-header::-webkit-scrollbar { display: none; }
.sk-header * { box-sizing: border-box; }
.sk-header > * { flex-shrink: 0; }
.sk-header-tabs { display: flex; gap: 4px; align-items: center; }
.sk-header-tab {
  display: inline-flex; align-items: center; gap: 6px;
  height: 30px; padding: 0 14px; border: 0; border-radius: 6px;
  background: transparent; color: inherit; cursor: pointer;
  font: 500 13px/1 system-ui, -apple-system, 'Segoe UI', sans-serif;
  opacity: 0.78; white-space: nowrap; transition: background 0.12s, opacity 0.12s;
}
.sk-header-tab:hover { background: var(--sk-header-hover, rgba(0,0,0,0.05)); opacity: 1; }
.sk-header-tab.active { background: var(--sk-selection, #3B82F6); color: #fff; opacity: 1; }
.sk-header-ic { display: inline-flex; align-items: center; }
@media (max-width: 640px), ${SHORT_VIEWPORT_QUERY} {
  .sk-header { display: none !important; }
}
`;
  document.head.appendChild(s);
  stylesInjected = true;
}

/**
 * Build the shared header element: leading ☰ button + stage buttons.
 */
export function createAppHeader({ tabs = [], onTabChange = null, activeTab = null, leading = null } = {}) {
  injectStyles();
  const el = document.createElement('header');
  el.className = 'sk-header';
  const tabsEl = document.createElement('nav');
  tabsEl.className = 'sk-header-tabs';
  if (leading) el.appendChild(leading);
  el.appendChild(tabsEl);

  let current = activeTab ?? (tabs[0] && tabs[0].id) ?? null;
  const tabBtns = new Map();

  for (const t of tabs) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sk-header-tab';
    b.dataset.tab = t.id;
    b.innerHTML = (t.icon ? `<span class="sk-header-ic">${t.icon}</span>` : '') + `<span>${t.label || ''}</span>`;
    b.addEventListener('click', () => {
      if (t.onSelect) t.onSelect(t.id);
      else if (onTabChange) onTabChange(t.id);
    });
    tabBtns.set(t.id, b);
    tabsEl.appendChild(b);
  }

  function setActiveTab(id) {
    current = id;
    for (const [k, b] of tabBtns) b.classList.toggle('active', k === id);
  }
  setActiveTab(current);

  return {
    el,
    setActiveTab,
    getActiveTab: () => current,
    render: (container) => {
      if (container) {
        if (el.parentNode !== container) container.appendChild(el);
      }
      return el;
    },
    destroy: () => { try { el.remove(); } catch (_) {} },
  };
}
