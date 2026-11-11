// packages/ui/cloud/router-adapter.js — the ROUTER adapter (TASK 480): one adapter for the store that sends every project / design
// to the LOCAL IndexedDB adapter or to the DRIVE adapter, by where that project lives. It is where the owner's rulings live:
//   - signing in changes NOTHING that already exists: an existing project goes to Drive only when the user moves it there
//     (moveProjectToDrive). TASK 506 adds the one other way onto Drive: `preferDrive()` (signed in AND the "Save to Google Drive by
//     default" setting on) decides where NEW things are created (newId / defaultProject below); it never moves anything;
//   - Drive projects are LISTED once Drive was used (driveEnabled meta) or while preferDrive() is true;
//   - a project that was never moved and is never created on Drive never touches the network (the local adapter does all of it);
//   - meta (the current-design pointer, flags) is always local.
// Remote ids are prefixed `drive:` so every id says where it lives; the Drive adapter itself sees the plain Drive ids.
// A project's `location` is 'drive' for remote ones (absent = local).
export const CURRENT_DESIGN_KEY = 'currentDesign'; // the store's "current design" pointer (project-store.js uses this same key)
export const DRIVE_PREFIX = 'drive:';
const DRIVE_ENABLED = 'driveEnabled';

export const isRemoteId = (id) => typeof id === 'string' && id.startsWith(DRIVE_PREFIX);
const strip = (id) => id.slice(DRIVE_PREFIX.length);
const withPrefix = (id) => DRIVE_PREFIX + id;
const toRemoteProject = (p) => (p ? { ...p, id: withPrefix(p.id), location: 'drive' } : p);
const fromRemoteProject = (p) => { if (!p) return p; const { location, ...rest } = p; return { ...rest, id: strip(p.id) }; };
const toRemoteDesign = (d) => (d ? { ...d, id: withPrefix(d.id), projectId: withPrefix(d.projectId) } : d);
const fromRemoteDesign = (d) => (d ? { ...d, id: strip(d.id), projectId: strip(d.projectId) } : d);
const gone = (what) => new Error(`That ${what} no longer exists.`);
const localId = (kind) => (kind === 'p' ? 'p' : 'd') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** createRouterAdapter({ local, getRemote, preferDrive }): getRemote() returns the Drive adapter (created lazily: nothing is built or called
 *  until Drive is used). preferDrive() -> boolean: should NEW projects / designs be created on Drive (signed in + the setting on)? */
