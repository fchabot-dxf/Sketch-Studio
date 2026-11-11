// packages/ui/sidebar-projects.js — TASK 479: the project actions + views of the shared app sidebar, wired to the project store
// (#ui/project-store.js, task 474) through each host's document buffer. ONE module, so every app gets the SAME entries:
//   main view  document name (click to rename inline) + where it lives and its save state (TASK 506) · New design · Save as… ·
//              Duplicate · Open recent · Projects · Save to file · Save to Google Drive (signed in only) · Open from file ·
//              [the host's own Download actions] · GO TO (+ the account row: the Drive default toggle and connection check)
//   views      'recent'   — listRecent, newest first, with project name + relative time
//              'projects' — the Fusion-style browser: New project, pinned first, then projects; click a project -> its designs
//                           (open on click), back; per row a small menu: rename, pin/unpin, move to…, delete (with confirm;
//                           the store's refusal reason is shown in the drawer).
// The host passes `getBuffer()` (its createDocumentBuffer result; it may be created lazily, so it is read at click time) and
// its own `hostActions` array. A refused open / file / delete shows the store's message in the drawer and changes nothing.
// The tab title follows the current design through the registry (appTitle).

import { createAppSidebar, SIDEBAR_ICONS } from './app-sidebar.js';
import { getProjectStore } from './project-store.js';
import { applyAppIdentity, appById } from './app-registry.js';
import { getGoogleAccount } from './cloud/google-account.js';
import { driveErrorText, driveFileUrl } from './cloud/drive-adapter.js';
import SettingsManager from '#core/settings-manager.js';

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

