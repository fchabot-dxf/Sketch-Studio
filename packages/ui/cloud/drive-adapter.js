// packages/ui/cloud/drive-adapter.js — GOOGLE DRIVE behind the project-store seam (TASK 480).
//   project = a Drive FOLDER under ONE app root folder "Sketch Studio" (appProperties: skKind/skPinned/skUpdatedAt)
//   design  = a FILE `<name>.sketch.json` in its project folder; its content is exactly the project FILE (project-file.js:
//             envelope + document + host sidecars), so a design downloaded from Drive opens with "Open from file"
//             appProperties: skKind='design', skApp, skUpdatedAt
// Scope is drive.file: the app only ever sees files it created. Implements the adapter interface documented in
// project-store.js (listProjects/getProject/putProject/putProjectIfAbsent/updateProject/deleteProject, listDesigns/getDesign/
// putDesign/putDesignIfAbsent/updateDesign/deleteDesign, getMeta/setMeta/setMetaIfAbsent) plus the optional hooks newId(kind)
// (files.generateIds: opaque Drive ids) and onChange(fn) (+ refresh(): poll the remote signature, fire onChange when it moved).
//
// Meta (the current-design pointer, flags, the cached root id) stays LOCAL: `meta` is the IndexedDB adapter.
// "Delete" is TRASH (Drive keeps it ~30 days and the user can restore it), never files.delete.
// OPTIMISTIC CONCURRENCY: Drive v3 has no conditional write, so update*(id, fn) reads the file's `version`, runs fn, re-reads the
// version just before writing and retries (re-reading the new content) when it moved; the window between that last check and the
// write is small but not zero, and is the honest limit of the API. Every request goes through account.authedFetch (bearer token,
// one re-mint + retry on a 401); nothing here ever sees a client secret.
import { GOOGLE } from '#ui/cloud/providers.js';
import { serializeProjectFile, parseProjectFile, PROJECT_FILE_EXT } from '#ui/project-file.js';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';
const META_FIELDS = 'id,name,parents,appProperties,modifiedTime,createdTime,version,trashed';
const ROOT_KEY = 'driveRootId';
const RETRIES = 4;

/** One readable line for a Drive / sign-in failure (the reason shown in the sidebar). Drive's HTTP status stays in the text. */
export function driveErrorText(e) {
  const m = (e && e.message) || String(e);
  if (m === 'cloud-auth') return 'Google sign-in is needed again';
  if (m === 'cloud-unavailable') return 'Google could not be reached';
  if (e instanceof TypeError) return `Google Drive could not be reached (${m})`;
  const http = /^Drive (\d+)$/.exec(m);
  if (http) return `Google Drive answered HTTP ${http[1]}`;
  return m;
}

// The steps of "Check Google Drive connection", in order, as DATA (the sidebar lists them; the adapter runs them).
export const CHECK_STEPS = [
  { id: 'token', label: 'Sign-in token is valid' },
  { id: 'root', label: `"${GOOGLE.rootFolderName}" folder found or created` },
  { id: 'write', label: 'Test file written' },
  { id: 'read', label: 'Test file read back identical' },
  { id: 'trash', label: 'Test file deleted (trashed)' },
];

const fileName = (name) => String(name) + PROJECT_FILE_EXT;
const baseName = (file) => String(file).endsWith(PROJECT_FILE_EXT) ? String(file).slice(0, -PROJECT_FILE_EXT.length) : String(file);

