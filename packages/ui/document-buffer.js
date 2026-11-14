// packages/ui/document-buffer.js — the shared AUTOSAVE LOOP of an app (PERSIST-2, reworked in TASK 474) and its open TABS (TASK 558).
// Polls the app state, and when it changed writes the document (packages/core/document.js serializeDocument + this host's
// sidecar) into the app's CURRENT DESIGN through the project store (project-store.js: projects and designs on IndexedDB). It
// also loads a design into the app (the initial restore, Open, New, Open from file) and offers the design actions a
// sidebar needs. Because every Sketch-Studio app is same-origin and the store's "current" pointer is global, switching apps
// via the shared app-switcher still carries the drawing: the next app restores the same current design.
//
// THE SAVE RULE (owner, 2026-11-12: "Auto save only once I actually saved and named"; docs/DOCUMENT-TABS-DESIGN.md, Saving): a NEW
// design (a fresh page, New design, a new tab) is an in-memory "Untitled" that is NOT stored anywhere until the user saves it the first
// time with a name (saveAs). From that first named save on, edits autosave into it. THIS module is the one place that decides "stored
// or not yet": the buffer is unbound (designId() === null) exactly while the design shown is an unsaved Untitled, and an unbound buffer
// never writes. needsSavePrompt() is the headless decision a close / leave prompt asks.
//
// TABS (TASK 558, docs/DOCUMENT-TABS-DESIGN.md section 4): several designs open at once, ONE live state. Switching tabs saves the active
// design, puts its document, undo/redo arrays, view and the host's session aside in a tab record, and loads the other tab's record
// into the same state (a SWAP; measured ~30 ms at 300 constraints, about one frame's solve).
//
// DDCS Studio lessons this steals (already paid for there, not rediscovered — see web/data/fsHandles.js,
// web/ui/fileSaveState.js:164):
//   - Autosave != a named save. Naming/saving-as/opening are explicit design actions (below); the loop never prompts.
//   - NO beforeunload warning for a clean STORED design. The buffer survives reload, so a warning would cry wolf on every refresh
//     and teach people to click through real ones. A passive status callback is the only truth-teller. The exception the save rule
//     makes: while needsSavePrompt() answers (an unsaved Untitled with content, or a design whose last save failed) the browser's
//     leave-page warning is armed, because leaving then really loses work.
//   - All storage is best-effort: a write/read failure just means "not saved this time," never a thrown
//     error the host has to handle (the explicit actions DO throw readable errors: the user asked for them).
//   - Hosts you don't own pass through: a save replaces only its own doc.hosts entry (TASK 458, kept per design in the store).
//   - Opening a document REPLACES the whole state (see #core/document.js's deserializeDocument) — never
//     a blend of old + restored.
//   - A buffer is BOUND to the design it loaded / created and keeps writing into THAT design, not into whatever the global
//     "current" pointer says later: a second tab that opens another design must not get this tab's drawing written into it.
//
// This module is UI-layer (DOM/IndexedDB), not #core — #core stays pure/testable.

import { serializeDocument, deserializeDocument, validateDocument } from '#core/document.js';
import { getProjectStore, emptyDocument } from '#ui/project-store.js';
import { browserFileSeam, serializeProjectFile, projectFileName } from '#ui/project-file.js';

/** T7 (owner ruling 2026-11-12): at most this many designs open at once (each tab keeps up to HISTORY_DEPTH undo steps in memory). */
export const MAX_TABS = 10;
/** The name an unsaved design shows. */
export const UNTITLED = 'Untitled';
const TAB_BUFFER_FIELDS = ['doc', 'sig', 'history', 'redoStack', 'view', 'hostSession', 'lastSig', 'emptySig', 'saveOk', 'designId', 'name'];

