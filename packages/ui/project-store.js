// packages/ui/project-store.js — PROJECTS (folders) and DESIGNS (documents) on top of the document format (TASK 474).
//
// Before: ONE autosave slot per browser (document-buffer.js on IndexedDB) = no names, no folders, no recent list, no files.
// Now (the Fusion 360 Data Panel model, owner's reference):
//   PROJECT = a folder   { id, name, pinned, updatedAt }
//   DESIGN  = a document { id, projectId, name, app, updatedAt, document }  — `document` is #core's serializeDocument output with
//             its host sidecars (document.hosts.<app>); a design lives in exactly one project.
// Plus a "current design" pointer (the design autosave writes into; global, so the cross-app carry still works: another app
// opens the same current design) and the operations a sidebar needs.
//
// WHY a new module and not an extension of document-buffer.js: the buffer is the AUTOSAVE LOOP (poll the app state, restore
// it into the app, status callbacks) and stays that; the store is the STORAGE + project/design model with no knowledge of
// app state. The buffer writes through the store, so there is one write path.
//
// STORAGE ADAPTER interface (all async; a REMOTE backend such as Google Drive is a second adapter, a project maps to a
// remote folder, a design to a file there; nothing above this seam changes):
//   projects: listProjects() -> [project]; getProject(id); putProject(p); putProjectIfAbsent(p) -> boolean;
//             updateProject(id, fn) -> stored | null; deleteProject(id)
//   designs:  listDesigns() -> [{ id, projectId, name, app, updatedAt }] (no bodies); getDesign(id) -> full | null;
//             putDesign(d); putDesignIfAbsent(d) -> boolean; updateDesign(id, fn) -> stored | null; deleteDesign(id)
//   meta:     getMeta(key); setMeta(key, value|null); setMetaIfAbsent(key, value) -> boolean   (the current pointer, flags)
//   update*(id, fn): fn(recordOrNull) returns the new record (or null = delete) and runs ATOMICALLY (IndexedDB: one transaction).
//   OPTIONAL hooks a remote adapter implements (the store uses them when present, nothing else changes):
//     newId(kind: 'p'|'d') -> id | Promise<id>   ids are OPAQUE strings the adapter owns (Drive: files.generateIds); only the local
//                                                  default project / migrated design use the fixed ids above
//     onChange(fn)                               the adapter calls fn() when the REMOTE changed (polling / push); the store then
//                                                  notifies its subscribers, so a recent list refreshes without a reload
// A remote adapter keeps meta (the "current design" pointer, flags) LOCAL to the device (delegate getMeta/setMeta/setMetaIfAbsent to
// the IndexedDB adapter): which design this browser has open is not a property of the shared library. For a remote update*, "atomic"
// means optimistic concurrency (compare the remote version / etag, re-read and retry), and a design's `updatedAt` is the remote
// modified time. A remote adapter is only ever INSTALLED by an explicit user choice (signing in does not swap the adapter).
// TASK 506 (Drive first): the router adapter ALSO places NEW projects / designs on Drive while signed in with the "Save to Google
// Drive by default" setting on, through three more OPTIONAL hooks the store uses when present:
//     isRemote(id) -> boolean                          does this id live on the remote? (autosave then goes through the throttled writer below)
//     newId(kind, projectId?, { local }?)              (extended) a design id follows its project; local:true forces this device
//     defaultProject({ id, name, now, local }) -> id   the default project: the ONE remote one while preferred, else the fixed local one
// A remote design autosave is THROTTLED (one write per 5 s), keeps a LOCAL copy (meta driveShadow:<id>) until Drive confirmed it,
// and retries with backoff (#ui/cloud/drive-writer.js). If Drive was wanted for something NEW and failed, the store falls back to this
// device and remembers why (status()), so nothing is ever lost and nothing is silent.
// NO CLOCK DECIDES ANYTHING: every write to / recovery of a Drive design compares Drive's own `version` with the version the local edit was
// based on (`bases`, persisted as meta driveBase:<id>). Equal = a plain overwrite. Different (another device / tab changed it) = the local
// content is written as a SEPARATE Drive file "<name> (conflicted copy <date time>)", the Drive version stays the design, and the sidebar
// says so; the local copy is dropped only after it was written (to the design or to the copy). Optional adapter hook listMetaKeys(prefix)
// lets the store find unconfirmed local copies left by a closed tab and send them through the same rule at start.
//
// The 458 rule is kept per design: a save replaces only the host sidecars it owns and passes every other host through.

import { DOCUMENT_VERSION } from '#core/document.js';
import { serializeProjectFile, parseProjectFile, projectFileName, browserFileSeam } from '#ui/project-file.js';
import { createRouterAdapter, CURRENT_DESIGN_KEY } from '#ui/cloud/router-adapter.js';
import { createDriveAdapter, driveErrorText } from '#ui/cloud/drive-adapter.js';
import { createDriveWriter } from '#ui/cloud/drive-writer.js';
import { getGoogleAccount } from '#ui/cloud/google-account.js';

const CURRENT = CURRENT_DESIGN_KEY;
const OPEN_TABS_BUFFER = 'openTabsBuffer';
const LEGACY_MIGRATED = 'legacyMigrated';
const BASE = 'driveBase:';     // meta key: the Drive `version` a design's local edits are based on (what a recovery compares with)
const SHADOW = 'driveShadow:'; // meta key of the LOCAL copy of a design that lives on Drive and has a write not yet confirmed (the safety net)
// Fixed ids: a second tab migrating at the same moment is a no-op (putIfAbsent), never a second copy.
export const DEFAULT_PROJECT_ID = 'my-designs';
export const DEFAULT_PROJECT_NAME = 'My Designs'; // neutral and user-facing; "Untitled" is kept for the migrated DESIGN itself
export const LEGACY_DESIGN_ID = 'untitled-legacy';