export function createRouterAdapter({ local, getRemote, preferDrive = () => false }) {
  let remoteError = null;
  let driveDefault = null; // the IN-FLIGHT lookup of the Drive default project (concurrent callers share it; never cached after: the account may change)
  const driveEnabled = async () => !!(await local.getMeta(DRIVE_ENABLED)) || preferDrive();
  /** A remote listing for the merged lists: only when Drive is on, and a failure (offline, signed out) must not hide the local projects. */
  async function remoteList(fn) {
    if (!(await driveEnabled())) return [];
    try { const out = await fn(getRemote()); remoteError = null; return out; } catch (e) { remoteError = e; return []; }
  }
  const noCrossing = () => new Error('A design cannot move between your device and Drive one by one: move the whole project to Drive instead.');

  async function copyProject(srcAdapter, dstAdapter, projectId, { dstRemote }) {
    const src = srcAdapter;
    const proj = await src.getProject(projectId);
    if (!proj) throw gone('project');
    const designs = (await src.listDesigns()).filter((d) => d.projectId === projectId);
    const newPid = await (dstRemote ? dstAdapter.newId('p') : 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
    await dstAdapter.putProject({ ...proj, id: newPid });
    const idMap = {};
    for (const m of designs) {
      const full = await src.getDesign(m.id);
      const nid = await (dstRemote ? dstAdapter.newId('d') : 'd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
      await dstAdapter.putDesign({ ...full, id: nid, projectId: newPid });
      idMap[m.id] = nid;
    }
    for (const nid of Object.values(idMap)) if (!(await dstAdapter.getDesign(nid))) throw new Error('The copy could not be verified: nothing was removed from the original.');
    return { newPid, idMap, oldIds: designs.map((d) => d.id) };
  }

  /** The ONE Drive project called `name` (the default "My Designs"): found by name among the Drive projects, created when absent. Two
   *  tabs / devices creating it at the same moment end with ONE: both re-list, the lowest id wins, the loser trashes its own. */
  async function ensureDriveDefault(name, now) {
    const remote = getRemote();
    const find = async () => (await remote.listProjects()).filter((p) => p.name === name).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    let found = await find();
    if (!found.length) {
      const id = await remote.newId('p');
      await remote.putProject({ id, name, pinned: false, updatedAt: now() });
      found = await find();
      if (found.length && found[0].id !== id && found.some((p) => p.id === id)) await remote.deleteProject(id); // lost the tie: use theirs
      if (!found.length) found = [{ id }];
    }
    await local.setMeta(DRIVE_ENABLED, true);
    return withPrefix(found[0].id);
  }
  const driveDefaultProject = (name, now) => {
    if (!driveDefault) driveDefault = ensureDriveDefault(name, now).finally(() => { driveDefault = null; });
    return driveDefault;
  };

  const router = {
    isRemote: isRemoteId,
    // ---- projects ----
    async listProjects() { return [...(await local.listProjects()), ...(await remoteList(async (r) => (await r.listProjects()).map(toRemoteProject)))]; },
    async getProject(id) { return isRemoteId(id) ? toRemoteProject(await getRemote().getProject(strip(id))) : local.getProject(id); },
    async putProject(p) { return isRemoteId(p.id) ? getRemote().putProject(fromRemoteProject(p)) : local.putProject(p); },
    async putProjectIfAbsent(p) { return isRemoteId(p.id) ? getRemote().putProjectIfAbsent(fromRemoteProject(p)) : local.putProjectIfAbsent(p); },
    async updateProject(id, fn) {
      if (!isRemoteId(id)) return local.updateProject(id, fn);
      const r = await getRemote().updateProject(strip(id), (cur) => { const next = fn(cur ? toRemoteProject(cur) : null); return next ? fromRemoteProject(next) : null; });
      return toRemoteProject(r);
    },
    async deleteProject(id) { return isRemoteId(id) ? getRemote().deleteProject(strip(id)) : local.deleteProject(id); },
    // ---- designs ----
    async listDesigns() { return [...(await local.listDesigns()), ...(await remoteList(async (r) => (await r.listDesigns()).map(toRemoteDesign)))]; },
    async getDesign(id) { return isRemoteId(id) ? toRemoteDesign(await getRemote().getDesign(strip(id))) : local.getDesign(id); },
    async putDesign(d) {
      if (isRemoteId(d.projectId) !== isRemoteId(d.id)) throw noCrossing();
      return isRemoteId(d.id) ? getRemote().putDesign(fromRemoteDesign(d)) : local.putDesign(d);
    },
    async putDesignIfAbsent(d) { return isRemoteId(d.id) ? getRemote().putDesignIfAbsent(fromRemoteDesign(d)) : local.putDesignIfAbsent(d); },
    async updateDesign(id, fn) {
      const remote = isRemoteId(id);
      const guard = (next) => { if (next && isRemoteId(next.projectId) !== remote) throw noCrossing(); return next; };
      if (!remote) return local.updateDesign(id, (cur) => guard(fn(cur)));
      const r = await getRemote().updateDesign(strip(id), (cur) => { const next = guard(fn(cur ? toRemoteDesign(cur) : null)); return next ? fromRemoteDesign(next) : null; });
      return toRemoteDesign(r);
    },
    async deleteDesign(id) { return isRemoteId(id) ? getRemote().deleteDesign(strip(id)) : local.deleteDesign(id); },
    // ---- meta: always this device ----
    getMeta: (k) => local.getMeta(k),
    setMeta: (k, v) => local.setMeta(k, v),
    setMetaIfAbsent: (k, v) => local.setMetaIfAbsent(k, v),
    /** Where a NEW project / design is created: a design always lives where its project does; a new project (or one with no project yet)
     *  goes to Drive when preferDrive() says so. `local: true` forces this device (the store's fallback after a Drive failure). Throws when
     *  Drive was wanted and failed (the store then falls back and shows why). */
    async newId(kind, projectId, { local: forceLocal = false } = {}) {
      const drive = !forceLocal && (projectId ? isRemoteId(projectId) : preferDrive());
      if (!drive) return localId(kind);
      const id = withPrefix(await getRemote().newId(kind));
      await local.setMeta(DRIVE_ENABLED, true);
      return id;
    },
    /** The default project ("My Designs"): ONE on Drive while preferDrive(), else the fixed local one (created on demand). Returns its id. */
    async defaultProject({ id, name, now, local: forceLocal = false }) {
      if (!forceLocal && preferDrive()) return driveDefaultProject(name, now);
      await local.putProjectIfAbsent({ id, name, pinned: false, updatedAt: now() });
      return id;
    },

    /** The explicit, user-chosen cloud actions (the store exposes them as store.cloud; the sidebar calls them). */
    cloud: {
      isEnabled: driveEnabled,
      enable: () => local.setMeta(DRIVE_ENABLED, true),
      disable: () => local.setMeta(DRIVE_ENABLED, null),   // Drive projects are hidden, not touched
      lastError: () => remoteError,
      /** Poll the remote (when Drive is on) and let the adapter fire its onChange. Call when the tab wakes. */
      async refresh() { if (await driveEnabled()) return getRemote().refresh(); return false; },
      /** Copy a LOCAL project and its designs to Drive, verify every design reads back, and only then delete the local copy.
       *  Returns { projectId, designIds: { oldLocalId: newDriveId } } (a buffer bound to a moved design must follow: followMoves). */
      async moveProjectToDrive(projectId) {
        if (isRemoteId(projectId)) throw new Error('That project is already on Drive.');
        const remote = getRemote();
        await local.setMeta(DRIVE_ENABLED, true);
        const { newPid, idMap, oldIds } = await copyProject(local, remote, projectId, { dstRemote: true });
        const designIds = Object.fromEntries(Object.entries(idMap).map(([o, n]) => [o, withPrefix(n)]));
        const cur = await local.getMeta(CURRENT_DESIGN_KEY);
        if (cur && designIds[cur]) await local.setMeta(CURRENT_DESIGN_KEY, designIds[cur]);
        for (const id of oldIds) await local.deleteDesign(id);          // the local copy goes LAST, after the verified remote copy
        await local.deleteProject(projectId);
        return { projectId: withPrefix(newPid), designIds };
      },
      /** Whether new things are created on Drive right now (signed in + the default setting on). */
      driveWanted: () => preferDrive(),
      /** "Save to Google Drive": put ONE design into the Drive project "My Designs" (created when absent), WITHOUT moving its local project.
       *  A local design keeps ONE Drive copy (remembered per design, updated on a repeat); one that already lives on Drive needs no copy.
       *  `design` = the full record. Returns { fileId }. A snapshot: later autosaves of a local design do not follow it. */
      async saveDesignToDrive(design, { name, now }) {
        if (isRemoteId(design.id)) return { fileId: strip(design.id) };
        const remote = getRemote();
        const pid = strip(await driveDefaultProject(name, now));
        const key = 'driveCopy:' + design.id;
        let fileId = await local.getMeta(key);
        if (!fileId || !(await remote.getDesign(fileId))) { fileId = await remote.newId('d'); await local.setMeta(key, fileId); }
        await remote.putDesign({ ...design, id: fileId, projectId: pid });
        return { fileId };
      },
      /** "Check Google Drive connection" (the Drive adapter's own check): onStep(steps) as it goes. */
      checkConnection: (onStep) => getRemote().checkConnection(onStep),
      /** The reverse: copy a Drive project down to this device, verify, then trash the Drive copy. */
      async makeProjectLocal(projectId) {
        if (!isRemoteId(projectId)) throw new Error('That project is already on this device.');
        const remote = getRemote();
        const { newPid, idMap, oldIds } = await copyProject(remote, local, strip(projectId), { dstRemote: false });
        const designIds = Object.fromEntries(Object.entries(idMap).map(([o, n]) => [withPrefix(o), n]));
        const cur = await local.getMeta(CURRENT_DESIGN_KEY);
        if (cur && designIds[cur]) await local.setMeta(CURRENT_DESIGN_KEY, designIds[cur]);
        for (const id of oldIds) await remote.deleteDesign(id);
        await remote.deleteProject(strip(projectId));
        return { projectId: newPid, designIds };
      },
    },
  };
  return router;
}
