// packages/ui/app-sidebar.js — the shared APP SIDEBAR (TASK 473), modelled on Shaper Studio's: a hamburger button in the header
// opens a dark left drawer with the DOCUMENT name, the host's ACTIONS, and a darker "GO TO" section listing the apps.
// It replaces the old #ui/app-switcher.js dropdown (the app roster lives here now, one source).
//
// DECLARED per host — the sidebar never knows host specifics:
//   createAppSidebar({ current, docName, actions, apps? }) → { el, open, close, toggle, isOpen, setDocName, setActions, destroy }
//     current  the host's app id (marks it in GO TO and names the header button)
//     docName  the document name shown at the top (a string)
//     actions  a plain DECLARED array a project store can extend later:
//              { id, label, icon?, onClick, enabled?: boolean | () => boolean, tooltip?, confirm?: 'message' }
//              or { divider: true }.  `confirm` makes the row ask inline (Cancel / OK) before running onClick.
//   views    OPTIONAL extra VIEWS the drawer can show instead of the main list (e.g. a Projects browser that drills down from
//            projects to designs and back): { [id]: { title, render(container, { go, back, close }) } }. The main view (document
//            name, actions, GO TO) is the built-in view 'main'; `showView(id)` swaps the drawer body, a back arrow returns to
//            'main' (or `back()` / `go('other')` from inside a view, so a view can drill down by re-rendering itself).
//   `el` is the header button; the drawer + backdrop live on document.body.
// Esc closes, an outside click (the backdrop) closes, Tab is trapped inside while open, focus returns to the button on close.
// Themed through --sk-sidebar-* tokens that fall back to each host's own --sk-header-* palette (Shaper sets the dark Studio
// tokens in its index.html). Below 768px the drawer is 85vw wide — the same slide-over pattern as #ui/mobile-drawer.js.

// The app roster, names and icons come from THE registry (#ui/app-registry.js): one source for GO TO, the tab title and the favicon.
import { APPS } from './app-registry.js';
export { APPS };

// Icons for the common actions (inline SVG, currentColor) so hosts reference them by key instead of drawing their own.
export const SIDEBAR_ICONS = {
  download: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2v9M5.5 7.5L9 11l3.5-3.5M3 14.5h12"/></svg>',
  new: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 2.5H5a1.5 1.5 0 0 0-1.5 1.5v10A1.5 1.5 0 0 0 5 15.5h8A1.5 1.5 0 0 0 14.5 14V6.5zM10.5 2.5v4h4M9 9v4M7 11h4"/></svg>',
};

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined' || !document.head) return;
  if (document.getElementById('sk-sidebar-styles')) { stylesInjected = true; return; }
  const s = document.createElement('style'); s.id = 'sk-sidebar-styles';
  s.textContent = `
.sk-sidebar-btn { display: inline-flex; align-items: center; gap: 8px; background: transparent; color: inherit; cursor: pointer;
  border: 1px solid var(--sk-header-sep, var(--sk-ribbon-sep, rgba(127,127,127,0.35))); border-radius: 6px; padding: 4px 9px; font: inherit; font-weight: 700; }
.sk-sidebar-btn:hover { background: var(--sk-header-hover, rgba(127,127,127,0.12)); }
.sk-sidebar-burger { font-size: 1.15em; line-height: 1; }
.sk-sidebar-backdrop { position: fixed; inset: 0; z-index: 9400; background: rgba(0,0,0,0.45); }
.sk-sidebar-backdrop[hidden] { display: none; }
.sk-sidebar { position: fixed; top: 0; bottom: 0; left: 0; z-index: 9500; width: 280px; max-width: 85vw; box-sizing: border-box; display: flex; flex-direction: column;
  background: var(--sk-sidebar-bg, var(--sk-header-bg, #fff)); color: var(--sk-sidebar-fg, var(--sk-header-fg, #1e293b));
  font: 14px system-ui, sans-serif; box-shadow: 2px 0 20px rgba(0,0,0,0.4); transform: translateX(-100%); transition: transform 0.18s ease; visibility: hidden; }
.sk-sidebar.open { transform: translateX(0); visibility: visible; }
.sk-sidebar-top { padding: 16px 16px 8px; }
.sk-sidebar-doc { font-size: 17px; font-weight: 600; margin: 0 0 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sk-sidebar-actions { display: flex; flex-direction: column; gap: 2px; padding: 0 8px 12px; }
.sk-sidebar-item { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; background: transparent; color: inherit; border: 0; border-radius: 8px;
  padding: 9px 10px; cursor: pointer; font: inherit; }
.sk-sidebar-item:hover:not(:disabled) { background: var(--sk-sidebar-hover, rgba(127,127,127,0.14)); }
.sk-sidebar-item:disabled { opacity: 0.4; cursor: not-allowed; }
.sk-sidebar-appic svg { width: 24px; height: 24px; display: block; }
.sk-sidebar-appic { width: 24px !important; height: 24px !important; }
.sk-sidebar-check { margin-left: auto; opacity: 0.8; }
.sk-sidebar-ic { width: 18px; height: 18px; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; }
.sk-sidebar-sep { height: 1px; margin: 6px 10px; background: var(--sk-sidebar-sep, rgba(127,127,127,0.3)); }
.sk-sidebar-confirm { display: flex; flex-direction: column; gap: 8px; padding: 10px; border-radius: 8px; background: var(--sk-sidebar-hover, rgba(127,127,127,0.14)); font-size: 13px; }
.sk-sidebar-confirm-btns { display: flex; gap: 8px; }
.sk-sidebar-confirm-btns button { flex: 1; padding: 6px; border-radius: 6px; border: 0; cursor: pointer; font: inherit; background: var(--sk-sidebar-bg, #fff); color: inherit; }
.sk-sidebar-confirm-btns button.ok { background: var(--sk-sidebar-accent, var(--sk-selection, #2c65ff)); color: #fff; }
.sk-sidebar-viewhead { padding: 12px 8px 4px; }
.sk-sidebar-view { flex: 1; overflow: auto; padding: 4px 8px 12px; }
.sk-sidebar-goto { margin-top: auto; padding: 14px 8px 18px; background: var(--sk-sidebar-goto-bg, rgba(127,127,127,0.12)); }
.sk-sidebar-goto-title { font-size: 11px; letter-spacing: 0.08em; opacity: 0.6; padding: 0 10px 8px; }
.sk-sidebar-item.current { font-weight: 700; background: var(--sk-sidebar-hover, rgba(127,127,127,0.14)); }
`;
  document.head.appendChild(s); stylesInjected = true;
}