const clone = (o) => JSON.parse(JSON.stringify(o));
const designMeta = (d) => ({ id: d.id, projectId: d.projectId, name: d.name, app: d.app, updatedAt: d.updatedAt });
export const emptyDocument = () => ({ version: DOCUMENT_VERSION, geometry: { joints: [], shapes: [], constraints: [] }, hosts: {} });

// ---- adapters ---------------------------------------------------------------------------------------------------------
export function createMemoryAdapter() {
  const projects = new Map();
  const designs = new Map();
  const meta = new Map();
  const upd = (map, id, fn) => {
    const next = fn(map.has(id) ? clone(map.get(id)) : null);
    if (next == null) { map.delete(id); return null; }
    map.set(id, clone(next)); return clone(next);
  };
  const ifAbsent = (map, r) => { if (map.has(r.id)) return false; map.set(r.id, clone(r)); return true; };
  return {
    async listProjects() { return [...projects.values()].map(clone); },
    async getProject(id) { return projects.has(id) ? clone(projects.get(id)) : null; },
    async putProject(p) { projects.set(p.id, clone(p)); },
    async putProjectIfAbsent(p) { return ifAbsent(projects, p); },
    async updateProject(id, fn) { return upd(projects, id, fn); },
    async deleteProject(id) { projects.delete(id); },
    async listDesigns() { return [...designs.values()].map(designMeta); },
    async getDesign(id) { return designs.has(id) ? clone(designs.get(id)) : null; },
    async putDesign(d) { designs.set(d.id, clone(d)); },
    async putDesignIfAbsent(d) { return ifAbsent(designs, d); },
    async updateDesign(id, fn) { return upd(designs, id, fn); },
    async deleteDesign(id) { designs.delete(id); },
    async listMetaKeys(prefix) { return [...meta.keys()].filter((k) => String(k).startsWith(prefix)); },
    async getMeta(k) { return meta.has(k) ? meta.get(k) : null; },
    async setMeta(k, v) { if (v == null) meta.delete(k); else meta.set(k, v); },
    async setMetaIfAbsent(k, v) { if (meta.has(k) && meta.get(k) != null) return false; meta.set(k, v); return true; },
  };
}

const PROJECTS_DB = 'sketch-studio-projects';
export function createIdbAdapter() {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('indexedDB unavailable')); return; }
    const req = indexedDB.open(PROJECTS_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('projects', { keyPath: 'id' });     // folders
      db.createObjectStore('designs', { keyPath: 'id' });      // full documents
      db.createObjectStore('designIndex', { keyPath: 'id' });  // {id,projectId,name,app,updatedAt} only: listing never loads a document
      db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
  const req2p = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const txDone = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
  return {
    async listProjects() { const db = await open(); return req2p(db.transaction('projects').objectStore('projects').getAll()); },
    async getProject(id) { const db = await open(); return (await req2p(db.transaction('projects').objectStore('projects').get(id))) || null; },
    async putProject(p) { const db = await open(); const tx = db.transaction('projects', 'readwrite'); tx.objectStore('projects').put(p); await txDone(tx); },
    async putProjectIfAbsent(p) {
      const db = await open(); const tx = db.transaction('projects', 'readwrite'); let added = false;
      const g = tx.objectStore('projects').get(p.id);
      g.onsuccess = () => { if (!g.result) { added = true; tx.objectStore('projects').put(p); } };
      await txDone(tx); return added;
    },
    async updateProject(id, fn) {
      const db = await open(); const tx = db.transaction('projects', 'readwrite'); let out = null;
      const g = tx.objectStore('projects').get(id);
      g.onsuccess = () => {
        const next = fn(g.result || null);
        if (next == null) tx.objectStore('projects').delete(id); else { tx.objectStore('projects').put(next); out = next; }
      };
      await txDone(tx); return out;
    },
    async deleteProject(id) { const db = await open(); const tx = db.transaction('projects', 'readwrite'); tx.objectStore('projects').delete(id); await txDone(tx); },

    async listDesigns() { const db = await open(); return req2p(db.transaction('designIndex').objectStore('designIndex').getAll()); },
    async getDesign(id) { const db = await open(); return (await req2p(db.transaction('designs').objectStore('designs').get(id))) || null; },
    async putDesign(d) {
      const db = await open(); const tx = db.transaction(['designs', 'designIndex'], 'readwrite');
      tx.objectStore('designs').put(d); tx.objectStore('designIndex').put(designMeta(d)); await txDone(tx);
    },
    async putDesignIfAbsent(d) {
      const db = await open(); const tx = db.transaction(['designs', 'designIndex'], 'readwrite'); let added = false;
      const g = tx.objectStore('designs').get(d.id);
      g.onsuccess = () => { if (!g.result) { added = true; tx.objectStore('designs').put(d); tx.objectStore('designIndex').put(designMeta(d)); } };
      await txDone(tx); return added;
    },
    async updateDesign(id, fn) {
      const db = await open(); const tx = db.transaction(['designs', 'designIndex'], 'readwrite'); let out = null;
      const g = tx.objectStore('designs').get(id);
      g.onsuccess = () => {
        const next = fn(g.result || null);
        if (next == null) { tx.objectStore('designs').delete(id); tx.objectStore('designIndex').delete(id); }
        else { tx.objectStore('designs').put(next); tx.objectStore('designIndex').put(designMeta(next)); out = next; }
      };
      await txDone(tx); return out;
    },
    async deleteDesign(id) {
      const db = await open(); const tx = db.transaction(['designs', 'designIndex'], 'readwrite');
      tx.objectStore('designs').delete(id); tx.objectStore('designIndex').delete(id); await txDone(tx);
    },

    async listMetaKeys(prefix) { const db = await open(); return req2p(db.transaction('meta').objectStore('meta').getAllKeys(IDBKeyRange.bound(prefix, prefix + '￿'))); },
    async getMeta(k) { const db = await open(); const v = await req2p(db.transaction('meta').objectStore('meta').get(k)); return v === undefined ? null : v; },
    async setMeta(k, v) {
      const db = await open(); const tx = db.transaction('meta', 'readwrite');
      if (v == null) tx.objectStore('meta').delete(k); else tx.objectStore('meta').put(v, k); await txDone(tx);
    },
    async setMetaIfAbsent(k, v) {
      const db = await open(); const tx = db.transaction('meta', 'readwrite'); let set = false;
      const g = tx.objectStore('meta').get(k);
      g.onsuccess = () => { if (g.result == null) { set = true; tx.objectStore('meta').put(v, k); } };
      await txDone(tx); return set;
    },
  };
}

