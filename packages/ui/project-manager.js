// packages/ui/project-manager.js — TASK 547: the PROJECT MANAGER, one shared modal opened by the sidebar's "Projects" item in every host.
//   left pane   Recent · pinned projects (star) · projects (each row: its menu from project-actions.js)
//   right pane  the selected project's designs as a grid of THUMBNAILS (name under it, last saved + where it lives under that),
//               each with a "…" button and a right-click menu (the designs' actions from project-actions.js)
//   toolbar     New project · New design · Open from file · search (filters the designs by name)
// Click / Enter on a design opens it and closes the modal. Esc and the X close it; focus goes in and comes back to where it was.
// At 640 px wide or less it is ONE pane at a time (projects, then the designs of the chosen one, with a back button).
// It only DISPLAYS and ASKS: every action is data from project-actions.js and runs against the project store.
// Thumbnails are generated lazily (#ui/design-thumbnail.js) after the grid is painted; placeholders show first.

import { appById } from './app-registry.js';
import { designThumbnailSvg } from './design-thumbnail.js';
import { driveErrorText } from './cloud/drive-adapter.js';

const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** "just now" / "5 min ago" / "3 h ago" / "2 d ago" / a date. */
export function relativeTime(ts, now = Date.now()) {
  const s = Math.max(0, Math.round((now - Number(ts)) / 1000));
  if (!Number.isFinite(s)) return '';
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 14) return `${Math.round(s / 86400)} d ago`;
  return new Date(ts).toLocaleDateString();
}

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined' || !document.head) return;
  if (document.getElementById('sk-pm-styles')) { stylesInjected = true; return; }
  const s = document.createElement('style'); s.id = 'sk-pm-styles';
  s.textContent = `
.sk-pm-backdrop { position: fixed; inset: 0; z-index: 9600; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; }
.sk-pm { position: relative; width: min(980px, 94vw); height: min(640px, 90vh); box-sizing: border-box; display: flex; flex-direction: column; overflow: hidden;
  background: var(--sk-sidebar-bg, var(--sk-header-bg, #fff)); color: var(--sk-sidebar-fg, var(--sk-header-fg, #1e293b));
  font: 14px system-ui, sans-serif; border-radius: 10px; box-shadow: 0 10px 40px rgba(0,0,0,0.5); }
.sk-pm-head { display: flex; align-items: center; gap: 10px; padding: 12px 14px 8px; }
.sk-pm-title { font-size: 17px; font-weight: 600; margin: 0; flex: 1; }
.sk-pm-x { background: transparent; color: inherit; border: 0; cursor: pointer; font-size: 22px; line-height: 1; padding: 2px 8px; border-radius: 6px; }
.sk-pm-x:hover, .sk-pm-btn:hover, .sk-pm-rowbtn:hover, .sk-pm-more:hover, .sk-pm-menu button:hover { background: var(--sk-sidebar-hover, rgba(127,127,127,0.18)); }
.sk-pm-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 0 14px 10px; }
.sk-pm-btn { background: transparent; color: inherit; border: 1px solid var(--sk-sidebar-sep, rgba(127,127,127,0.35)); border-radius: 6px; padding: 5px 10px; cursor: pointer; font: inherit; }
.sk-pm-search { margin-left: auto; box-sizing: border-box; width: 200px; max-width: 100%; background: var(--sk-sidebar-hover, rgba(127,127,127,0.14)); color: inherit; border: 1px solid var(--sk-sidebar-sep, rgba(127,127,127,0.35)); border-radius: 6px; padding: 5px 8px; font: inherit; }
.sk-pm-body { flex: 1; min-height: 0; display: flex; border-top: 1px solid var(--sk-sidebar-sep, rgba(127,127,127,0.3)); }
.sk-pm-side { width: 220px; flex: 0 0 auto; overflow: auto; padding: 8px; border-right: 1px solid var(--sk-sidebar-sep, rgba(127,127,127,0.3)); }
.sk-pm-main { flex: 1; min-width: 0; overflow: auto; padding: 10px 14px; display: flex; flex-direction: column; }
.sk-pm-prow { display: flex; align-items: center; }
.sk-pm-rowbtn { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; text-align: left; background: transparent; color: inherit; border: 0; border-radius: 8px; padding: 8px 10px; cursor: pointer; font: inherit; }
.sk-pm-rowbtn.sel { background: var(--sk-sidebar-hover, rgba(127,127,127,0.22)); font-weight: 700; }
.sk-pm-rowbtn .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sk-pm-more { background: transparent; color: inherit; border: 0; cursor: pointer; font-size: 18px; padding: 2px 8px; border-radius: 6px; opacity: 0.75; }
.sk-pm-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 14px; align-content: start; }
.sk-pm-tile { position: relative; display: flex; flex-direction: column; gap: 4px; padding: 6px; border-radius: 8px; cursor: pointer; outline: none; }
.sk-pm-tile:hover, .sk-pm-tile:focus-visible { background: var(--sk-sidebar-hover, rgba(127,127,127,0.18)); }
.sk-pm-tile:focus-visible { box-shadow: 0 0 0 2px var(--sk-sidebar-accent, var(--sk-selection, #2c65ff)); }
.sk-pm-thumb { aspect-ratio: 1; border-radius: 6px; background: var(--sk-sidebar-hover, rgba(127,127,127,0.14)); display: flex; align-items: center; justify-content: center; overflow: hidden; opacity: 0.95; }
.sk-pm-thumb svg { width: 100%; height: 100%; display: block; }
.sk-pm-thumb.blank::after { content: ''; width: 28%; height: 28%; border: 1.5px dashed currentColor; opacity: 0.35; border-radius: 4px; }
.sk-pm-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sk-pm-sub { font-size: 12px; opacity: 0.65; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sk-pm-tile .sk-pm-more { position: absolute; top: 8px; right: 8px; background: rgba(0,0,0,0.35); color: #fff; padding: 0 7px; }
.sk-pm-note { opacity: 0.6; padding: 10px 4px; }
.sk-pm-msg { margin: 0 14px 8px; padding: 8px 10px; border-radius: 8px; font-size: 13px; background: var(--sk-sidebar-hover, rgba(127,127,127,0.14)); }
.sk-pm-msg[hidden] { display: none; }
.sk-pm-msg.error { background: rgba(220, 60, 60, 0.18); color: #ff9c9c; }
.sk-pm-msg a { color: inherit; font-weight: 600; margin-left: 6px; }
.sk-pm-ask { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--sk-sidebar-sep, rgba(127,127,127,0.3)); background: var(--sk-sidebar-hover, rgba(127,127,127,0.12)); }
.sk-pm-ask[hidden] { display: none; }
.sk-pm-ask input { flex: 1; min-width: 140px; box-sizing: border-box; background: var(--sk-sidebar-bg, #fff); color: inherit; border: 1px solid var(--sk-sidebar-accent, #2c65ff); border-radius: 6px; padding: 6px 8px; font: inherit; }
.sk-pm-ask button { padding: 6px 12px; border-radius: 6px; border: 0; cursor: pointer; font: inherit; background: var(--sk-sidebar-bg, #fff); color: inherit; }
.sk-pm-ask button.ok { background: var(--sk-sidebar-accent, var(--sk-selection, #2c65ff)); color: #fff; }
.sk-pm-menu { position: fixed; z-index: 9700; min-width: 170px; display: flex; flex-direction: column; padding: 4px; border-radius: 8px; background: var(--sk-sidebar-bg, #fff); color: var(--sk-sidebar-fg, #1e293b); box-shadow: 0 6px 24px rgba(0,0,0,0.5); border: 1px solid var(--sk-sidebar-sep, rgba(127,127,127,0.35)); }
.sk-pm-menu button { text-align: left; background: transparent; color: inherit; border: 0; border-radius: 6px; padding: 7px 10px; cursor: pointer; font: inherit; }
.sk-pm-back { display: none; }
@media (max-width: 640px) {
  .sk-pm-backdrop { align-items: stretch; }
  .sk-pm { width: 100vw; height: 100vh; border-radius: 0; }
  .sk-pm-side { width: auto; flex: 1; border-right: 0; }
  .sk-pm[data-pane="side"] .sk-pm-main { display: none; }
  .sk-pm[data-pane="main"] .sk-pm-side { display: none; }
  .sk-pm-back { display: inline-block; align-self: flex-start; margin-bottom: 8px; }
  .sk-pm-search { margin-left: 0; width: 100%; }
  .sk-pm-grid { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; }
}
`;
  document.head.appendChild(s); stylesInjected = true;
}

