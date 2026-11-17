// packages/ui/project-actions.js — TASK 547: the ONE declaration of what you can do with a design and with a project.
// The project manager modal (project-manager.js) and the sidebar's main menu (sidebar-projects.js) both take their actions from here,
// so no action exists twice. Every action is data: { id, label, visible?, ask?, closes?, run(arg) }.
//   ask: { kind: 'confirm', text, okLabel } | { kind: 'prompt', label, value, okLabel } | { kind: 'choose', label, options: [{ id, label, onClick? }] }
//        the UI asks first and passes the answer (the text, or the chosen option id) to run(arg); no `ask` = run at once.
//   closes: the UI closes itself after a successful run (Open); run returning null means "cancelled" (a file picker) and keeps it open.
// Failures THROW (a readable message); the UI shows it and changes nothing.
// TASK 558 (owner ruling 2026-11-12): an action that would replace an UNSAVED Untitled with content (Open, Open recent, Open from file, New
// design) first asks THE question settleUnsaved() declares: Save… (the Save as name prompt, then go on) / Don't save
// (discard it, then go on) / Cancel (nothing happens). TASK 624: all named saves go ONLY to Google Drive; if signed out, saving first asks
// to sign in to Google (calling account.signIn() synchronously inside the click gesture), then continues seamlessly or cancels cleanly.
// TASK 759 (owner turn 2266): Save as and Open are ONE dialog each (#ui/file-dialog.js) with two tabs, Google Drive | Local: a design is saved to and opened
// from a file on this device with no Google account at all, and Drive works as before inside its tab. A document has a HOME (#ui/document-home.js: Drive,
// a file on this device, or none) and Save (Ctrl+S, the menu's Save) saves to it; no home -> Save as. A signed-out user is never asked to sign in by Save,
// Save as, Open or Open from file: Drive (and its sign-in button) is only met inside the dialog's Drive tab.

import { IMPORT_ACTION_LABEL, pickAndImport } from './sketch-import.js';
import { track } from './analytics.js'; // TASK 738: a design opened, a template started
import { openFileDialog } from './file-dialog.js';
import { browserFileSeam, fileAccess } from './project-file.js';
import { saveRoute, HOME_KINDS } from './document-home.js';
import { relativeTime } from './project-manager.js';

