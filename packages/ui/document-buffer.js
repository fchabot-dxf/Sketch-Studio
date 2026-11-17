// packages/ui/document-buffer.js — the shared AUTOSAVE LOOP of an app (PERSIST-2, reworked in TASK 474) and its open TABS (TASK 558).
// Polls the app state, and when it changed writes the document (packages/core/document.js serializeDocument + this host's
// sidecar) into the app's CURRENT DESIGN through the project store (project-store.js: projects and designs on IndexedDB). It
// also loads a design into the app (the initial restore, Open, New, Open from file) and offers the design actions a
// sidebar needs. The store's "current" pointer and the open-tabs buffer (below) are shared by every page of ONE
// origin (TASK 696: each app is its own website, so on the published sites that is the pages of one app; the local dev server serves all four on one).
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
// ONE LIST OF OPEN TABS PER ORIGIN (TASK 684, owner turns 1768-1775; TASK 696: one origin per app on the published sites): the open tabs live in ONE
// shared working buffer (project-store.js readBuffer / updateBuffer), so every app page of the origin shows the same tabs, in the same order, with the same
// active tab, unsaved Untitled tabs included. Each app shows ITS view of a document (its own sidecar, or its defaults when the document
// has none) and passes every other app's through: the buffer keeps the WHOLE document (fullDoc: every app's sidecar) while an autosave still writes only
// this app's sidecar (458). What stays per APP: the stage (each host's own MODE_KEY / STAGE_KEY), and each app's SESSION of a tab (hostSessions[app]:
// Pen Plotter's toolpath undo + selection, Shaper's Prepare state, Trace's photo): written into the buffer under the app's own slot, the other
// apps' slots passed through. The document's undo / redo history stays with the PAGE (in memory, not in the buffer: a reload starts with an
// empty history, as a reload always did; an undo step is a whole-state snapshot of this app's state, which another app could not apply).
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
import { browserFileSeam, serializeProjectFile, parseProjectFile, projectFileName, designNameOfFile } from '#ui/project-file.js';
import { homeOf } from '#ui/document-home.js'; // TASK 759: where a tab's design lives (Drive, a file on this device, or nowhere yet)
import { track } from '#ui/analytics.js'; // TASK 738: a design saved under a name

/** T7 (owner ruling 2026-11-12): at most this many designs open at once (each tab keeps up to HISTORY_DEPTH undo steps in memory). */
export const MAX_TABS = 10;
/** The name an unsaved design shows. */
export const UNTITLED = 'Untitled';
/** TASK 706 ("everything in Design"): the restore reasons that are a design the user OPENED: a new design (blank or a template, a new tab), Open, Open from
 *  file. A host that declares `showDesign` shows its Design view for these, before onRestored. Not: 'switch' (a tab switch keeps the stage), 'restore' (the
 *  page's own restore keeps the stored stage), 'conflict' (a Drive reload of the same tab). (Moved here from Shaper's modes.js, TASK 705.) */
export const OPENING_REASONS = Object.freeze(new Set(['new', 'open', 'file']));
const TAB_BUFFER_FIELDS = ['doc', 'history', 'redoStack', 'view', 'hostSessions', 'lastSig', 'emptySig', 'hasOwnSidecar', 'content', 'saveOk', 'designId', 'name', 'file'];
/** Render caches stamped by svg-renderer on live constraints; stripped from change signatures so viewing / zooming / panning never triggers a save (task 687). */
const RENDER_CONSTRAINT_KEYS = ['glyphPos', '__visible', '__showGlyph'];
function docChangeSig(doc) {
  if (!doc || !doc.geometry || !Array.isArray(doc.geometry.constraints) || !doc.geometry.constraints.length) return JSON.stringify(doc);
  return JSON.stringify({
    ...doc,
    geometry: {
      ...doc.geometry,
      constraints: doc.geometry.constraints.map((c) => {
        if (!c || typeof c !== 'object') return c;
        let copy = null;
        for (const k of RENDER_CONSTRAINT_KEYS) {
          if (k in c) { if (!copy) copy = { ...c }; delete copy[k]; }
        }
        return copy || c;
      }),
    },
  });
}
/** The empty baseline of an unsaved Untitled the shared buffer says HAS content (TASK 684): no signature equals it, so the tab asks THE question when closed
 *  (its own empty baseline was taken by another app or an earlier page, whose signature is not this app's). */
const HAS_CONTENT = '';

