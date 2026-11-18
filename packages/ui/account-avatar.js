// packages/ui/account-avatar.js — TASK 776 (owner turn 2365, like DDCS Studio): THE account control of the shared app chrome, ONE component for the four hosts.
// A round AVATAR at the far RIGHT END of the shared app footer (footer-slot.js, after the Save button; TASK 776, owner turn 2368: one place in every layout)
// and a small MENU that opens UPWARD from it. It is the account's ONLY UI (the drawer has no account block any more): exactly one per layout.
//   signed in   the Google profile picture (the `picture` of account.userInfo(): Drive's own about.get photoLink, the call the drawer's account row already
//               made: no new scope, no new call; the <img> has referrerpolicy="no-referrer"), the initials when there is none or it does not load. The name is the
//               tooltip / aria-label; the email is shown only in the menu.
//   signed out  a neutral person icon, tooltip "Sign in".
//   lapsed      the person icon with an amber dot, tooltip "Reconnect Google account" (a refused refresh is not a sign-out, auth-state.js).
// The MENU (a popover on the sidebar's tokens: Esc / an outside press closes it, Tab stays inside it, 44 px rows on touch) RUNS the account's existing functions:
// account.signIn() (called synchronously from the click, so its popup is not blocked) / signOut(), the Drive connection check (driveControls.check from
// sidebar-projects.js) and shows the status lines that already exist: the Google Drive connection and the settings sync (settings-sync.js SYNC_STATUS_TEXT).
// Nothing is stored here. accountModel() is the PURE part (what to show for a state), tested in node; createAccountAvatar() draws it.
import { listenOutsidePress } from './outside-press.js';
import { SYNC_STATUS_TEXT, settingsSyncStatus, onSettingsSyncStatus } from './cloud/settings-sync.js';
import { initialsOf } from './cloud/auth-state.js';

/** The words of the menu, in one place. */
export const ACCOUNT_TEXT = Object.freeze({
  signedOutTip: 'Sign in',
  lapsedTip: 'Reconnect Google account',
  signedOutLine: 'Sign in to save designs and settings to your Google Drive. Everything also works without an account.',
  signedInLine: 'Saves your designs and settings to your Google Drive.',
  lapsedLine: 'Your Google session ended. Reconnect to keep saving to your Google Drive.',
  driveConnected: 'Connected to Google Drive',
  driveLapsed: 'Google Drive: reconnect needed',
  signIn: 'Sign in with Google',
  reconnect: 'Reconnect',
  signOut: 'Sign out',
  check: 'Check Google Drive connection',
  fallbackName: 'Google account',
});

/** PURE: what the account control shows. `state` = account.state() ({ signedIn, lapsed }), `info` = account.userInfo() ({ name, email, picture, initials }) or null,
 *  `sync` = the settings sync status ({ state }). Returns { mode, tip, name, email, initials, picture, purpose, status: [text], actions: [id] }. */
export function accountModel({ state, info = null, sync = { state: 'off' }, canCheck = false } = {}) {
  const st = state || {};
  const syncLine = sync && sync.state && sync.state !== 'off' && SYNC_STATUS_TEXT[sync.state] ? [SYNC_STATUS_TEXT[sync.state]] : [];
  if (st.lapsed) {
    return { mode: 'lapsed', tip: ACCOUNT_TEXT.lapsedTip, name: '', email: '', initials: '', picture: '', purpose: ACCOUNT_TEXT.lapsedLine, status: [ACCOUNT_TEXT.driveLapsed, ...syncLine], actions: ['reconnect'] };
  }
  if (!st.signedIn) {
    return { mode: 'signed-out', tip: ACCOUNT_TEXT.signedOutTip, name: '', email: '', initials: '', picture: '', purpose: ACCOUNT_TEXT.signedOutLine, status: [], actions: ['sign-in'] };
  }
  const name = (info && info.name) || '', email = (info && info.email) || '';
  const label = name || email || ACCOUNT_TEXT.fallbackName;
  return {
    mode: 'signed-in', tip: label, name: label, email: name ? email : '',
    initials: (info && info.initials) || initialsOf(name, email), picture: (info && info.picture) || '',
    purpose: ACCOUNT_TEXT.signedInLine, status: [ACCOUNT_TEXT.driveConnected, ...syncLine], actions: [...(canCheck ? ['check-drive'] : []), 'sign-out'],
  };
}

const PERSON = '<svg aria-hidden="true" width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="9" r="3.6"/><path d="M5 20c.8-3.6 3.6-5.4 7-5.4s6.2 1.8 7 5.4"/></svg>';