/**
 * createDocumentBuffer({ state, app, hostName, getHostData, session, onRestored, store, pollMs, onStatusChange, canvas, doc, win })
 *   state: the live sketch state to persist/restore (same shape #core/document.js expects).
 *   app: the app id ('sketchstudio' | 'shaper' | 'penplotter'), stored on the design (who saved it last).
 *   hostName / getHostData: OPTIONAL — if given, getHostData() is called at save time and embedded
 *     under doc.hosts[hostName] (e.g. penplotter's pens/toolpaths). Omit for a host with no side-car data of its own.
 *   session: OPTIONAL { capture() -> data, restore(data | undefined) } — the host's IN-MEMORY per-design data that is not in the
 *     document (e.g. Pen Plotter's toolpath undo stacks): captured when a tab is put aside, restored when it comes back; restore(undefined)
 *     = a design that has none yet (reset). Omit for a host with nothing of that kind.
 *   onRestored({ restored, hosts, name, reason }): OPTIONAL — called after the state was replaced (initial restore, openDesign, newDesign,
 *     openFile, a Drive conflict reload, a tab switch / new tab / close). `reason`: 'restore' | 'open' | 'new' | 'file' | 'conflict' |
 *     'switch'. The host re-solves / repaints and applies ITS sidecar from `hosts` (or resets its own state to defaults when
 *     `hosts[hostName]` is absent: a design without a sidecar must not inherit the previous one). On 'switch' the tab's own view has
 *     already been put back on state.view.
 *   store: a project store (default: the shared IndexedDB one). pollMs: change-check interval (default 1500ms).
 *   onStatusChange(status): optional — 'saving' | 'saved' | 'error', for a passive indicator.
 *   canvas: the host's Design canvas <svg>. Until the INITIAL restore has settled the buffer ignores the user's pointer / keyboard input on it (a late restore replaces the
 *     whole state, so an edit started before it lands would hit objects that are about to be thrown away) and carries data-doc-ready="0" on it; it sets data-doc-ready="1"
 *     when the restore is done (also when there was nothing to restore). `buffer.ready` is the same signal as a promise.
 *     It also carries the autosave state as data-save-state ('saving' | 'saved' | 'error' | 'idle', the onStatusChange values; TASK 602).
 *   doc / win: the page's document and window (injectable for tests): when the tab goes hidden or is closing, the buffer saves pending
 *     changes and flushes the store's throttled Drive writes (TASK 506), so a design on Drive is never left a few seconds behind.
 *
 * Returns { restore, ready, start, stop, flush, openDesign, newDesign, saveAs, saveFile, openFile, followMoves, designId, designName,
 *   isStored, needsSavePrompt, discardUnsaved, tabs, openTab, openFileTab, newTab, activate, closeTab, store }.
 */