/** The pre-474 autosave slot (IndexedDB 'sketch-studio-documents' / 'kv' / 'current'). READ-ONLY: never written or deleted here. */
export async function readLegacySlot() {
  try {
    if (typeof indexedDB === 'undefined') return null;
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('sketch-studio-documents', 1);
      req.onupgradeneeded = () => { try { req.result.createObjectStore('kv'); } catch (_) {} };
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
    return await new Promise((resolve) => {
      const g = db.transaction('kv').objectStore('kv').get('current');
      g.onsuccess = () => resolve(g.result || null); g.onerror = () => resolve(null);
    });
  } catch (_) { return null; } // unreadable slot = nothing to migrate; the slot itself stays untouched
}

// ---- the store ---------------------------------------------------------------------------------------------------------
/**
 * createProjectStore({ adapter, legacySource, idFn, now, channel }) -> store. Defaults: IndexedDB adapter, the real legacy
 * slot, random ids, Date.now, a BroadcastChannel for cross-tab change events (all injectable for tests).
 */
export function createProjectStore({ adapter = createIdbAdapter(), legacySource = readLegacySlot, idFn, now = () => Date.now(), channel, setTimer, clearTimer, driveWrites = {} } = {}) {
  const newId = idFn || (adapter.newId ? (kind, projectId, opts) => adapter.newId(kind, projectId, opts) : ((prefix = 'd') => prefix + '_' + now().toString(36) + Math.random().toString(36).slice(2, 8)));
  const isRemote = (id) => !!(adapter.isRemote && adapter.isRemote(id));
  const listeners = new Set();
  const bc = channel !== undefined ? channel : (typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('sketch-studio-projects') : null);
  if (bc) bc.onmessage = () => { for (const fn of [...listeners]) { try { fn(); } catch (_) {} } };
  if (adapter.onChange) adapter.onChange(() => { for (const fn of [...listeners]) { try { fn(); } catch (_) {} } }); // a REMOTE change (optional hook)
  const notifyLocal = () => { for (const fn of [...listeners]) { try { fn(); } catch (_) {} } };
  const changed = () => {
    notifyLocal();
    try { if (bc) bc.postMessage('changed'); } catch (_) {}
  };

  // ---- Drive-first bookkeeping (TASK 506) ----
  const headers = new Map(); // remote design id -> { projectId, name, app, updatedAt }: the sidebar name / status never re-download a file
  const rememberHeader = (d) => { if (d && isRemote(d.id)) headers.set(d.id, { projectId: d.projectId, name: d.name, app: d.app, updatedAt: d.updatedAt }); };
  const bases = new Map();   // remote design id -> the Drive version the local edits are based on
  const setBase = async (id, version) => { if (version == null) bases.delete(id); else bases.set(id, version); await adapter.setMeta(BASE + id, version == null ? null : version); };
  /** A design record read from / written to Drive: remember its header and the Drive version it now has. */
  const adoptRemote = async (d, version = d && d.version) => { if (d && isRemote(d.id)) { rememberHeader(d); await setBase(d.id, version); } };
  const notices = new Map(); // design id ('' = none open) -> { text }: a one-off explanation the sidebar shows (a conflicted copy, a re-created design)
  const moved = new Map();   // a remote design id that was re-created under a new id -> the new id (a buffer still bound to the old one follows)
  const resolveMoved = (id) => { while (id && moved.has(id)) id = moved.get(id); return id; };
  const adoptTried = new Set();
  const conflictListeners = new Set();
  const copies = new Map();  // remote design id -> { foreign, copyId, name }: the conflicted copy kept for that Drive version (one per version, updated, never duplicated)
  const locks = new Map();   // remote design id -> tail of the chain of Drive reads / writes of that design (they never overlap)
  const loads = new Map();   // remote design id -> the loadDesign run in flight (concurrent callers share it)
  let orphansDone = false;
  /** Run fn after every earlier Drive read / write of design `id` finished (a read never sees our own write half done). */
  function withLock(id, fn) {
    const run = (locks.get(id) || Promise.resolve()).then(fn);
    const tail = run.then(() => {}, () => {}); // the chain only orders; the caller gets fn's own result / error through `run`
    locks.set(id, tail);
    tail.then(() => { if (locks.get(id) === tail) locks.delete(id); });
    return run;
  }
  /** Everything this device keeps about a design that is gone on purpose (deleted, or its project moved / deleted): it can never come back. */
  async function forgetRemote(id) {
    for (const [k, v] of moved) if (k === id || v === id) moved.delete(k);
    writer.cancel(id);
    await adapter.setMeta(SHADOW + id, null); await setBase(id, null);
    headers.delete(id); adoptTried.delete(id); copies.delete(id);
  }
  let transientReason = null; // transient read failure during loadCurrent (e.g. offline/signed-out while opening a Drive design)
  const translateOfflineError = (e) => {
    if (adapter.isRemote && e && (e instanceof TypeError || e.message === 'cloud-unavailable' || (typeof navigator !== 'undefined' && navigator.onLine === false))) {
      return new Error("Google Drive can't be reached; your drawing is kept, try again when online");
    }
    return e;
  };
  if (adapter.cloud && adapter.cloud.onSignInChange) adapter.cloud.onSignInChange(() => { if (adapter.cloud.signedIn()) writer.resume(); }); // held writes go on at once
  const writer = createDriveWriter({
    now, ...(setTimer ? { setTimer } : {}), ...(clearTimer ? { clearTimer } : {}), describeError: driveErrorText, ...driveWrites,
    write: (id, p, isCancelled) => withLock(id, () => writeRemote(id, p, isCancelled)),
    canWrite: () => !(adapter.cloud && adapter.cloud.signedIn) || adapter.cloud.signedIn(), // signed out: no attempts, no retry timers
    keepLocal: (id, p) => adapter.setMeta(SHADOW + id, { ...(headers.get(id) || {}), id, app: p.app, updatedAt: p.updatedAt, document: p.document }),
    dropLocal: (id) => adapter.setMeta(SHADOW + id, null),
    onStatus: () => notifyLocal(),
    onWritten: () => changed(),
  });

  const cleanName = (name, what = 'design') => { const n = String(name == null ? '' : name).trim(); if (!n) throw new Error(`A ${what} needs a name.`); return n; };
  const mergeHosts = (stored, incoming) => ({ ...incoming, hosts: { ...((stored && stored.hosts) || {}), ...((incoming && incoming.hosts) || {}) } });
  const gone = (what) => new Error(`That ${what} no longer exists.`);

  /** Make sure the default project exists and return its id (`local: true` = on this device whatever the adapter prefers). */
  async function defaultProjectId({ local = false } = {}) {
    if (adapter.defaultProject) return adapter.defaultProject({ id: DEFAULT_PROJECT_ID, name: DEFAULT_PROJECT_NAME, now, local });
    await adapter.putProjectIfAbsent({ id: DEFAULT_PROJECT_ID, name: DEFAULT_PROJECT_NAME, pinned: false, updatedAt: now() });
    return DEFAULT_PROJECT_ID;
  }
  /** A design record, the way the app should open it. A design on Drive with a local copy not yet confirmed there (its write failed, or the
   *  tab closed first) opens from that copy and queues the write again: nothing typed is lost. A design that cannot be read at all
   *  (signed out, offline) opens from its local copy when there is one, else the read error is thrown. */
  function loadDesign(id) {
    id = resolveMoved(id);
    if (!isRemote(id)) return adapter.getDesign(id);
    if (loads.has(id)) return loads.get(id).then(clone); // concurrent callers share ONE run (one copy / one re-creation at most)
    const run = withLock(id, () => loadRemote(id));
    loads.set(id, run);
    const done = () => { if (loads.get(id) === run) loads.delete(id); };
    run.then(done, done);
    return run;
  }
  async function loadRemote(id) {
    let d = null, err = null;
    try { d = await adapter.getDesign(id); } catch (e) { err = e; }
    const shadow = await adapter.getMeta(SHADOW + id); // read AFTER the Drive read: an autosave that landed meanwhile has already replaced it
    const mine = writer.unconfirmed(id) || (shadow && { app: shadow.app, document: shadow.document, updatedAt: shadow.updatedAt });
    if (writer.hasPending(id) && mine) { // the writer already owns this design (a queued / in-flight / just-confirmed write): it applies the version rule itself
      const h = headers.get(id) || {};
      const sd = { id, projectId: (d && d.projectId) || h.projectId, name: (d && d.name) || h.name || 'Untitled', app: mine.app, updatedAt: mine.updatedAt, document: mine.document };
      rememberHeader(sd);
      return sd; // the NEWEST local content, not the (possibly older) kept copy
    }
    const content = shadow && { app: shadow.app, document: shadow.document, updatedAt: shadow.updatedAt };
    const base = await adapter.getMeta(BASE + id);
    if (err) { // cannot read Drive (offline, signed out, 5xx): open the local copy if there is one; the version is checked when it is written
      if (!shadow) throw err;
      const sd = { id, projectId: shadow.projectId, name: shadow.name || 'Untitled', app: shadow.app, updatedAt: shadow.updatedAt, document: shadow.document };
      rememberHeader(sd); if (base != null) bases.set(id, base); else bases.delete(id);
      await writer.queue(id, content);
      return sd;
    }
    if (!d) { // gone from Drive (trashed / deleted): permanent. A local copy is saved again as a NEW file; without one there is nothing to open
      if (!shadow) return null;
      const nd = await recreate(id, content, shadow);
      return nd;
    }
    if (!shadow) { await adoptRemote(d); writer.seed(id, d.updatedAt); return d; }
    if (base != null && base === d.version) { // Drive still has the version the unsaved edit was based on: the edit carries on from the local copy
      await adoptRemote(d);
      await writer.queue(id, content);
      return { ...d, app: shadow.app, updatedAt: shadow.updatedAt, document: shadow.document };
    }
    await keepConflictedCopy(d, content);  // Drive changed since (or the base is unknown): keep the local edit as a separate file, open Drive's version
    await adapter.setMeta(SHADOW + id, null);
    writer.cancel(id);
    await adoptRemote(d); writer.seed(id, d.updatedAt);
    return d;
  }
  const stamp = () => {
    const t = new Date(now()), p = (n) => String(n).padStart(2, '0');
    return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}-${p(t.getMinutes())}`;
  };
  /** The local edit of a design Drive has since changed: written as a SEPARATE file next to it, never over it, never dropped. */
  async function keepConflictedCopy(rec, content) {
    const prior = copies.get(rec.id);
    const again = prior && prior.foreign === rec.version; // the SAME Drive version again (a newer local edit): update that copy, never a second one
    const name = again ? prior.name : `${rec.name} (conflicted copy ${stamp()})`;
    const copy = { id: again ? prior.copyId : await newId('d', rec.projectId), projectId: rec.projectId, name, app: content.app || rec.app, updatedAt: content.updatedAt, document: mergeHosts(rec.document, content.document) };
    await adoptRemote(copy, await adapter.putDesign(copy));
    copies.set(rec.id, { foreign: rec.version, copyId: copy.id, name });
    notices.set(rec.id, { text: `Another device changed this design. Your unsaved changes were kept as "${name}".` });
    changed();
    return copy;
  }
  /** A design that no longer exists on Drive, with unsaved content: saved again as a NEW file in the same Drive folder (or, when
   *  the Drive folder is gone too, recreated in "My Designs" on Drive); the current pointer follows. `h` = { projectId, name, app }. */
  async function recreate(id, content, h) {
    let pid = h.projectId;
    if (!pid || !isRemote(pid) || !(await adapter.getProject(pid))) pid = await defaultProjectId({ local: false });
    const nd = { id: await newId('d', pid, { local: false }), projectId: pid, name: h.name || 'Untitled', app: content.app || h.app || null, updatedAt: content.updatedAt, document: content.document };
    const version = await adapter.putDesign(nd);
    await touchProject(pid, content.updatedAt);
    await adoptRemote(nd, version); if (isRemote(nd.id)) writer.seed(nd.id, nd.updatedAt);
    moved.set(id, nd.id);
    if ((await adapter.getMeta(CURRENT)) === id) await adapter.setMeta(CURRENT, nd.id);
    await adapter.setMeta(SHADOW + id, null); await setBase(id, null); headers.delete(id);
    notices.set(nd.id, { text: `"${nd.name}" was removed from Google Drive. Your work was saved again as a new file.` });
    changed();
    return nd;
  }
  /** Unconfirmed local copies a closed tab left behind (a design that was never opened again): through the same version rule, once per start. */
  async function recoverOrphans() {
    if (orphansDone || !adapter.listMetaKeys || !(adapter.cloud && adapter.cloud.signedIn())) return;
    orphansDone = true;
    for (const key of await adapter.listMetaKeys(SHADOW)) {
      const id = key.slice(SHADOW.length);
      if (!isRemote(id) || writer.hasPending(id)) continue;
      const s = await adapter.getMeta(key);
      if (!s) continue;
      headers.set(id, { projectId: s.projectId, name: s.name, app: s.app, updatedAt: s.updatedAt });
      const base = await adapter.getMeta(BASE + id);
      if (base != null) bases.set(id, base); else bases.delete(id);
      await writer.queue(id, { app: s.app, document: s.document, updatedAt: s.updatedAt });
    }
  }
  /** A design header { id, projectId, name, app, updatedAt }: the remembered one for a design on Drive (no download), else a read. */
  async function headerOf(id) {
    id = resolveMoved(id);
    if (isRemote(id) && headers.has(id)) return { id, ...headers.get(id) };
    const d = await loadDesign(id);
    return d ? designMeta(d) : null;
  }
  /** A project that exists on Drive (or local when no remote router exists): the asked one, else the current design's, else the default (created on demand). */
  async function resolveProjectId(projectId, { local = false } = {}) {
    if (!local) {
      if (projectId && (!adapter.isRemote || isRemote(projectId)) && await adapter.getProject(projectId)) return projectId;
      const curId = await adapter.getMeta(CURRENT);
      const cur = curId ? await headerOf(curId) : null;
      if (cur && (!adapter.isRemote || isRemote(cur.projectId)) && await adapter.getProject(cur.projectId)) return cur.projectId;
    }
    return defaultProjectId({ local });
  }
  const touchProject = (id, at) => adapter.updateProject(id, (p) => (p ? { ...p, updatedAt: at } : null));

  async function createDesign(name, { app = null, document = emptyDocument(), projectId, makeCurrent = true, id } = {}) {
    const n = cleanName(name);
    let design;
    try {
      const pid = await resolveProjectId(projectId);
      const d = { id: id || await newId('d', pid), projectId: pid, name: n, app, updatedAt: now(), document: clone(document) };
      d.version = await adapter.putDesign(d); // a remote adapter resolves the new file's version
      await touchProject(pid, d.updatedAt);
      design = d;
    } catch (e) {
      throw translateOfflineError(e);
    }
    if (isRemote(design.id)) { await adoptRemote(design); writer.seed(design.id, design.updatedAt); }
    delete design.version;
    if (makeCurrent) { notices.clear(); await adapter.setMeta(CURRENT, design.id); }
    changed();
    return clone(design);
  }
  /** The write of a design on Drive (what the writer runs): merge into the Drive copy (458: other hosts sidecars pass through). */
  async function writeRemote(id, p, isCancelled = () => false) {
    const base = bases.get(id);
    let saved;
    try {
      saved = await adapter.updateDesign(id, (rec) => {
        if (!rec) throw Object.assign(new Error('missing'), { missing: true });
        if (rec.version !== base) throw Object.assign(new Error('changed'), { changed: rec }); // not the version this edit was based on
        return { ...rec, app: p.app || rec.app, updatedAt: p.updatedAt, document: mergeHosts(rec.document, p.document) };
      });
    } catch (e) {
      if (e.changed) { await keepConflictedCopy(e.changed, p); for (const fn of [...conflictListeners]) fn(id); return; } // the copy IS the write: the local copy may go
      if (e.missing) {
        if (isCancelled()) return; // deleted on purpose while this write was in flight: it must not come back as a new file
        const h = headers.get(id);
        if (!h) throw Object.assign(gone('design'), { permanent: true });
        await recreate(id, p, h); return;
      }
      throw e;
    }
    await adoptRemote(saved);
    await touchProject(saved.projectId, p.updatedAt);
  }

  /** Move the pre-474 autosave slot into the design "Untitled" of the default project, once. Nothing is deleted: the slot stays as a backup. */
  async function migrateLegacy(app) {
    if (await adapter.getMeta(LEGACY_MIGRATED)) return;
    const existing = await adapter.listDesigns();
    if (existing.length === 0) {
      const doc = await legacySource();
      if (doc && typeof doc === 'object') {
        const pid = await defaultProjectId({ local: true }); // the old slot is on this device: it stays here (signing in moves nothing)
        const added = await adapter.putDesignIfAbsent({ id: LEGACY_DESIGN_ID, projectId: pid, name: 'Untitled', app: app || null, updatedAt: now(), document: clone(doc) });
        if (added) await adapter.setMetaIfAbsent(CURRENT, LEGACY_DESIGN_ID);
      }
    }
    await adapter.setMeta(LEGACY_MIGRATED, true);
  }

  const store = {
    // ---- designs (what the app opens) ----
    /** The current design's full record (migrating the old slot first), or null when there is none yet. */
    async loadCurrent({ app } = {}) {
      await migrateLegacy(app);
      transientReason = null;
      const id = await adapter.getMeta(CURRENT);
      let d = null, unreadable = false;
      if (id) {
        try { d = await loadDesign(id); }
        catch (e) { // on Drive and unreadable right now (signed out, offline, 5xx) with no local copy: TRANSIENT, so the pointer stays
          if (!isRemote(id)) throw e;
          transientReason = driveErrorText(e);
          unreadable = true;
        }
        if (!d && isRemote(id) && !unreadable) { // read fine and it is not there (trashed / deleted) with no local copy: PERMANENT, the pointer is stale
          await adapter.setMeta(CURRENT, null);
          notices.set('', { text: 'The design you had open was removed from Google Drive.' }); notifyLocal();
        }
      }
      await recoverOrphans();
      return d;
    },
    /** Migrate any pre-474 legacy slot and recover any unconfirmed offline Drive writes (called by buffer restore as well as loadCurrent). */
    async prepare({ app } = {}) {
      await migrateLegacy(app);
      await recoverOrphans();
    },
    currentId: () => adapter.getMeta(CURRENT),
    readBuffer: () => adapter.getMeta(OPEN_TABS_BUFFER),
    writeBuffer: (data) => adapter.setMeta(OPEN_TABS_BUFFER, data),
    isRemote,
    resolveId: resolveMoved,
    hasPendingDrive: (id) => { id = resolveMoved(id); return !!(id && isRemote(id) && writer.status(id).state === 'failed'); },
    async current() { const id = await adapter.getMeta(CURRENT); return id ? headerOf(id) : null; },
    async get(id) { return loadDesign(id); },
    /** Designs across ALL projects, newest first, no bodies, each with its projectName. listRecent('shaper') or listRecent({ app, limit }). */
    async listRecent(opts) {
      const { app, limit } = typeof opts === 'string' ? { app: opts } : (opts || {});
      let rows = await adapter.listDesigns();
      if (app) rows = rows.filter((r) => r.app === app);
      rows.sort((a, b) => (b.updatedAt - a.updatedAt) || String(a.id).localeCompare(String(b.id)));
      if (limit) rows = rows.slice(0, limit);
      const names = new Map((await adapter.listProjects()).map((p) => [p.id, p.name]));
      return rows.map((r) => ({ ...r, projectName: names.get(r.projectId) || null }));
    },
    /** The designs of one project, newest first, no bodies. */
    async listDesigns(projectId) {
      const rows = (await adapter.listDesigns()).filter((r) => r.projectId === projectId);
      rows.sort((a, b) => (b.updatedAt - a.updatedAt) || String(a.id).localeCompare(String(b.id)));
      return rows;
    },
    /** Make design `id` current and return its full record (the app loads the document from it). */
    async open(id) {
      const d = await loadDesign(id);
      if (!d) throw gone('design');
      notices.delete(''); await adapter.setMeta(CURRENT, d.id); // d.id differs when a design gone from Drive was saved again under a new id
      changed();
      return d;
    },
    /** Point the current design at `id` without loading it, or at NOTHING (null): what a page shows when it switches tabs or shows an
     *  unsaved Untitled (TASK 558: an Untitled is never stored, so no design is current). */
    async setCurrent(id) { await adapter.setMeta(CURRENT, id || null); changed(); },
    /** A new EMPTY design (or pre-filled when saving an Untitled from the buffer), in `projectId`, which becomes current. */
    async newDesign(name = 'Untitled', { app = null, projectId, document } = {}) { return createDesign(name, { app, projectId, ...(document !== undefined ? { document } : {}) }); },
    /** Copy a design (default: the CURRENT one; a buffer passes the one it is bound to) into a NEW named design on Drive (or in
     *  `projectId`), which becomes current. */
    async saveAs(name, { app = null, fromId, projectId } = {}) {
      const id = fromId || (await adapter.getMeta(CURRENT));
      const src = id ? await loadDesign(id) : null;
      const pid = projectId || (src && (!adapter.isRemote || isRemote(src.projectId)) ? src.projectId : undefined);
      return createDesign(name, { app: app || (src && src.app) || null, document: src ? src.document : emptyDocument(), projectId: pid });
    },
    async rename(id, name) {
      const n = cleanName(name);
      const d = await adapter.updateDesign(id, (rec) => (rec ? { ...rec, name: n, updatedAt: now() } : null));
      if (!d) throw gone('design');
      await adoptRemote(d);
      await touchProject(d.projectId, d.updatedAt);
      changed(); return designMeta(d);
    },
    /** Same Drive project (or default Drive project if duplicating a legacy local design), new id, not current. */
    async duplicate(id, name) {
      const d = await loadDesign(id);
      if (!d) throw gone('design');
      const pid = (!adapter.isRemote || isRemote(d.projectId)) ? d.projectId : undefined;
      return createDesign(name || d.name + ' copy', { app: d.app, document: d.document, projectId: pid, makeCurrent: false });
    },
    /** Delete a design. Deleting the current one clears the pointer (the app then starts empty). */
    async remove(id) {
      if (isRemote(id)) await forgetRemote(id); // a pending or in-flight write must not bring it back
      await adapter.deleteDesign(id);
      if ((await adapter.getMeta(CURRENT)) === id) await adapter.setMeta(CURRENT, null);
      changed();
    },
    async moveDesign(id, projectId) {
      if (!(await adapter.getProject(projectId))) throw gone('project');
      const at = now();
      const d = await adapter.updateDesign(id, (rec) => (rec ? { ...rec, projectId, updatedAt: at } : null));
      if (!d) throw gone('design');
      await adoptRemote(d);
      await touchProject(projectId, at);
      changed(); return designMeta(d);
    },
    /** AUTOSAVE: write `document` into design `id` (default: the current one; none yet -> a new "Untitled" design in the default
     *  project). Other hosts' sidecars already stored in that design pass through untouched (458). Returns { id }. */
    async save(document, { app = null, id } = {}) {
      let target = id || (await adapter.getMeta(CURRENT));
      while (target && moved.has(target)) target = moved.get(target); // re-created under a new id: a buffer still bound to the old id follows
      if (target && isRemote(target)) { // a design on Drive: keep it here first, write it to Drive THROTTLED (drive-writer.js), report through status()
        if (!bases.has(target) && !adoptTried.has(target)) { // a design moved to Drive by the explicit action: learn its version once; unreadable = the write will keep a copy
          adoptTried.add(target);
          let found = true;
          try { found = !!(await loadDesign(target)); } catch (_) { /* unreadable right now: writer handles retry via status() */ }
          if (!found) { // gone from Drive and nothing local: the work goes into a new design (the old id redirects), never back into the deleted one
            const h = headers.get(target);
            const fresh = await createDesign((h && h.name) || 'Untitled', { app, document, projectId: h && h.projectId });
            moved.set(target, fresh.id);
            return { id: fresh.id };
          }
        }
        const at = now();
        await writer.queue(target, { app, document, updatedAt: at });
        const h = headers.get(target); if (h) headers.set(target, { ...h, app: app || h.app, updatedAt: at });
        return { id: target };
      }
      if (!target) {
        const fresh = await createDesign('Untitled', { app, document, makeCurrent: false });
        if (await adapter.setMetaIfAbsent(CURRENT, fresh.id)) { changed(); return { id: fresh.id }; }
        await adapter.deleteDesign(fresh.id);             // another tab created the first design at the same moment: use theirs
        target = await adapter.getMeta(CURRENT);
      }
      const updatedAt = now();
      let saved = await adapter.updateDesign(target, (rec) => (rec
        ? { ...rec, app: app || rec.app, updatedAt, document: mergeHosts(rec.document, document) }
        : null));
      if (!saved) { // deleted in another tab: keep the work without touching Drive when the existing design is present
        if (!adapter.isRemote) {
          const pid = await resolveProjectId(undefined, { local: true });
          const rec = { id: target, projectId: pid, name: 'Untitled', app, updatedAt, document };
          await adapter.putDesign(rec);
          saved = rec;
        } else {
          const fresh = await createDesign('Untitled', { app, document });
          moved.set(target, fresh.id);
          return { id: fresh.id };
        }
      }
      await touchProject(saved.projectId, updatedAt);
      changed();
      return { id: target };
    },
    /** Write a design to a file through `seam` (default: the browser picker / download). Resolves { name } or null (cancelled). */
    async exportFile(id, seam = browserFileSeam) {
      const target = id || (await adapter.getMeta(CURRENT));
      const d = target ? await loadDesign(target) : null;
      if (!d) throw new Error('There is no design to save.');
      return seam.save(serializeProjectFile({ app: d.app, name: d.name, document: d.document }), projectFileName(d.name));
    },
    /** Read a design file through `seam`, validate it, store it as a NEW design (in `projectId`, default the current project) and
     *  make it current. null = cancelled. Throws ProjectFileError (readable message) for a bad / newer file; nothing is stored then. */
    async importFile(seam = browserFileSeam, { app, projectId } = {}) {
      const file = await seam.open();
      if (!file) return null;
      const parsed = parseProjectFile(file.text);
      return createDesign(parsed.name, { app: parsed.app || app || null, document: parsed.document, projectId });
    },

    // ---- projects (folders) ----
    /** Pinned first, then most recently changed. */
    async listProjects() {
      const rows = await adapter.listProjects();
      rows.sort((a, b) => (Number(!!b.pinned) - Number(!!a.pinned)) || (b.updatedAt - a.updatedAt) || String(a.id).localeCompare(String(b.id)));
      return rows;
    },
    async createProject(name) {
      const n = cleanName(name, 'project');
      let p;
      try {
        p = { id: await newId('p'), name: n, pinned: false, updatedAt: now() };
        await adapter.putProject(p);
      } catch (e) {
        throw translateOfflineError(e);
      }
      changed(); return clone(p);
    },
    async renameProject(id, name) {
      const n = cleanName(name, 'project');
      const p = await adapter.updateProject(id, (rec) => (rec ? { ...rec, name: n, updatedAt: now() } : null));
      if (!p) throw gone('project');
      changed(); return clone(p);
    },
    /** pinned defaults to true; pinProject(id, false) unpins. Pinning does not count as a change to the contents (updatedAt stays). */
    async pinProject(id, pinned = true) {
      const p = await adapter.updateProject(id, (rec) => (rec ? { ...rec, pinned: !!pinned } : null));
      if (!p) throw gone('project');
      changed(); return clone(p);
    },
    /** Delete an EMPTY project. One that still holds designs is refused (move or delete them first): a folder never takes work with it. */
    async removeProject(id) {
      const inside = (await adapter.listDesigns()).filter((d) => d.projectId === id).length;
      if (inside > 0) throw new Error(`This project still holds ${inside} design${inside === 1 ? '' : 's'}. Move or delete them first.`);
      await adapter.deleteProject(id);
      if (isRemote(id)) { // deleted on purpose: whatever this device still keeps for designs of that project is dropped, so nothing recreates them
        const ids = new Set([...headers].filter(([, h]) => h.projectId === id).map(([did]) => did));
        for (const key of await adapter.listMetaKeys(SHADOW)) { const s = await adapter.getMeta(key); if (s && s.projectId === id) ids.add(key.slice(SHADOW.length)); }
        for (const did of ids) await forgetRemote(did);
      }
      changed();
    },

    /** Where design `id` lives and how its last save went: { where: 'drive' | 'device', state: 'saved' | 'saving' | 'failed', at, reason }.
     *  The ONE source of the sidebar status line. */
    status(id) {
      id = resolveMoved(id);
      const notice = (notices.get(id || '') || notices.get('') || {}).text || null; // a one-off explanation (conflicted copy, re-created design)
      if (id && isRemote(id)) return { where: 'drive', ...writer.status(id), notice };
      return { where: 'device', state: 'saved', at: null, reason: id ? null : transientReason, notice };
    },
    /** fn(id) runs when the Drive copy of design `id` was changed elsewhere and the local edit was kept as a conflicted copy: the buffer
     *  bound to `id` then reloads the Drive version (it must not write its older state over it). Returns an unsubscribe function. */
    subscribeConflict(fn) { conflictListeners.add(fn); return () => conflictListeners.delete(fn); },
    /** Write the pending Drive writes NOW (one design, or all): before an action that reads Drive, and when the tab goes hidden / closes. */
    async flushDrive(id) { await writer.flush(resolveMoved(id)); },

    /** fn() runs after any change to the projects, designs or the current pointer, in this tab and (BroadcastChannel) in other tabs. */
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
  // The explicit CLOUD actions of an adapter that has them (the router): signing in never calls these; the user's choice does.
  if (adapter.cloud) {
    const c = adapter.cloud;
    store.cloud = {
      isEnabled: () => c.isEnabled(),
      enable: async () => { await c.enable(); changed(); },
      disable: async () => { await c.disable(); changed(); },
      lastError: () => c.lastError(),
      refresh: async () => { const moved = await c.refresh(); if (moved) changed(); return moved; },
      moveProjectToDrive: async (id) => { const r = await c.moveProjectToDrive(id); changed(); return r; },
      checkConnection: (onStep) => c.checkConnection(onStep),
    };
  }
  return store;
}

let shared = null;
/** The one shared store of this page (IndexedDB adapter). */
export function getProjectStore() {
  if (shared) return shared;
  const local = createIdbAdapter();
  let remote = null; // built on first use: a page that never touches Drive never constructs it
  const account = getGoogleAccount();
  const router = createRouterAdapter({ local, signedIn: () => account.state().signedIn, subscribeSignIn: (fn) => account.subscribe(fn), getRemote: () => remote || (remote = createDriveAdapter({ account, meta: local })) });
  return (shared = createProjectStore({ adapter: router }));
}
