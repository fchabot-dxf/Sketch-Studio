// packages/ui/app-sidebar.js — the shared APP SIDEBAR (TASK 473), modelled on Shaper Studio's: a hamburger button in the header
// opens a dark left drawer with the DOCUMENT name and the host's ACTIONS. (TASK 776: the Google account is the round avatar of the header, account-avatar.js; the drawer has no account row.)
// TASK 696: each app is its own website, so the drawer links to no other app (the GO TO section is gone).
//
// DECLARED per host — the sidebar never knows host specifics:
//   createAppSidebar({ current, docName, actions }) → { el, chevron, open, close, toggle, isOpen, setDocName, setActions, destroy }
//     current  the host's app id (names the header button)
//     docName  the document name shown at the top (a string)
//     actions  a plain DECLARED array a project store can extend later:
//              { id, label, icon, onClick, enabled?, tooltip?, confirm?: 'message', prompt?: { label, value(): string, okLabel? }, keepOpen? }
//              or { divider: true }.  `confirm` asks inline (Cancel / OK) before onClick; `prompt` asks for a text inline and calls
//              onClick(text); `keepOpen` leaves the drawer open after the click (an action that opens a view).
//     onRenameDoc(name)  OPTIONAL: when given, clicking the document name edits it inline (Enter commits, Esc cancels).
//     status   OPTIONAL () => { text, kind } the one-line state of the current design under its name ('error' | 'info'); read at every
//              render and by refreshStatus().
//     actions may carry `visible: () => bool` (hidden, not just disabled, when it returns false).
//     notify(text, kind, link?) shows a message line in the drawer ('error' | 'info'), optionally ending in a link { href, label } that opens
//              in a new tab — e.g. the reason a store refused something, or "Saved to Google Drive" + "Open in Drive".
//   views    OPTIONAL extra VIEWS the drawer can show instead of the main list (e.g. a Projects browser that drills down from
//            projects to designs and back): { [id]: { title, render(container, { go, back, close }) } }. The main view (document
//            name, actions) is the built-in view 'main'; `showView(id)` swaps the drawer body, a back arrow returns to
//            'main' (or `back()` / `go('other')` from inside a view, so a view can drill down by re-rendering itself).
//   ask(spec) shows a question inline in the drawer (opening it): { kind: 'choose', label, options: [{ id, label }] } resolves the
//            chosen id, { kind: 'prompt', label, value, okLabel } the typed text; Cancel / Esc / closing the drawer resolves null.
//   `el` is the header button; the drawer + backdrop live on document.body.
// Esc closes, an outside click (the backdrop) closes, Tab is trapped inside while open, focus returns to the button on close.
// Themed through --sk-sidebar-* tokens that fall back to each host's own --sk-header-* palette (Shaper sets the dark Studio
// tokens in its index.html). Below 768px the drawer is 85vw wide — the same slide-over pattern as #ui/mobile-drawer.js.

// The app's name comes from THE registry (#ui/app-registry.js): one source for the header button, the tab title and the favicon.
import { appById } from './app-registry.js';
import { SHORT_VIEWPORT_QUERY } from './short-viewport.js';

