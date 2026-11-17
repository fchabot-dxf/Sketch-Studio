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
.sk-fd .sk-fd-list { display: flex; flex-direction: column; gap: 4px; max-height: min(320px, 45vh); overflow: auto; }
.sk-fd .sk-fd-design { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-height: 44px; padding: 6px 10px; text-align: left; font: inherit;
  color: inherit; background: transparent; cursor: pointer; border-radius: 8px; border: 1px solid var(--sk-sidebar-sep, rgba(127,127,127,0.35)); }
.sk-fd .sk-fd-design:hover { background: var(--sk-sidebar-hover, rgba(127,127,127,0.14)); }
.sk-fd .sk-fd-design span:last-child { font-size: 12px; opacity: 0.7; }
.sk-fd .sk-fd-signin, .sk-fd .sk-fd-choose, .sk-fd .sk-fd-projects { align-self: flex-start; }
@media (max-width: 640px) { .sk-fd .sk-fd-signin, .sk-fd .sk-fd-choose, .sk-fd .sk-fd-projects { align-self: stretch; } }
.sk-fd .sk-fd-panel[hidden], .sk-fd .sk-fd-name[hidden], .sk-fd .sk-tp-btn[hidden] { display: none; } /* last: a hidden part stays hidden whatever its own display */
`;
  document.head.appendChild(s); stylesInjected = true;
}

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const button = (cls, text, data) => { const b = el('button', cls, text); b.type = 'button'; if (data) b.dataset.fd = data; return b; };

/** THE dialog. See the header for the options. */
export function openFileDialog({ mode = 'save', name = '', driveReady = () => true, signIn = async () => {}, subscribeAccount = () => () => {}, onSave = null,
  listDesigns = async () => [], onOpenDesign = null, onChooseFile = null, onProjects = null, settings = SettingsManager } = {}) {
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

    let tab = initialFileDialogTab({ driveReady: driveReady(), settings });
    const save = () => {
      const n = nameInput.value.trim();
      if (!n) { say('A design needs a name.'); nameInput.focus(); return; }
      if (tab === 'drive' && !driveReady()) return;
      act(() => onSave(tab, n));
    };
    if (saving) {
      nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
      saveBtn = mk('sk-tp-open', 'Save', 'ok', save);
    }
    mk('sk-tp-cancel', 'Cancel', '__cancel', () => finish(null));

    const signInBlock = (panel) => {
      panel.appendChild(el('p', 'sk-fd-line', saving ? 'Save to your Google Drive: sign in with your Google account first.' : 'Open a design from your Google Drive: sign in with your Google account first.'));
      const b = button('sk-tp-btn sk-tp-open sk-fd-signin', 'Sign in with Google', 'sign-in');
      b.addEventListener('click', () => act(() => Promise.resolve(signIn()).then(() => { render(); return null; })));
      panel.appendChild(b);
    };
    function renderDrive() {
      const p = panels.drive; p.textContent = '';
      if (!driveReady()) { signInBlock(p); return; }
      if (saving) { p.appendChild(el('p', 'sk-fd-line', 'Saved to your Google Drive; from then on every change is saved there as you work.')); return; }
      const list = el('div', 'sk-fd-list'); list.dataset.fd = 'designs';
      list.appendChild(el('p', 'sk-fd-line', 'Loading your designs…'));
      p.appendChild(list);
      const all = button('sk-tp-btn sk-fd-projects', 'All projects…', 'projects');
      all.addEventListener('click', () => { finish(null); onProjects(); });
      p.appendChild(all);
      Promise.resolve(listDesigns()).then((rows) => {
        if (!list.isConnected) return;
        list.textContent = '';
        if (!rows.length) { list.appendChild(el('p', 'sk-fd-line', 'No design on your Google Drive yet.')); return; }
        for (const r of rows) {
          const b = button('sk-fd-design', null, 'design'); b.dataset.design = r.id;
          b.append(el('span', null, r.name), el('span', null, r.sub || ''));
          b.addEventListener('click', () => act(() => onOpenDesign(r.id)));
          list.appendChild(b);
        }
      }, (e) => { list.textContent = ''; say(e); });
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
    unsubscribe = subscribeAccount(() => { if (dlg.isConnected) render(); });
    if (saving && !nameRow.hidden) return nameInput;
    return tabBtns[tab];
  }, { panelClass: 'sk-fd' });
  return result.finally(() => unsubscribe());
}