export function createDriveAdapter({ account, meta, config = GOOGLE } = {}) {
  let rootId = null;
  let idPool = [];
  const changeListeners = new Set();
  let lastSignature = null;

  // ---- REST ----
  async function call(url, opts, { allow404 = false } = {}) {
    const r = await account.authedFetch(url, opts);
    if (r.status === 404 && allow404) return null;
    if (!r.ok) { const e = new Error('Drive ' + r.status); e.status = r.status; throw e; }
    return r;
  }
  const multipart = (metadata, content, contentType) => {
    const boundary = 'sk' + Math.random().toString(16).slice(2);
    const part = (type, text) => `Content-Type: ${type}\r\n\r\n${text}`;
    return { type: `multipart/related; boundary=${boundary}`, body: `--${boundary}\r\n${part('application/json; charset=UTF-8', JSON.stringify(metadata))}\r\n--${boundary}\r\n${part(contentType, content)}\r\n--${boundary}--` };
  };
  const jsonOpts = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  async function listAll(q, fields) {
    const out = []; let pageToken = '';
    do {
      const url = `${API}/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(`nextPageToken,files(${fields})`)}&pageSize=200${pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''}`;
      const j = await (await call(url)).json();
      out.push(...(j.files || [])); pageToken = j.nextPageToken || '';
    } while (pageToken);
    return out;
  }
  const getMeta = async (id) => { const r = await call(`${API}/files/${id}?fields=${encodeURIComponent(META_FIELDS)}`, undefined, { allow404: true }); const m = r ? await r.json() : null; return m && !m.trashed ? m : null; };

  // ---- the app root folder ----
  const oldestFirst = (a, b) => (Date.parse(a.createdTime) || 0) - (Date.parse(b.createdTime) || 0) || String(a.id).localeCompare(String(b.id));
  /** The root folder when it exists (READ-ONLY: never creates, so listing for a signed-in user writes nothing), else null.
   *  Always verifies any cached root id is not trashed/deleted out of band before returning it. */
  async function findRoot() {
    if (rootId) {
      const m = await getMeta(rootId);
      if (m) return rootId;
      rootId = null;
      await meta.setMeta(ROOT_KEY, null);
    }
    const cached = await meta.getMeta(ROOT_KEY);
    if (cached) {
      const m = await getMeta(cached);
      if (m) return (rootId = cached);
      await meta.setMeta(ROOT_KEY, null);
    }
    const found = (await listAll(`mimeType='${FOLDER}' and name='${config.rootFolderName}' and 'root' in parents and trashed=false`, 'id,createdTime')).sort(oldestFirst);
    if (!found.length) return null;
    await meta.setMeta(ROOT_KEY, found[0].id);
    return (rootId = found[0].id);
  }
  /** The root folder, CREATED when absent (only a write calls this). Two devices creating it at the same moment: the OLDEST folder is the
   *  root; a device that lost trashes its own just-created one ONLY while it is still empty, never a folder anything was put into. */
  async function ensureRoot() {
    const existing = await findRoot();
    if (existing) return existing;
    const id = (await (await call(`${API}/files?fields=id`, jsonOpts('POST', { name: config.rootFolderName, mimeType: FOLDER }))).json()).id;
    const found = (await listAll(`mimeType='${FOLDER}' and name='${config.rootFolderName}' and 'root' in parents and trashed=false`, 'id,createdTime')).sort(oldestFirst);
    let chosen = id;
    if (found.length && found[0].id !== id && found.some((f) => f.id === id)) {
      const used = (await listAll(`'${id}' in parents and trashed=false`, 'id')).length > 0;
      if (!used) { await call(`${API}/files/${id}?fields=id`, jsonOpts('PATCH', { trashed: true })); chosen = found[0].id; }
    }
    await meta.setMeta(ROOT_KEY, chosen);
    return (rootId = chosen);
  }

  // ---- projects (folders) ----
  const projectOf = (f) => ({ id: f.id, name: f.name, createdAt: Date.parse(f.createdTime) || 0, pinned: !!(f.appProperties && f.appProperties.skPinned === '1'), updatedAt: Number(f.appProperties && f.appProperties.skUpdatedAt) || Date.parse(f.modifiedTime) || 0 });
  const projectProps = (p) => ({ skKind: 'project', skPinned: p.pinned ? '1' : '0', skUpdatedAt: String(p.updatedAt) });
  async function writeProject(p, existing) {
    if (existing) await call(`${API}/files/${p.id}?fields=id`, jsonOpts('PATCH', { name: p.name, appProperties: projectProps(p) }));
    else await call(`${API}/files?fields=id`, jsonOpts('POST', { id: p.id, name: p.name, mimeType: FOLDER, parents: [await ensureRoot()], appProperties: projectProps(p) }));
  }

  // ---- designs (files) ----
  const designMetaOf = (f) => ({
    id: f.id, projectId: (f.parents || [])[0], name: baseName(f.name), app: (f.appProperties && f.appProperties.skApp) || null,
    updatedAt: Number(f.appProperties && f.appProperties.skUpdatedAt) || Date.parse(f.modifiedTime) || 0,
  });
  const designProps = (d) => ({ skKind: 'design', skApp: d.app || '', skUpdatedAt: String(d.updatedAt) });
  async function readDesign(m) {
    const text = await (await call(`${API}/files/${m.id}?alt=media`)).text();
    const parsed = parseProjectFile(text); // validates the envelope + document version (a damaged / newer file throws a readable error)
    const base = designMetaOf(m);
    return { id: m.id, projectId: base.projectId, name: parsed.name || base.name, app: base.app || parsed.app, updatedAt: base.updatedAt, version: m.version, document: parsed.document };
  }
  /** Writes the design; resolves the file's Drive `version` AFTER the write (what the next write is compared with). */
  async function writeDesign(d, existingMeta) {
    const content = serializeProjectFile({ app: d.app, name: d.name, document: d.document });
    const props = designProps(d);
    if (existingMeta) {
      const moved = existingMeta.parents && existingMeta.parents[0] !== d.projectId;
      await call(`${UPLOAD}/files/${d.id}?uploadType=media&fields=id`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: content });
      const q = moved ? `?addParents=${encodeURIComponent(d.projectId)}&removeParents=${encodeURIComponent(existingMeta.parents[0])}&fields=id` : '?fields=id';
      await call(`${API}/files/${d.id}${q}`, jsonOpts('PATCH', { name: fileName(d.name), appProperties: props }));
      return (await getMeta(d.id)).version;
    }
    const m = multipart({ id: d.id, name: fileName(d.name), mimeType: 'application/json', parents: [d.projectId], appProperties: props }, content, 'application/json');
    await call(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'Content-Type': m.type }, body: m.body });
    return (await getMeta(d.id)).version;
  }

  const adapter = {
    // projects
    async listProjects() {
      const root = await findRoot(); // read-only: no root yet = no projects (nothing is created by looking)
      if (!root) return [];
      return (await listAll(`'${root}' in parents and mimeType='${FOLDER}' and trashed=false`, 'id,name,appProperties,modifiedTime,createdTime')).map(projectOf);
    },
    async getProject(id) { const m = await getMeta(id); return m ? projectOf(m) : null; },
    async putProject(p) { await writeProject(p, !!(await getMeta(p.id))); },
    async putProjectIfAbsent(p) { if (await getMeta(p.id)) return false; await writeProject(p, false); return true; },
    async updateProject(id, fn) {
      const cur = await getMeta(id);
      const next = fn(cur ? projectOf(cur) : null);
      if (next == null) { if (cur) await call(`${API}/files/${id}?fields=id`, jsonOpts('PATCH', { trashed: true })); return null; }
      await writeProject(next, !!cur);
      return next;
    },
    async deleteProject(id) { await call(`${API}/files/${id}?fields=id`, jsonOpts('PATCH', { trashed: true }), { allow404: true }); },

    // designs
    async listDesigns() {
      return (await listAll(`appProperties has { key='skKind' and value='design' } and trashed=false`, 'id,name,parents,appProperties,modifiedTime')).map(designMetaOf);
    },
    async getDesign(id) { const m = await getMeta(id); return m ? readDesign(m) : null; },
    async putDesign(d) { return writeDesign(d, await getMeta(d.id)); },
    async putDesignIfAbsent(d) { if (await getMeta(d.id)) return false; await writeDesign(d, null); return true; },
    async updateDesign(id, fn) {
      for (let attempt = 0; attempt < RETRIES; attempt++) {
        const m1 = await getMeta(id);
        const cur = m1 ? await readDesign(m1) : null;
        const next = fn(cur);
        if (next == null) { if (m1) await call(`${API}/files/${id}?fields=id`, jsonOpts('PATCH', { trashed: true })); return null; }
        const m2 = await getMeta(id);
        if ((m1 && m2 && m1.version !== m2.version) || (!m1 && m2)) continue; // changed elsewhere while we computed: re-read and recompute
        const version = await writeDesign(next, m2);
        return { ...next, version };
      }
      throw new Error('This design is being changed somewhere else. Try again in a moment.');
    },
    async deleteDesign(id) { await call(`${API}/files/${id}?fields=id`, jsonOpts('PATCH', { trashed: true }), { allow404: true }); },

    /** "Check Google Drive connection": token, root folder, write, read back, trash, in order. onStep(steps) after every change; resolves the
     *  final steps = [{ id, label, state: 'pending'|'running'|'ok'|'failed'|'skipped', status?: HTTP status, detail?: text }]. A failed step skips
     *  the rest, except the test file is always trashed once it exists. Never throws: a failure is a step. */
    async checkConnection(onStep = () => {}) {
      const steps = CHECK_STEPS.map((s) => ({ ...s, state: 'pending' }));
      const by = Object.fromEntries(steps.map((s) => [s.id, s]));
      const show = () => onStep(steps.map((s) => ({ ...s })));
      let fileId = null, failed = false;
      const run = async (id, fn) => {
        const step = by[id];
        if (failed && !(id === 'trash' && fileId)) { step.state = 'skipped'; show(); return; }
        step.state = 'running'; show();
        try { await fn(); step.state = 'ok'; step.status = 200; }
        catch (e) { failed = true; step.state = 'failed'; step.status = e.status; step.detail = driveErrorText(e); }
        show();
      };
      const text = `Sketch Studio connection test ${new Date().toISOString()}`;
      await run('token', async () => { await call(`${API}/about?fields=user`); });
      await run('root', async () => { rootId = null; await ensureRoot(); });
      await run('write', async () => {
        const m = multipart({ name: 'sketch-studio-connection-test.txt', mimeType: 'text/plain', parents: [await ensureRoot()] }, text, 'text/plain');
        fileId = (await (await call(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'Content-Type': m.type }, body: m.body })).json()).id;
      });
      await run('read', async () => { const back = await (await call(`${API}/files/${fileId}?alt=media`)).text(); if (back !== text) throw new Error('The file read back is different from what was written'); });
      await run('trash', async () => { await call(`${API}/files/${fileId}?fields=id`, jsonOpts('PATCH', { trashed: true })); });
      return steps;
    },

    // meta stays local to this device
    listMetaKeys: (prefix) => meta.listMetaKeys(prefix),
    getMeta: (k) => meta.getMeta(k),
    setMeta: (k, v) => meta.setMeta(k, v),
    setMetaIfAbsent: (k, v) => meta.setMetaIfAbsent(k, v),

    // optional hooks
    async newId() {
      if (!idPool.length) idPool = (await (await call(`${API}/files/generateIds?count=10&space=drive`)).json()).ids || [];
      return idPool.shift();
    },
    onChange(fn) { changeListeners.add(fn); },
    /** Poll the remote: when the set of designs / projects (ids + updatedAt) moved since the last poll, fire onChange. Call it when the tab wakes. */
    async refresh() {
      const sig = JSON.stringify([(await adapter.listProjects()).map((p) => [p.id, p.updatedAt]), (await adapter.listDesigns()).map((d) => [d.id, d.updatedAt])]);
      const moved = lastSignature !== null && sig !== lastSignature;
      lastSignature = sig;
      if (moved) for (const fn of [...changeListeners]) { try { fn(); } catch (_) { /* */ } }
      return moved;
    },
  };
  return adapter;
}
