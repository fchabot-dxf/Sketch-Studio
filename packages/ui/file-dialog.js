// packages/ui/file-dialog.js — TASK 759 (owner turn 2266: "Save as should open a modal that has google drive or local tab"): THE Save as dialog and THE
// Open dialog of every app, declared once. Both are the shared small modal (#ui/template-picker.js openSmallModal: dimmed backdrop, role=dialog aria-modal,
// Esc / a press outside / Cancel close it, focus comes back) with the same two tabs:
//   Google Drive  signed in: the name field + Save (today's Drive save, unchanged underneath) / the recent designs + "All projects…" (today's project manager).
//                 Signed out: one line and the "Sign in with Google" button INSIDE the tab (the only place a signed-out user meets Drive); once signed in the
//                 tab shows its signed-in content.
//   Local         a name field + Save: the design FILE (.sketch.json, the same bytes a Drive save writes) on this device / "Choose a file…": a design file
//                 from this device opens as a tab. No account, no network.
// The tab shown first: the one last used on this device (the FILE_DIALOG_TAB setting), else Drive for a signed-in user, Local for a signed-out one.
// The dialog only shows and asks; what Save / Open DO is passed in (project-actions.js), and is called synchronously inside the click, so the browser's
// file picker and Google's sign-in popup open (they need the click). A failure shows in the dialog's error line and the dialog stays open; a picker the user
// closed leaves the dialog open too.
//
// openFileDialog({ mode: 'save' | 'open', ... }) -> Promise<result | null>  (null = cancelled)
//   driveReady()        true when the Drive tab can be used now (signed in; or a store with no Drive at all)
//   signIn()            starts the Google sign-in (account.signIn(), called in the click); resolves when it settled
//   subscribeAccount(fn) -> unsubscribe   the tab re-renders when the sign-in state changes
//   save mode:  name, onSave(tab, name) -> Promise<result | null>   (null = the picker was cancelled: the dialog stays)
//   open mode:  listDesigns() -> Promise<[{ id, name, sub }]>, onOpenDesign(id), onChooseFile() -> Promise<result | null>, onProjects() (opens the project manager)

import SettingsManager from '#core/settings-manager.js';
import { openSmallModal } from './template-picker.js';
import { PROJECT_FILE_EXT } from './project-file.js';

/** The per-device setting that remembers the tab last used (either dialog). */
export const FILE_DIALOG_TAB_SETTING = 'FILE_DIALOG_TAB';
export const FILE_DIALOG_TABS = Object.freeze([{ id: 'drive', label: 'Google Drive' }, { id: 'local', label: 'Local' }]);

