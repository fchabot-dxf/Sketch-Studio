// packages/ui/project-actions.js — TASK 547: the ONE declaration of what you can do with a design and with a project.
// The project manager modal (project-manager.js) and the sidebar's main menu (sidebar-projects.js) both take their actions from here,
// so no action exists twice. Every action is data: { id, label, visible?, ask?, closes?, run(arg) }.
//   ask: { kind: 'confirm', text, okLabel } | { kind: 'prompt', label, value, okLabel } | { kind: 'choose', label, options: [{ id, label, onClick? }] }
//        the UI asks first and passes the answer (the text, or the chosen option id) to run(arg); no `ask` = run at once.
//   closes: the UI closes itself after a successful run (Open); run returning null means "cancelled" (a file picker) and keeps it open.
// Failures THROW (a readable message); the UI shows it and changes nothing.
// TASK 558 (owner ruling 2026-11-12): an action that would replace an UNSAVED Untitled with content (Open, Open recent, Open from file, New
// design, GO TO another app) first asks THE question settleUnsaved() declares: Save… (the Save as name prompt, then go on) / Don't save
// (discard it, then go on) / Cancel (nothing happens). TASK 624: all named saves go ONLY to Google Drive; if signed out, saving first asks
// to sign in to Google (calling account.signIn() synchronously inside the click gesture), then continues seamlessly or cancels cleanly.

import { IMPORT_ACTION_LABEL, pickAndImport } from './sketch-import.js';

// `importFile(text, fileName)` (TASK 566): the host's SVG / DXF import into its Design canvas (it lands the shapes and shows its own status). A host
// without a Design canvas passes none, and then has no "Import SVG / DXF…" action at all.
// TASK 587: `tabs: true` (the host shows the document-tab strip, sidebar-projects.js `documentTabs`) makes Open / Open recent / Open from file / New open a
// NEW TAB instead of replacing the shown design (docs/DOCUMENT-TABS-DESIGN.md T2, T3): the unsaved Untitled is not replaced then, so those ask no question.
export function createProjectActions({ store, getBuffer, account = null, notify = () => {}, importFile = null, ask = async () => null, tabs = false }) {
  const buf = () => { const b = getBuffer && getBuffer(); if (!b) throw new Error('This app is still starting. Try again in a moment.'); return b; };
  const signedInDrive = () => !!(account && account.state().signedIn && store.cloud);

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

  /** THE unsaved-design question. Resolves true = go on (nothing unsaved, or saved under a name, or discarded); false = Cancel. */
  async function settleUnsaved() {
    const b = buf();
    if (b.needsSavePrompt() !== 'unsaved') return true;
    const choice = await ask({ kind: 'choose', label: 'This design is not saved.', options: [{ id: 'save', label: 'Save…' }, { id: 'discard', label: "Don't save" }] });
    if (choice === 'discard') { b.discardUnsaved(); return true; }
    if (choice !== 'save') return false;
    if (!(await ensureSignedIn())) return false;
    const name = await ask({ kind: 'prompt', label: 'Save as', value: b.designName(), okLabel: 'Save' });
    if (!name) return false;
    await b.saveAs(name);
    return true;
  }
  /** Resolves null when the user cancelled the unsaved-design question (nothing changed). */
  async function openDesign(id) {
    if (!tabs && !(await settleUnsaved())) return null;
    const out = await (tabs ? buf().openTab(id) : buf().openDesign(id));
    if (!out.restored) throw new Error(out.reason || 'This design could not be opened.');
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
  const saveAs = async (name) => { if (!(await ensureSignedIn())) return null; return buf().saveAs(name); };
  async function saveAsPrompt() {
    const b = buf();
    await b.ready;
    if (!(await ensureSignedIn())) return null;
    const isCopy = b.isStored();
    const name = await ask({ kind: 'prompt', label: isCopy ? 'Save a copy as' : 'Save as', value: isCopy ? b.designName() + ' copy' : b.designName(), okLabel: 'Save' });
    if (!name) return null;
    return b.saveAs(name);
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
  const newDesign = async () => (tabs ? buf().newTab() : (await settleUnsaved()) ? buf().newDesign() : null);
  const openFile = async () => {
    if (!tabs && !(await settleUnsaved())) return null;
    if (!(await ensureSignedIn())) return null;
    return tabs ? buf().openFileTab() : buf().openFile();
  };

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
        const choice = await ask({ kind: 'choose', label: 'The last save of this design failed.', options: [{ id: 'retry', label: 'Try saving again' }, { id: 'close', label: 'Close anyway' }] });
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

  return { activateTab, closeTab, duplicateCurrent, saveAs, saveAsPrompt, ensureSignedIn, moveCurrentProjectToDrive, newDesign, openFile, importDrawing, toolbarItems, openDesign, duplicateDesign, saveDesignToFile, designItems, projectItems, settleUnsaved };
}