// THE gear artwork (Settings), drawn once: the drawer's style / gear items below and the footer's Settings button (app-footer.js) wrap it.
export const GEAR_GLYPH = '<circle cx="9" cy="9" r="2.5"/><path d="M14.2 11a1.2 1.2 0 0 0 .2 1.3l.05.05a1.4 1.4 0 1 1-2 2l-.05-.05a1.2 1.2 0 0 0-1.3-.2 1.2 1.2 0 0 0-.7 1.1V15.5a1.4 1.4 0 1 1-2.8 0v-.1a1.2 1.2 0 0 0-.8-1.1 1.2 1.2 0 0 0-1.3.2l-.05.05a1.4 1.4 0 1 1-2-2l.05-.05a1.2 1.2 0 0 0 .2-1.3 1.2 1.2 0 0 0-1.1-.7H2.5a1.4 1.4 0 0 1 0-2.8h.1a1.2 1.2 0 0 0 1.1-.8 1.2 1.2 0 0 0-.2-1.3l-.05-.05a1.4 1.4 0 1 1 2-2l.05.05a1.2 1.2 0 0 0 1.3.2H7a1.2 1.2 0 0 0 .7-1.1V2.5a1.4 1.4 0 1 1 2.8 0v.1a1.2 1.2 0 0 0 .7 1.1 1.2 1.2 0 0 0 1.3-.2l.05-.05a1.4 1.4 0 1 1 2 2l-.05.05a1.2 1.2 0 0 0-.2 1.3v.1a1.2 1.2 0 0 0 1.1.7h.1a1.4 1.4 0 0 1 0 2.8h-.1a1.2 1.2 0 0 0-1.1.7z"/>';
const GEAR_ICON = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + GEAR_GLYPH + '</svg>';