// `importFile(text, fileName)` (TASK 566): the host's SVG / DXF import into its Design canvas (it lands the shapes and shows its own status). A host
// without a Design canvas passes none, and then has no "Import SVG / DXF…" action at all.
// TASK 587: `tabs: true` (the host shows the document-tab strip, sidebar-projects.js `documentTabs`) makes Open / Open recent / Open from file / New open a
// NEW TAB instead of replacing the shown design (docs/DOCUMENT-TABS-DESIGN.md T2, T3): the unsaved Untitled is not replaced then, so those ask no question.
// TASK 759: `fileDialog` (default: THE Save as / Open dialog, #ui/file-dialog.js openFileDialog; a headless caller passes a scripted one, as it passes `ask`),
// `fileSeam` (default: the browser's file picker / download, #ui/project-file.js browserFileSeam) and `openProjects()` (the host's project manager, for the
// Open dialog's "All projects…").
export function createProjectActions({ store, getBuffer, account = null, notify = () => {}, importFile = null, ask = async () => null, tabs = false, pickTemplate = null, chooseModal = null, promptModal = null,
  fileDialog = openFileDialog, fileSeam = browserFileSeam, openProjects = () => {} }) {
  const buf = () => { const b = getBuffer && getBuffer(); if (!b) throw new Error('This app is still starting. Try again in a moment.'); return b; };
  const signedInDrive = () => !!(account && account.state().signedIn && store.cloud);
  /** TASK 759: the Drive tab can be used now: signed in, or a store with no Drive at all (nothing to sign in to). */
  const driveReady = () => !account || !store.cloud || !!account.state().signedIn;
  // what the dialog's Drive tab needs of the account (sign-in runs inside its click; the tab follows the sign-in state)
  const dialogAccount = {
    driveReady,
    signIn: () => (account ? account.signIn() : null),
    subscribeAccount: (fn) => (account && account.subscribe ? account.subscribe(fn) : () => {}),
  };

  /** Ask the user to sign in to Google Drive if currently signed out (runs signIn synchronously in the button click so popups work). */
  async function ensureSignedIn() {
    if (!account || !store.cloud || account.state().signedIn) return true;
    let pending = null;
    const choice = await ask({
      kind: 'choose',
      label: 'Sign in to Google Drive to save designs.',
      options: [{ id: 'signin', label: 'Sign in with Google', onClick: () => { pending = account.signIn(); } }],
    });
    if (choice !== 'signin') return false;
    await pending;
    return !!account.state().signedIn;
  }

  /** THE unsaved-design question. Resolves true = go on (nothing unsaved, or saved under a name, or discarded); false = Cancel.
   *  TASK 681 (owner 1765): ALWAYS asked in the ONE modal (the host's `chooseModal` / `promptModal`, template-picker.js), whichever action asks it (close a tab, open, new design, open file);
   *  a host that passes none (tests with a scripted `ask`) asks through `ask`. */
  async function settleUnsaved() {
    const b = buf();
    if (b.needsSavePrompt() !== 'unsaved') return true;
    const label = b.home().kind === HOME_KINDS.FILE ? 'This design has changes not saved to its file.' : 'This design is not saved.';
    const choice = await (chooseModal || ask)({ kind: 'choose', label, options: [{ id: 'save', label: 'Save…' }, { id: 'discard', label: "Don't save" }] });
    if (choice === 'discard') { b.discardUnsaved(); return true; }
    if (choice !== 'save') return false;
    return !!(await save()); // TASK 759: Save… saves to the design's home (a file: back to it; none: the Save as dialog), never a sign-in question
  }
  /** Resolves null when the user cancelled the unsaved-design question (nothing changed). */
  async function openDesign(id) {
    if (!tabs && !(await settleUnsaved())) return null;
    const out = await (tabs ? buf().openTab(id) : buf().openDesign(id));
    if (!out.restored) throw new Error(out.reason || 'This design could not be opened.');
    track('drive:open'); // TASK 738
    return out;
  }
  // (the *Now forms assume the pending edits are already saved)
  async function duplicateNow(id) {
    if (!id) throw new Error('This design is not saved yet. Save it with a name first (Save as…).'); // TASK 558: an unsaved Untitled has no stored design
    if (!(await ensureSignedIn())) return null;
    const d = await store.duplicate(id);
    notify(`Duplicated as "${d.name}" (find it under Open recent).`, 'info');
    return d;
  }
  const duplicateDesign = async (id) => { await buf().flush(); return duplicateNow(id); };
  const saveDesignToFile = (id) => buf().saveFile(undefined, id);

  /** The actions of one design `d` (a store design row); `projects` = the project rows, for "Move to…". */
  function designItems(d, { projects = [] } = {}) {
    return [
      { id: 'open', label: 'Open', closes: true, run: () => openDesign(d.id) },
      { id: 'rename', label: 'Rename', ask: { kind: 'prompt', label: 'Rename design', value: d.name, okLabel: 'Rename' }, run: (name) => store.rename(d.id, name) },
      { id: 'duplicate', label: 'Duplicate', run: () => duplicateDesign(d.id) },
      { id: 'move', label: 'Move to…', visible: projects.some((p) => p.id !== d.projectId),
        ask: { kind: 'choose', label: 'Move to', options: projects.filter((p) => p.id !== d.projectId).map((p) => ({ id: p.id, label: p.name })) }, run: (projectId) => store.moveDesign(d.id, projectId) },
      { id: 'save-file', label: 'Save to file', run: () => saveDesignToFile(d.id) },
      { id: 'delete', label: 'Delete', ask: { kind: 'confirm', text: `Delete "${d.name}"?`, okLabel: 'Delete' }, run: () => store.remove(d.id) },
    ].filter((a) => a.visible !== false);
  }

  /** The actions of one project row `p`. */
  function projectItems(p) {
    const drive = signedInDrive();
    return [
      ...(drive && p.location !== 'drive' ? [{ id: 'use-drive', label: 'Use Google Drive', ask: { kind: 'confirm', okLabel: 'Use Google Drive', text: `Use Google Drive for "${p.name}"? It will be copied to your Google Drive and checked, and only then is the copy on this device removed.` }, run: () => store.cloud.moveProjectToDrive(p.id) }] : []),
      { id: 'rename', label: 'Rename', ask: { kind: 'prompt', label: 'Rename project', value: p.name, okLabel: 'Rename' }, run: (name) => store.renameProject(p.id, name) },
      { id: 'pin', label: p.pinned ? 'Unpin' : 'Pin', run: () => store.pinProject(p.id, !p.pinned) },
      { id: 'delete', label: 'Delete', ask: { kind: 'confirm', text: `Delete project "${p.name}"?`, okLabel: 'Delete' }, run: () => store.removeProject(p.id) },
    ];
  }

  // the CURRENT design of the host's buffer (its id may only exist after the pending edits are saved, hence flush first)
  const duplicateCurrent = async () => { const b = buf(); await b.flush(); return duplicateNow(b.designId()); };
  /** TASK 759: THE Save as dialog (Google Drive | Local). `name` pre-fills the name (default: the design's name; a stored design's: "<name> copy", as before).
   *  Drive: today's named save (a stored design: a copy that becomes the bound one); Local: the design file on this device, which becomes its home.
   *  Resolves what the save returned, or null (cancelled). */
  async function saveAsDialog({ name } = {}) {
    const b = buf();
    await b.ready;
    const value = name || (b.isStored() ? b.designName() + ' copy' : b.designName());
    return fileDialog({ mode: 'save', name: value, ...dialogAccount,
      onSave: (tab, n) => (tab === 'drive' ? b.saveAs(n) : b.saveToFile(n, fileSeam)) });
  }
  /** TASK 759, SAVE (Ctrl+S, the menu): to the design's home (document-home.js saveRoute): Drive -> the pending autosave is written now; a file -> back to it
   *  (or the picker again / a download); none -> the Save as dialog. Resolves { route, name? } or null (cancelled). */
  async function save() {
    const b = buf();
    await b.ready;
    const route = saveRoute(b.home(), fileAccess());
    if (route === 'flush') { await b.flush(); return { route }; }
    if (route === 'save-as') {
      const r = await saveAsDialog();
      if (!r) return null;
      const home = b.home();
      return { route, name: home.kind === HOME_KINDS.FILE ? home.name : b.designName(), ...(r.downloaded ? { downloaded: true } : {}) };
    }
    return b.saveHome(fileSeam);
  }
  async function moveCurrentProjectToDrive() {
    const b = buf();
    const id = b.designId();
    if (!id || (store.isRemote && store.isRemote(id))) return null;
    if (!(await ensureSignedIn())) return null;
    await b.flush();
    const d = await store.get(id);
    if (!d) throw new Error('That design no longer exists.');
    const r = await store.cloud.moveProjectToDrive(d.projectId);
    b.followMoves(r.designIds);
    notify('Moved to Google Drive.', 'info');
    return r;
  }
  // TASK 651 / 668: a new design starts from the ONE template modal (template-picker.js; the host passes `pickTemplate`, like `ask`): "Blank design" first,
  // then the templates; closing the modal = no new design (null). A host that passes none (a headless caller) gets the blank one at once.
  const newDesign = async () => {
    const choice = pickTemplate ? await pickTemplate() : { blank: true };
    if (!choice) return null;
    const template = choice.template ? { name: choice.name, document: choice.document } : null;
    const out = tabs ? await buf().newTab(template) : (await settleUnsaved()) ? await buf().newDesign(template) : null;
    if (out) track('template:' + (choice.template ? choice.template.id : 'blank')); // TASK 738: the template's declared id (#core/templates.js), never its name
    return out;
  };
  /** TASK 759: a design FILE from this device opens as a tab (its home is that file), with no account: `seam` (default: the browser's picker / <input type=file>).
   *  Called synchronously from the click (the browser's picker needs it). null = cancelled. */
  const openLocalFile = (seam = fileSeam) => (tabs ? buf().openFileTab(seam) : buf().openFile(seam));
  /** Open from file (the project manager's toolbar): the unsaved question first (no tabs), then the file. */
  const openFile = async () => {
    if (!tabs && !(await settleUnsaved())) return null;
    return openLocalFile();
  };
  /** TASK 759: a design file DROPPED on the drawing (#ui/sketch-import.js mountImportDrop: a .sketch.json there is a document, not a drawing to import). */
  const openDroppedFile = async ({ name, text }) => {
    if (!tabs && !(await settleUnsaved())) return null;
    return openLocalFile({ open: async () => ({ name, text, handle: null }) });
  };
  /** TASK 759: THE Open dialog (Google Drive | Local): the recent designs on Drive (and "All projects…") / "Choose a file…". */
  async function openDialog() {
    if (!tabs && !(await settleUnsaved())) return null;
    return fileDialog({ mode: 'open', ...dialogAccount,
      listDesigns: async () => (await store.listRecent({ limit: 12 })).map((r) => ({ id: r.id, name: r.name, sub: [r.projectName, relativeTime(r.updatedAt)].filter(Boolean).join(' · ') })),
      onOpenDesign: (id) => openDesign(id),
      onChooseFile: () => openLocalFile(),
      onProjects: () => openProjects() });
  }

  // ---- the document-tab strip's actions (TASK 587) -------------------------------------------------------------------------------
  const activateTab = (key) => buf().activate(key);
  /** Close tab `key`. A named design closes without asking (it is autosaved); an unsaved Untitled with content asks THE question (settleUnsaved:
   *  Save… / Don't save / Cancel); a design whose last save failed asks "Close anyway" / "Try saving again". The question is about the ACTIVE design, so
   *  a tab that needs it is activated first (Cancel leaves you on it). Resolves false = cancelled. */
  async function closeTab(key) {
    const b = buf();
    const t = b.tabs().find((x) => x.key === key);
    if (!t) return true;
    if (t.needsSavePrompt) {
      if (!t.active) await b.activate(key);
      if (t.needsSavePrompt === 'unsaved') {
        if (!(await settleUnsaved())) return false;
      } else {
        const choice = await (chooseModal || ask)({ kind: 'choose', label: 'The last save of this design failed.', options: [{ id: 'retry', label: 'Try saving again' }, { id: 'close', label: 'Close anyway' }] });
        if (choice === 'retry') { await b.flush(); if (b.needsSavePrompt()) throw new Error('This design still could not be saved.'); }
        else if (choice !== 'close') return false;
      }
    }
    await b.closeTab(key);
    return true;
  }
  // pick an SVG / DXF and hand its text to the host's importer; null = the picker was cancelled
  const importDrawing = importFile ? () => pickAndImport(importFile) : null;

  /** The project manager's toolbar. */
  function toolbarItems() {
    return [
      { id: 'new-project', label: 'New project', run: async () => {
        if (!(await ensureSignedIn())) return null;
        const name = await ask({ kind: 'prompt', label: 'New project', value: 'New project', okLabel: 'Create' });
        if (!name) return null;
        return store.createProject(name);
      } },
      { id: 'new-design', label: 'New design', closes: true, run: () => newDesign() },
      { id: 'open-file', label: 'Open from file', closes: true, run: () => openFile() },
      ...(importDrawing ? [{ id: 'import-file', label: IMPORT_ACTION_LABEL, closes: true, run: () => importDrawing() }] : []),
    ];
  }

  return { activateTab, closeTab, duplicateCurrent, save, saveAsDialog, driveReady, ensureSignedIn, moveCurrentProjectToDrive, newDesign, openFile, openLocalFile, openDroppedFile, openDialog, importDrawing, toolbarItems, openDesign, duplicateDesign, saveDesignToFile, designItems, projectItems, settleUnsaved };
}