let stylesInjected = false;
function injectStyles(doc) {
  if (stylesInjected || !doc || !doc.head) return;
  if (doc.getElementById('sk-account-styles')) { stylesInjected = true; return; }
  const s = doc.createElement('style'); s.id = 'sk-account-styles';
  s.textContent = `
.sk-account { --sk-account-size: calc(var(--sk-footer-btn-h, 32px) - 8px); position: relative; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; margin: 0; padding: 0; border: 0; background: transparent; color: inherit; cursor: pointer; border-radius: 50%; }
.sk-account:focus-visible { outline: 2px solid var(--sk-selection, #3B82F6); outline-offset: 2px; }
.sk-account-circle { position: relative; width: var(--sk-account-size); height: var(--sk-account-size); flex: 0 0 auto; border-radius: 50%; overflow: hidden; display: inline-flex; align-items: center; justify-content: center;
  background: var(--sk-sidebar-accent, var(--sk-selection, #2c65ff)); color: #fff; font: 700 calc(var(--sk-account-size) * 0.4)/1 system-ui, -apple-system, 'Segoe UI', sans-serif; box-sizing: border-box; }
.sk-account-circle img { width: 100%; height: 100%; object-fit: cover; display: block; }
.sk-account-circle.person { background: transparent; color: inherit; border: 1px solid var(--sk-header-sep, rgba(127,127,127,0.45)); padding: 15%; }
.sk-account:hover .sk-account-circle.person { background: var(--sk-header-hover, rgba(127,127,127,0.12)); }
.sk-account-dot { position: absolute; right: 0; bottom: 0; width: 9px; height: 9px; border-radius: 50%; background: #f59e0b; border: 2px solid var(--sk-header-bg, #f1f5f9); box-sizing: content-box; transform: translate(25%, 25%); display: none; }
.sk-account[data-state="lapsed"] .sk-account-dot { display: block; }
.sk-account-menu { position: fixed; z-index: 100000; box-sizing: border-box; width: 300px; max-width: calc(100vw - 16px); padding: 12px; outline: none; overflow-y: auto;
  background: var(--sk-sidebar-bg, var(--sk-header-bg, #fff)); color: var(--sk-sidebar-fg, var(--sk-header-fg, #1e293b));
  border: 1px solid var(--sk-sidebar-sep, rgba(127,127,127,0.35)); border-radius: 10px; box-shadow: 0 10px 25px rgba(0,0,0,0.25); font: 13px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif; }
.sk-account-menu * { box-sizing: border-box; }
.sk-account-menu[hidden] { display: none; }
.sk-account-who { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.sk-account-who .sk-account-circle { --sk-account-size: 40px; }
.sk-account-names { display: flex; flex-direction: column; min-width: 0; }
.sk-account-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sk-account-email { font-size: 12px; opacity: 0.7; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sk-account-purpose { margin: 0 0 8px; opacity: 0.85; }
.sk-account-status { margin: 0 0 8px; padding: 0; list-style: none; font-size: 12.5px; opacity: 0.75; }
.sk-account-status li { padding: 1px 0; }
.sk-account-btn { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; min-height: 34px; margin: 4px 0 0; padding: 6px 10px; border-radius: 6px; cursor: pointer; font: 600 13px/1.2 inherit;
  background: transparent; color: inherit; border: 1px solid var(--sk-sidebar-sep, rgba(127,127,127,0.45)); }
.sk-account-btn:hover:not(:disabled) { background: var(--sk-sidebar-hover, rgba(127,127,127,0.18)); }
.sk-account-btn:disabled { opacity: 0.55; cursor: progress; }
.sk-account-btn.primary { background: var(--sk-sidebar-accent, var(--sk-selection, #2c65ff)); border-color: transparent; color: #fff; }
.sk-account-btn:focus-visible { outline: 2px solid var(--sk-selection, #3B82F6); outline-offset: 1px; }
.sk-account-steps { margin: 6px 0 0; padding: 0; list-style: none; font-size: 12.5px; line-height: 1.4; }
.sk-account-steps li { display: flex; gap: 8px; padding: 2px 0; }
.sk-account-steps .mark { flex: 0 0 auto; width: 16px; text-align: center; }
.sk-account-steps li[data-state=ok] .mark { color: #16a34a; }
.sk-account-steps li[data-state=failed] { color: #dc2626; }
.sk-account-steps li[data-state=skipped], .sk-account-steps li[data-state=pending] { opacity: 0.55; }
.sk-account-err { margin: 6px 0 0; font-size: 12.5px; color: #dc2626; }
@media (pointer: coarse), (max-width: 640px) { .sk-account-btn { min-height: 44px; } }
`;
  doc.head.appendChild(s);
  stylesInjected = true;
}

