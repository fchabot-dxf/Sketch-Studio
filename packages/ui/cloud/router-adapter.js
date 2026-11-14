// packages/ui/cloud/router-adapter.js — the ROUTER adapter (TASK 480, reworked in TASK 624): one adapter for the store that sends
// every NEW project / design ONLY to Google Drive, while keeping legacy local projects readable/editable until moved to Drive:
//   - all new named saves (`newId`, `defaultProject`) go ONLY to Drive (signing in moves nothing; legacy local projects stay openable and
//     can be moved with `moveProjectToDrive`);
//   - Drive projects are LISTED while signed in or once Drive was used (`driveEnabled` meta);
//   - meta (current-design pointer, flags, working open-tabs buffer) is always local.
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

/** createRouterAdapter({ local, getRemote, signedIn, subscribeSignIn }): getRemote() returns the Drive adapter (lazily constructed). */
export function createRouterAdapter({ local, getRemote, signedIn = () => false, subscribeSignIn = () => () => {} }) {
  let remoteError = null;
  let driveDefault = null; // the IN-FLIGHT lookup of the Drive default project (concurrent callers share it; never cached after: the account may change)
  const driveEnabled = async () => !!(await local.getMeta(DRIVE_ENABLED)) || signedIn();
  /** A remote listing for the merged lists: only when Drive is on, and a failure (offline, signed out) must not hide legacy local projects. */
  async function remoteList(fn) {
    if (!(await driveEnabled())) return [];
    try { const out = await fn(getRemote()); remoteError = null; return out; } catch (e) { remoteError = e; return []; }
  }
  const noCrossing = () => new Error('A design cannot move between your device and Drive one by one: move the whole project to Drive instead.');

  async function copyProject(srcAdapter, dstAdapter, projectId) {
    const src = srcAdapter;
    const proj = await src.getProject(projectId);
    if (!proj) throw gone('project');
    const designs = (await src.listDesigns()).filter((d) => d.projectId === projectId);
    const newPid = await dstAdapter.newId('p');
    await dstAdapter.putProject({ ...proj, id: newPid });
    const idMap = {};
    for (const m of designs) {
      const full = await src.getDesign(m.id);
      const nid = await dstAdapter.newId('d');
      await dstAdapter.putDesign({ ...full, id: nid, projectId: newPid });
      idMap[m.id] = nid;
    }
    for (const nid of Object.values(idMap)) if (!(await dstAdapter.getDesign(nid))) throw new Error('The copy could not be verified: nothing was removed from the original.');
    return { newPid, idMap, oldIds: designs.map((d) => d.id) };
  }

  /** The Drive project called `name` (the default "My Designs"): found by name among the Drive projects, created when absent. Two tabs /
   *  devices creating it at the same moment: the default is the OLDEST one (a lookup rule). A folder is trashed ONLY by the device that just
   *  created it, and ONLY while it is still empty; one anything was put into is kept, so the duplicates just coexist. */
  async function ensureDriveDefault(name, now) {
    if (!signedIn()) throw new Error('cloud-auth');
    const remote = getRemote();
    const find = async () => (await remote.listProjects()).filter((p) => p.name === name).sort((a, b) => (a.createdAt - b.createdAt) || String(a.id).localeCompare(String(b.id)));
    let found = await find();
    if (!found.length) {
      const id = await remote.newId('p');
      await remote.putProject({ id, name, pinned: false, updatedAt: now() });
      found = await find();
      if (found.length && found[0].id !== id && found.some((p) => p.id === id)) {
        const used = (await remote.listDesigns()).some((d) => d.projectId === id);
        if (!used) { await remote.deleteProject(id); found = found.filter((p) => p.id !== id); }
      }
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
    listMetaKeys: (prefix) => local.listMetaKeys(prefix),
    getMeta: (k) => local.getMeta(k),
    setMeta: (k, v) => local.setMeta(k, v),
    setMetaIfAbsent: (k, v) => local.setMetaIfAbsent(k, v),
    /** Where a NEW project / design is created: always on Google Drive (TASK 624). Throws `cloud-auth` when signed out. */
    async newId(kind, projectId) {
      if (!signedIn()) throw new Error('cloud-auth');
      if (projectId && !isRemoteId(projectId)) throw noCrossing();
      const id = withPrefix(await getRemote().newId(kind));
      await local.setMeta(DRIVE_ENABLED, true);
      return id;
    },
    /** The default project ("My Designs"): ONE on Drive (`local: true` ONLY for pre-474 legacy migration). Returns its id. */
    async defaultProject({ id, name, now, local: forceLocal = false }) {
      if (forceLocal) {
        await local.putProjectIfAbsent({ id, name, pinned: false, updatedAt: now() });
        return id;
      }
      return driveDefaultProject(name, now);
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
        const { newPid, idMap, oldIds } = await copyProject(local, remote, projectId);
        const designIds = Object.fromEntries(Object.entries(idMap).map(([o, n]) => [o, withPrefix(n)]));
        const cur = await local.getMeta(CURRENT_DESIGN_KEY);
        if (cur && designIds[cur]) await local.setMeta(CURRENT_DESIGN_KEY, designIds[cur]);
        for (const id of oldIds) await local.deleteDesign(id);          // the local copy goes LAST, after the verified remote copy
        await local.deleteProject(projectId);
        return { projectId: withPrefix(newPid), designIds };
      },
      /** Is an account signed in? Unconfirmed local copies are only sent while it is. */
      signedIn: () => signedIn(),
      /** fn() runs when the sign-in state changes (the store then resumes the Drive writes it held while signed out). */
      onSignInChange: (fn) => subscribeSignIn(fn),
      /** "Check Google Drive connection" (the Drive adapter's own check): onStep(steps) as it goes. */
      checkConnection: (onStep) => getRemote().checkConnection(onStep),
    },
  };
  return router;
}
