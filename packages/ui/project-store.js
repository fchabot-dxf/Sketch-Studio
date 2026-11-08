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
//
// The 458 rule is kept per design: a save replaces only the host sidecars it owns and passes every other host through.

import { DOCUMENT_VERSION } from '#core/document.js';
import { serializeProjectFile, parseProjectFile, projectFileName, browserFileSeam } from '#ui/project-file.js';

const CURRENT = 'currentDesign';
const LEGACY_MIGRATED = 'legacyMigrated';
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
export function createProjectStore({ adapter = createIdbAdapter(), legacySource = readLegacySlot, idFn, now = () => Date.now(), channel } = {}) {
  const newId = idFn || (adapter.newId ? (kind) => adapter.newId(kind) : ((prefix = 'd') => prefix + '_' + now().toString(36) + Math.random().toString(36).slice(2, 8)));
  const listeners = new Set();
  const bc = channel !== undefined ? channel : (typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('sketch-studio-projects') : null);
  if (bc) bc.onmessage = () => { for (const fn of [...listeners]) { try { fn(); } catch (_) {} } };
  if (adapter.onChange) adapter.onChange(() => { for (const fn of [...listeners]) { try { fn(); } catch (_) {} } }); // a REMOTE change (optional hook)
  const changed = () => {
    for (const fn of [...listeners]) { try { fn(); } catch (_) {} }
    try { if (bc) bc.postMessage('changed'); } catch (_) {}
  };

  const cleanName = (name, what = 'design') => { const n = String(name == null ? '' : name).trim(); if (!n) throw new Error(`A ${what} needs a name.`); return n; };
  const mergeHosts = (stored, incoming) => ({ ...incoming, hosts: { ...((stored && stored.hosts) || {}), ...((incoming && incoming.hosts) || {}) } });
  const gone = (what) => new Error(`That ${what} no longer exists.`);

  /** Make sure the default project exists and return its id. */
  async function defaultProjectId() {
    await adapter.putProjectIfAbsent({ id: DEFAULT_PROJECT_ID, name: DEFAULT_PROJECT_NAME, pinned: false, updatedAt: now() });
    return DEFAULT_PROJECT_ID;
  }
  /** A project that exists: the asked one, else the current design's, else the default (created on demand). */
  async function resolveProjectId(projectId) {
    if (projectId && await adapter.getProject(projectId)) return projectId;
    const curId = await adapter.getMeta(CURRENT);
    const cur = curId ? await adapter.getDesign(curId) : null;
    if (cur && await adapter.getProject(cur.projectId)) return cur.projectId;
    return defaultProjectId();
  }
  const touchProject = (id, at) => adapter.updateProject(id, (p) => (p ? { ...p, updatedAt: at } : null));

  async function createDesign(name, { app = null, document = emptyDocument(), projectId, makeCurrent = true, id } = {}) {
    const pid = await resolveProjectId(projectId);
    const design = { id: id || await newId('d'), projectId: pid, name: cleanName(name), app, updatedAt: now(), document: clone(document) };
    await adapter.putDesign(design);
    await touchProject(pid, design.updatedAt);
    if (makeCurrent) await adapter.setMeta(CURRENT, design.id);
    changed();
    return clone(design);
  }

  /** Move the pre-474 autosave slot into the design "Untitled" of the default project, once. Nothing is deleted: the slot stays as a backup. */
  async function migrateLegacy(app) {
    if (await adapter.getMeta(LEGACY_MIGRATED)) return;
    const existing = await adapter.listDesigns();
    if (existing.length === 0) {
      const doc = await legacySource();
      if (doc && typeof doc === 'object') {
        const pid = await defaultProjectId();
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
      const id = await adapter.getMeta(CURRENT);
      return id ? await adapter.getDesign(id) : null;
    },
    async current() { const id = await adapter.getMeta(CURRENT); const d = id ? await adapter.getDesign(id) : null; return d ? designMeta(d) : null; },
    async get(id) { return adapter.getDesign(id); },
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
      const d = await adapter.getDesign(id);
      if (!d) throw gone('design');
      await adapter.setMeta(CURRENT, id);
      changed();
      return d;
    },
    /** A new EMPTY design (in `projectId`, default: the current design's project), which becomes current. */
    async newDesign(name = 'Untitled', { app = null, projectId } = {}) { return createDesign(name, { app, projectId }); },
    /** Copy a design (default: the CURRENT one; a buffer passes the one it is bound to) into a NEW named design in the same
     *  project (or `projectId`), which becomes current. */
    async saveAs(name, { app = null, fromId, projectId } = {}) {
      const id = fromId || (await adapter.getMeta(CURRENT));
      const src = id ? await adapter.getDesign(id) : null;
      return createDesign(name, { app: app || (src && src.app) || null, document: src ? src.document : emptyDocument(), projectId: projectId || (src && src.projectId) });
    },
    async rename(id, name) {
      const n = cleanName(name);
      const d = await adapter.updateDesign(id, (rec) => (rec ? { ...rec, name: n, updatedAt: now() } : null));
      if (!d) throw gone('design');
      await touchProject(d.projectId, d.updatedAt);
      changed(); return designMeta(d);
    },
    /** Same project, new id, not current. */
    async duplicate(id, name) {
      const d = await adapter.getDesign(id);
      if (!d) throw gone('design');
      return createDesign(name || d.name + ' copy', { app: d.app, document: d.document, projectId: d.projectId, makeCurrent: false });
    },
    /** Delete a design. Deleting the current one clears the pointer (the app then starts empty). */
    async remove(id) {
      await adapter.deleteDesign(id);
      if ((await adapter.getMeta(CURRENT)) === id) await adapter.setMeta(CURRENT, null);
      changed();
    },
    async moveDesign(id, projectId) {
      if (!(await adapter.getProject(projectId))) throw gone('project');
      const at = now();
      const d = await adapter.updateDesign(id, (rec) => (rec ? { ...rec, projectId, updatedAt: at } : null));
      if (!d) throw gone('design');
      await touchProject(projectId, at);
      changed(); return designMeta(d);
    },
    /** AUTOSAVE: write `document` into design `id` (default: the current one; none yet -> a new "Untitled" design in the default
     *  project). Other hosts' sidecars already stored in that design pass through untouched (458). Returns { id }. */
    async save(document, { app = null, id } = {}) {
      let target = id || (await adapter.getMeta(CURRENT));
      if (!target) {
        const fresh = await createDesign('Untitled', { app, document, makeCurrent: false });
        if (await adapter.setMetaIfAbsent(CURRENT, fresh.id)) { changed(); return { id: fresh.id }; }
        await adapter.deleteDesign(fresh.id);             // another tab created the first design at the same moment: use theirs
        target = await adapter.getMeta(CURRENT);
      }
      const updatedAt = now();
      const pid = await resolveProjectId(undefined);       // only used if the design vanished and must be re-created
      const saved = await adapter.updateDesign(target, (rec) => rec
        ? { ...rec, app: app || rec.app, updatedAt, document: mergeHosts(rec.document, document) }
        : { id: target, projectId: pid, name: 'Untitled', app, updatedAt, document }); // deleted in another tab: keep the work
      await touchProject(saved.projectId, updatedAt);
      changed();
      return { id: target };
    },
    /** Write a design to a file through `seam` (default: the browser picker / download). Resolves { name } or null (cancelled). */
    async exportFile(id, seam = browserFileSeam) {
      const target = id || (await adapter.getMeta(CURRENT));
      const d = target ? await adapter.getDesign(target) : null;
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
      const p = { id: await newId('p'), name: cleanName(name, 'project'), pinned: false, updatedAt: now() };
      await adapter.putProject(p); changed(); return clone(p);
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
      await adapter.deleteProject(id); changed();
    },

    /** fn() runs after any change to the projects, designs or the current pointer, in this tab and (BroadcastChannel) in other tabs. */
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
  return store;
}

let shared = null;
/** The one shared store of this page (IndexedDB adapter). */
export function getProjectStore() { return shared || (shared = createProjectStore()); }