/** createAccountAvatar({ account, check, doc, win }) -> { el, refresh, open, close, isOpen, placeIn, destroy }.
 *  account = the Google account controller (getGoogleAccount()); check(onSteps) = the Drive connection check (null: no such row). */
export function createAccountAvatar({ account, check = null, doc = globalThis.document, win = globalThis.window } = {}) {
  injectStyles(doc);
  const el = doc.createElement('button'); el.type = 'button'; el.className = 'sk-account'; el.dataset.account = 'avatar';
  el.setAttribute('aria-haspopup', 'dialog'); el.setAttribute('aria-expanded', 'false');
  const menu = doc.createElement('div'); menu.className = 'sk-account-menu'; menu.dataset.section = 'account'; menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-label', 'Account'); menu.tabIndex = -1; menu.hidden = true;
  doc.body.appendChild(menu);

  let info = null;            // account.userInfo() of the signed-in user (cached by the account itself)
  let infoRequested = false;
  let steps = null;           // the last "Check Google Drive connection" result, shown in the menu
  let errorText = '';
  let model = null;
  let isOpenFlag = false, stopOutside = null;

  const fail = (e) => { errorText = (e && e.message) || String(e); if (isOpenFlag) drawMenu(); };
  const run = (fn) => () => { try { const r = fn(); if (r && r.catch) r.catch(fail); } catch (e) { fail(e); } };

  /** The round picture: <img referrerpolicy="no-referrer"> when there is a URL, the initials until / unless it loads, the person icon with no account. */
  function paintCircle(circle, m) {
    circle.textContent = '';
    if (m.mode === 'signed-in') {
      circle.classList.remove('person');
      circle.textContent = m.initials || '?';
      if (m.picture) {
        const img = doc.createElement('img'); img.alt = ''; img.referrerPolicy = 'no-referrer';
        img.addEventListener('load', () => { circle.textContent = ''; circle.appendChild(img); });
        img.addEventListener('error', () => { img.remove(); circle.textContent = m.initials || '?'; });
        img.src = m.picture;
      }
    } else {
      circle.classList.add('person');
      circle.innerHTML = PERSON;
    }
  }

  function currentModel() {
    return accountModel({ state: account.state(), info, sync: settingsSyncStatus(), canCheck: !!check });
  }

  function drawButton() {
    model = currentModel();
    el.dataset.state = model.mode;
    el.title = model.tip;
    el.setAttribute('aria-label', model.mode === 'signed-in' ? `Account: ${model.tip}` : model.tip);
    el.textContent = '';
    const circle = doc.createElement('span'); circle.className = 'sk-account-circle'; circle.setAttribute('aria-hidden', 'true');
    paintCircle(circle, model);
    el.append(circle);
    const dot = doc.createElement('span'); dot.className = 'sk-account-dot'; dot.setAttribute('aria-hidden', 'true'); el.append(dot);
  }

  function btn(id, text, onClick, primary = false) {
    const b = doc.createElement('button'); b.type = 'button'; b.className = 'sk-account-btn' + (primary ? ' primary' : ''); b.dataset.account = id; b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }

  function drawMenu() {
    const m = model;
    menu.textContent = '';
    menu.dataset.state = m.mode;
    if (m.mode === 'signed-in') {
      const who = doc.createElement('div'); who.className = 'sk-account-who'; who.dataset.account = 'who';
      const circle = doc.createElement('span'); circle.className = 'sk-account-circle'; circle.dataset.account = 'picture'; paintCircle(circle, m);
      const names = doc.createElement('span'); names.className = 'sk-account-names';
      const n = doc.createElement('span'); n.className = 'sk-account-name'; n.textContent = m.name; names.append(n);
      if (m.email) { const e = doc.createElement('span'); e.className = 'sk-account-email'; e.textContent = m.email; names.append(e); }
      who.append(circle, names); menu.append(who);
    }
    const p = doc.createElement('p'); p.className = 'sk-account-purpose'; p.dataset.account = 'purpose'; p.textContent = m.purpose; menu.append(p);
    if (m.status.length) {
      const ul = doc.createElement('ul'); ul.className = 'sk-account-status'; ul.dataset.account = 'status';
      for (const t of m.status) { const li = doc.createElement('li'); li.textContent = t; ul.append(li); }
      menu.append(ul);
    }
    for (const id of m.actions) {
      if (id === 'sign-in') menu.append(btn('sign-in', ACCOUNT_TEXT.signIn, run(() => { close(); return account.signIn(); }), true));
      else if (id === 'reconnect') menu.append(btn('reconnect', ACCOUNT_TEXT.reconnect, run(() => { close(); return account.signIn(); }), true));
      else if (id === 'sign-out') menu.append(btn('sign-out', ACCOUNT_TEXT.signOut, run(() => { close(); return account.signOut(); })));
      else if (id === 'check-drive') {
        const b = btn('check-drive', ACCOUNT_TEXT.check, () => {
          if (b.disabled) return;
          b.disabled = true;
          Promise.resolve(check((s) => { steps = s; if (list.isConnected) drawSteps(list); })).catch(fail).finally(() => { b.disabled = false; });
        });
        const list = doc.createElement('ul'); list.className = 'sk-account-steps'; list.dataset.account = 'check-result';
        drawSteps(list);
        menu.append(b, list);
      }
    }
    if (errorText) { const e = doc.createElement('p'); e.className = 'sk-account-err'; e.dataset.account = 'error'; e.setAttribute('role', 'alert'); e.textContent = errorText; menu.append(e); }
  }
  function drawSteps(list) {
    list.textContent = ''; list.hidden = !steps;
    for (const s of steps || []) {
      const li = doc.createElement('li'); li.dataset.state = s.state; li.dataset.step = s.id;
      const mark = { ok: '✓', failed: '✗', running: '…', skipped: '-', pending: '·' }[s.state] || '';
      const http = s.state === 'ok' ? ' (OK)' : s.state === 'failed' ? ` (failed${s.status ? ', HTTP ' + s.status : ''}${s.detail ? ': ' + s.detail : ''})` : s.state === 'skipped' ? ' (not run)' : '';
      li.innerHTML = '<span class="mark"></span><span class="txt"></span>';
      li.querySelector('.mark').textContent = mark; li.querySelector('.txt').textContent = s.label + http;
      list.appendChild(li);
    }
  }

  function position() {
    const r = el.getBoundingClientRect(), vw = win.innerWidth;
    const w = menu.getBoundingClientRect().width || 300;
    menu.style.bottom = Math.round(win.innerHeight - r.top + 6) + 'px'; // opens UPWARD from the footer
    menu.style.maxHeight = Math.max(120, Math.round(r.top - 14)) + 'px';
    menu.style.left = Math.round(Math.max(8, Math.min(r.right - w, vw - w - 8))) + 'px';
  }
  const focusables = () => [...menu.querySelectorAll('button:not(:disabled)')];
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); el.focus(); return; }
    if (e.key !== 'Tab') return;
    const f = focusables(); if (!f.length) { e.preventDefault(); return; }
    const first = f[0], last = f[f.length - 1], a = doc.activeElement;
    if (e.shiftKey && (a === first || a === menu)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
  }
  function open() {
    if (isOpenFlag) return;
    isOpenFlag = true; errorText = '';
    drawButton(); drawMenu();
    menu.hidden = false; position();
    el.setAttribute('aria-expanded', 'true');
    const f = focusables(); (f[0] || menu).focus();
    doc.addEventListener('keydown', onKey, true);
    stopOutside = listenOutsidePress((e) => { if (!menu.contains(e.target) && !el.contains(e.target)) close(); });
  }
  function close() {
    if (!isOpenFlag) return;
    isOpenFlag = false;
    menu.hidden = true; el.setAttribute('aria-expanded', 'false');
    doc.removeEventListener('keydown', onKey, true);
    if (stopOutside) { stopOutside(); stopOutside = null; }
  }
  el.addEventListener('click', () => { if (isOpenFlag) close(); else open(); });

  /** Redraw from the account's state; fetch the picture / name once per sign-in. */
  function refresh() {
    const st = account.state();
    if (!st.signedIn) { info = null; infoRequested = false; steps = null; }
    else if (!infoRequested && account.userInfo) {
      infoRequested = true;
      Promise.resolve(account.userInfo()).then((u) => { if (u && account.state().signedIn) { info = u; refresh(); } }, fail);
    }
    drawButton();
    if (isOpenFlag) { drawMenu(); position(); }
  }
  const offAccount = account.subscribe ? account.subscribe(refresh) : () => {};
  const offSync = onSettingsSyncStatus(() => refresh());

  // the footer's right end (footer-slot.js), after the Save button: the far right of every layout
  const placeIn = (slot) => { slot.appendChild(el); };

  refresh();
  return {
    el, menu, refresh, open, close, isOpen: () => isOpenFlag, placeIn,
    destroy() { close(); offAccount(); offSync(); el.remove(); menu.remove(); },
  };
}
