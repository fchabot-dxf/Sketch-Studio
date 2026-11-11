// packages/ui/app-sidebar.js — the shared APP SIDEBAR (TASK 473), modelled on Shaper Studio's: a hamburger button in the header
// opens a dark left drawer with the DOCUMENT name, the host's ACTIONS, and a darker "GO TO" section listing the apps.
// It replaces the old #ui/app-switcher.js dropdown (the app roster lives here now, one source).
//
// DECLARED per host — the sidebar never knows host specifics:
//   createAppSidebar({ current, docName, actions, apps? }) → { el, open, close, toggle, isOpen, setDocName, setActions, destroy }
//     current  the host's app id (marks it in GO TO and names the header button)
//     docName  the document name shown at the top (a string)
//     actions  a plain DECLARED array a project store can extend later:
//              { id, label, icon, onClick, enabled?, tooltip?, confirm?: 'message', prompt?: { label, value(): string, okLabel? }, keepOpen? }
//              or { divider: true }.  `confirm` asks inline (Cancel / OK) before onClick; `prompt` asks for a text inline and calls
//              onClick(text); `keepOpen` leaves the drawer open after the click (an action that opens a view).
//     onRenameDoc(name)  OPTIONAL: when given, clicking the document name edits it inline (Enter commits, Esc cancels).
//     account  OPTIONAL Google account controller (#ui/cloud/google-account.js getGoogleAccount()): adds the account row under GO TO.
//     driveControls  OPTIONAL (with `account`; TASK 506): { getDefault(): bool, setDefault(bool), check(onSteps): Promise } adds, while signed
//              in, the "Save to Google Drive by default" toggle and the "Check Google Drive connection" action (its steps listed inline).
//     status   OPTIONAL () => { text, kind } the one-line state of the current design under its name ('error' | 'info'); read at every
//              render and by refreshStatus().
//     actions may carry `visible: () => bool` (hidden, not just disabled, when it returns false).
//     notify(text, kind, link?) shows a message line in the drawer ('error' | 'info'), optionally ending in a link { href, label } that opens
//              in a new tab — e.g. the reason a store refused something, or "Saved to Google Drive" + "Open in Drive".
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
  save: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 3.5h9l2 2v9h-11zM6 3.5v4h5v-4M6 14.5v-4h6v4"/></svg>',
  copy: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="9" height="9" rx="1.5"/><path d="M12 6V4.5A1.5 1.5 0 0 0 10.5 3h-6A1.5 1.5 0 0 0 3 4.5v6A1.5 1.5 0 0 0 4.5 12H6"/></svg>',
  recent: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="9" r="6"/><path d="M9 5.5V9l2.5 1.5"/></svg>',
  folder: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 5.5A1.5 1.5 0 0 1 4 4h3l1.5 1.5H14A1.5 1.5 0 0 1 15.5 7v6A1.5 1.5 0 0 1 14 14.5H4A1.5 1.5 0 0 1 2.5 13z"/></svg>',
  open: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11.5V3M5.5 6.5L9 3l3.5 3.5M3 12.5v2h12v-2"/></svg>',
  cloud: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13.5a3 3 0 0 1-.4-5.97A4.5 4.5 0 0 1 13.2 6.6 3.5 3.5 0 0 1 13 13.5zM9 7.5v4M7.3 9.3L9 7.5l1.7 1.8"/></svg>',
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
.sk-sidebar-doc.renamable { cursor: text; border-radius: 6px; padding: 2px 4px; margin-left: -4px; }
.sk-sidebar-doc.renamable:hover { background: var(--sk-sidebar-hover, rgba(127,127,127,0.14)); }
.sk-sidebar-input { box-sizing: border-box; width: 100%; background: var(--sk-sidebar-hover, rgba(127,127,127,0.14)); color: inherit; border: 1px solid var(--sk-sidebar-accent, #2c65ff); border-radius: 6px; padding: 6px 8px; font: inherit; }
.sk-sidebar-docinput { font-size: 17px; font-weight: 600; margin: 0 0 10px; }
.sk-sidebar-msg { margin: 6px 0 0; padding: 8px 10px; border-radius: 8px; font-size: 13px; line-height: 1.4; background: var(--sk-sidebar-hover, rgba(127,127,127,0.14)); }
.sk-sidebar-msg.error { background: rgba(220, 60, 60, 0.18); color: #ff9c9c; }
.sk-sidebar-msg a { color: inherit; font-weight: 600; margin-left: 6px; }
.sk-sidebar-status { margin: -4px 0 8px; font-size: 12.5px; line-height: 1.35; opacity: 0.75; }
.sk-sidebar-status.error { opacity: 1; color: #ff9c9c; }
.sk-account-toggle { display: flex; align-items: center; gap: 10px; padding: 7px 10px; cursor: pointer; font-size: 13px; }
.sk-account-toggle input { width: 16px; height: 16px; margin: 0; flex: 0 0 auto; }
.sk-check-steps { margin: 2px 10px 4px; padding: 0; list-style: none; font-size: 12.5px; line-height: 1.4; }
.sk-check-steps li { display: flex; gap: 8px; padding: 2px 0; }
.sk-check-steps .mark { flex: 0 0 auto; width: 16px; text-align: center; }
.sk-check-steps li[data-state=ok] .mark { color: #7ee2a0; }
.sk-check-steps li[data-state=failed] { color: #ff9c9c; }
.sk-check-steps li[data-state=skipped], .sk-check-steps li[data-state=pending] { opacity: 0.55; }
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
.sk-sidebar-goto { margin-top: auto; padding: 14px 8px 18px; background: var(--sk-sidebar-goto-bg, rgba(127,127,127,0.12)); }
.sk-sidebar-goto-title { font-size: 11px; letter-spacing: 0.08em; opacity: 0.6; padding: 0 10px 8px; }
.sk-sidebar-account { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--sk-sidebar-sep, rgba(127,127,127,0.3)); }
.sk-account-line { display: flex; align-items: center; gap: 10px; padding: 4px 10px; }
.sk-account-out { width: auto; padding: 5px 10px; font-size: 13px; }
.sk-avatar { width: 32px; height: 32px; flex: 0 0 auto; border-radius: 50%; overflow: hidden; display: inline-flex; align-items: center; justify-content: center; background: var(--sk-sidebar-accent, #2c65ff); color: #fff; font-size: 13px; font-weight: 700; }
.sk-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
.sk-cloud-mark { margin-left: 6px; opacity: 0.8; }
.sk-sidebar-item.current { font-weight: 700; background: var(--sk-sidebar-hover, rgba(127,127,127,0.14)); }
`;
  document.head.appendChild(s); stylesInjected = true;
}

export function createAppSidebar({ current, docName = 'Untitled', actions = [], apps = APPS, views = {}, onRenameDoc = null, account = null, driveControls = null, status = null } = {}) {
  injectStyles();
  const list = Array.isArray(apps) && apps.length ? apps : APPS;
  const cur = list.find((a) => a.id === current) || list[0];
  let acts = Array.isArray(actions) ? actions : [];
  let name = docName;
  let isOpenFlag = false;
  let viewId = 'main';
  let message = null; // { text, kind, link? }
  let checkSteps = null; // the last "Check Google Drive connection" result (steps), shown inline in the account area
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
    drawMessage(head);
    const body = document.createElement('div'); body.className = 'sk-sidebar-view'; body.dataset.view = viewId; drawer.appendChild(body);
    try { def.render(body, { go: showView, back: () => showView('main'), close }); } catch (e) { console.error(e); }
  }

  function render() {
    drawer.innerHTML = '';
    if (viewId !== 'main' && viewDefs[viewId]) { renderView(viewDefs[viewId]); return; }
    viewId = 'main';
    const top = document.createElement('div'); top.className = 'sk-sidebar-top';
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
    if (status) { const s = document.createElement('div'); s.className = 'sk-sidebar-status'; s.dataset.section = 'status'; top.appendChild(s); paintStatus(s); }
    drawer.appendChild(top);
    drawMessage(top);
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
    if (account) go.appendChild(renderAccount());
    drawer.appendChild(go);
  }

  // The Google account row (the ONE sign-in door). signIn() runs synchronously inside the click so the popup is not blocked.
  function renderAccount() {
    const st = account.state();
    const row = document.createElement('div'); row.className = 'sk-sidebar-account'; row.dataset.section = 'account';
    const fail = (e) => notify((e && e.message) || String(e), 'error');
    const run = (fn) => () => { try { const r = fn(); if (r && r.catch) r.catch(fail); } catch (e) { fail(e); } };
    if (!st.signedIn && !st.lapsed) {
      row.dataset.state = 'signed-out';
      const b = document.createElement('button'); b.type = 'button'; b.className = 'sk-sidebar-item'; b.dataset.account = 'sign-in';
      b.innerHTML = '<span class="sk-sidebar-ic" aria-hidden="true">G</span><span>Sign in with Google</span>';
      b.addEventListener('click', run(() => account.signIn()));
      row.appendChild(b);
      return row;
    }
    if (st.lapsed) {
      row.dataset.state = 'lapsed';
      const b = document.createElement('button'); b.type = 'button'; b.className = 'sk-sidebar-item'; b.dataset.account = 'reconnect';
      b.innerHTML = '<span class="sk-sidebar-ic" aria-hidden="true">G</span><span>Reconnect</span>';
      b.addEventListener('click', run(() => account.signIn()));
      row.appendChild(b);
      return row;
    }
    row.dataset.state = 'signed-in';
    const av = document.createElement('span'); av.className = 'sk-avatar'; av.dataset.account = 'avatar'; av.textContent = '…';
    const who = document.createElement('span'); who.className = 'sk-row-main'; who.dataset.account = 'who';
    who.innerHTML = '<span class="sk-row-name">Google account</span><span class="sk-row-sub"></span>';
    const out = document.createElement('button'); out.type = 'button'; out.className = 'sk-sidebar-item sk-account-out'; out.dataset.account = 'sign-out'; out.textContent = 'Sign out';
    out.addEventListener('click', run(() => account.signOut()));
    const line = document.createElement('div'); line.className = 'sk-account-line'; line.append(av, who, out);
    row.appendChild(line);
    if (driveControls) row.append(...driveRows(fail));
    Promise.resolve(account.userInfo ? account.userInfo() : null).then((u) => {
      if (!u || !row.isConnected) return;
      const initials = u.initials || '?';
      av.textContent = initials;
      if (u.picture) {
        const img = document.createElement('img'); img.alt = ''; img.referrerPolicy = 'no-referrer';
        img.addEventListener('load', () => { av.textContent = ''; av.appendChild(img); });
        img.addEventListener('error', () => { img.remove(); av.textContent = initials; });
        img.src = u.picture;
      }
      who.querySelector('.sk-row-name').textContent = u.name || u.email || 'Google account';
      who.querySelector('.sk-row-sub').textContent = u.name ? (u.email || '') : '';
    }).catch(() => { av.textContent = '?'; });
    return row;
  }
  // Signed-in Drive rows: the default-location toggle, and the connection check with its steps listed inline (TASK 506).
  function driveRows(fail) {
    const toggle = document.createElement('label'); toggle.className = 'sk-account-toggle'; toggle.dataset.account = 'drive-default-row';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.dataset.account = 'drive-default'; cb.checked = !!driveControls.getDefault();
    cb.addEventListener('change', () => { try { driveControls.setDefault(cb.checked); } catch (e) { fail(e); } });
    const t = document.createElement('span'); t.textContent = 'Save to Google Drive by default';
    toggle.append(cb, t);
    const check = document.createElement('button'); check.type = 'button'; check.className = 'sk-sidebar-item'; check.dataset.account = 'check-drive';
    check.innerHTML = '<span class="sk-sidebar-ic" aria-hidden="true">&#10003;</span><span>Check Google Drive connection</span>';
    const list = document.createElement('ul'); list.className = 'sk-check-steps'; list.dataset.account = 'check-result';
    const draw = () => {
      list.innerHTML = ''; list.hidden = !checkSteps;
      for (const s of checkSteps || []) {
        const li = document.createElement('li'); li.dataset.state = s.state; li.dataset.step = s.id;
        const mark = { ok: '\u2713', failed: '\u2717', running: '\u2026', skipped: '-', pending: '\u00b7' }[s.state] || '';
        const http = s.state === 'ok' ? ' (OK)' : s.state === 'failed' ? ` (failed${s.status ? ', HTTP ' + s.status : ''}${s.detail ? ': ' + s.detail : ''})` : s.state === 'skipped' ? ' (not run)' : '';
        li.innerHTML = '<span class="mark"></span><span class="txt"></span>';
        li.querySelector('.mark').textContent = mark; li.querySelector('.txt').textContent = s.label + http;
        list.appendChild(li);
      }
    };
    draw();
    check.addEventListener('click', () => {
      if (check.disabled) return;
      check.disabled = true;
      Promise.resolve(driveControls.check((steps) => { checkSteps = steps; if (list.isConnected) draw(); })).catch(fail).finally(() => { check.disabled = false; });
    });
    return [toggle, check, list];
  }
  function paintStatus(el) { const s = status(); el.textContent = s.text; el.classList.toggle('error', s.kind === 'error'); el.dataset.kind = s.kind || 'info'; }
  if (account && account.subscribe) account.subscribe(() => { if (isOpenFlag && viewId === 'main') render(); });

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
    const old = drawer.querySelector('.sk-sidebar-msg'); if (old) old.remove();
    if (!message) return;
    const m = document.createElement('div'); m.className = 'sk-sidebar-msg ' + (message.kind || 'info'); m.setAttribute('role', message.kind === 'error' ? 'alert' : 'status'); m.textContent = message.text;
    if (message.link) { const a = document.createElement('a'); a.href = message.link.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = message.link.label; m.appendChild(a); }
    (parent || drawer).appendChild(m);
  }
  function notify(text, kind = 'info', link = null) { message = text ? { text, kind, link } : null; if (isOpenFlag) { const top = drawer.querySelector('.sk-sidebar-top') || drawer.querySelector('.sk-sidebar-viewhead'); drawMessage(top); } }

  const focusables = () => [...drawer.querySelectorAll('button:not(:disabled)')];
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
    // updates the heading in place: a full re-render would reset an open view (e.g. the Projects browser back to its first level)
    setDocName(n) { name = n; const h = drawer.querySelector('h2.sk-sidebar-doc'); if (h) h.textContent = n; },
    /** Repaint the status line in place (the store's state changed). */
    refreshStatus() { const s = drawer.querySelector('[data-section=status]'); if (s && status) paintStatus(s); },
    showView, notify, registerView(id, def) { viewDefs[id] = def; },
    setActions(a) { acts = Array.isArray(a) ? a : []; if (isOpenFlag) render(); },
    destroy() { close(); try { el.remove(); backdrop.remove(); drawer.remove(); } catch (_) {} },
  };
}
