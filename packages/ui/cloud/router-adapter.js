// packages/ui/cloud/router-adapter.js — the ROUTER adapter (TASK 480): one adapter for the store that sends every project / design
// to the LOCAL IndexedDB adapter or to the DRIVE adapter, by where that project lives. It is where the owner's rulings live:
//   - signing in changes NOTHING here: Drive is used only for a project the user explicitly moved there (moveProjectToDrive),
//     and Drive projects are even LISTED only after the user turned Drive on (enableDrive, which moveProjectToDrive also does);
//   - a project that was never moved never touches the network (the local adapter does all of it, exactly as before 480);
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

/** createRouterAdapter({ local, getRemote }): getRemote() returns the Drive adapter (created lazily: nothing is built or called until Drive is used). */
export function createRouterAdapter({ local, getRemote }) {
  let remoteError = null;
  const driveEnabled = async () => !!(await local.getMeta(DRIVE_ENABLED));
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

  const router = {
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
    // newId is deliberately NOT defined: the store mints local ids; Drive ids are minted by the explicit actions below.

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