/** The tab the dialog opens on: the one last used on this device, else Drive when it is ready (signed in), Local otherwise. */
export function initialFileDialogTab({ driveReady, settings = SettingsManager }) {
  const saved = settings.get(FILE_DIALOG_TAB_SETTING);
  if (FILE_DIALOG_TABS.some((t) => t.id === saved)) return saved;
  return driveReady ? 'drive' : 'local';
}

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined' || !document.head) return;
  if (document.getElementById('sk-fd-styles')) { stylesInjected = true; return; }
  const s = document.createElement('style'); s.id = 'sk-fd-styles';
  s.textContent = `
.sk-fd .sk-fd-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--sk-sidebar-sep, rgba(127,127,127,0.35)); }
.sk-fd .sk-fd-tab { flex: 1 1 0; min-height: 44px; padding: 0 12px; border: 0; border-bottom: 3px solid transparent; background: none; color: inherit; font: inherit;
  cursor: pointer; opacity: 0.75; }
.sk-fd .sk-fd-tab[aria-selected="true"] { opacity: 1; font-weight: 600; border-bottom-color: var(--sk-sidebar-accent, var(--sk-selection, #2c65ff)); }
.sk-fd .sk-fd-tab:focus-visible { outline: 2px solid var(--sk-sidebar-accent, var(--sk-selection, #2c65ff)); outline-offset: -2px; }
.sk-fd .sk-fd-panel { display: flex; flex-direction: column; gap: 10px; min-height: 0; }
.sk-fd .sk-fd-line { margin: 0; font-size: 13.5px; line-height: 1.4; opacity: 0.85; }
.sk-fd .sk-fd-name { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.sk-fd .sk-fd-name .sk-tp-input { width: 100%; min-height: 44px; }
.sk-fd .sk-fd-list { display: flex; flex-direction: column; gap: 4px; max-height: min(210px, 34vh); overflow: auto; }
.sk-fd .sk-fd-browser { display: flex; flex-direction: column; gap: 6px; border: 1px solid var(--sk-sidebar-sep, rgba(127,127,127,0.35)); border-radius: 8px; padding: 8px; min-height: 0; }
.sk-fd .sk-fd-bar { display: flex; align-items: center; justify-content: space-between; gap: 6px; flex-wrap: wrap; }
.sk-fd .sk-fd-crumbs { display: flex; align-items: center; gap: 2px; flex-wrap: wrap; min-width: 0; font-size: 13px; }
.sk-fd .sk-fd-crumb { background: none; border: 0; padding: 3px 6px; border-radius: 6px; color: var(--sk-sidebar-accent, var(--sk-selection, #2c65ff)); font: inherit; font-weight: 600; cursor: pointer; }
.sk-fd .sk-fd-crumb:hover { background: var(--sk-sidebar-hover, rgba(127,127,127,0.14)); }
.sk-fd .sk-fd-crumb[aria-current="location"] { color: inherit; cursor: default; background: none; opacity: 0.9; }
.sk-fd .sk-fd-crumb-sep { opacity: 0.5; padding: 0 2px; }
.sk-fd .sk-fd-tools { display: flex; gap: 4px; flex-wrap: wrap; }
.sk-fd .sk-fd-tool { font: 500 12px/1.2 inherit; min-height: 30px; padding: 4px 9px; border-radius: 6px; cursor: pointer; color: inherit; background: transparent;
  border: 1px solid var(--sk-sidebar-sep, rgba(127,127,127,0.4)); }
.sk-fd .sk-fd-tool:hover { background: var(--sk-sidebar-hover, rgba(127,127,127,0.14)); }
.sk-fd .sk-fd-tool:disabled { opacity: 0.45; cursor: not-allowed; }
.sk-fd .sk-fd-tool:focus-visible, .sk-fd .sk-fd-crumb:focus-visible, .sk-fd .sk-fd-folder:focus-visible, .sk-fd .sk-fd-up:focus-visible, .sk-fd .sk-fd-design:focus-visible {
  outline: 2px solid var(--sk-sidebar-accent, var(--sk-selection, #2c65ff)); outline-offset: -2px; }
.sk-fd .sk-fd-mkdir { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.sk-fd .sk-fd-mkdir .sk-tp-input { flex: 1 1 130px; min-height: 34px; width: auto; }
.sk-fd .sk-fd-folder, .sk-fd .sk-fd-up, .sk-fd .sk-fd-design { display: flex; align-items: center; gap: 8px; min-height: 38px; padding: 6px 10px; text-align: left; font: inherit;
  color: inherit; background: transparent; cursor: pointer; border-radius: 8px; border: 1px solid var(--sk-sidebar-sep, rgba(127,127,127,0.35)); }
.sk-fd .sk-fd-folder:hover, .sk-fd .sk-fd-up:hover, .sk-fd .sk-fd-design:hover { background: var(--sk-sidebar-hover, rgba(127,127,127,0.14)); }
.sk-fd .sk-fd-design-text { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; min-width: 0; flex: 1; }
.sk-fd .sk-fd-design-sub, .sk-fd .sk-fd-meta { font-size: 12px; opacity: 0.7; }
.sk-fd .sk-fd-meta { margin-left: auto; flex: none; }
.sk-fd .sk-fd-ic { flex: none; opacity: 0.8; display: inline-flex; align-items: center; }
.sk-fd .sk-fd-dest { margin: 0; font-size: 12px; opacity: 0.78; }
.sk-fd .sk-fd-section { margin: 4px 0 0; font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; opacity: 0.6; }
.sk-fd .sk-fd-signin, .sk-fd .sk-fd-choose, .sk-fd .sk-fd-projects { align-self: flex-start; }
@media (max-width: 640px) {
  .sk-fd .sk-fd-signin, .sk-fd .sk-fd-choose, .sk-fd .sk-fd-projects { align-self: stretch; }
  .sk-fd .sk-fd-tool, .sk-fd .sk-fd-crumb, .sk-fd .sk-fd-folder, .sk-fd .sk-fd-up, .sk-fd .sk-fd-design { min-height: 44px; }
}
.sk-fd .sk-fd-panel[hidden], .sk-fd .sk-fd-name[hidden], .sk-fd .sk-tp-btn[hidden] { display: none; } /* last: a hidden part stays hidden whatever its own display */
`;
  document.head.appendChild(s); stylesInjected = true;
}

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const button = (cls, text, data) => { const b = el('button', cls, text); b.type = 'button'; if (data) b.dataset.fd = data; return b; };
const svgIcon = (d) => {
  const s = el('span', 'sk-fd-ic'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  return s;
};
const FOLDER_SVG = '<path d="M1.5 3.5h4.2l1.3 1.5h7.5v8h-13z"/>';
const FILE_SVG = '<path d="M4 1.5h5.5L12.5 4.5v10H4z"/><path d="M9.5 1.5v3h3"/>';

/** THE dialog. See the header for the options. */
export function openFileDialog({ mode = 'save', name = '', driveReady = () => true, signIn = async () => {}, subscribeAccount = () => () => {}, onSave = null,
  browseDrive = null, listDesigns = async () => [], onOpenDesign = null, onChooseFile = null, onProjects = null, settings = SettingsManager } = {}) {
  injectStyles();
  const saving = mode === 'save';
  const label = saving ? 'Save as' : 'Open';
  let unsubscribe = () => {};
  const result = openSmallModal(label, (body, mk, finish) => {
    const dlg = body.closest('[role="dialog"]'); dlg.dataset.fileDialog = mode;
    const err = el('div', 'sk-tp-err'); err.setAttribute('role', 'status');
    const say = (e) => { err.textContent = e ? ((e && e.message) || String(e)) : ''; };
    let busy = false;
    /** Run a dialog action; `fn` is called synchronously (the click's picker / popup), its result closes the dialog, null keeps it open. */
    const act = (fn) => {
      if (busy) return;
      say('');
      let p;
      try { p = fn(); } catch (e) { say(e); return; }
      busy = true;
      Promise.resolve(p).then((r) => { busy = false; if (r != null) finish(r); }, (e) => { busy = false; say(e); });
    };

    // the tabs (role=tablist; arrows / Home / End move between them; the choice is remembered on this device)
    const tabBar = el('div', 'sk-fd-tabs'); tabBar.setAttribute('role', 'tablist'); tabBar.setAttribute('aria-label', label + ': where');
    const tabBtns = {}, panels = {};
    for (const t of FILE_DIALOG_TABS) {
      const b = el('button', 'sk-fd-tab', t.label); b.type = 'button'; b.setAttribute('role', 'tab'); b.dataset.fdTab = t.id; b.id = `sk-fd-tab-${mode}-${t.id}`;
      b.addEventListener('click', () => select(t.id, { remember: true }));
      b.addEventListener('keydown', (e) => {
        const i = FILE_DIALOG_TABS.findIndex((x) => x.id === t.id), n = FILE_DIALOG_TABS.length;
        const to = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
        if (to < 0) return;
        e.preventDefault(); const id = FILE_DIALOG_TABS[to].id; select(id, { remember: true }); tabBtns[id].focus();
      });
      const p = el('div', 'sk-fd-panel'); p.setAttribute('role', 'tabpanel'); p.setAttribute('aria-labelledby', b.id); p.dataset.fdPanel = t.id;
      tabBar.appendChild(b); tabBtns[t.id] = b; panels[t.id] = p;
    }
    body.appendChild(tabBar);
    for (const t of FILE_DIALOG_TABS) body.appendChild(panels[t.id]);

    // save mode: ONE name field for both tabs (a name typed in one is kept in the other)
    let nameInput = null, saveBtn = null;
    const nameRow = el('label', 'sk-fd-name');
    if (saving) {
      nameRow.appendChild(el('span', null, 'Name'));
      nameInput = el('input', 'sk-tp-input sk-tp-name-input'); nameInput.type = 'text'; nameInput.value = name; nameInput.setAttribute('aria-label', 'Name');
      nameInput.autocomplete = 'off';
      nameRow.appendChild(nameInput);
      body.appendChild(nameRow);
    }
    body.appendChild(err);

    // Google Drive in-app folder browser state (for saving into or opening from "Sketch Studio")
    let browserFolder = null; // { id, name } inside root app folder, or null at root
    let defaultFolderName = (browseDrive && browseDrive.defaultFolderName) || 'My Designs';
    let folders = [];
    let folderDesigns = [];
    let recentDesigns = [];
    let browserLoading = false;
    let browserReady = false;
    let browserInitialized = false;
    let creatingFolder = false;
    let loadSeq = 0;

    let tab = initialFileDialogTab({ driveReady: driveReady(), settings });
    const save = () => {
      const n = nameInput.value.trim();
      if (!n) { say('A design needs a name.'); nameInput.focus(); return; }
      if (tab === 'drive' && !driveReady()) return;
      const folderId = tab === 'drive' && browserFolder ? browserFolder.id : undefined;
      act(() => onSave(tab, n, folderId));
    };
    if (saving) {
      nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
      saveBtn = mk('sk-tp-open', 'Save', 'ok', save);
    }
    mk('sk-tp-cancel', 'Cancel', '__cancel', () => finish(null));

    const signInBlock = (panel) => {
      panel.appendChild(el('p', 'sk-fd-line', saving ? 'Save to your Google Drive: sign in with your Google account first.' : 'Open a design from your Google Drive: sign in with your Google account first.'));
      const b = button('sk-tp-btn sk-tp-open sk-fd-signin', 'Sign in with Google', 'sign-in');
      b.addEventListener('click', () => act(() => Promise.resolve(signIn()).then(() => { browserInitialized = false; render(); return null; })));
      panel.appendChild(b);
    };

    const appendDesignRow = (list, r) => {
      const b = button('sk-fd-design', null, 'design'); b.dataset.design = r.id;
      const text = el('span', 'sk-fd-design-text');
      text.append(el('span', null, r.name), el('span', 'sk-fd-design-sub', r.sub || ''));
      b.append(svgIcon(FILE_SVG), text);
      b.addEventListener('click', () => {
        if (saving) { nameInput.value = r.name; nameInput.focus(); nameInput.select(); }
        else act(() => onOpenDesign(r.id));
      });
      list.appendChild(b);
    };

    async function loadBrowser({ resolveInitial = false } = {}) {
      if (!driveReady() || !dlg.isConnected) return;
      const seq = ++loadSeq;
      browserLoading = true;
      renderDrivePanel();
      try {
        if (browseDrive) {
          const nextFolders = await browseDrive.listFolders();
          if (seq !== loadSeq || !dlg.isConnected) return;
          folders = nextFolders;
          if (resolveInitial && saving && browseDrive.initialFolderId) {
            const initId = await browseDrive.initialFolderId();
            if (seq !== loadSeq || !dlg.isConnected) return;
            const match = initId && folders.find((f) => f.id === initId);
            if (match) { browserFolder = { id: match.id, name: match.name }; defaultFolderName = match.name; }
          }
          if (browserFolder) {
            const match = folders.find((f) => f.id === browserFolder.id);
            if (match) {
              browserFolder = { id: match.id, name: match.name };
              folderDesigns = await browseDrive.listFolderDesigns(browserFolder.id);
            } else {
              browserFolder = null;
              folderDesigns = [];
            }
          }
          if (!saving && !browserFolder) {
            recentDesigns = await listDesigns();
          }
        } else if (!saving) {
          recentDesigns = await listDesigns();
        }
        if (seq !== loadSeq || !dlg.isConnected) return;
        browserReady = true;
      } catch (e) {
        if (seq === loadSeq && dlg.isConnected) say(e);
      } finally {
        if (seq === loadSeq) {
          browserLoading = false;
          if (dlg.isConnected) renderDrivePanel();
        }
      }
    }

    async function submitCreateFolder(nameText) {
      const folderName = String(nameText || '').trim();
      if (!folderName) { say('Enter a folder name.'); return; }
      say('');
      browserLoading = true;
      renderDrivePanel();
      try {
        const created = await browseDrive.createFolder(folderName);
        if (!dlg.isConnected) return;
        creatingFolder = false;
        browserFolder = { id: created.id, name: created.name };
        await loadBrowser();
      } catch (e) {
        browserLoading = false;
        say(e);
        if (dlg.isConnected) renderDrivePanel();
      }
    }

    function renderDrivePanel() {
      const p = panels.drive; p.textContent = '';
      if (!driveReady()) { signInBlock(p); return; }

      const rootName = (browseDrive && browseDrive.rootLabel) || 'Sketch Studio';
      if (!browseDrive && saving) {
        p.appendChild(el('p', 'sk-fd-line', 'Saved to your Google Drive; from then on every change is saved there as you work.'));
        return;
      }

      if (browseDrive) {
        const box = el('div', 'sk-fd-browser');
        const bar = el('div', 'sk-fd-bar');
        const crumbs = el('nav', 'sk-fd-crumbs'); crumbs.setAttribute('aria-label', 'Google Drive app folder path');
        const rootCrumb = button('sk-fd-crumb', rootName, 'crumb-root');
        if (!browserFolder) rootCrumb.setAttribute('aria-current', 'location');
        else rootCrumb.addEventListener('click', () => { browserFolder = null; folderDesigns = []; loadBrowser(); });
        crumbs.appendChild(rootCrumb);
        if (browserFolder) {
          crumbs.appendChild(el('span', 'sk-fd-crumb-sep', '/'));
          const curCrumb = el('span', 'sk-fd-crumb', browserFolder.name);
          curCrumb.setAttribute('aria-current', 'location');
          crumbs.appendChild(curCrumb);
        }

        const tools = el('div', 'sk-fd-tools');
        const refreshBtn = button('sk-fd-tool', 'Refresh', 'refresh');
        refreshBtn.disabled = browserLoading;
        refreshBtn.addEventListener('click', () => loadBrowser());
        tools.appendChild(refreshBtn);
        if (saving && browseDrive.createFolder) {
          const newBtn = button('sk-fd-tool', '+ New folder', 'new-folder');
          newBtn.disabled = browserLoading;
          newBtn.addEventListener('click', () => {
            creatingFolder = !creatingFolder;
            renderDrivePanel();
            const inp = box.querySelector('[data-fd="mkdir-input"]');
            if (inp) inp.focus();
          });
          tools.appendChild(newBtn);
        }
        bar.append(crumbs, tools);
        box.appendChild(bar);

        if (saving && creatingFolder) {
          const mkdirRow = el('div', 'sk-fd-mkdir'); mkdirRow.dataset.fd = 'mkdir-row';
          const inp = el('input', 'sk-tp-input'); inp.type = 'text'; inp.placeholder = 'New folder name';
          inp.dataset.fd = 'mkdir-input'; inp.setAttribute('aria-label', 'New folder name'); inp.autocomplete = 'off';
          const okBtn = button('sk-fd-tool', 'Create', 'mkdir-ok'); okBtn.disabled = browserLoading;
          const cancelBtn = button('sk-fd-tool', 'Cancel', 'mkdir-cancel');
          okBtn.addEventListener('click', () => submitCreateFolder(inp.value));
          cancelBtn.addEventListener('click', () => { creatingFolder = false; say(''); renderDrivePanel(); });
          inp.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); submitCreateFolder(inp.value); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); creatingFolder = false; renderDrivePanel(); }
          });
          mkdirRow.append(inp, okBtn, cancelBtn);
          box.appendChild(mkdirRow);
        }

        const list = el('div', 'sk-fd-list'); list.dataset.fd = 'designs';
        if (browserLoading && !browserReady) {
          list.appendChild(el('p', 'sk-fd-line', 'Loading your folders…'));
        } else if (browserFolder) {
          const up = button('sk-fd-up', null, 'up');
          up.append(svgIcon(FOLDER_SVG), el('span', null, `.. (${rootName})`));
          up.addEventListener('click', () => { browserFolder = null; folderDesigns = []; loadBrowser(); });
          list.appendChild(up);
          if (!folderDesigns.length) {
            list.appendChild(el('p', 'sk-fd-line', saving ? 'This folder is empty. Enter a name below to save here.' : 'No designs in this folder yet.'));
          } else {
            for (const r of folderDesigns) appendDesignRow(list, r);
          }
        } else {
          if (!folders.length && saving) {
            list.appendChild(el('p', 'sk-fd-line', `No folders in "${rootName}" yet. Click + New folder, or Save to create "My Designs".`));
          }
          for (const f of folders) {
            const row = button('sk-fd-folder', null, 'folder'); row.dataset.folder = f.id;
            const meta = el('span', 'sk-fd-meta', f.sub || 'Open');
            row.append(svgIcon(FOLDER_SVG), el('span', null, f.name), meta);
            row.addEventListener('click', () => { browserFolder = { id: f.id, name: f.name }; loadBrowser(); });
            list.appendChild(row);
          }
          if (!saving) {
            if (folders.length && recentDesigns.length) list.appendChild(el('p', 'sk-fd-section', 'Recent designs'));
            if (!folders.length && !recentDesigns.length) list.appendChild(el('p', 'sk-fd-line', 'No design on your Google Drive yet.'));
            for (const r of recentDesigns) appendDesignRow(list, r);
          }
        }
        box.appendChild(list);
        p.appendChild(box);

        if (saving) {
          const destText = browserFolder
            ? `Saving into ${rootName} / ${browserFolder.name}`
            : `Saving into ${rootName} / ${defaultFolderName} — or choose a folder above.`;
          p.appendChild(el('p', 'sk-fd-dest', destText));
        } else {
          const all = button('sk-tp-btn sk-fd-projects', 'All projects…', 'projects');
          all.addEventListener('click', () => { finish(null); onProjects(); });
          p.appendChild(all);
        }
        return;
      }

      // Legacy fallback when only listDesigns() is supplied (no browseDrive) in Open mode
      const list = el('div', 'sk-fd-list'); list.dataset.fd = 'designs';
      if (!browserReady) list.appendChild(el('p', 'sk-fd-line', 'Loading your designs…'));
      else if (!recentDesigns.length) list.appendChild(el('p', 'sk-fd-line', 'No design on your Google Drive yet.'));
      else for (const r of recentDesigns) appendDesignRow(list, r);
      p.appendChild(list);
      const all = button('sk-tp-btn sk-fd-projects', 'All projects…', 'projects');
      all.addEventListener('click', () => { finish(null); onProjects(); });
      p.appendChild(all);
    }

    function renderDrive() {
      renderDrivePanel();
      if (driveReady() && !browserInitialized) {
        browserInitialized = true;
        loadBrowser({ resolveInitial: true });
      }
    }
    function renderLocal() {
      const p = panels.local; p.textContent = '';
      if (saving) { p.appendChild(el('p', 'sk-fd-line', `Saved as a ${PROJECT_FILE_EXT} file on this device. No account needed.`)); return; }
      p.appendChild(el('p', 'sk-fd-line', `Open a Sketch Studio design file (${PROJECT_FILE_EXT}) from this device. No account needed. You can also drop the file on the drawing.`));
      const b = button('sk-tp-btn sk-tp-open sk-fd-choose', 'Choose a file…', 'choose-file');
      b.addEventListener('click', () => act(() => onChooseFile()));
      p.appendChild(b);
    }
    function select(id, { remember = false } = {}) {
      tab = id;
      for (const t of FILE_DIALOG_TABS) {
        const on = t.id === id;
        panels[t.id].hidden = !on; tabBtns[t.id].setAttribute('aria-selected', on ? 'true' : 'false'); tabBtns[t.id].tabIndex = on ? 0 : -1;
      }
      dlg.dataset.fdTab = id;
      if (saving) { const ready = id !== 'drive' || driveReady(); nameRow.hidden = !ready; saveBtn.hidden = !ready; }
      say('');
      if (remember) settings.set(FILE_DIALOG_TAB_SETTING, id, { persist: 'local' });
    }
    function render() { renderDrive(); renderLocal(); select(tab); }
    render();
    unsubscribe = subscribeAccount(() => { if (dlg.isConnected) { browserInitialized = false; render(); } });
    if (saving && !nameRow.hidden) return nameInput;
    return tabBtns[tab];
  }, { panelClass: 'sk-fd' });
  return result.finally(() => unsubscribe());
}