/**
 * TASK 684: the ONE open-tabs working buffer is shared by every app and every page (browser tab) of this origin. A page writes it as a MERGE with what
 * is stored, so two pages open at the same time never silently lose a tab or a tab's content (the simplest safe rule):
 *   stored  the buffer as it is now (another page may have written it since this page last did); null = none
 *   mine    this page's snapshot (captureBufferSnapshot); null = this page holds only an empty Untitled
 *   base    Map key -> tabSig of the tabs this page has held, as it last READ or WROTE them (what "changed elsewhere" is measured against)
 *   app     this page's app: each app owns ITS slot of a tab's hostSessions (the 458 rule, for sessions): the others are taken from `stored`
 * Rules: a tab of mine is written as mine, unless another page changed it since (stored != base): then, if this page did not change it (mine == base),
 * the other page's version is kept; if both changed it, mine is written AND theirs is kept as another tab. A tab this page never held (another page
 * opened it) is kept after mine; one this page held and closed is dropped, unless another page changed it since. A stored design is listed once.
 * Order and the active tab: this page's (the last writer's). Returns { buffer, wrote: Map key -> tabSig written as this page's }.
 */
export function tabSig(t) { return t.designId ? 'd:' + t.designId : 'u:' + JSON.stringify([t.name, t.doc]); }
export function mergeTabBuffers(stored, mine, base, app) {
  const theirs = (stored && Array.isArray(stored.tabs) ? stored.tabs : []).filter(Boolean);
  const byKey = new Map(theirs.map((t) => [t.key, t]));
  const own = mine ? mine.tabs : [];
  const ownKeys = new Set(own.map((t) => t.key));
  const sessionsOf = (t, other) => {
    const out = { ...((other && other.hostSessions) || t.hostSessions || {}) };
    if (t.hostSessions && t.hostSessions[app] !== undefined) out[app] = t.hostSessions[app]; else delete out[app];
    return out;
  };
  const out = [], extra = [], wrote = new Map();
  for (const t of own) {
    const s = byKey.get(t.key), b = base.get(t.key), mineSig = tabSig(t);
    const theirSig = s ? tabSig(s) : null;
    if (!s || b === undefined || theirSig === b || theirSig === mineSig) { out.push({ ...t, hostSessions: sessionsOf(t, s) }); wrote.set(t.key, mineSig); continue; }
    if (mineSig === b) { out.push({ ...s, hostSessions: sessionsOf(t, s) }); continue; } // changed only by another page: its newer version stays
    out.push({ ...t, hostSessions: sessionsOf(t, s) }); wrote.set(t.key, mineSig);       // changed here AND there: mine, and theirs as another tab
    extra.push({ ...s, key: s.key + '+' + Math.random().toString(36).slice(2, 7) });
  }
  for (const s of theirs) {
    if (ownKeys.has(s.key)) continue;
    const b = base.get(s.key);
    if (b !== undefined && tabSig(s) === b) continue; // this page closed it and no other page changed it since
    extra.push(s);
  }
  const ids = new Set(out.filter((t) => t.designId).map((t) => t.designId));
  for (const t of extra) { if (t.designId) { if (ids.has(t.designId)) continue; ids.add(t.designId); } out.push(t); }
  if (!out.length) return { buffer: null, wrote };
  const has = (k) => k != null && out.some((t) => t.key === k);
  const activeKey = mine && has(mine.activeKey) ? mine.activeKey : (stored && has(stored.activeKey) ? stored.activeKey : out[0].key);
  const currentId = mine ? mine.currentId : (stored ? stored.currentId || null : null);
  return { buffer: { v: 2, activeKey, currentId, tabs: out }, wrote };
}