const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function mountProjectSidebar({ appId, getBuffer, hostActions = [], store = getProjectStore(), account = getGoogleAccount() } = {}) {
  let sidebar = null;
  let currentName = 'Untitled';
  let currentDesignId = null;
  const buf = () => { const b = getBuffer && getBuffer(); if (!b) throw new Error('This app is still starting. Try again in a moment.'); return b; };
  const fail = (e) => sidebar.notify(driveErrorText(e), 'error');
  // run a store-backed action: errors stay in the drawer (nothing changed); success closes it
  const act = (fn, { close = true } = {}) => async (...args) => { try { await fn(...args); if (close) sidebar.close(); } catch (e) { fail(e); } };
  const currentId = async () => { const b = getBuffer && getBuffer(); return (b && b.designId && b.designId()) || ((await store.current()) || {}).id || null; };

  async function refreshName() {
    let c = null;
    try { c = await store.current(); } catch (_) { c = null; }
    currentName = c ? c.name : 'Untitled';
    currentDesignId = c ? c.id : null;
    if (sidebar) { sidebar.setDocName(currentName); sidebar.refreshStatus(); }
    applyAppIdentity(appId, { designName: c ? c.name : undefined });
  }

  const openDesignById = async (id) => {
    const out = await buf().openDesign(id);
    if (!out.restored) throw new Error(out.reason || 'This design could not be opened.');
  };

  const actions = [
    { id: 'new-design', label: 'New design', icon: SIDEBAR_ICONS.new, tooltip: 'Start an empty design (the current one is kept)', keepOpen: true, onClick: act(async () => { await buf().newDesign(); }) },
    { id: 'save-as', label: 'Save as…', icon: SIDEBAR_ICONS.save, keepOpen: true, prompt: { label: 'Save a copy as', value: () => currentName + ' copy', okLabel: 'Save' }, onClick: act(async (name) => { await buf().saveAs(name); }) },
    { id: 'duplicate', label: 'Duplicate', icon: SIDEBAR_ICONS.copy, keepOpen: true, onClick: act(async () => {
      const b = buf(); await b.flush();
      const id = b.designId();
      if (!id) throw new Error('Nothing to duplicate yet — draw something first.');
      const d = await store.duplicate(id);
      sidebar.notify(`Duplicated as "${d.name}" (find it under Open recent).`, 'info');
    }, { close: false }) },
    { id: 'open-recent', label: 'Open recent', icon: SIDEBAR_ICONS.recent, keepOpen: true, onClick: () => sidebar.showView('recent') },
    { id: 'projects', label: 'Projects', icon: SIDEBAR_ICONS.folder, keepOpen: true, onClick: () => sidebar.showView('projects') },
    { divider: true },
    { id: 'save-file', label: 'Save to file', icon: SIDEBAR_ICONS.save, keepOpen: true, onClick: act(async () => { await buf().saveFile(); }) },
    { id: 'save-drive', label: 'Save to Google Drive', icon: SIDEBAR_ICONS.cloud, keepOpen: true, tooltip: 'Save this design into the "My Designs" project on your Google Drive (the rest of its project stays on this device)',
      visible: () => !!(account && account.state().signedIn && store.cloud),
      onClick: act(async () => {
        const b = buf(); await b.flush();
        const id = b.designId();
        if (!id) throw new Error('Nothing to save yet — draw something first.');
        const r = await store.cloud.saveToDrive(id);
        sidebar.notify('Saved to Google Drive', 'info', { href: driveFileUrl(r.fileId), label: 'Open in Drive' });
      }, { close: false }) },
    { id: 'open-file', label: 'Open from file', icon: SIDEBAR_ICONS.open, keepOpen: true, onClick: act(async () => { await buf().openFile(); }) },
    ...(hostActions.length ? [{ divider: true }, ...hostActions] : []),
  ];

  // The one-line state under the document name, derived from the store (where the current design lives + how its last save went).
  const statusLine = () => {
    const s = store.status ? store.status(currentDesignId) : { where: 'device', state: 'saved', at: null, reason: null };
    if (s.state === 'failed' || (s.where === 'device' && s.reason)) return { kind: 'error', text: `Not saved to Google Drive: ${s.reason}. Kept on this device.` };
    if (s.where === 'device') return { kind: 'info', text: 'Saved on this device' };
    if (s.state === 'saving') return { kind: 'info', text: 'Saving to Google Drive...' };
    return { kind: 'info', text: 'Saved to Google Drive' + (s.at ? ', ' + relativeTime(s.at) : '') };
  };
  const driveControls = store.cloud ? {
    getDefault: () => SettingsManager.get('DRIVE_DEFAULT') !== false,
    setDefault: (on) => SettingsManager.set('DRIVE_DEFAULT', !!on),
    check: (onSteps) => store.cloud.checkConnection(onSteps),
  } : null;

  // ---- views ------------------------------------------------------------------------------------------------------
  const note = (box, text) => { const d = document.createElement('div'); d.className = 'sk-note'; d.textContent = text; box.appendChild(d); };
  const rowBtn = (cls, html) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'sk-sidebar-item sk-row ' + cls; b.innerHTML = html; return b; };
  const liveRefresh = (box, rerender) => { const off = store.subscribe(() => { if (!box.isConnected) { off(); return; } rerender(); }); };

  async function renderRecent(box) {
    let rows = [];
    try { rows = await store.listRecent({ limit: 40 }); } catch (e) { fail(e); }
    box.innerHTML = '';
    if (!rows.length) { note(box, 'No designs yet.'); return; }
    for (const r of rows) {
      const app = appById(r.app);
      const b = rowBtn('sk-recent', `<span class="sk-row-main"><span class="sk-row-name">${esc(r.name)}</span><span class="sk-row-sub">${esc(r.projectName || '')} · ${esc(app ? app.name : r.app || '')} · ${esc(relativeTime(r.updatedAt))}</span></span>`);
      b.dataset.design = r.id;
      b.addEventListener('click', act(() => openDesignById(r.id)));
      box.appendChild(b);
    }
  }

  // an inline one-line text editor in place of a row: Enter / blur-less OK commits, Esc cancels (back to `again`)
  function editInline(row, initial, onOk, again) {
    const inp = document.createElement('input'); inp.type = 'text'; inp.className = 'sk-sidebar-input'; inp.value = initial;
    let done = false;
    const finish = (ok) => { if (done) return; done = true; if (ok && inp.value.trim()) Promise.resolve(onOk(inp.value.trim())).catch(fail); else again(); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); } });
    inp.addEventListener('blur', () => finish(false));
    row.replaceWith(inp); inp.focus(); inp.select();
  }
  function confirmInline(row, text, okLabel, onOk, again) {
    const c = document.createElement('div'); c.className = 'sk-sidebar-confirm';
    c.innerHTML = `<span>${esc(text)}</span><div class="sk-sidebar-confirm-btns"><button type="button" class="cancel">Cancel</button><button type="button" class="ok">${esc(okLabel)}</button></div>`;
    c.querySelector('.cancel').addEventListener('click', again);
    c.querySelector('.ok').addEventListener('click', () => { Promise.resolve(onOk()).catch(fail); });
    row.replaceWith(c); c.querySelector('.cancel').focus();
  }
  // the small per-row menu: a "⋯" button that expands a list of choices under the row
  function withMenu(rowWrap, items) {
    const menuBtn = document.createElement('button'); menuBtn.type = 'button'; menuBtn.className = 'sk-row-menu'; menuBtn.setAttribute('aria-label', 'More'); menuBtn.textContent = '⋯';
    let menu = null;
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (menu) { menu.remove(); menu = null; return; }
      menu = document.createElement('div'); menu.className = 'sk-row-menulist';
      for (const it of items) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'sk-sidebar-item sk-menu-item'; b.dataset.menu = it.id; b.textContent = it.label;
        b.addEventListener('click', (ev) => { ev.stopPropagation(); menu.remove(); menu = null; it.run(rowWrap); });
        menu.appendChild(b);
      }
      rowWrap.after(menu);
    });
    rowWrap.appendChild(menuBtn);
  }

  async function renderProjects(box, state = { project: null }) {
    const again = () => renderProjects(box, state);
    box.innerHTML = '';
    if (!state.project) {
      let projects = [];
      try { projects = await store.listProjects(); } catch (e) { fail(e); }
      if (store.cloud && account && !account.state().signedIn && await store.cloud.isEnabled()) note(box, 'Your projects on Google Drive are hidden while you are signed out. Sign in again to see them; nothing was changed.');
      const nb = rowBtn('sk-new-project', `<span class="sk-sidebar-ic" aria-hidden="true">+</span><span>New project</span>`);
      nb.dataset.action = 'new-project';
      nb.addEventListener('click', () => editInline(nb, 'New project', async (name) => { await store.createProject(name); }, again));
      box.appendChild(nb);
      for (const p of projects) {
        const wrap = document.createElement('div'); wrap.className = 'sk-row-wrap';
        const b = rowBtn('sk-project', `<span class="sk-sidebar-ic" aria-hidden="true">${p.pinned ? '&#9733;' : SIDEBAR_ICONS.folder}</span><span class="sk-row-main"><span class="sk-row-name">${esc(p.name)}${p.location === 'drive' ? '<span class="sk-cloud-mark" data-cloud="drive" title="        on Google Drive" aria-label="On Google Drive">&#9729;</span>' : ''}</span><span class="sk-row-sub">${esc(relativeTime(p.updatedAt))}</span></span>`);
        b.dataset.project = p.id;
        b.addEventListener('click', () => { state.project = p; again(); });
        wrap.appendChild(b);
        const cloudItems = [];
        if (account && account.state().signedIn && store.cloud) {
          if (p.location === 'drive') cloudItems.push({ id: 'make-local', label: 'Make local', run: () => confirmInline(wrap, `Make "${p.name}" local? It will be copied from Google Drive to this device and checked, and only then is the Drive copy removed.`, 'Make local', async () => { try { await store.cloud.makeProjectLocal(p.id); } catch (e) { fail(e); again(); } }, again) });
          else cloudItems.push({ id: 'use-drive', label: 'Use Google Drive', run: () => confirmInline(wrap, `Use Google Drive for "${p.name}"? It will be copied to your Google Drive and checked, and only then is the copy on this device removed.`, 'Use Google Drive', async () => { try { await store.cloud.moveProjectToDrive(p.id); } catch (e) { fail(e); again(); } }, again) });
        }
        withMenu(wrap, [
          ...cloudItems,
          { id: 'rename', label: 'Rename', run: () => editInline(wrap, p.name, async (n) => { await store.renameProject(p.id, n); }, again) },
          { id: 'pin', label: p.pinned ? 'Unpin' : 'Pin', run: () => store.pinProject(p.id, !p.pinned).catch(fail) },
          { id: 'delete', label: 'Delete', run: () => confirmInline(wrap, `Delete project "${p.name}"?`, 'Delete', async () => { try { await store.removeProject(p.id); } catch (e) { fail(e); again(); } }, again) },
        ]);
        box.appendChild(wrap);
      }
      return;
    }
    // level 2: the designs of one project
    const p = state.project;
    const back = rowBtn('sk-back-projects', `<span class="sk-sidebar-ic" aria-hidden="true">&#8249;</span><span class="sk-row-name">${esc(p.name)}</span>`);
    back.dataset.action = 'to-projects';
    back.addEventListener('click', () => { state.project = null; again(); });
    box.appendChild(back);
    let designs = [], projects = [];
    try { designs = await store.listDesigns(p.id); projects = await store.listProjects(); } catch (e) { fail(e); }
    if (!designs.length) note(box, 'No designs in this project.');
    for (const d of designs) {
      const wrap = document.createElement('div'); wrap.className = 'sk-row-wrap';
      const app = appById(d.app);
      const b = rowBtn('sk-design', `<span class="sk-row-main"><span class="sk-row-name">${esc(d.name)}</span><span class="sk-row-sub">${esc(app ? app.name : d.app || '')} · ${esc(relativeTime(d.updatedAt))}</span></span>`);
      b.dataset.design = d.id;
      b.addEventListener('click', act(() => openDesignById(d.id)));
      wrap.appendChild(b);
      withMenu(wrap, [
        { id: 'rename', label: 'Rename', run: () => editInline(wrap, d.name, async (n) => { await store.rename(d.id, n); }, again) },
        { id: 'move', label: 'Move to…', run: () => {
          const c = document.createElement('div'); c.className = 'sk-row-menulist sk-move';
          for (const t of projects.filter((x) => x.id !== p.id)) {
            const mb = document.createElement('button'); mb.type = 'button'; mb.className = 'sk-sidebar-item sk-menu-item'; mb.dataset.moveTo = t.id; mb.textContent = t.name;
            mb.addEventListener('click', () => store.moveDesign(d.id, t.id).catch(fail));
            c.appendChild(mb);
          }
          if (!c.children.length) { const n = document.createElement('div'); n.className = 'sk-note'; n.textContent = 'No other project yet — make one first.'; c.appendChild(n); }
          wrap.after(c);
        } },
        { id: 'delete', label: 'Delete', run: () => confirmInline(wrap, `Delete "${d.name}"?`, 'Delete', async () => { await store.remove(d.id); }, again) },
      ]);
      box.appendChild(wrap);
    }
  }

  sidebar = createAppSidebar({
    current: appId, docName: currentName, actions, account, driveControls, status: statusLine,
    onRenameDoc: (name) => act(async () => {
      const id = await currentId();
      if (!id) throw new Error('Nothing to rename yet — draw something first.');
      await store.rename(id, name);
    }, { close: false })(),
    views: {
      recent: { title: 'Open recent', render: (box) => { renderRecent(box); liveRefresh(box, () => renderRecent(box)); } },
      projects: { title: 'Projects', render: (box) => { const st = { project: null }; renderProjects(box, st); liveRefresh(box, () => renderProjects(box, st)); if (account && account.subscribe) { const off = account.subscribe(() => { if (!box.isConnected) { off(); return; } renderProjects(box, st); }); } } },
    },
  });
  store.subscribe(refreshName);
  refreshName();
  return sidebar;
}