export function createDocumentBuffer({ state, app, hostName, getHostData, session = null, onRestored, store = getProjectStore(), pollMs = 1500, onStatusChange, canvas = null, doc = globalThis.document, win = globalThis.window } = {}) {
  // ---- the ACTIVE tab's live binding (an inactive tab keeps the same fields in its record) ----
  let lastSig = null;     // the document signature last written (or loaded): a different one = something to save
  let boundId = null;     // the stored design this buffer reads from / writes to; null = an unsaved Untitled (never written)
  let name = UNTITLED;    // the design's name as shown
  let emptySig = null;    // an unsaved Untitled: the signature it started from (content = anything else); null for a stored design
  let saveOk = true;      // the last autosave of the bound design succeeded
  let bufferOk = true;    // the last local working-buffer write succeeded (beforeunload arms on failure)
  let lastBufSig = null;  // JSON string of last successfully persisted open-tabs buffer
  let intervalId = null;
  let offConflict = () => {};
  let offHistory = () => {};
  // ---- tabs: one record per open design, in strip order; `active` is the record whose design is in the state ----
  let tabSeq = 0;
  const newRecord = () => ({ key: 't' + (++tabSeq) });
  let active = newRecord();
  const tabList = [active];

  // THE gate on user input until the initial restore settles (see the `canvas` option). One capture listener per event type on the window.
  let isReady = false;
  let openGate = () => {};
  const ready = new Promise((res) => { openGate = res; });
  const GATED = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'wheel', 'keydown', 'keyup'];
  const gate = (e) => {
    if (isReady) return;
    const t = e.target;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    const blocked = e.type.startsWith('key') ? !typing : !!(canvas && t && canvas.contains(t));
    if (blocked) { e.stopImmediatePropagation(); e.preventDefault(); }
  };
  if (canvas) {
    canvas.dataset.docReady = '0';
    if (win) for (const t of GATED) win.addEventListener(t, gate, true);
  }
  function markReady() {
    isReady = true;
    if (canvas) { canvas.dataset.docReady = '1'; if (win) for (const t of GATED) win.removeEventListener(t, gate, true); }
    openGate();
  }
  // TASK 602: the save state is also written on the canvas (data-save-state): a host without a status text (SketchStudio: its tab dot shows it) and the
  // live tests read it there
  const notify = (s) => { if (canvas) canvas.dataset.saveState = s; try { onStatusChange && onStatusChange(s); } catch (_) {} };
  const restored = (out) => { try { onRestored && onRestored(out); } catch (e) { console.error('onRestored failed', e); } return out; };

  function currentDoc() {
    const hosts = (hostName && typeof getHostData === 'function') ? { [hostName]: getHostData() } : {};
    return serializeDocument(state, { hosts });
  }
  const sigNow = () => JSON.stringify(currentDoc());

  /** Snapshot of the open tabs + active working state so page refresh / crash reopens what was open (local working buffer only, NOT a saved file). */
  function captureBufferSnapshot() {
    if (tabList.length === 1 && !boundId && untouchedUntitled()) return null;
    const activeDoc = JSON.parse(sigNow());
    return {
      v: 1,
      app: app || null,
      activeKey: active.key,
      currentId: boundId || null,
      tabs: tabList.map((t) => {
        if (t === active) {
          return {
            key: t.key,
            designId: boundId || null,
            name,
            emptySig: boundId ? null : emptySig,
            saveOk,
            doc: activeDoc,
            view: state.view ? { ...state.view } : null,
            hostSession: session ? session.capture() : undefined,
          };
        }
        return {
          key: t.key,
          designId: t.designId || null,
          name: t.name,
          emptySig: t.designId ? null : t.emptySig,
          saveOk: t.saveOk,
          doc: t.doc,
          view: t.view ? { ...t.view } : null,
          hostSession: t.hostSession,
        };
      }),
    };
  }
  async function saveWorkingBuffer() {
    if (!store.writeBuffer) return true;
    let payload;
    try { payload = captureBufferSnapshot(); } catch (_) { return true; }
    const s = JSON.stringify(payload);
    if (s === lastBufSig && bufferOk) return true;
    try {
      await store.writeBuffer(payload);
      lastBufSig = s;
      bufferOk = true;
      return true;
    } catch (_) {
      bufferOk = false;
      return false;
    }
  }

  async function poll() {
    const bufPromise = saveWorkingBuffer();
    if (!boundId) { await bufPromise; return; } // THE SAVE RULE: an unsaved Untitled lives only in the working buffer above
    const target = boundId; // the design this signature belongs to (the buffer may be rebound while the write is in flight)
    let sig;
    try { sig = sigNow(); } catch (_) { await bufPromise; return; } // a transient bad state -- skip this tick
    if (sig === lastSig) { await bufPromise; return; }
    notify('saving');
    let ok = false, r = null;
    try { r = await store.save(JSON.parse(sig), { app, id: target }); ok = true; } catch (_) { ok = false; }
    await bufPromise;
    if (boundId !== target) { // rebound (open / new / tab switch) while this write was in flight: the result belongs to the design we left
      const left = ok && r.id !== target ? tabList.find((x) => x !== active && x.designId === target) : null;
      if (left) { left.designId = r.id; await saveWorkingBuffer(); } // that design was re-created under a new id: its tab follows
      return;
    }
    if (ok && r.id !== boundId) { boundId = r.id; await saveWorkingBuffer(); }
    else if (ok) boundId = r.id;
    saveOk = ok;
    if (sig === lastSig) return; // a newer change landed while this write was in flight -- let the NEXT tick handle it
    lastSig = sig;
    notify(ok ? 'saved' : 'error');
  }

  // ---- the binding: a stored design, or an unsaved Untitled ----------------------------------------------------------------------
  function bindStored(design) { boundId = design.id; name = design.name; emptySig = null; saveOk = true; lastSig = sigNow(); }
  function bindUntitled() { boundId = null; name = UNTITLED; saveOk = true; lastSig = emptySig = sigNow(); }

  /** Replace the app state with a stored design and tell the host. */
  function load(design, reason) {
    const result = deserializeDocument(design.document, state);
    if (!result.ok) return { restored: false, hosts: {}, name: design.name, reason: result.reason }; // e.g. a newer-version document
    bindStored(design); // the just-restored state IS the baseline -- don't immediately re-save it as "new"
    return restored({ restored: true, hosts: result.hosts, name: design.name, reason });
  }
  /** Replace the app state with an empty, UNSAVED Untitled (the same empty document a stored New design had) and tell the host. */
  function loadUntitled(reason) {
    const result = deserializeDocument(emptyDocument(), state);
    bindUntitled();
    const out = restored({ restored: true, hosts: result.hosts, name: UNTITLED, reason });
    lastSig = emptySig = sigNow(); // the empty baseline is taken AFTER the host reset its own data (its sidecar is part of the signature)
    return out;
  }

  /** The content test of an unsaved Untitled: anything other than the document it started as. */
  const hasContent = (sig, empty) => empty != null && sig !== empty;
  /** The decision a close / leave prompt asks for the ACTIVE design (or a tab record): 'unsaved' = an Untitled with content (Save… / Don't
   *  save / Cancel); 'save-failed' = a stored design whose last save failed; null = close without asking (autosaved). */
  function promptFor(designId, sig, empty, ok) {
    if (!designId) return hasContent(sig, empty) ? 'unsaved' : null;
    const s = store.status ? store.status(designId) : null;
    return (!ok || (s && s.state === 'failed')) ? 'save-failed' : null;
  }
  function needsSavePrompt() {
    let sig = null;
    if (!boundId) { try { sig = sigNow(); } catch (_) { sig = null; } }
    return promptFor(boundId, sig, emptySig, saveOk);
  }
  const notSavedYet = () => new Error('This design is not saved yet. Save it with a name first (Save as…), or undo / clear it.');
  const refuseIfUnsaved = () => { if (needsSavePrompt() === 'unsaved') throw notSavedYet(); };

  async function restore() {
    try {
      let bufSnap = null;
      try { bufSnap = store.readBuffer ? await store.readBuffer() : null; } catch (_) { bufSnap = null; }
      if (bufSnap && Array.isArray(bufSnap.tabs) && bufSnap.tabs.length) {
        try { if (store.prepare) await store.prepare({ app }); } catch (_) {}
        let curId = null;
        try { curId = store.currentId ? await store.currentId() : null; } catch (_) { curId = null; }
        const externalCurrent = !!(curId && curId !== bufSnap.currentId && !bufSnap.tabs.some((t) => t.designId === curId));
        if (!externalCurrent) {
          const restoredTabs = [];
          for (const s of bufSnap.tabs) {
            const key = s && s.key ? String(s.key) : ('t' + (++tabSeq));
            const m = /^t(\d+)$/.exec(key); if (m) tabSeq = Math.max(tabSeq, Number(m[1]));
            if (!s.designId) {
              if (!validateDocument(s.doc).ok) continue;
              restoredTabs.push({ key, designId: null, name: s.name || UNTITLED, emptySig: s.emptySig, saveOk: true, lastSig: JSON.stringify(s.doc), doc: s.doc, view: s.view || null, hostSession: s.hostSession });
            } else {
              let d = null, unreadable = false;
              try { d = await store.get(s.designId); } catch (_) { unreadable = true; }
              if (!d && !unreadable) continue; // deleted on Drive out-of-band (with no local shadow): do not resurrect
              const doc = d ? d.document : s.doc;
              if (!validateDocument(doc).ok) continue;
              restoredTabs.push({ key, designId: d ? d.id : s.designId, name: (d ? d.name : s.name) || UNTITLED, emptySig: null, saveOk: true, lastSig: JSON.stringify(doc), doc, view: s.view || null, hostSession: s.hostSession });
            }
          }
          if (restoredTabs.length) {
            tabList.length = 0;
            tabList.push(...restoredTabs);
            const target = tabList.find((x) => x.key === bufSnap.activeKey) || tabList[0];
            active = target;
            const result = deserializeDocument(target.doc, state);
            if (result.ok) {
              if (target.designId) {
                boundId = target.designId; name = target.name; emptySig = null; saveOk = true;
              } else {
                boundId = null; name = target.name || UNTITLED; emptySig = target.emptySig; saveOk = true;
              }
              if (target.view && state.view) Object.assign(state.view, target.view);
              const hostSession = target.hostSession;
              for (const k of TAB_BUFFER_FIELDS) delete target[k];
              const out = restored({ restored: true, hosts: result.hosts, name, reason: 'restore' });
              if (session && hostSession !== undefined) session.restore(hostSession);
              if (typeof state._notifyHistory === 'function') state._notifyHistory();
              lastSig = sigNow();
              if (boundId !== curId && store.setCurrent) { try { await store.setCurrent(boundId); } catch (_) {} }
              notify(boundId ? 'saved' : 'idle');
              return out;
            }
          }
          // All buffered tabs vanished on Drive or failed validation: reset stale buffer cleanly to Untitled
          active = newRecord();
          tabList.length = 0; tabList.push(active);
          if (store.writeBuffer) { try { await store.writeBuffer(null); } catch (_) {} }
          if (curId && store.setCurrent) { try { await store.setCurrent(null); } catch (_) {} }
          bindUntitled();
          return { restored: false, hosts: {} };
        }
      }
      let design = null;
      try { design = await store.loadCurrent({ app }); } catch (_) { design = null; } // best-effort: no store = boot with an empty sketch (unchanged)
      if (!design) { bindUntitled(); return { restored: false, hosts: {} }; } // nothing stored: the page shows an unsaved Untitled
      return load(design, 'restore');
    } finally {
      markReady(); // input opens once the stored design (if any) has replaced the state AND the host's onRestored has run
    }
  }

  // The tab going hidden or closing: save what changed since the last tick and write it through to Drive now (a hidden tab may be frozen).
  // Drive changed this design elsewhere and our edit was kept as a conflicted copy: show Drive's version (never write our older state over it).
  const onConflict = (id) => { if (id === boundId) store.get(id).then((d) => { if (d) load(d, 'conflict'); }, (e) => console.error('reload after a Drive conflict failed', e)); };
  // TASK 587 / 624: a hidden / closing page saves the working buffer + active design AND writes pending Drive writes through.
  const flushAll = async () => { await poll(); await store.flushDrive(); await saveWorkingBuffer(); };
  const onVisibility = () => { if (doc.visibilityState === 'hidden') flushAll(); };
  const onPageHide = () => { flushAll(); };
  // THE leave-page warning (TASK 624): since the local working buffer survives refresh, arm beforeunload ONLY when leaving would lose unpersisted work
  // (a buffer write failed, or any open tab has failed / unflushed Drive writes). The close-tab prompt for Untitled content stays in needsSavePrompt().
  const shouldWarnLeave = () => !bufferOk || tabs().some((t) => t.needsSavePrompt === 'save-failed' || (t.designId && store.hasPendingDrive && store.hasPendingDrive(t.designId)));
  const onBeforeUnload = (e) => { if (!shouldWarnLeave()) return; e.preventDefault(); e.returnValue = ''; };
  function start() {
    if (intervalId != null) return;
    intervalId = setInterval(poll, pollMs);
    offConflict = store.subscribeConflict(onConflict);
    offHistory = typeof state.addHistoryListener === 'function' ? state.addHistoryListener(() => { saveWorkingBuffer(); }) : () => {};
    if (doc) doc.addEventListener('visibilitychange', onVisibility);
    if (win) { win.addEventListener('pagehide', onPageHide); win.addEventListener('beforeunload', onBeforeUnload); }
  }
  function stop() {
    if (intervalId == null) return;
    clearInterval(intervalId); intervalId = null;
    offConflict();
    offHistory();
    if (doc) doc.removeEventListener('visibilitychange', onVisibility);
    if (win) { win.removeEventListener('pagehide', onPageHide); win.removeEventListener('beforeunload', onBeforeUnload); }
  }
  /** Save pending changes NOW (before an action that copies / exports the stored design, and when the tab hides), written through to Drive. */
  async function flush() { await poll(); await store.flushDrive(boundId || undefined); }

  // ---- explicit design actions (they throw readable errors: the user asked for them) -------------------------------
  // They act on the ACTIVE tab. One that would replace an unsaved Untitled WITH content refuses: nothing is ever thrown away silently.
  // The UI never meets that refusal: it asks Save… / Don't save / Cancel first (project-actions.js settleUnsaved) and then either saves
  // (saveAs) or discards (discardUnsaved) before calling these. An empty Untitled is simply replaced.
  async function openDesign(id) { refuseIfUnsaved(); await flush(); const out = load(await store.open(id), 'open'); await saveWorkingBuffer(); return out; }
  /** New design: an empty, UNSAVED Untitled (stored at its first named save). No design is current while it shows. */
  async function newDesign() { refuseIfUnsaved(); await flush(); await store.setCurrent(null); const out = loadUntitled('new'); await saveWorkingBuffer(); return out; }
  /** Save as: on an unsaved Untitled, the FIRST NAMED SAVE (it is stored under `newName`, and autosaves from then on); on a stored design,
   *  a copy under `newName` that becomes the bound one (unchanged). */
  async function saveAs(newName) {
    if (!boundId) {
      const sig = sigNow();
      const d = await store.newDesign(newName, { app, document: JSON.parse(sig) }); // stored, named, current in one write
      boundId = d.id; name = d.name; emptySig = null; saveOk = true; lastSig = sig;
      notify('saved');
      await saveWorkingBuffer();
      return d;
    }
    await flush();
    const p = await store.saveAs(newName, { app, fromId: boundId });
    boundId = p.id; name = p.name; lastSig = sigNow();
    await saveWorkingBuffer();
    return p;
  }
  /** Save a design to a file: `designId` (a design picked in the project manager), else the shown one: the bound design, or the unsaved
   *  Untitled's in-memory document (a file is not the project store: the save rule does not apply). */
  async function saveFile(seam = browserFileSeam, designId) {
    if (designId || boundId) { await flush(); return store.exportFile(designId || boundId, seam); }
    return seam.save(serializeProjectFile({ app, name, document: JSON.parse(sigNow()) }), projectFileName(name));
  }
  /** "Don't save": the unsaved Untitled is thrown away (an empty Untitled takes its place), so the action the user asked for can go on.
   *  A stored design is never discarded (it is autosaved). */
  function discardUnsaved() { if (!boundId) { loadUntitled('new'); saveWorkingBuffer(); } }
  async function openFile(seam = browserFileSeam) {
    refuseIfUnsaved();
    await flush();
    const p = await store.importFile(seam, { app }); // a file has a name: it is stored as a named design
    const out = p ? load(p, 'file') : null;
    if (out) await saveWorkingBuffer();
    return out;
  }

  /** After store.cloud.moveProjectToDrive: the designs bound here (the active one and the other tabs) may have a new id
   *  (`designIds` = { old: new }). */
  function followMoves(designIds) {
    if (!designIds) return;
    if (boundId && designIds[boundId]) boundId = designIds[boundId];
    for (const t of tabList) if (t !== active && t.designId && designIds[t.designId]) t.designId = designIds[t.designId];
    saveWorkingBuffer();
  }

  // ---- TABS -------------------------------------------------------------------------------------------------------------------
  /** End what is in progress before the state is swapped: a half-drawn element is cancelled (as on a tool pick), an open undo group
   *  (a drag, a dimension edit) is committed, so the history arrays that leave with the tab are whole. */
  function endInteraction() {
    if (typeof state.closeDrawStep === 'function') state.closeDrawStep();
    if (typeof state.isUndoGroupOpen === 'function') while (state.isUndoGroupOpen()) state.endUndoGroup();
  }
  /** Put the active design aside into its record (after saving it). */
  async function putAside() {
    endInteraction();
    await poll();
    const sig = sigNow();
    Object.assign(active, {
      designId: boundId, name, emptySig, saveOk, lastSig, sig,
      doc: JSON.parse(sig),
      history: state.history, redoStack: state.redoStack,
      view: state.view ? { ...state.view } : null,
      hostSession: session ? session.capture() : undefined,
    });
    if (Array.isArray(state.history)) { state.history = []; state.redoStack = []; }
  }
  /** Make record `rec` the active one, loading its document, history, view and host session into the state. */
  function bringIn(rec) {
    active = rec;
    const result = deserializeDocument(rec.doc, state);
    boundId = rec.designId || null; name = rec.name; emptySig = rec.emptySig; saveOk = rec.saveOk; lastSig = rec.lastSig;
    if (Array.isArray(rec.history)) { state.history = rec.history; state.redoStack = rec.redoStack; }
    if (rec.view && state.view) Object.assign(state.view, rec.view);
    const hostSession = rec.hostSession;
    for (const k of TAB_BUFFER_FIELDS) delete rec[k];
    const out = restored({ restored: true, hosts: result.hosts || {}, name, reason: 'switch' });
    if (session) session.restore(hostSession);
    if (typeof state._notifyHistory === 'function') state._notifyHistory();
    notify(boundId ? (saveOk ? 'saved' : 'error') : 'idle'); // the host's status text follows the tab now shown (an unsaved Untitled writes nothing: empty)
    return out;
  }
  /** A fresh tab record becomes active with an empty unsaved Untitled (its history starts empty). */
  function bringInUntitled() {
    active = newRecord();
    if (Array.isArray(state.history)) { state.history = []; state.redoStack = []; }
    const out = loadUntitled('new');
    if (session) session.restore(undefined);
    if (typeof state._notifyHistory === 'function') state._notifyHistory();
    notify('idle');
    return out;
  }
  const untouchedUntitled = () => !boundId && !hasContent(sigNow(), emptySig) && !(state.history && state.history.length) && !(state.redoStack && state.redoStack.length);
  const full = () => new Error(`Close a tab first: at most ${MAX_TABS} designs are open at once.`);
  const recordOf = (key) => { const r = tabList.find((x) => x.key === key); if (!r) throw new Error('That tab is not open.'); return r; };

  /** The open tabs in strip order: { key, designId, name, active, stored, needsSavePrompt }. */
  function syncMovedIds() {
    if (!store || !store.resolveId) return;
    if (boundId) boundId = store.resolveId(boundId);
    for (const t of tabList) if (t.designId) t.designId = store.resolveId(t.designId);
  }
  function tabs() {
    syncMovedIds();
    return tabList.map((t) => (t === active
      ? { key: t.key, designId: boundId, name, active: true, stored: !!boundId, needsSavePrompt: needsSavePrompt() }
      : { key: t.key, designId: t.designId || null, name: t.name, active: false, stored: !!t.designId, needsSavePrompt: promptFor(t.designId, t.sig, t.emptySig, t.saveOk) }));
  }
  /** Open stored design `id` in a NEW tab (T2) at the right end; already open -> its tab is activated; the active tab an untouched
   *  Untitled -> it is reused. */
  async function openTab(id, reason = 'open') {
    if (boundId === id) return { restored: true, hosts: {}, name, reason: 'switch' };
    const open = tabList.find((x) => x !== active && x.designId === id);
    if (open) return activate(open.key);
    const reuse = untouchedUntitled();
    if (!reuse && tabList.length >= MAX_TABS) throw full();
    await poll();
    const design = await store.open(id); // makes it current
    const valid = validateDocument(design.document);
    if (!valid.ok) return { restored: false, hosts: {}, name: design.name, reason: valid.reason };
    if (!reuse) {
      await putAside();
      active = newRecord(); tabList.push(active);
    }
    const out = load(design, reason);
    if (!reuse && session) session.restore(undefined);
    if (typeof state._notifyHistory === 'function') state._notifyHistory();
    notify('saved');
    await saveWorkingBuffer();
    return out;
  }
  /** Open from file into a NEW tab (T2): the file becomes a stored, named design (as openFile) and opens like any design. The tab limit is
   *  checked BEFORE the file is imported, so a refused open leaves nothing stored. */
  async function openFileTab(seam = browserFileSeam) {
    if (tabList.length >= MAX_TABS && !untouchedUntitled()) throw full();
    await poll();
    const p = await store.importFile(seam, { app });
    return p ? openTab(p.id, 'file') : null;
  }
  /** New design in a NEW tab (T3): an unsaved Untitled. */
  async function newTab() {
    if (tabList.length >= MAX_TABS) throw full();
    await putAside();
    const out = bringInUntitled();
    tabList.push(active);
    await store.setCurrent(null);
    await saveWorkingBuffer();
    return out;
  }
  /** Switch to the tab `key`. */
  async function activate(key) {
    const rec = recordOf(key);
    if (rec === active) return { restored: true, hosts: {}, name, reason: 'switch' };
    await putAside();
    const out = bringIn(rec);
    await store.setCurrent(boundId);
    await saveWorkingBuffer();
    return out;
  }
  /** Close the tab `key` (the caller asked needsSavePrompt first: closing never asks here). Its design is saved first; the active tab
   *  hands over to its right neighbour (else the left one); the last tab closed leaves a fresh Untitled (T6). */
  async function closeTab(key) {
    const rec = recordOf(key);
    const i = tabList.indexOf(rec);
    if (rec !== active) { tabList.splice(i, 1); if (rec.designId) await store.flushDrive(rec.designId); await saveWorkingBuffer(); return null; }
    endInteraction();
    await flush();
    tabList.splice(i, 1);
    if (!tabList.length) { const out = bringInUntitled(); tabList.push(active); await store.setCurrent(null); await saveWorkingBuffer(); return out; }
    const out = bringIn(tabList[Math.min(i, tabList.length - 1)]);
    await store.setCurrent(boundId);
    await saveWorkingBuffer();
    return out;
  }

  return {
    restore, ready, start, stop, flush, openDesign, newDesign, saveAs, saveFile, openFile, followMoves,
    designId: () => boundId, designName: () => name, isStored: () => !!boundId, needsSavePrompt, discardUnsaved,
    tabs, openTab, openFileTab, newTab, activate, closeTab, store,
  };
}
