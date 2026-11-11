// packages/ui/document-buffer.js — the shared AUTOSAVE LOOP of an app (PERSIST-2, reworked in TASK 474).
// Polls the app state, and when it changed writes the document (packages/core/document.js serializeDocument + this host's
// sidecar) into the app's CURRENT DESIGN through the project store (project-store.js: projects and designs on IndexedDB). It
// also loads a design into the app (the initial restore, Open, New, Open from file) and offers the design actions a
// sidebar needs. Because every Sketch-Studio app is same-origin and the store's "current" pointer is global, switching apps
// via the shared app-switcher still carries the drawing: the next app restores the same current design.
//
// DDCS Studio lessons this steals (already paid for there, not rediscovered — see web/data/fsHandles.js,
// web/ui/fileSaveState.js:164):
//   - Autosave != a named save. Naming/saving-as/opening are explicit design actions (below); the loop never prompts.
//   - NO beforeunload warning. The buffer survives reload, so a warning would cry wolf on every refresh
//     and teach people to click through real ones. A passive status callback is the only truth-teller.
//   - All storage is best-effort: a write/read failure just means "not saved this time," never a thrown
//     error the host has to handle (the explicit actions DO throw readable errors: the user asked for them).
//   - Hosts you don't own pass through: a save replaces only its own doc.hosts entry (TASK 458, kept per design in the store).
//   - Opening a document REPLACES the whole state (see #core/document.js's deserializeDocument) — never
//     a blend of old + restored.
//   - A buffer is BOUND to the design it loaded / created and keeps writing into THAT design, not into whatever the global
//     "current" pointer says later: a second tab that opens another design must not get this tab's drawing written into it.
//
// This module is UI-layer (DOM/IndexedDB), not #core — #core stays pure/testable.

import { serializeDocument, deserializeDocument } from '#core/document.js';
import { getProjectStore } from '#ui/project-store.js';
import { browserFileSeam } from '#ui/project-file.js';

/**
 * createDocumentBuffer({ state, app, hostName, getHostData, onRestored, store, pollMs, onStatusChange })
 *   state: the live sketch state to persist/restore (same shape #core/document.js expects).
 *   app: the app id ('sketchstudio' | 'shaper' | 'penplotter'), stored on the design (who saved it last).
 *   hostName / getHostData: OPTIONAL — if given, getHostData() is called at save time and embedded
 *     under doc.hosts[hostName] (e.g. penplotter's pens/toolpaths). Omit for a host with no side-car data of its own.
 *   onRestored({ restored, hosts, name }): OPTIONAL — called after the state was replaced by a stored design (initial restore,
 *     openDesign, newDesign, openFile). The host re-solves / repaints and applies ITS sidecar from `hosts` (or resets its
 *     own state to defaults when `hosts[hostName]` is absent: a design without a sidecar must not inherit the previous one).
 *   store: a project store (default: the shared IndexedDB one). pollMs: change-check interval (default 1500ms).
 *   onStatusChange(status): optional — 'saving' | 'saved' | 'error', for a passive indicator.
 *   doc / win: the page's document and window (injectable for tests): when the tab goes hidden or is closing, the buffer saves pending
 *     changes and flushes the store's throttled Drive writes (TASK 506), so a design on Drive is never left a few seconds behind.
 *
 * Returns { restore, start, stop, flush, openDesign, newDesign, saveAs, saveFile, openFile, followMoves, designId, store }.
 */
export function createDocumentBuffer({ state, app, hostName, getHostData, onRestored, store = getProjectStore(), pollMs = 1500, onStatusChange, doc = globalThis.document, win = globalThis.window } = {}) {
  let lastSig = null;
  let intervalId = null;
  let boundId = null; // the design this buffer reads from / writes to
  const notify = (s) => { try { onStatusChange && onStatusChange(s); } catch (_) {} };

  function currentDoc() {
    const hosts = (hostName && typeof getHostData === 'function') ? { [hostName]: getHostData() } : {};
    return serializeDocument(state, { hosts });
  }

  async function poll() {
    let sig;
    try { sig = JSON.stringify(currentDoc()); } catch (_) { return; } // a transient bad state -- skip this tick
    if (sig === lastSig) return;
    notify('saving');
    let ok = false;
    try { const r = await store.save(JSON.parse(sig), { app, id: boundId || undefined }); boundId = r.id; ok = true; } catch (_) { ok = false; }
    if (sig === lastSig) return; // a newer change landed while this write was in flight -- let the NEXT tick handle it
    lastSig = sig;
    notify(ok ? 'saved' : 'error');
  }

  /** Replace the app state with a stored design and tell the host. */
  function load(design) {
    const result = deserializeDocument(design.document, state);
    if (!result.ok) return { restored: false, hosts: {}, name: design.name, reason: result.reason }; // e.g. a newer-version document
    boundId = design.id;
    lastSig = JSON.stringify(currentDoc()); // the just-restored state IS the baseline -- don't immediately re-save it as "new"
    const out = { restored: true, hosts: result.hosts, name: design.name };
    try { onRestored && onRestored(out); } catch (e) { console.error('onRestored failed', e); }
    return out;
  }

  async function restore() {
    let design = null;
    try { design = await store.loadCurrent({ app }); } catch (_) { design = null; } // best-effort: no store = boot with an empty sketch
    if (!design) return { restored: false, hosts: {} };
    return load(design);
  }

  // The tab going hidden or closing: save what changed since the last tick and write it through to Drive now (a hidden tab may be frozen).
  const onVisibility = () => { if (doc.visibilityState === 'hidden') flush(); };
  const onPageHide = () => { flush(); };
  function start() {
    if (intervalId != null) return;
    intervalId = setInterval(poll, pollMs);
    if (doc) doc.addEventListener('visibilitychange', onVisibility);
    if (win) win.addEventListener('pagehide', onPageHide);
  }
  function stop() {
    if (intervalId == null) return;
    clearInterval(intervalId); intervalId = null;
    if (doc) doc.removeEventListener('visibilitychange', onVisibility);
    if (win) win.removeEventListener('pagehide', onPageHide);
  }
  /** Save pending changes NOW (before an action that copies / exports the stored design, and when the tab hides), written through to Drive. */
  async function flush() { await poll(); await store.flushDrive(boundId || undefined); }

  // ---- explicit design actions (they throw readable errors: the user asked for them) -------------------------------
  async function openDesign(id) { await flush(); return load(await store.open(id)); }
  async function newDesign(name) { await flush(); return load(await store.newDesign(name || 'Untitled', { app })); }
  async function saveAs(name) { await flush(); const p = await store.saveAs(name, { app, fromId: boundId || undefined }); boundId = p.id; return p; }
  async function saveFile(seam = browserFileSeam) { await flush(); return store.exportFile(boundId || undefined, seam); }
  async function openFile(seam = browserFileSeam) {
    await flush();
    const p = await store.importFile(seam, { app });
    return p ? load(p) : null;
  }

  /** After store.cloud.moveProjectToDrive / makeProjectLocal: the design this buffer is bound to may have a new id (`designIds` = { old: new }). */
  function followMoves(designIds) { if (boundId && designIds && designIds[boundId]) boundId = designIds[boundId]; }

  return { restore, start, stop, flush, openDesign, newDesign, saveAs, saveFile, openFile, followMoves, designId: () => boundId, store };
}