// Icons for the common actions (inline SVG, currentColor) so hosts reference them by key instead of drawing their own.
export const SIDEBAR_ICONS = {
  download: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2v9M5.5 7.5L9 11l3.5-3.5M3 14.5h12"/></svg>',
  save: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 3.5h9l2 2v9h-11zM6 3.5v4h5v-4M6 14.5v-4h6v4"/></svg>',
  copy: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="9" height="9" rx="1.5"/><path d="M12 6V4.5A1.5 1.5 0 0 0 10.5 3h-6A1.5 1.5 0 0 0 3 4.5v6A1.5 1.5 0 0 0 4.5 12H6"/></svg>',
  recent: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="9" r="6"/><path d="M9 5.5V9l2.5 1.5"/></svg>',
  folder: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 5.5A1.5 1.5 0 0 1 4 4h3l1.5 1.5H14A1.5 1.5 0 0 1 15.5 7v6A1.5 1.5 0 0 1 14 14.5H4A1.5 1.5 0 0 1 2.5 13z"/></svg>',
  open: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11.5V3M5.5 6.5L9 3l3.5 3.5M3 12.5v2h12v-2"/></svg>',
  cloud: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13.5a3 3 0 0 1-.4-5.97A4.5 4.5 0 0 1 13.2 6.6 3.5 3.5 0 0 1 13 13.5zM9 7.5v4M7.3 9.3L9 7.5l1.7 1.8"/></svg>',
  templates: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="4.5" height="4.5" rx="1"/><rect x="10.5" y="3" width="4.5" height="4.5" rx="1"/><rect x="3" y="10.5" width="4.5" height="4.5" rx="1"/><rect x="10.5" y="10.5" width="4.5" height="4.5" rx="1"/></svg>',
  new: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 2.5H5a1.5 1.5 0 0 0-1.5 1.5v10A1.5 1.5 0 0 0 5 15.5h8A1.5 1.5 0 0 0 14.5 14V6.5zM10.5 2.5v4h4M9 9v4M7 11h4"/></svg>',
  style: GEAR_ICON,
  gear: GEAR_ICON, // TASK 727: SketchStudio's "Tune solver" and Shaper's Settings items named it, but it was missing (no icon showed)
  log: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4.5h10M4 9h10M4 13.5h6"/></svg>',
  // TASK 733: a puzzle piece = an add-in (the Shaper sidebar's "Fusion add-in")
  addin: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4.5V4a2 2 0 0 1 4 0v.5h3.5V8H14a2 2 0 0 0 0 4h.5v3.5H11V15a2 2 0 0 0-4 0v.5H3.5V12H4a2 2 0 0 0 0-4h-.5V4.5z"/></svg>',
  chevron: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4l5 5-5 5"/></svg>',
  info: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="9" r="7"/><path d="M9 8v4.5M9 5.4v.1"/></svg>', // TASK 828: About
  debug: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5l4 4-4 4M9.5 13H14"/></svg>',
};

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined' || !document.head) return;
  if (document.getElementById('sk-sidebar-styles')) { stylesInjected = true; return; }
  const s = document.createElement('style'); s.id = 'sk-sidebar-styles';
  s.textContent = `
.sk-sidebar-btn { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px; background: transparent; color: inherit; cursor: pointer;
  border: 1px solid var(--sk-header-sep, var(--sk-ribbon-sep, rgba(127,127,127,0.35))); border-radius: 6px; font: 700 13px/1 system-ui, -apple-system, 'Segoe UI', sans-serif; white-space: nowrap; }
.sk-sidebar-btn:hover { background: var(--sk-header-hover, rgba(127,127,127,0.12)); }
@media (pointer: coarse) { .sk-sidebar-item { min-height: 44px; } }
.sk-sidebar-burger { font-size: 1.15em; line-height: 1; }
.sk-sidebar-backdrop { position: fixed; inset: 0; z-index: 9400; background: rgba(0,0,0,0.45); }
.sk-sidebar-backdrop[hidden] { display: none; }
.sk-sidebar { position: fixed; top: 0; bottom: 0; left: 0; z-index: 9500; width: 280px; max-width: min(85vw, calc(100vw - 44px)); box-sizing: border-box; display: flex; flex-direction: column;
  background: var(--sk-sidebar-bg, var(--sk-header-bg, #fff)); color: var(--sk-sidebar-fg, var(--sk-header-fg, #1e293b));
  font: 14px system-ui, sans-serif; box-shadow: 2px 0 20px rgba(0,0,0,0.4); transform: translateX(-100%); transition: transform 0.18s ease; visibility: hidden; overflow: visible; }
.sk-sidebar.open { transform: translateX(0); visibility: visible; }
/* TASK 602: a menu taller than the screen (a phone in landscape: 360 px) scrolls under a finger instead of cutting its last entries off */
.sk-sidebar-content { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; height: 100%; overflow-y: auto; overscroll-behavior: contain; touch-action: pan-y; }
.sk-sidebar-stages { display: none; }
.sk-sidebar-chevron { display: none; }
@media (max-width: 640px), ${SHORT_VIEWPORT_QUERY} {
  .sk-sidebar-stages { display: flex; flex-wrap: wrap; gap: 6px; padding: 12px 12px 10px; border-bottom: 1px solid var(--sk-sidebar-sep, rgba(127,127,127,0.3)); }
  .sk-sidebar-stage { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; min-width: 44px; padding: 0 12px;
    border: 1px solid var(--sk-sidebar-sep, rgba(127,127,127,0.35)); border-radius: 8px; background: transparent; color: inherit;
    cursor: pointer; font: 600 13px/1 system-ui, -apple-system, 'Segoe UI', sans-serif; }
  .sk-sidebar-stage:hover { background: var(--sk-sidebar-hover, rgba(127,127,127,0.14)); }
  .sk-sidebar-stage.active { background: var(--sk-selection, var(--sk-sidebar-accent, #2c65ff)); border-color: transparent; color: #fff; }
  /* TASK 819: the phone door of the drawer: a chevron at the start of the document tab strip (document-tabs.js mounts it as its first child; it stays at the strip's left edge while the tabs scroll) */
  .sk-sidebar-chevron { display: flex; align-items: center; justify-content: center; position: sticky; left: 0; z-index: 2; flex: 0 0 44px; width: 44px; height: var(--sk-doctabs-h, 30px);
    margin: 0; padding: 0; border: 0; border-radius: 0; background: var(--sk-doctab-strip, var(--sk-header-bg, #fff)); color: var(--sk-header-fg, #334155); cursor: pointer; }
  /* a host with no document tab strip (Shaper in Fusion mode, projects: false) keeps a small tab on the page's left edge, where the old drawer handle sat (a corner chevron would cover that host's own top bar) */
  .sk-sidebar-chevron.free { position: fixed; top: 33%; left: 0; transform: translateY(-50%); z-index: 9300; width: 24px; height: 72px; flex: none; border-radius: 0 10px 10px 0; box-shadow: 2px 0 8px rgba(0,0,0,0.22); }
  .sk-sidebar-chevron svg { transition: transform 0.18s ease; }
  .sk-sidebar-chevron[aria-expanded="true"] svg { transform: rotate(180deg); }
  .sk-sidebar-chevron:focus-visible { outline: 2px solid var(--sk-selection, #3B82F6); outline-offset: -2px; }
}
.sk-sidebar-top { padding: 16px 16px 8px; }
.sk-sidebar-doc { font-size: 17px; font-weight: 600; margin: 0 0 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sk-sidebar-actions { display: flex; flex-direction: column; gap: 2px; padding: 0 8px 12px; }
.sk-sidebar-item { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; background: transparent; color: inherit; border: 0; border-radius: 8px;
  padding: 9px 10px; cursor: pointer; font: inherit; }
.sk-sidebar-item:hover:not(:disabled) { background: var(--sk-sidebar-hover, rgba(127,127,127,0.14)); }
.sk-sidebar-item:disabled { opacity: 0.4; cursor: not-allowed; }
.sk-sidebar-ic { width: 18px; height: 18px; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; }
.sk-sidebar-sep { height: 1px; margin: 6px 10px; background: var(--sk-sidebar-sep, rgba(127,127,127,0.3)); }
.sk-sidebar-confirm { display: flex; flex-direction: column; gap: 8px; padding: 10px; border-radius: 8px; background: var(--sk-sidebar-hover, rgba(127,127,127,0.14)); font-size: 13px; }
.sk-sidebar-confirm-btns { display: flex; gap: 8px; }
.sk-sidebar-confirm-btns button { flex: 1; padding: 6px; border-radius: 6px; border: 0; cursor: pointer; font: inherit; background: var(--sk-sidebar-bg, #fff); color: inherit; }
.sk-sidebar-confirm-btns button.ok { background: var(--sk-sidebar-accent, var(--sk-selection, #2c65ff)); color: #fff; }
.sk-sidebar-doc.renamable { cursor: text; border-radius: 6px; padding: 2px 4px; margin-left: -4px; }
.sk-sidebar-doc.renamable:hover { background: var(--sk-sidebar-hover, rgba(127,127,127,0.14)); }
.sk-sidebar-input { box-sizing: border-box; width: 100%; background: var(--sk-sidebar-hover, rgba(127,127,127,0.14)); color: inherit; border: 1px solid var(--sk-sidebar-accent, #2c65ff); border-radius: 6px; padding: 6px 8px; font: inherit; }
.sk-sidebar-docinput { font-size: 17px; font-weight: 600; margin: 0 0 10px; }
.sk-sidebar-msg { margin: 6px 0 0; padding: 8px 10px; border-radius: 8px; font-size: 13px; line-height: 1.4; background: var(--sk-sidebar-hover, rgba(127,127,127,0.14)); }
.sk-sidebar-msg.error { background: rgba(220, 60, 60, 0.18); color: #ff9c9c; }
.sk-sidebar-msg a { color: inherit; font-weight: 600; margin-left: 6px; }
.sk-sidebar-status { margin: -4px 0 8px; font-size: 12.5px; line-height: 1.35; opacity: 0.75; }
.sk-sidebar-status.error { opacity: 1; color: #ff9c9c; }
.sk-sidebar-status-act { background: none; border: 0; padding: 0; color: inherit; font: inherit; text-decoration: underline; cursor: pointer; }
.sk-row-main { display: flex; flex-direction: column; min-width: 0; flex: 1; text-align: left; }
.sk-row-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sk-row-sub { font-size: 12px; opacity: 0.6; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sk-row-wrap { display: flex; align-items: center; }
.sk-row-wrap .sk-row { flex: 1; min-width: 0; }
.sk-row-menu { background: transparent; color: inherit; border: 0; cursor: pointer; font-size: 18px; padding: 4px 8px; border-radius: 6px; opacity: 0.7; }
.sk-row-menu:hover { background: var(--sk-sidebar-hover, rgba(127,127,127,0.14)); opacity: 1; }
.sk-row-menulist { display: flex; flex-direction: column; margin: 0 0 4px 24px; }
.sk-menu-item { padding: 6px 10px; font-size: 13px; }
.sk-note { opacity: 0.6; font-size: 13px; padding: 8px 10px; }
.sk-sidebar-viewhead { padding: 12px 8px 4px; }
.sk-sidebar-view { flex: 1; overflow: auto; padding: 4px 8px 12px; }
.sk-cloud-mark { margin-left: 6px; opacity: 0.8; }
`;
  document.head.appendChild(s); stylesInjected = true;
}