/**
 * openProjectManager({ store, actions, toolbar, onClose }) -> { el, close, notify, refresh, ask }
 *   ask(spec) -> Promise: the question bar for a question an action asks while it runs (TASK 558: the unsaved-design question),
 *     spec = an item's `ask` ({ kind: 'choose' | 'prompt' | 'confirm', ... }); resolves the answer, or null for Cancel / the modal closing.
 *   actions : createProjectActions(...) result (designItems / projectItems)
 *   toolbar : [{ id, label, ask?, closes?, run(arg) }]  — New project / New design / Open from file, declared by project-actions.js
 *   account : the Google account controller (optional): its sign-in state drives the "Drive projects are hidden" note
 *   start   : 'projects' (default: the project list) | 'recent' (the Recent pane; on a narrow screen the pane is shown, not the list)
 *   onClose : called once when the modal closes (focus is already restored)
 */
export function openProjectManager({ store, actions, toolbar = [], account = null, start = 'projects', onClose = () => {} }) {
  injectStyles();
  const returnTo = document.activeElement;
  const back = document.createElement('div'); back.className = 'sk-pm-backdrop';
  const dlg = document.createElement('div'); dlg.className = 'sk-pm'; dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-modal', 'true'); dlg.setAttribute('aria-label', 'Projects'); dlg.dataset.pane = start === 'recent' ? 'main' : 'side';
  dlg.innerHTML = `<div class="sk-pm-head"><h2 class="sk-pm-title">Projects</h2><button type="button" class="sk-pm-x" data-pm="close" aria-label="Close">&times;</button></div>
<div class="sk-pm-bar"></div><div class="sk-pm-msg" hidden></div>
<div class="sk-pm-body"><div class="sk-pm-side" data-pm="side"></div><div class="sk-pm-main" data-pm="main"></div></div><div class="sk-pm-ask" hidden></div>`;
  back.appendChild(dlg); document.body.appendChild(back);
  const $ = (s) => dlg.querySelector(s);
  const bar = $('.sk-pm-bar'), msgEl = $('.sk-pm-msg'), side = $('[data-pm=side]'), main = $('[data-pm=main]'), askEl = $('.sk-pm-ask');

  let sel = 'recent';       // 'recent' | a project id
  let query = '';
  let designs = [];         // the rows shown on the right
  let projects = [];
  let menu = null;
  let closed = false;
  const thumbCache = new Map(); // `${id}:${updatedAt}` -> svg markup, or '' when there is nothing to draw

  const showMsg = (text, kind = 'info', link = null) => {
    msgEl.hidden = !text; msgEl.className = 'sk-pm-msg' + (kind === 'error' ? ' error' : ''); msgEl.textContent = text || '';
    if (text && link && link.href) { const a = document.createElement('a'); a.href = link.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = link.label || 'Open'; msgEl.appendChild(a); }
  };
  const fail = (e) => showMsg(driveErrorText(e), 'error');

  let off = () => {};
  function close() {
    if (closed) return; closed = true;
    if (askCancel) askCancel();
    document.removeEventListener('keydown', onKey, true); off();
    back.remove();
    if (returnTo && returnTo.focus && returnTo.isConnected) returnTo.focus();
    onClose();
  }

  // ---- asking (rename / new / confirm / choose) ------------------------------------------------------------------
  let askCancel = null; // what a Cancel of the open question runs (null: nothing)
  const closeAsk = () => { askEl.hidden = true; askEl.innerHTML = ''; askCancel = null; };
  function ask(item, then, onCancel = null) {
    closeMenu();
    if (askCancel) askCancel(); // a newer question replaces an open one (which counts as cancelled)
    const a = item.ask;
    askEl.hidden = false; askEl.innerHTML = '';
    const label = document.createElement('span'); label.textContent = a.kind === 'confirm' ? a.text : a.label; askEl.appendChild(label);
    const mk = (cls, text) => { const b = document.createElement('button'); b.type = 'button'; if (cls) b.className = cls; b.textContent = text; return b; };
    const cancel = mk('cancel', 'Cancel'); cancel.addEventListener('click', () => { const c = askCancel; closeAsk(); if (c) c(); });
    askCancel = onCancel;
    if (a.kind === 'choose') {
      for (const o of a.options) { const b = mk('', o.label); b.dataset.choice = o.id; b.addEventListener('click', () => { closeAsk(); then(o.id); }); askEl.appendChild(b); }
      askEl.appendChild(cancel); askEl.querySelector('button').focus(); return;
    }
    let inp = null;
    if (a.kind === 'prompt') { inp = document.createElement('input'); inp.type = 'text'; inp.value = a.value || ''; askEl.appendChild(inp); }
    const ok = mk('ok', a.okLabel || 'OK');
    const go = () => { const v = inp ? inp.value.trim() : undefined; if (inp && !v) return; closeAsk(); then(v); };
    ok.addEventListener('click', go);
    if (inp) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    askEl.appendChild(cancel); askEl.appendChild(ok);
    if (inp) { inp.focus(); inp.select(); } else cancel.focus();
  }
  async function runItem(item) {
    const go = async (arg) => { try { showMsg(''); const out = await item.run(arg); if (item.closes && out !== null) close(); } catch (e) { fail(e); } };
    if (item.ask) ask(item, go); else await go();
  }

  // ---- menus -------------------------------------------------------------------------------------------------------
  function closeMenu() { if (menu) { menu.remove(); menu = null; } }
  function showMenu(items, x, y) {
    closeMenu();
    menu = document.createElement('div'); menu.className = 'sk-pm-menu'; menu.setAttribute('role', 'menu');
    for (const it of items) {
      const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'menuitem'); b.dataset.menu = it.id; b.textContent = it.label;
      b.addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); runItem(it); });
      menu.appendChild(b);
    }
    back.appendChild(menu);
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = Math.max(4, Math.min(x, window.innerWidth - w - 4)) + 'px';
    menu.style.top = Math.max(4, Math.min(y, window.innerHeight - h - 4)) + 'px';
    menu.querySelector('button').focus();
  }
  back.addEventListener('pointerdown', (e) => { if (menu && !menu.contains(e.target)) closeMenu(); });
  const menuAt = (btn, items) => { const r = btn.getBoundingClientRect(); showMenu(items, r.left, r.bottom + 2); };

  // ---- toolbar -----------------------------------------------------------------------------------------------------
  for (const t of toolbar) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'sk-pm-btn'; b.dataset.pm = t.id; b.textContent = t.label;
    b.addEventListener('click', () => runItem(t)); bar.appendChild(b);
  }
  const search = document.createElement('input'); search.type = 'search'; search.className = 'sk-pm-search'; search.placeholder = 'Search designs'; search.setAttribute('aria-label', 'Search designs'); search.dataset.pm = 'search';
  search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); renderMain(); });
  bar.appendChild(search);
  $('[data-pm=close]').addEventListener('click', close);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });

  // ---- left pane ---------------------------------------------------------------------------------------------------
  function renderSide(hiddenDrive) {
    side.innerHTML = '';
    if (hiddenDrive) { const n = document.createElement('div'); n.className = 'sk-pm-note'; n.textContent = 'Your projects on Google Drive are hidden while you are signed out. Sign in again to see them; nothing was changed.'; side.appendChild(n); }
    const row = (key, html, items) => {
      const w = document.createElement('div'); w.className = 'sk-pm-prow';
      const b = document.createElement('button'); b.type = 'button'; b.className = 'sk-pm-rowbtn' + (sel === key ? ' sel' : ''); b.dataset.pane = key; b.innerHTML = html;
      b.addEventListener('click', () => { sel = key; dlg.dataset.pane = 'main'; refresh(); });
      w.appendChild(b);
      if (items) {
        const m = document.createElement('button'); m.type = 'button'; m.className = 'sk-pm-more'; m.dataset.pm = 'project-menu'; m.setAttribute('aria-label', 'Project actions'); m.textContent = '⋯';
        m.addEventListener('click', (e) => { e.stopPropagation(); menuAt(m, items()); });
        w.appendChild(m);
        w.addEventListener('contextmenu', (e) => { e.preventDefault(); showMenu(items(), e.clientX, e.clientY); });
      }
      side.appendChild(w);
    };
    row('recent', '<span class="nm">Recent</span>');
    for (const p of projects) row(p.id, `<span aria-hidden="true">${p.pinned ? '&#9733;' : '&#128193;'}</span><span class="nm" data-project="${esc(p.id)}">${esc(p.name)}</span>${p.location === 'drive' ? '<span data-cloud="drive" title="on Google Drive" aria-label="On Google Drive">&#9729;</span>' : ''}`, () => actions.projectItems(p));
  }

  // ---- right pane --------------------------------------------------------------------------------------------------
  const cols = () => { const all = [...main.querySelectorAll('.sk-pm-tile')]; if (!all.length) return 1; return Math.max(1, all.filter((x) => x.offsetTop === all[0].offsetTop).length); };
  function tileFor(d) {
    const st = store.status ? store.status(d.id) : { where: 'device' };
    const app = appById(d.app);
    const t = document.createElement('div'); t.className = 'sk-pm-tile'; t.tabIndex = 0; t.setAttribute('role', 'button'); t.dataset.design = d.id;
    t.innerHTML = `<div class="sk-pm-thumb blank" data-thumb></div><div class="sk-pm-name" data-name>${esc(d.name)}</div><div class="sk-pm-sub" title="${esc(app ? app.name : d.app || '')}">${esc(relativeTime(d.updatedAt))} · ${st.where === 'drive' ? 'Google Drive' : 'This device'}</div>`;
    const items = () => actions.designItems(d, { projects });
    const m = document.createElement('button'); m.type = 'button'; m.className = 'sk-pm-more'; m.dataset.pm = 'design-menu'; m.setAttribute('aria-label', 'Design actions'); m.textContent = '⋯';
    m.addEventListener('click', (e) => { e.stopPropagation(); menuAt(m, items()); });
    t.appendChild(m);
    t.addEventListener('contextmenu', (e) => { e.preventDefault(); showMenu(items(), e.clientX, e.clientY); });
    t.addEventListener('click', () => runItem(items()[0]));
    t.addEventListener('keydown', (e) => {
      if (e.target !== t) return;
      if (e.key === 'Enter') { e.preventDefault(); runItem(items()[0]); return; }
      if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) { e.preventDefault(); menuAt(m, items()); return; }
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols(), ArrowDown: cols() }[e.key];
      if (step == null) return;
      e.preventDefault();
      const tiles = [...main.querySelectorAll('.sk-pm-tile')]; const next = tiles[tiles.indexOf(t) + step];
      if (next) next.focus();
    });
    return t;
  }

  // thumbnails: one at a time, after the grid is painted, so opening the modal never waits for them
  let thumbRun = 0;
  async function fillThumbs() {
    const run = ++thumbRun;
    for (const d of designs) {
      if (closed || run !== thumbRun) return;
      const tile = main.querySelector(`.sk-pm-tile[data-design="${CSS.escape(d.id)}"] [data-thumb]`);
      if (!tile) continue;
      const key = d.id + ':' + d.updatedAt;
      let svg = thumbCache.get(key);
      if (svg === undefined) {
        await new Promise((r) => setTimeout(r, 0));
        try { const full = await store.get(d.id); svg = (full && designThumbnailSvg(full.document)) || ''; } catch (_) { svg = ''; } // an unreadable design keeps its placeholder; opening it shows the reason
        thumbCache.set(key, svg);
      }
      if (closed || run !== thumbRun) return;
      if (svg) { tile.classList.remove('blank'); tile.innerHTML = svg; }
    }
  }

  let rows = [];
  function renderMain() {
    main.innerHTML = '';
    const title = sel === 'recent' ? 'Recent' : ((projects.find((p) => p.id === sel) || {}).name || '');
    const bk = document.createElement('button'); bk.type = 'button'; bk.className = 'sk-pm-btn sk-pm-back'; bk.dataset.pm = 'back'; bk.textContent = '‹ Projects';
    bk.addEventListener('click', () => { dlg.dataset.pane = 'side'; });
    main.appendChild(bk);
    designs = rows.filter((d) => !query || String(d.name).toLowerCase().includes(query));
    if (!designs.length) { const n = document.createElement('div'); n.className = 'sk-pm-note'; n.textContent = query ? `No design in "${title}" matches "${query}".` : (sel === 'recent' ? 'No designs yet.' : 'No designs in this project.'); main.appendChild(n); return; }
    const grid = document.createElement('div'); grid.className = 'sk-pm-grid'; grid.dataset.pm = 'grid';
    for (const d of designs) grid.appendChild(tileFor(d));
    main.appendChild(grid);
    fillThumbs();
  }

  async function refresh() {
    try {
      projects = await store.listProjects();
      if (sel !== 'recent' && !projects.some((p) => p.id === sel)) sel = 'recent';
      rows = sel === 'recent' ? await store.listRecent({ limit: 60 }) : await store.listDesigns(sel);
    } catch (e) { fail(e); rows = []; }
    let hiddenDrive = false;
    try { hiddenDrive = !!(store.cloud && account && !account.state().signedIn && await store.cloud.isEnabled()); } catch (e) { fail(e); }
    renderSide(hiddenDrive); renderMain();
  }
  const offStore = store.subscribe(() => { if (!closed) refresh(); });
  const offAccount = account && account.subscribe ? account.subscribe(() => { if (!closed) refresh(); }) : () => {};
  off = () => { offStore(); offAccount(); };

  // ---- keys: Esc layers (menu, then a question, then the modal); Tab stays inside ------------------------------------
  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (menu) { closeMenu(); return; }
      if (!askEl.hidden) { closeAsk(); return; }
      close(); return;
    }
    if (e.key === 'Tab') {
      const f = [...dlg.querySelectorAll('button, input, [tabindex="0"]')].filter((x) => !x.disabled && x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || !back.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !back.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    }
  }
  document.addEventListener('keydown', onKey, true);
  // the host app's own key handlers (tool letters, arrows) must not see keys typed into the modal
  for (const type of ['keydown', 'keyup', 'keypress']) back.addEventListener(type, (e) => e.stopPropagation());

  refresh().then(() => { const first = bar.querySelector('button'); if (first) first.focus(); });
  /** A question asked by an action while it runs: resolves the answer, or null for Cancel / the modal closing. */
  const askAsync = (spec) => new Promise((resolve) => { if (closed) { resolve(null); return; } ask({ ask: spec }, resolve, () => resolve(null)); });
  return { el: back, close, notify: showMsg, refresh, ask: askAsync };
}
