// packages/ui/app-header.js — the ONE shared, declared app header across all four hosts.
// Desktop holds: the ☰ app-menu button + the host's stage buttons. (TASK 776: THE Save button and THE account avatar are in the footer's right end, footer-slot.js.) Same layout, order, sizes and spacing everywhere;
// each app themes it via --sk-header-* / --sk-selection tokens. Scrolls sideways when narrow. Hidden at the phone breakpoint
// and in short landscape (SHORT_VIEWPORT_QUERY), where stage buttons and the peeking drawer handle live in app-sidebar.js.
// TASK 880: a stage may DECLARE its own ACTIONS (`actions` on the stage, see buildStageAction): the shown stage's sit at the header's right end, compact (an icon and
// its label; below STAGE_ACTION_ICON_QUERY the icon alone, the label its accessible name). Where the header hides, the drawer lists them under the stage buttons.

import { SHORT_VIEWPORT_QUERY } from './short-viewport.js';

/** Where the header bar is hidden (a phone, a phone in landscape), declared once. TASK 880: the drawer (app-sidebar.js) shows a stage's actions there. */
export const HEADER_HIDDEN_QUERY = `(max-width: 640px), ${SHORT_VIEWPORT_QUERY}`;
/** TASK 880: below this width a stage action in the header shows its icon only (its label stays its accessible name and the host's tooltip). */
const STAGE_ACTION_ICON_QUERY = '(max-width: 1000px)';

/**
 * TASK 880: ONE stage action, DECLARED by the host on the stage ({ id, label, icon?, onClick?, href?, variant?, data? }), built the same way for the header and the drawer:
 *   id       the element's id in the header (a test and the host find it by it); every copy carries it as data-action
 *   label    its text and accessible name; icon: inline SVG markup (currentColor)
 *   onClick  what a press does; href: a link that opens in a new tab instead
 *   variant  'primary' | 'accent': the filled looks (the host's --sk-selection / --sk-header-accent); none = the plain outlined look
 *   data     extra data-* attributes (a host's tooltip key, e.g. { hint: 'generateSvg' })
 * opts: className, withId (the header's copy only: one element per id), before() (run first, e.g. the drawer closes).
 */
export function buildStageAction(a, { className, withId = true, before = null } = {}) {
  const b = document.createElement(a.href ? 'a' : 'button');
  if (a.href) Object.assign(b, { href: a.href, target: '_blank', rel: 'noopener noreferrer' });
  else b.type = 'button';
  if (withId && a.id) b.id = a.id;
  b.className = className;
  b.dataset.action = a.id;
  if (a.variant) b.dataset.variant = a.variant;
  for (const [k, v] of Object.entries(a.data || {})) b.dataset[k] = v;
  b.setAttribute('aria-label', a.label);
  const ic = document.createElement('span'); ic.className = 'sk-action-ic'; ic.setAttribute('aria-hidden', 'true'); ic.innerHTML = a.icon || '';
  const text = document.createElement('span'); text.className = 'sk-action-label'; text.textContent = a.label;
  b.append(ic, text);
  b.addEventListener('click', (e) => { if (before) before(); if (a.onClick) a.onClick(e); });
  return b;
}

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
/* TASK 880: the shown stage's declared actions, at the right end */
.sk-header-actions { display: flex; align-items: center; gap: 6px; margin-left: auto; }
.sk-header-stage-actions { display: flex; align-items: center; gap: 6px; }
.sk-header-stage-actions[hidden] { display: none; }
.sk-header-action {
  display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px; box-sizing: border-box;
  border: 1px solid var(--sk-header-sep, #cbd5e1); border-radius: 6px; background: transparent; color: inherit; cursor: pointer;
  font: 500 13px/1 system-ui, -apple-system, 'Segoe UI', sans-serif; white-space: nowrap; text-decoration: none;
}
.sk-header-action:hover { background: var(--sk-header-hover, rgba(0,0,0,0.05)); }
.sk-header-action[data-variant="primary"] { background: var(--sk-selection, #3B82F6); border-color: transparent; color: #fff; }
.sk-header-action[data-variant="accent"] { background: var(--sk-header-accent, #059669); border-color: transparent; color: #fff; }
.sk-header-action[data-variant]:hover { filter: brightness(1.1); }
.sk-header-action .sk-action-ic { display: inline-flex; align-items: center; }
.sk-header-action .sk-action-ic:empty { display: none; }
.sk-header-action .sk-action-ic svg { width: 16px; height: 16px; }
@media ${STAGE_ACTION_ICON_QUERY} {
  .sk-header-action { width: 34px; padding: 0; justify-content: center; }
  .sk-header-action .sk-action-label { display: none; }
}
@media ${HEADER_HIDDEN_QUERY} {
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
  const actionGroups = new Map(); // TASK 880: stage id -> its actions' group (only stages that declare actions)
  const actionsEl = document.createElement('div');
  actionsEl.className = 'sk-header-actions';

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
    if (Array.isArray(t.actions) && t.actions.length) {
      const g = document.createElement('div');
      g.className = 'sk-header-stage-actions'; g.dataset.stage = t.id;
      for (const a of t.actions) g.appendChild(buildStageAction(a, { className: 'sk-header-action' }));
      actionGroups.set(t.id, g);
      actionsEl.appendChild(g);
    }
  }
  if (actionGroups.size) el.appendChild(actionsEl);

  function setActiveTab(id) {
    current = id;
    for (const [k, b] of tabBtns) b.classList.toggle('active', k === id);
    for (const [k, g] of actionGroups) g.hidden = k !== id;
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