/**
 * createDocumentBuffer({ state, app, hostName, getHostData, session, onRestored, showDesign, store, pollMs, onStatusChange, canvas, doc, win })
 *   state: the live sketch state to persist/restore (same shape #core/document.js expects).
 *   app: the app id ('sketchstudio' | 'shaper' | 'penplotter'), stored on the design (who saved it last).
 *   hostName / getHostData: OPTIONAL — if given, getHostData() is called at save time and embedded
 *     under doc.hosts[hostName] (e.g. penplotter's pens/toolpaths). Omit for a host with no side-car data of its own.
 *   session: OPTIONAL { capture() -> data, restore(data | undefined), stored?(data) -> data } — the host's IN-MEMORY per-design data that is not in
 *     the document (e.g. Pen Plotter's toolpath undo stacks): captured when a tab is put aside, restored when it comes back; restore(undefined)
 *     = a design that has none yet (reset). Omit for a host with nothing of that kind. stored(data) (TASK 684): the part of it the open-tabs working
 *     buffer keeps across a reload (the buffer is IndexedDB: plain, storable data only; no DOM element, canvas, nor a photo, TASK 567);
 *     omitted = all of it is storable. It is applied to data that is already its own result too (a tab the buffer gave this page), so it must keep that.
 *   onRestored({ restored, hosts, name, reason, removedVcarves }): OPTIONAL — called after the state was replaced (initial restore, openDesign, newDesign,
 *     openFile, a Drive conflict reload, a tab switch / new tab / close). `reason`: 'restore' | 'open' | 'new' | 'file' | 'conflict' |
 *     'switch'. The host re-solves / repaints and applies ITS sidecar from `hosts` (or resets its own state to defaults when
 *     `hosts[hostName]` is absent: a design without a sidecar must not inherit the previous one). On 'switch' the tab's own view has
 *     already been put back on state.view. `removedVcarves` (TASK 741): #core/document.js deserializeDocument's count of the V-carve regions an old
 *     document carried and that were not loaded (0 for any other document); Shaper says so once in Prepare, the other hosts ignore it.
 *   showDesign(): OPTIONAL (TASK 706) — how this host shows its Design view; called before onRestored when the reason is one of OPENING_REASONS (a design the
 *     user opened is shown in Design, from any stage). Omit it and the stage is never changed by a restore (Trace: its own applyHost decides).
 *   store: a project store (default: the shared IndexedDB one). pollMs: change-check interval (default 1500ms).
 *   onStatusChange(status): optional — 'saving' | 'saved' | 'error', for a passive indicator.
 *   canvas: the host's Design canvas <svg>. Until the INITIAL restore has settled the buffer ignores the user's pointer / keyboard input on it (a late restore replaces the
 *     whole state, so an edit started before it lands would hit objects that are about to be thrown away) and carries data-doc-ready="0" on it; it sets data-doc-ready="1"
 *     when the restore is done (also when there was nothing to restore). `buffer.ready` is the same signal as a promise.
 *     It also carries the autosave state as data-save-state ('saving' | 'saved' | 'error' | 'idle', the onStatusChange values; TASK 602).
 *   doc / win: the page's document and window (injectable for tests): when the tab goes hidden or is closing, the buffer saves pending
 *     changes and flushes the store's throttled Drive writes (TASK 506), so a design on Drive is never left a few seconds behind.
 *
 * Returns { restore, ready, start, stop, flush, openDesign, newDesign, saveAs, saveFile, saveToFile, saveHome, openFile, followMoves, designId, designName,
 *   home, rename, isStored, needsSavePrompt, discardUnsaved, tabs, openTab, openFileTab, newTab, activate, closeTab, store }.
 *
 * TASK 759, A FILE HOME (document-home.js): a design opened from a file on this device (openFile / openFileTab) or saved to one (saveToFile, Save as > Local) is
 * NOT a stored design: like an unsaved Untitled it is unbound (designId() === null) and lives in the open-tabs buffer, but it carries its file ({ name,
 * handle }) and its baseline (emptySig) is the content as last read from / written to that file, so needsSavePrompt() answers 'unsaved' (the tab's dot)
 * exactly while it has changes not written to the file. saveHome() writes it there (the handle, else the picker again, else a download). The buffer keeps the
 * file NAME across a reload, never the handle (a page-memory object).
 */