export function createAppSidebar({ current, docName = 'Untitled', actions = [], views = {}, onRenameDoc = null, status = null, stages = [], activeStage = null, onStageChange = null } = {}) {
  injectStyles();
  const cur = appById(current);
  let acts = Array.isArray(actions) ? actions : [];
  let stageList = Array.isArray(stages) ? stages : [];
  let curStage = activeStage ?? (stageList[0] && stageList[0].id) ?? null;
  let name = docName;
  let isOpenFlag = false;
  let viewId = 'main';
  let message = null; // { text, kind, link? }
  const viewDefs = { ...views };

  const el = document.createElement('button'); // the header button
  el.type = 'button'; el.className = 'sk-sidebar-btn'; el.title = 'Menu'; el.setAttribute('aria-label', 'Menu'); el.setAttribute('aria-haspopup', 'dialog'); el.setAttribute('aria-expanded', 'false');
  el.innerHTML = `<span class="sk-sidebar-burger" aria-hidden="true">&#9776;</span><span class="sk-sidebar-name">${cur ? cur.name : 'App'}</span>`;

  const backdrop = document.createElement('div'); backdrop.className = 'sk-sidebar-backdrop'; backdrop.hidden = true;
  const drawer = document.createElement('aside'); drawer.className = 'sk-sidebar'; drawer.setAttribute('role', 'dialog'); // aria-modal only while open (TASK 783): the chevron in the tab strip keeps the focus when it closes, and is not an overlay then
  drawer.setAttribute('aria-label', 'App menu');
  const content = document.createElement('div'); content.className = 'sk-sidebar-content';
  const chevron = document.createElement('button'); chevron.type = 'button'; chevron.className = 'sk-sidebar-chevron'; chevron.setAttribute('aria-label', 'Open menu'); chevron.setAttribute('aria-expanded', 'false'); chevron.title = 'Menu';
  chevron.innerHTML = SIDEBAR_ICONS.chevron; // TASK 819: mounted by the host at the start of the document tab strip (the phone breakpoints only show it)
  drawer.append(content);
  document.body.append(backdrop, drawer);

  const enabledOf = (a) => (typeof a.enabled === 'function' ? !!a.enabled() : a.enabled !== false);

  // a registered extra view: a back-arrow header + a container the view renders into
  function renderView(def) {
    const head = document.createElement('div'); head.className = 'sk-sidebar-viewhead';
    const back = document.createElement('button'); back.type = 'button'; back.className = 'sk-sidebar-item sk-sidebar-back'; back.setAttribute('aria-label', 'Back');
    back.innerHTML = `<span class="sk-sidebar-ic" aria-hidden="true">&#8592;</span><span>${def.title || ''}</span>`;
    back.addEventListener('click', () => showView('main'));
    head.appendChild(back); content.appendChild(head);
    drawMessage(head);
    const body = document.createElement('div'); body.className = 'sk-sidebar-view'; body.dataset.view = viewId; content.appendChild(body);
    try { def.render(body, { go: showView, back: () => showView('main'), close }); } catch (e) { console.error(e); }
  }

  // an open ask() question survives a re-render (a store change repaints the drawer while the user decides)
  let askRow = null, askSettle = null;
  function render() { renderBody(); if (askRow) placeAsk(); }
  function renderBody() {
    content.innerHTML = '';
    if (viewId !== 'main' && viewDefs[viewId]) { renderView(viewDefs[viewId]); return; }
    viewId = 'main';
    if (stageList.length) {
      const sb = document.createElement('div'); sb.className = 'sk-sidebar-stages'; sb.dataset.section = 'stages';
      for (const s of stageList) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'sk-sidebar-stage' + (s.id === curStage ? ' active' : ''); b.dataset.tab = s.id; b.textContent = s.label || '';
        b.addEventListener('click', () => {
          setActiveStage(s.id);
          close();
          if (s.onSelect) s.onSelect(s.id);
          else if (onStageChange) onStageChange(s.id);
        });
        sb.appendChild(b);
      }
      content.appendChild(sb);
    }
    if (name != null || status) {
      const top = document.createElement('div'); top.className = 'sk-sidebar-top';
      if (name != null) {
        const h = document.createElement('h2'); h.className = 'sk-sidebar-doc'; h.textContent = name; top.appendChild(h);
        if (onRenameDoc) {
          h.classList.add('renamable'); h.title = 'Rename'; h.tabIndex = 0;
          const edit = () => {
            const inp = document.createElement('input'); inp.type = 'text'; inp.className = 'sk-sidebar-input sk-sidebar-docinput'; inp.value = name;
            let done = false;
            const commit = () => { if (done) return; done = true; const v = inp.value.trim(); if (v && v !== name) { try { onRenameDoc(v); } catch (e) { notify(e.message, 'error'); } } render(); };
            inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done = true; render(); } });
            inp.addEventListener('blur', commit);
            h.replaceWith(inp); inp.focus(); inp.select();
          };
          h.addEventListener('click', edit);
          h.addEventListener('keydown', (e) => { if (e.key === 'Enter') edit(); });
        }
      }
      if (status) { const s = document.createElement('div'); s.className = 'sk-sidebar-status'; s.dataset.section = 'status'; top.appendChild(s); paintStatus(s); }
      content.appendChild(top);
      drawMessage(top);
    } else if (message) {
      drawMessage(content);
    }
    const box = document.createElement('div'); box.className = 'sk-sidebar-actions'; box.dataset.section = 'actions';
    for (const a of acts) {
      if (a.visible && !a.visible()) continue;
      if (a.divider) { const d = document.createElement('div'); d.className = 'sk-sidebar-sep'; box.appendChild(d); continue; }
      const b = document.createElement('button'); b.type = 'button'; b.className = 'sk-sidebar-item'; b.dataset.action = a.id;
      b.innerHTML = `<span class="sk-sidebar-ic" aria-hidden="true">${a.icon || ''}</span><span>${a.label}</span>`;
      b.disabled = !enabledOf(a);
      if (a.tooltip) b.title = a.tooltip;
      b.addEventListener('click', () => {
        if (b.disabled) return;
        if (a.confirm) { askConfirm(b, a); return; }
        if (a.prompt) { askPrompt(b, a); return; }
        if (!a.keepOpen) close();
        try { a.onClick && a.onClick(); } catch (e) { notify(e.message || String(e), 'error'); }
      });
      box.appendChild(b);
    }
    content.appendChild(box);
  }

  function paintStatus(el) {
    const s = status();
    el.classList.toggle('error', s.kind === 'error');
    el.dataset.kind = s.kind || 'info';
    el.textContent = s.text;
    if (s.action && s.action.label) {
      el.append(' \u00b7 ');
      const b = document.createElement(s.action.href ? 'a' : 'button');
      b.className = 'sk-sidebar-status-act';
      b.dataset.action = s.action.id || 'status-action';
      b.textContent = s.action.label;
      if (s.action.href) { b.href = s.action.href; b.target = '_blank'; b.rel = 'noopener noreferrer'; }
      else { b.type = 'button'; b.addEventListener('click', s.action.onClick); }
      el.appendChild(b);
    }
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

  // ask(spec): a question inline under the drawer's heading (see the header comment). One at a time: a newer one cancels the older.
  function placeAsk() { const top = content.querySelector('.sk-sidebar-top') || content.querySelector('.sk-sidebar-viewhead'); if (top) top.after(askRow); else content.prepend(askRow); }
  function ask(spec) {
    if (askSettle) askSettle(null);
    if (!isOpenFlag) open();
    return new Promise((resolve) => {
      const row = document.createElement('div'); row.className = 'sk-sidebar-confirm sk-sidebar-ask'; row.setAttribute('role', spec.kind === 'prompt' ? 'group' : 'alertdialog');
      const label = document.createElement('span'); label.textContent = spec.label; row.appendChild(label);
      const settle = (v) => { if (askSettle !== settle) return; askSettle = null; askRow = null; row.remove(); resolve(v); };
      let inp = null;
      if (spec.kind === 'prompt') {
        inp = document.createElement('input'); inp.type = 'text'; inp.className = 'sk-sidebar-input'; inp.value = spec.value || ''; row.appendChild(inp);
      }
      const btns = document.createElement('div'); btns.className = 'sk-sidebar-confirm-btns';
      const mk = (cls, text, onClick) => { const b = document.createElement('button'); b.type = 'button'; if (cls) b.className = cls; b.textContent = text; b.addEventListener('click', onClick); btns.appendChild(b); return b; };
      const typed = () => { const v = inp.value.trim(); if (v) settle(v); };
      if (spec.kind === 'choose') for (const o of spec.options) mk('ok', o.label, () => { if (o.onClick) o.onClick(); settle(o.id); }).dataset.choice = o.id;
      mk('cancel', 'Cancel', () => settle(null));
      if (inp) {
        mk('ok', spec.okLabel || 'OK', typed);
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); typed(); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); settle(null); } });
      }
      row.appendChild(btns);
      askRow = row; askSettle = settle; placeAsk();
      if (inp) { inp.focus(); inp.select(); } else row.querySelector('button').focus();
    });
  }

  function showView(id) { viewId = viewDefs[id] ? id : 'main'; message = null; if (isOpenFlag) { render(); firstFocus(); } }
  // an inline text prompt row: Enter / OK runs onClick(text), Esc / Cancel returns to the list
  function askPrompt(btn, a) {
    const row = document.createElement('div'); row.className = 'sk-sidebar-confirm'; row.setAttribute('role', 'group');
    row.innerHTML = `<span></span><input type="text" class="sk-sidebar-input"><div class="sk-sidebar-confirm-btns"><button type="button" class="cancel">Cancel</button><button type="button" class="ok">${a.prompt.okLabel || 'OK'}</button></div>`;
    row.querySelector('span').textContent = a.prompt.label;
    const inp = row.querySelector('input'); inp.value = typeof a.prompt.value === 'function' ? a.prompt.value() : (a.prompt.value || '');
    const run = () => { const v = inp.value.trim(); if (!v) return; if (!a.keepOpen) close(); try { a.onClick && a.onClick(v); } catch (e) { notify(e.message || String(e), 'error'); } };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); render(); firstFocus(); } });
    row.querySelector('.cancel').addEventListener('click', () => { render(); firstFocus(); });
    row.querySelector('.ok').addEventListener('click', run);
    btn.replaceWith(row); inp.focus(); inp.select();
  }
  function drawMessage(parent) {
    const old = content.querySelector('.sk-sidebar-msg'); if (old) old.remove();
    if (!message) return;
    const m = document.createElement('div'); m.className = 'sk-sidebar-msg ' + (message.kind || 'info'); m.setAttribute('role', message.kind === 'error' ? 'alert' : 'status'); m.textContent = message.text;
    if (message.link) { const a = document.createElement('a'); a.href = message.link.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = message.link.label; m.appendChild(a); }
    (parent || content).appendChild(m);
  }
  function notify(text, kind = 'info', link = null) { message = text ? { text, kind, link } : null; if (isOpenFlag) { const top = content.querySelector('.sk-sidebar-top') || content.querySelector('.sk-sidebar-viewhead'); drawMessage(top); } }

  const isHiddenByLayout = (node) => {
    if (typeof getComputedStyle !== 'function') return false;
    for (let cur = node; cur && cur !== drawer; cur = cur.parentElement) {
      if (cur.hidden || getComputedStyle(cur).display === 'none') return true;
    }
    return false;
  };
  const focusables = () => [...drawer.querySelectorAll('button:not(:disabled)')].filter((b) => !isHiddenByLayout(b));
  function firstFocus() { const f = focusables(); if (f[0]) f[0].focus(); }

  const onKey = (e) => {
    if (e.key === 'Escape') {
      if (document.activeElement && document.activeElement.tagName === 'INPUT' && drawer.contains(document.activeElement)) return; // the field cancels its own edit
      e.preventDefault(); close(); return;
    }
    if (e.key === 'Tab') { // trap focus inside the drawer
      const f = focusables(); if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || !drawer.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !drawer.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    }
  };
  function open() {
    if (isOpenFlag) return;
    isOpenFlag = true; viewId = 'main'; message = null; render();
    backdrop.hidden = false; drawer.classList.add('open'); drawer.setAttribute('aria-modal', 'true'); el.setAttribute('aria-expanded', 'true');
    chevron.setAttribute('aria-expanded', 'true'); chevron.setAttribute('aria-label', 'Close menu');
    document.addEventListener('keydown', onKey, true);
    firstFocus();
  }
  function close() {
    backdrop.hidden = true;
    if (!isOpenFlag) return;
    isOpenFlag = false;
    if (askSettle) askSettle(null); // closing the drawer cancels an open question
    drawer.classList.remove('open'); drawer.removeAttribute('aria-modal'); el.setAttribute('aria-expanded', 'false');
    chevron.setAttribute('aria-expanded', 'false'); chevron.setAttribute('aria-label', 'Open menu');
    document.removeEventListener('keydown', onKey, true);
    try { if (chevron.isConnected && typeof getComputedStyle === 'function' && getComputedStyle(chevron).display !== 'none') chevron.focus(); else el.focus(); } catch (_) {}
  }
  const toggle = () => (isOpenFlag ? close() : open());
  el.addEventListener('click', toggle);
  backdrop.addEventListener('click', close);

  chevron.addEventListener('click', toggle);

  function setActiveStage(id) {
    curStage = id;
    for (const b of content.querySelectorAll('.sk-sidebar-stage')) b.classList.toggle('active', b.dataset.tab === id);
  }

  return {
    el, chevron, open, close, toggle, isOpen: () => isOpenFlag,
    // updates the heading in place: a full re-render would reset an open view (e.g. the Projects browser back to its first level)
    setDocName(n) { name = n; const h = content.querySelector('h2.sk-sidebar-doc'); if (h) h.textContent = n; },
    /** Repaint the status line in place (the store's state changed). */
    refreshStatus() { const s = content.querySelector('[data-section=status]'); if (s && status) paintStatus(s); },
    setActiveStage,
    showView, notify, ask, registerView(id, def) { viewDefs[id] = def; },
    setActions(a) { acts = Array.isArray(a) ? a : []; if (isOpenFlag) render(); },
    destroy() { close(); try { el.remove(); chevron.remove(); backdrop.remove(); drawer.remove(); } catch (_) {} },
  };
}