export function createAppSidebar({ current, docName = 'Untitled', actions = [], apps = APPS, views = {} } = {}) {
  injectStyles();
  const list = Array.isArray(apps) && apps.length ? apps : APPS;
  const cur = list.find((a) => a.id === current) || list[0];
  let acts = Array.isArray(actions) ? actions : [];
  let name = docName;
  let isOpenFlag = false;
  let viewId = 'main';
  const viewDefs = { ...views };

  const el = document.createElement('button'); // the header button
  el.type = 'button'; el.className = 'sk-sidebar-btn'; el.title = 'Menu'; el.setAttribute('aria-label', 'Menu'); el.setAttribute('aria-haspopup', 'dialog'); el.setAttribute('aria-expanded', 'false');
  el.innerHTML = `<span class="sk-sidebar-burger" aria-hidden="true">&#9776;</span><span class="sk-sidebar-name">${cur ? cur.name : 'App'}</span>`;

  const backdrop = document.createElement('div'); backdrop.className = 'sk-sidebar-backdrop'; backdrop.hidden = true;
  const drawer = document.createElement('aside'); drawer.className = 'sk-sidebar'; drawer.setAttribute('role', 'dialog'); drawer.setAttribute('aria-modal', 'true'); drawer.setAttribute('aria-label', 'App menu');
  document.body.append(backdrop, drawer);

  const enabledOf = (a) => (typeof a.enabled === 'function' ? !!a.enabled() : a.enabled !== false);

  // a registered extra view: a back-arrow header + a container the view renders into
  function renderView(def) {
    const head = document.createElement('div'); head.className = 'sk-sidebar-viewhead';
    const back = document.createElement('button'); back.type = 'button'; back.className = 'sk-sidebar-item sk-sidebar-back'; back.setAttribute('aria-label', 'Back');
    back.innerHTML = `<span class="sk-sidebar-ic" aria-hidden="true">&#8592;</span><span>${def.title || ''}</span>`;
    back.addEventListener('click', () => showView('main'));
    head.appendChild(back); drawer.appendChild(head);
    const body = document.createElement('div'); body.className = 'sk-sidebar-view'; body.dataset.view = viewId; drawer.appendChild(body);
    try { def.render(body, { go: showView, back: () => showView('main'), close }); } catch (e) { console.error(e); }
  }

  function render() {
    drawer.innerHTML = '';
    if (viewId !== 'main' && viewDefs[viewId]) { renderView(viewDefs[viewId]); return; }
    viewId = 'main';
    const top = document.createElement('div'); top.className = 'sk-sidebar-top';
    const h = document.createElement('h2'); h.className = 'sk-sidebar-doc'; h.textContent = name; top.appendChild(h);
    drawer.appendChild(top);
    const box = document.createElement('div'); box.className = 'sk-sidebar-actions'; box.dataset.section = 'actions';
    for (const a of acts) {
      if (a.divider) { const d = document.createElement('div'); d.className = 'sk-sidebar-sep'; box.appendChild(d); continue; }
      const b = document.createElement('button'); b.type = 'button'; b.className = 'sk-sidebar-item'; b.dataset.action = a.id;
      b.innerHTML = `<span class="sk-sidebar-ic" aria-hidden="true">${a.icon || ''}</span><span>${a.label}</span>`;
      b.disabled = !enabledOf(a);
      if (a.tooltip) b.title = a.tooltip;
      b.addEventListener('click', () => {
        if (b.disabled) return;
        if (a.confirm) { askConfirm(b, a); return; }
        close(); try { a.onClick && a.onClick(); } catch (e) { console.error(e); }
      });
      box.appendChild(b);
    }
    drawer.appendChild(box);
    const go = document.createElement('div'); go.className = 'sk-sidebar-goto'; go.dataset.section = 'goto';
    go.innerHTML = '<div class="sk-sidebar-goto-title">GO TO</div>';
    for (const app of list) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'sk-sidebar-item' + (app.id === (cur && cur.id) ? ' current' : ''); b.dataset.app = app.id;
      if (app.id === (cur && cur.id)) b.setAttribute('aria-current', 'true');
      b.innerHTML = `<span class="sk-sidebar-ic sk-sidebar-appic" aria-hidden="true">${app.icon}</span><span>${app.name}</span>${app.id === (cur && cur.id) ? '<span class="sk-sidebar-check" aria-hidden="true">&#10003;</span>' : ''}`;
      b.addEventListener('click', () => { close(); if (app.id !== (cur && cur.id)) location.href = app.href; });
      go.appendChild(b);
    }
    drawer.appendChild(go);
  }

  // an inline "are you sure" row (no window.confirm: it is unsupported in some embedded webviews)
  function askConfirm(btn, a) {
    const row = document.createElement('div'); row.className = 'sk-sidebar-confirm'; row.setAttribute('role', 'alertdialog');
    row.innerHTML = `<span></span><div class="sk-sidebar-confirm-btns"><button type="button" class="cancel">Cancel</button><button type="button" class="ok">${a.confirmLabel || a.label}</button></div>`;
    row.querySelector('span').textContent = a.confirm;
    row.querySelector('.cancel').addEventListener('click', () => { render(); firstFocus(); });
    row.querySelector('.ok').addEventListener('click', () => { close(); try { a.onClick && a.onClick(); } catch (e) { console.error(e); } });
    btn.replaceWith(row);
    row.querySelector('.cancel').focus();
  }

  function showView(id) { viewId = viewDefs[id] ? id : 'main'; if (isOpenFlag) { render(); firstFocus(); } }
  const focusables = () => [...drawer.querySelectorAll('button:not(:disabled)')];
  function firstFocus() { const f = focusables(); if (f[0]) f[0].focus(); }

  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'Tab') { // trap focus inside the drawer
      const f = focusables(); if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || !drawer.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !drawer.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    }
  };
  function open() {
    if (isOpenFlag) return;
    isOpenFlag = true; viewId = 'main'; render();
    backdrop.hidden = false; drawer.classList.add('open'); el.setAttribute('aria-expanded', 'true');
    document.addEventListener('keydown', onKey, true);
    firstFocus();
  }
  function close() {
    if (!isOpenFlag) return;
    isOpenFlag = false;
    backdrop.hidden = true; drawer.classList.remove('open'); el.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onKey, true);
    try { el.focus(); } catch (_) {}
  }
  const toggle = () => (isOpenFlag ? close() : open());
  el.addEventListener('click', toggle);
  backdrop.addEventListener('click', close);

  return {
    el, open, close, toggle, isOpen: () => isOpenFlag,
    setDocName(n) { name = n; if (isOpenFlag) render(); },
    showView, registerView(id, def) { viewDefs[id] = def; },
    setActions(a) { acts = Array.isArray(a) ? a : []; if (isOpenFlag) render(); },
    destroy() { close(); try { el.remove(); backdrop.remove(); drawer.remove(); } catch (_) {} },
  };
}