export function createDocumentBuffer({ state, app, hostName, getHostData, session = null, onRestored, showDesign = null, store = getProjectStore(), pollMs = 1500, onStatusChange, canvas = null, doc = globalThis.document, win = globalThis.window } = {}) {
  // ---- the ACTIVE tab's live binding (an inactive tab keeps the same fields in its record) ----
  let lastSig = null;     // the document signature last written (or loaded): a different one = something to save
  let boundId = null;     // the stored design this buffer reads from / writes to; null = an unsaved Untitled (never written)
  let name = UNTITLED;    // the design's name as shown
  let emptySig = null;    // an unsaved Untitled: the FULL signature it started from (content = anything else); null for a stored design
  let foreign = {};       // TASK 684: the OTHER apps' sidecars of the shown document: kept in the shared buffer and in an Untitled's first named save, never autosaved (458)
  let otherSessions = {}; // TASK 684: the OTHER apps' sessions of the shown tab (hostSessions minus this app's): passed through the shared buffer untouched
  let hasOwnSidecar = false; // TASK 687: true once the shown document carried hosts[hostName] or the user changed something in this host
  let defaultHostSig = null; // TASK 687: getHostData() snapshot of an un-sidecar'd host right after onRestored; matching it writes no default sidecar
  let fileHome = null;    // TASK 759: { name, handle } of an unbound design whose home is a file on this device; null = no file home
  let saveOk = true;      // the last autosave of the bound design succeeded
  let bufferOk = true;    // the last local working-buffer write succeeded (beforeunload arms on failure)
  let lastBufSig = null;  // JSON string of last successfully persisted open-tabs buffer
  let intervalId = null;
  let offConflict = () => {};
  let offHistory = () => {};
  // ---- tabs: one record per open design, in strip order; `active` is the record whose design is in the state ----
  let tabSeq = 0;
  const pageTag = Math.random().toString(36).slice(2, 7); // TASK 684: keys are unique across pages (two pages share one buffer)
  const newKey = () => 't' + (++tabSeq) + '-' + pageTag;
  const newRecord = () => ({ key: newKey() });
  const base = new Map(); // TASK 684: key -> tabSig of each tab as this page last read / wrote it in the shared buffer (mergeTabBuffers)
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
  const restored = (out) => {
    try { if (showDesign && OPENING_REASONS.has(out.reason)) showDesign(); onRestored && onRestored(out); } catch (e) { console.error('onRestored failed', e); } // TASK 706: Design first (its canvas has its size for the fit)
    return out;
  };

  const hostDataSig = (data) => (data === undefined ? '' : JSON.stringify(data));
  const docHasOwnHost = (hosts) => !!(hostName && hosts && Object.prototype.hasOwnProperty.call(hosts, hostName) && hosts[hostName] !== undefined);
  function resetHostBaseline(hadSidecar) {
    hasOwnSidecar = !!hadSidecar;
    defaultHostSig = (!hasOwnSidecar && hostName && typeof getHostData === 'function') ? hostDataSig(getHostData()) : null;
  }
  function ownHostEntry() {
    if (!hostName || typeof getHostData !== 'function') return {};
    const data = getHostData();
    if (!hasOwnSidecar && defaultHostSig !== null && hostDataSig(data) === defaultHostSig) return {};
    hasOwnSidecar = true;
    return { [hostName]: data };
  }

  /** The document as THIS app writes it to the store: its own sidecar only (458: every other host's passes through in the store), omitted when unchanged from defaults (TASK 687). */
  function currentDoc() {
    return serializeDocument(state, { hosts: ownHostEntry() });
  }
  const sigNow = () => docChangeSig(currentDoc());
  /** TASK 684: the WHOLE document, the other apps' sidecars included: what the shared buffer keeps (an Untitled lives only there) and what an
   *  Untitled's first named save stores, so no app's sidecar is lost on the way Studio -> Shaper -> Pen Plotter -> Trace. */
  function fullDoc() { const d = currentDoc(); d.hosts = { ...foreign, ...d.hosts }; return d; }
  const fullSigNow = () => docChangeSig(fullDoc());
  const splitHosts = (hosts) => { const o = { ...(hosts || {}) }; if (hostName) delete o[hostName]; return o; };
  /** A tab's sessions with THIS app's slot set to `mine` (undefined = none). */
  const withOwn = (sessions, mine) => { const o = { ...(sessions || {}) }; if (mine === undefined) delete o[app]; else o[app] = mine; return o; };
  /** What of this app's session of a tab the working buffer may keep (session.stored; the in-memory capture can hold a DOM element or a photo). */
  const storedSession = (data) => (data === undefined || !session || typeof session.stored !== 'function' ? data : session.stored(data));
  /** TASK 759: what the open-tabs buffer keeps of a file home: its NAME only (the handle is a page-memory object; after a reload the home is "name only"). */
  const storedFile = (f) => (f && f.name ? { name: f.name } : null);
  /** The active design is an unsaved Untitled with content. */
  const activeContent = () => !boundId && hasContent(fullSigNow(), emptySig);

  /** Snapshot of the open tabs + active working state so page refresh / crash reopens what was open (the shared working buffer, NOT a saved
   *  file). null = only an empty Untitled is open (nothing to keep). */
  function captureBufferSnapshot() {
    if (tabList.length === 1 && !boundId && !activeContent()) return null;
    return {
      v: 2,
      activeKey: active.key,
      currentId: boundId || null,
      tabs: tabList.map((t) => (t === active
        ? { key: t.key, designId: boundId || null, name, content: activeContent(), saveOk, doc: fullDoc(), view: state.view ? { ...state.view } : null, hostSessions: withOwn(otherSessions, session ? storedSession(session.capture()) : undefined), file: storedFile(fileHome) }
        : { key: t.key, designId: t.designId || null, name: t.name, content: !!t.content, saveOk: t.saveOk !== false, doc: t.doc, view: t.view ? { ...t.view } : null, hostSessions: withOwn(t.hostSessions, storedSession((t.hostSessions || {})[app])), file: storedFile(t.file) })),
    };
  }
  /** Write the snapshot into the SHARED buffer, merged with what other pages wrote there (mergeTabBuffers). Resolves false when it could not be written. */
  async function saveWorkingBuffer() {
    if (!store.updateBuffer) return true;
    let payload;
    try { payload = captureBufferSnapshot(); } catch (e) { console.error('open-tabs snapshot failed', e); return true; } // a transient bad state: the next tick tries again
    const s = JSON.stringify(payload);
    if (s === lastBufSig && bufferOk) return true;
    let wrote = null;
    try {
      await store.updateBuffer((stored) => { const m = mergeTabBuffers(stored, payload, base, app); wrote = m.wrote; return m.buffer; });
      for (const [k, sig] of wrote) base.set(k, sig);
      lastBufSig = s;
      bufferOk = true;
      return true;
    } catch (e) {
      console.error('the open-tabs working buffer could not be written', e);
      bufferOk = false;
      return false;
    }
  }

  async function poll() {
    const bufPromise = saveWorkingBuffer();
    if (!boundId) { await bufPromise; return; } // THE SAVE RULE: an unsaved Untitled lives only in the working buffer above
    const target = boundId; // the design this signature belongs to (the buffer may be rebound while the write is in flight)
    let doc, sig;
    try { doc = currentDoc(); sig = docChangeSig(doc); } catch (_) { await bufPromise; return; } // a transient bad state -- skip this tick
    if (sig === lastSig) { await bufPromise; return; }
    notify('saving');
    let ok = false, r = null;
    try { r = await store.save(doc, { app, id: target }); ok = true; } catch (_) { ok = false; }
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
  function bindStored(design) { boundId = design.id; name = design.name; emptySig = null; saveOk = true; fileHome = null; resetHostBaseline(docHasOwnHost(design.document && design.document.hosts)); lastSig = sigNow(); }
  function bindUntitled() { boundId = null; name = UNTITLED; saveOk = true; fileHome = null; foreign = {}; otherSessions = {}; resetHostBaseline(false); lastSig = sigNow(); emptySig = fullSigNow(); }

  /** Replace the app state with a stored design and tell the host. */
  function load(design, reason) {
    const result = deserializeDocument(design.document, state);
    if (!result.ok) return { restored: false, hosts: {}, name: design.name, reason: result.reason }; // e.g. a newer-version document
    foreign = splitHosts(result.hosts);
    if (reason !== 'conflict') otherSessions = {}; // a Drive conflict reloads the SAME tab: the other apps' sessions stay with it
    bindStored(design);
    const out = restored({ restored: true, hosts: result.hosts, name: design.name, reason, removedVcarves: result.removedVcarves });
    resetHostBaseline(docHasOwnHost(result.hosts));
    lastSig = sigNow(); // TASK 684: the baseline is taken AFTER the host applied its sidecar (or its defaults when the design has none): showing a design never writes it
    return out;
  }
  /** Replace the app state with an empty, UNSAVED Untitled (the same empty document a stored New design had) and tell the host. */
  function loadUntitled(reason, template = null) {
    const result = deserializeDocument(emptyDocument(), state);
    bindUntitled();
    let out = restored({ restored: true, hosts: result.hosts, name: UNTITLED, reason });
    resetHostBaseline(false);
    lastSig = sigNow(); emptySig = fullSigNow(); // the empty baseline is taken AFTER the host reset its own data
    if (template) {
      // TASK 651: a design started from a TEMPLATE ({ name, document }) is the same unsaved Untitled, shown under the template's name and holding its
      // drawing as its STARTING document (not an edit: the undo history stays empty). emptySig stays the EMPTY baseline, so it has content: closing it asks
      // Save... / Don't save, and a named save stores it.
      const r = deserializeDocument(template.document, state);
      if (!r.ok) throw new Error(`This template could not be opened: ${r.reason}`);
      name = template.name;
      foreign = splitHosts(r.hosts);
      out = restored({ restored: true, hosts: r.hosts, name, reason, removedVcarves: r.removedVcarves });
      resetHostBaseline(docHasOwnHost(r.hosts));
      lastSig = sigNow();
    }
    return out;
  }

  /** The content test of an unsaved Untitled: anything other than the document it started as. */
  const hasContent = (sig, empty) => empty != null && sig !== empty;
  /** The decision a close / leave prompt asks for the ACTIVE design (or a tab record): 'unsaved' = an Untitled with content (Save… / Don't
   *  save / Cancel); 'save-failed' = a stored design whose last save failed; null = close without asking (autosaved). */
  function promptFor(designId, content, ok) {
    if (!designId) return content ? 'unsaved' : null;
    const s = store.status ? store.status(designId) : null;
    return (!ok || (s && s.state === 'failed')) ? 'save-failed' : null;
  }
  function needsSavePrompt() {
    let content = false;
    if (!boundId) { try { content = activeContent(); } catch (e) { console.error('the content test failed', e); content = true; } } // unreadable = assume content: never close it silently
    return promptFor(boundId, content, saveOk);
  }
  const notSavedYet = () => new Error('This design is not saved yet. Save it with a name first (Save as…), or undo / clear it.');
  const refuseIfUnsaved = () => { if (needsSavePrompt() === 'unsaved') throw notSavedYet(); };

  /** A tab of the SHARED buffer as a record of this page (TASK 684). Its baselines (lastSig, and an Untitled's emptySig) are left undefined: they
   *  are taken when the tab is shown, by THIS app (bringIn); an Untitled the buffer says has content gets HAS_CONTENT instead (it asks when closed). */
  // (a TASK 624 per-app buffer was converted to this form by the store's first read: project-store.js mergeLegacyBuffers)
  function recordFromBuffer(t, key, { designId = null, name: n = t.name, doc = t.doc } = {}) {
    const content = !designId && !!t.content;
    const file = !designId && t.file && t.file.name ? { name: String(t.file.name), handle: null } : null; // TASK 759: a file home comes back by its name only
    return { key, designId, name: n || UNTITLED, content, emptySig: designId ? null : (content ? HAS_CONTENT : undefined), saveOk: true, lastSig: undefined, doc, view: t.view || null, hostSessions: t.hostSessions || {}, file };
  }

  /** The initial restore (TASK 684): the tabs of the SHARED buffer (whichever app wrote them; a stored design from the store, an Untitled from the buffer),
   *  plus the current design when the buffer does not hold it (another page set it), which then shows; nothing = an unsaved Untitled. */
  async function restore() {
    try {
      let design = null;
      try { design = await store.loadCurrent({ app }); } catch (e) { console.error('the current design could not be read', e); design = null; } // best-effort: boot with an empty sketch
      let bufSnap = null;
      try { bufSnap = store.readBuffer ? await store.readBuffer({ app }) : null; } catch (e) { console.error('the open-tabs working buffer could not be read', e); bufSnap = null; }
      let curId = design ? design.id : null;
      if (!curId && store.currentId) { try { curId = await store.currentId(); } catch (_) { curId = null; } }
      const restoredTabs = [];
      const ids = new Set();
      for (const t of (bufSnap && Array.isArray(bufSnap.tabs) ? bufSnap.tabs : [])) {
        if (!t) continue;
        const key = t.key ? String(t.key) : newKey();
        base.set(key, tabSig(t)); // held by this page from now on: a tab dropped below is dropped from the buffer too (mergeTabBuffers)
        if (!t.designId) {
          if (!validateDocument(t.doc).ok) continue;
          restoredTabs.push(recordFromBuffer(t, key));
          continue;
        }
        const sid = store.resolveId ? store.resolveId(t.designId) : t.designId;
        let d = (design && (design.id === sid || design.id === t.designId)) ? design : null;
        let unreadable = false;
        if (!d) {
          try { d = await store.get(sid); } catch (_) { unreadable = true; }
        }
        if (!d && !unreadable) continue; // deleted on Drive out-of-band (with no local shadow): do not resurrect
        const id = d ? d.id : sid;
        if (ids.has(id)) continue; // a stored design is open once
        const doc = d ? d.document : t.doc;
        if (!validateDocument(doc).ok) continue;
        ids.add(id);
        restoredTabs.push(recordFromBuffer(t, key, { designId: id, name: d ? d.name : t.name, doc }));
      }
      let target = restoredTabs.find((x) => x.key === (bufSnap && bufSnap.activeKey)) || restoredTabs[0] || null;
      if (design && !ids.has(design.id) && validateDocument(design.document).ok) { // current, but not among the buffer's tabs: it opens as a tab of its own and shows
        target = recordFromBuffer({ hostSessions: {} }, newKey(), { designId: design.id, name: design.name, doc: design.document });
        restoredTabs.push(target);
      }
      if (!target) { bindUntitled(); return { restored: false, hosts: {} }; } // nothing open, nothing current: the page shows an unsaved Untitled
      tabList.length = 0;
      tabList.push(...restoredTabs);
      const out = bringIn(target, 'restore');
      if (boundId !== curId && store.setCurrent) { try { await store.setCurrent(boundId); } catch (e) { console.error('the current design pointer could not be set', e); } }
      return out;
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
  async function newDesign(template = null) { refuseIfUnsaved(); await flush(); await store.setCurrent(null); const out = loadUntitled('new', template); await saveWorkingBuffer(); return out; }
  /** Save as: on an unsaved Untitled, the FIRST NAMED SAVE (it is stored under `newName`, and autosaves from then on); on a stored design,
   *  a copy under `newName` that becomes the bound one (unchanged). */
  async function saveAs(newName) {
    if (!boundId) {
      const doc = fullDoc();
      const sig = docChangeSig(doc);
      const d = await store.newDesign(newName, { app, document: doc }); // stored, named, current in one write; every app's sidecar goes with it (TASK 684)
      boundId = d.id; name = d.name; emptySig = null; saveOk = true; fileHome = null; resetHostBaseline(docHasOwnHost(doc.hosts)); lastSig = sig;
      notify('saved');
      await saveWorkingBuffer();
      track('drive:save'); // TASK 738
      return d;
    }
    await flush();
    const p = await store.saveAs(newName, { app, fromId: boundId });
    boundId = p.id; name = p.name; lastSig = sigNow();
    await saveWorkingBuffer();
    track('drive:save'); // TASK 738
    return p;
  }
  /** Save a design to a file: `designId` (a design picked in the project manager), else the shown one: the bound design, or the unsaved
   *  Untitled's in-memory document (a file is not the project store: the save rule does not apply). */
  async function saveFile(seam = browserFileSeam, designId) {
    if (designId || boundId) { await flush(); return store.exportFile(designId || boundId, seam); }
    return seam.save(serializeProjectFile({ app, name, document: fullDoc() }), projectFileName(name));
  }
  /** "Don't save": the unsaved Untitled is thrown away (an empty Untitled takes its place), so the action the user asked for can go on.
   *  A stored design is never discarded (it is autosaved). */
  function discardUnsaved() { if (!boundId) { loadUntitled('new'); saveWorkingBuffer(); } }
  // ---- TASK 759: a design whose home is a FILE on this device (no account, no store) ------------------------------------------------
  /** The text of the design file as it is written now: the SAME bytes a Drive save of this design writes (#ui/cloud/drive-adapter.js stores
   *  serializeProjectFile of the design), every app's sidecar included. */
  const fileText = (n) => serializeProjectFile({ app, name: n, document: fullDoc() });
  /** Read a design file through `seam` (the picker / an <input type=file> / a dropped file): { file, name, document }, null = cancelled. A bad or newer
   *  file throws ProjectFileError (a readable message); nothing changed then. The seam is called before any await (the browser's picker needs the click). */
  async function readFile(seam) {
    const f = await seam.open();
    if (!f) return null;
    const parsed = parseProjectFile(f.text);
    return { file: { name: f.name, handle: f.handle || null }, name: designNameOfFile(f.name), document: parsed.document };
  }
  /** Replace the app state with a design read from a file: unbound, its file is its home, and its baseline is the file's content (no dot). */
  function loadFile(p) {
    const result = deserializeDocument(p.document, state);
    if (!result.ok) throw new Error(`This file could not be opened: ${result.reason}`);
    boundId = null; name = p.name; saveOk = true; fileHome = p.file;
    foreign = splitHosts(result.hosts); otherSessions = {};
    const out = restored({ restored: true, hosts: result.hosts, name, reason: 'file', removedVcarves: result.removedVcarves });
    resetHostBaseline(docHasOwnHost(result.hosts));
    lastSig = sigNow(); emptySig = fullSigNow(); // taken AFTER the host applied the file's sidecar: showing the file is not a change
    return out;
  }
  /** Open from file (no tabs): the file's design replaces the shown one (an unsaved one refuses, as Open does). Nothing is stored in the project store. */
  async function openFile(seam = browserFileSeam) {
    refuseIfUnsaved();
    const p = await readFile(seam);
    if (!p) return null;
    await flush();
    await store.setCurrent(null);
    const out = loadFile(p);
    await saveWorkingBuffer();
    track('local:open'); // TASK 759
    return out;
  }
  /** Save as > Local: write the shown design to a NEW file the user names (`newName`; the picker or a download). The file becomes the design's home: a design
   *  that was on Drive keeps its last saved state there and this tab now edits the file. Resolves { name, handle, downloaded } or null (cancelled). */
  async function saveToFile(newName, seam = browserFileSeam) {
    const n = String(newName == null ? '' : newName).trim();
    if (!n) throw new Error('A design needs a name.');
    const r = await seam.save(fileText(n), projectFileName(n));
    if (!r) return null;
    if (boundId) await flush(); // the stored design keeps everything up to now
    boundId = null; saveOk = true;
    fileHome = { name: r.name, handle: r.handle || null };
    name = designNameOfFile(r.name);
    emptySig = fullSigNow(); lastSig = sigNow();
    await store.setCurrent(null);
    notify('idle');
    await saveWorkingBuffer();
    track('local:save'); // TASK 759
    return { name: r.name, handle: fileHome.handle, downloaded: !r.handle };
  }
  /** Save to the file home (Save, Ctrl+S): back into the same file through its handle; a handle the browser refuses or none (a reload, a browser without the
   *  picker) -> the picker again where there is one, else a download under the same name. Resolves { route: 'write-back' | 'repick' | 'download', name } or
   *  null (the picker was cancelled: nothing changed). */
  async function saveHome(seam = browserFileSeam) {
    if (!fileHome) throw new Error('This design has no file on this device to save to.');
    const sig = fullSigNow();
    const text = fileText(name);
    let r = null, route = 'write-back';
    if (fileHome.handle) r = await seam.write(fileHome.handle, text);
    if (!r) { r = await seam.save(text, fileHome.name || projectFileName(name)); route = r && r.handle ? 'repick' : 'download'; }
    if (!r) return null;
    fileHome = { name: r.name, handle: r.handle || null };
    emptySig = sig; // clean as of the bytes written (an edit made while the write ran keeps the dot)
    await saveWorkingBuffer();
    track('local:save'); // TASK 759
    return { route, name: r.name };
  }
  /** Rename an UNBOUND design (an Untitled or a file home) in this page: the name its next save uses. A stored design is renamed in the store instead. */
  async function rename(newName) {
    const n = String(newName == null ? '' : newName).trim();
    if (!n) throw new Error('A design needs a name.');
    if (boundId) throw new Error('A saved design is renamed in its project.');
    name = n;
    await saveWorkingBuffer();
    return n;
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
    Object.assign(active, {
      designId: boundId, name, emptySig, saveOk, lastSig, hasOwnSidecar, file: fileHome,
      content: activeContent(),
      doc: fullDoc(),
      history: state.history, redoStack: state.redoStack,
      view: state.view ? { ...state.view } : null,
      hostSessions: withOwn(otherSessions, session ? session.capture() : undefined),
    });
    if (Array.isArray(state.history)) { state.history = []; state.redoStack = []; }
  }
  /** Make record `rec` the active one, loading its document, history, view and THIS app's session of it into the state (`reason` 'switch', or
   *  'restore' for the initial restore: a tab without a session of this app then leaves the fresh page's session as it is). */
  function bringIn(rec, reason = 'switch') {
    active = rec;
    const result = deserializeDocument(rec.doc, state);
    foreign = splitHosts(result.hosts);
    const sessions = rec.hostSessions || {};
    otherSessions = withOwn(sessions, undefined);
    boundId = rec.designId || null; name = rec.name; emptySig = boundId ? null : rec.emptySig; saveOk = rec.saveOk !== false; lastSig = rec.lastSig;
    fileHome = boundId ? null : (rec.file || null);
    const knownOwn = rec.hasOwnSidecar;
    if (Array.isArray(rec.history)) { state.history = rec.history; state.redoStack = rec.redoStack; }
    if (rec.view && state.view) Object.assign(state.view, rec.view);
    for (const k of TAB_BUFFER_FIELDS) delete rec[k];
    const out = restored({ restored: true, hosts: result.hosts || {}, name, reason, removedVcarves: result.removedVcarves });
    if (session && (reason !== 'restore' || sessions[app] !== undefined)) session.restore(sessions[app]);
    resetHostBaseline(knownOwn !== undefined ? knownOwn : docHasOwnHost(result.hosts));
    // a tab from the shared buffer (another app, an earlier page): its baselines are THIS app's signatures, taken now that it shows (TASK 684). An empty
    // Untitled's baseline is the document as shown, so it has no dot; the autosave baseline is the shown design, so showing it never writes it.
    if (lastSig === undefined) lastSig = sigNow();
    if (!boundId && emptySig === undefined) emptySig = fullSigNow();
    if (typeof state._notifyHistory === 'function') state._notifyHistory();
    notify(boundId ? (saveOk ? 'saved' : 'error') : 'idle'); // the host's status text follows the tab now shown (an unsaved Untitled writes nothing: empty)
    return out;
  }
  /** A fresh tab record becomes active with an empty unsaved Untitled (its history starts empty). */
  function bringInUntitled(template = null) {
    active = newRecord();
    if (Array.isArray(state.history)) { state.history = []; state.redoStack = []; }
    const out = loadUntitled('new', template);
    if (session) {
      session.restore(undefined);
      resetHostBaseline(hasOwnSidecar);
      lastSig = sigNow();
      if (!template) emptySig = fullSigNow();
    }
    if (typeof state._notifyHistory === 'function') state._notifyHistory();
    notify('idle');
    return out;
  }
  // TASK 759: a design just opened from a file (a file home) is not an empty Untitled: it is never reused
  const untouchedUntitled = () => !boundId && !fileHome && !activeContent() && !(state.history && state.history.length) && !(state.redoStack && state.redoStack.length);
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
      ? { key: t.key, designId: boundId, name, active: true, stored: !!boundId, needsSavePrompt: needsSavePrompt(), home: homeOf({ designId: boundId, file: fileHome }) }
      : { key: t.key, designId: t.designId || null, name: t.name, active: false, stored: !!t.designId, needsSavePrompt: promptFor(t.designId, t.content, t.saveOk !== false), home: homeOf({ designId: t.designId, file: t.file }) }));
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
    if (!reuse && session) { session.restore(undefined); resetHostBaseline(hasOwnSidecar); lastSig = sigNow(); }
    if (typeof state._notifyHistory === 'function') state._notifyHistory();
    notify('saved');
    await saveWorkingBuffer();
    return out;
  }
  /** Open from file into a NEW tab (T2): the file's design opens as a tab whose home is that file (TASK 759: nothing is stored in the project store, no
   *  account is needed); the active tab an untouched Untitled -> it is reused. The tab limit is checked BEFORE the file is read. */
  async function openFileTab(seam = browserFileSeam) {
    if (tabList.length >= MAX_TABS && !untouchedUntitled()) throw full();
    const p = await readFile(seam);
    if (!p) return null;
    const reuse = untouchedUntitled();
    if (!reuse) {
      await putAside();
      active = newRecord(); tabList.push(active);
    } else await poll();
    const out = loadFile(p);
    if (!reuse && session) { session.restore(undefined); resetHostBaseline(hasOwnSidecar); lastSig = sigNow(); emptySig = fullSigNow(); }
    if (typeof state._notifyHistory === 'function') state._notifyHistory();
    notify('idle');
    await store.setCurrent(null);
    await saveWorkingBuffer();
    track('local:open'); // TASK 759
    return out;
  }
  /** New design in a NEW tab (T3): an unsaved Untitled, or one started from a template { name, document } (TASK 651). */
  async function newTab(template = null) {
    if (tabList.length >= MAX_TABS) throw full();
    await putAside();
    const out = bringInUntitled(template);
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
    restore, ready, start, stop, flush, openDesign, newDesign, saveAs, saveFile, saveToFile, saveHome, rename, openFile, followMoves,
    designId: () => boundId, designName: () => name, isStored: () => !!boundId, needsSavePrompt, discardUnsaved,
    home: () => homeOf({ designId: boundId, file: fileHome }),
    tabs, openTab, openFileTab, newTab, activate, closeTab, store,
  };
}
