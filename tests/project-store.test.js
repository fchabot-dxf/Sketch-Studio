// tests/project-store.test.js — TASK 474: projects (folders) and designs (CRUD, recent order, pinned, move), autosave into the current project, the legacy
// slot migration, the project FILE round trip, cross-host sidecars, newer-version refusal, and the buffer's binding rules.
// Runs on the in-memory adapter (same interface as the IndexedDB one; tests/project-store-idb.test.js runs the same contract
// against real IndexedDB in a browser).
import assert from 'node:assert';
import { createProjectStore, createMemoryAdapter, emptyDocument, LEGACY_DESIGN_ID, DEFAULT_PROJECT_ID } from '../packages/ui/project-store.js';
import { serializeProjectFile, parseProjectFile, ProjectFileError, PROJECT_FILE_EXT, projectFileName } from '../packages/ui/project-file.js';
import { createDocumentBuffer } from '../packages/ui/document-buffer.js';
import { validateDocument, DOCUMENT_VERSION } from '../packages/core/document.js';

let t = 1000;
const mk = (opts = {}) => {
  let n = 0;
  return createProjectStore({ adapter: opts.adapter || createMemoryAdapter(), legacySource: opts.legacySource || (async () => null), idFn: () => 'id' + (++n), now: () => ++t, channel: null });
};
const doc = (marker, hosts = {}) => ({ ...emptyDocument(), geometry: { joints: [['j1', { x: marker, y: 0 }]], shapes: [], constraints: [] }, hosts });
const memSeam = () => { const s = { text: null, name: null, save: async (text, name) => { s.text = text; s.name = name; return { name }; }, open: async () => (s.text == null ? null : { name: s.name, text: s.text }) }; return s; };

// 1. CRUD + recent ordering
{
  const store = mk();
  assert.strictEqual(await store.current(), null, 'no project yet');
  const a = await store.newDesign('Alpha', { app: 'shaper' });
  const b = await store.newDesign('Beta', { app: 'penplotter' });
  const c = await store.newDesign('Gamma', { app: 'shaper' });
  assert.strictEqual((await store.current()).id, c.id, 'the newest new project is current');
  assert.deepStrictEqual((await store.listRecent()).map((p) => p.name), ['Gamma', 'Beta', 'Alpha'], 'newest first');
  assert.deepStrictEqual((await store.listRecent('shaper')).map((p) => p.name), ['Gamma', 'Alpha'], 'filtered by app');
  assert.deepStrictEqual((await store.listRecent({ limit: 2 })).map((p) => p.name), ['Gamma', 'Beta'], 'limit');
  assert(!('document' in (await store.listRecent())[0]), 'the list carries no document bodies');
  const opened = await store.open(a.id);
  assert.strictEqual(opened.name, 'Alpha'); assert.strictEqual((await store.current()).id, a.id, 'open makes it current');
  await store.rename(b.id, '  Beta 2 ');
  assert.strictEqual((await store.get(b.id)).name, 'Beta 2', 'rename trims');
  assert.strictEqual((await store.listRecent())[0].id, b.id, 'rename counts as a change: it moves to the top');
  await assert.rejects(() => store.rename(b.id, '   '), /needs a name/, 'a blank name is refused');
  const d = await store.duplicate(a.id);
  assert.strictEqual(d.name, 'Alpha copy'); assert.notStrictEqual(d.id, a.id);
  assert.strictEqual((await store.current()).id, a.id, 'duplicate does not change the current project');
  await store.remove(a.id);
  assert.strictEqual(await store.current(), null, 'removing the current project clears the pointer');
  assert.strictEqual((await store.listRecent()).length, 3);
  await assert.rejects(() => store.open('nope'), /no longer exists/);
}

// 2. autosave goes to the CURRENT project; the first autosave creates "Untitled"; other hosts' sidecars pass through (458)
{
  const store = mk();
  const first = await store.save(doc(1, { shaper: { cut: 'pocket' } }), { app: 'shaper' });
  const cur = await store.current();
  assert.strictEqual(cur.name, 'Untitled'); assert.strictEqual(cur.id, first.id);
  assert.strictEqual((await store.listRecent()).length, 1, 'one project, not a slot per save');
  await store.save(doc(2, { penplotter: { pens: 3 } }), { app: 'penplotter' });            // another app saves: shaper sidecar must survive
  let p = await store.get(first.id);
  assert.deepStrictEqual(Object.keys(p.document.hosts).sort(), ['penplotter', 'shaper'], 'both sidecars kept');
  assert.strictEqual(p.document.geometry.joints[0][1].x, 2, 'the geometry is the latest save');
  assert.strictEqual(p.app, 'penplotter', 'app = who saved it last');
  await store.save(doc(3), { app: 'sketchstudio' });                                        // a host-less save deletes nobody
  p = await store.get(first.id);
  assert.deepStrictEqual(Object.keys(p.document.hosts).sort(), ['penplotter', 'shaper'], 'a host-less save keeps every sidecar');
  assert.deepStrictEqual(p.document.hosts.shaper, { cut: 'pocket' });
  // saving into a specific id does not touch the current one
  const other = await store.newDesign('Other');
  await store.save(doc(9), { id: first.id });
  assert.strictEqual((await store.get(other.id)).document.geometry.joints.length, 0, 'an id-targeted save leaves other projects alone');
  // the project vanished under a tab: the work is kept as a new "Untitled" with that id
  await store.remove(first.id);
  const back = await store.save(doc(4), { id: first.id });
  assert.strictEqual((await store.get(back.id)).name, 'Untitled', 'work is never dropped');
}

// 3. migration of the old autosave slot -> the first project "Untitled"; nothing deleted; idempotent; no loss paths
{
  const legacy = doc(7, { penplotter: { v: 1 } });
  let reads = 0;
  const adapter = createMemoryAdapter();
  const legacySource = async () => { reads++; return JSON.parse(JSON.stringify(legacy)); };
  const store = mk({ adapter, legacySource });
  const rec = await store.loadCurrent({ app: 'penplotter' });
  assert(rec && rec.id === LEGACY_DESIGN_ID && rec.name === 'Untitled', 'the slot became the design "Untitled"');
  assert.deepStrictEqual((await store.listProjects()).map((p) => p.name), ['My Designs'], 'inside the default project "My Designs"');
  assert.strictEqual(rec.projectId, DEFAULT_PROJECT_ID);
  assert.deepStrictEqual(rec.document, legacy, 'the migrated document is the slot document, unchanged (sidecars too)');
  assert.strictEqual((await store.current()).id, LEGACY_DESIGN_ID, 'and it is the current project');
  await store.loadCurrent({ app: 'shaper' });
  assert.strictEqual(reads, 1, 'migrated once');
  assert.strictEqual((await store.listRecent()).length, 1);
  // two tabs migrating at the same moment: exactly one project, the first writer wins, no overwrite of later saves
  const a2 = createMemoryAdapter();
  const s1 = createProjectStore({ adapter: a2, legacySource, idFn: () => 'x1', now: () => ++t, channel: null });
  const s2 = createProjectStore({ adapter: a2, legacySource, idFn: () => 'x2', now: () => ++t, channel: null });
  await Promise.all([s1.loadCurrent({ app: 'a' }), s2.loadCurrent({ app: 'b' })]);
  assert.strictEqual((await s1.listRecent()).length, 1, 'concurrent migrations make ONE project');
  await s1.save(doc(8), { id: LEGACY_DESIGN_ID });
  await s2.loadCurrent({ app: 'b' });
  assert.strictEqual((await s1.get(LEGACY_DESIGN_ID)).document.geometry.joints[0][1].x, 8, 'a later migration pass does not overwrite newer work');
  // projects already exist (e.g. the flag was lost): the slot is NOT imported over them
  const a3 = createMemoryAdapter();
  const s3 = createProjectStore({ adapter: a3, legacySource, idFn: () => 'y1', now: () => ++t, channel: null });
  await s3.newDesign('Mine');
  await s3.loadCurrent({ app: 'a' });
  assert.deepStrictEqual((await s3.listRecent()).map((p) => p.name), ['Mine'], 'existing projects are never joined by a migration');
  // an empty / unreadable slot: nothing created, no error, and the flag stops re-reading
  const s4 = mk({ legacySource: async () => null });
  assert.strictEqual(await s4.loadCurrent({ app: 'a' }), null);
  assert.strictEqual((await s4.listRecent()).length, 0);
}

// 4. saveAs / duplicate copy independently
{
  const store = mk();
  await store.save(doc(1, { shaper: { a: 1 } }), { app: 'shaper' });
  const copy = await store.saveAs('Snapshot', { app: 'shaper' });
  assert.strictEqual((await store.current()).id, copy.id, 'Save As makes the copy current');
  await store.save(doc(2), { app: 'shaper' });
  const rows = await store.listRecent();
  const orig = rows.find((r) => r.name === 'Untitled');
  assert.strictEqual((await store.get(orig.id)).document.geometry.joints[0][1].x, 1, 'the original keeps its last saved state');
  assert.strictEqual((await store.get(copy.id)).document.geometry.joints[0][1].x, 2, 'the copy takes the new autosaves');
  assert.deepStrictEqual((await store.get(copy.id)).document.hosts.shaper, { a: 1 }, 'the copy carries the sidecars');
}

// 5. the project FILE: envelope, byte-stable round trip per host, newer versions refused
{
  const store = mk();
  const hosts = { penplotter: { pens: [{ id: 'pen1', color: '#ff0000' }], settings: { draw_feed: 1234 } }, shaper: { cut: 'inside', depth: 6 } };
  await store.save(doc(5, hosts), { app: 'penplotter' });
  await store.rename((await store.current()).id, 'Bench / part: 1?');
  const seam = memSeam();
  const out = await store.exportFile(undefined, seam);
  assert.strictEqual(out.name, 'Bench _ part_ 1_' + PROJECT_FILE_EXT, 'a file-safe name with the extension: ' + out.name);
  const env = JSON.parse(seam.text);
  assert.deepStrictEqual(Object.keys(env), ['format', 'version', 'app', 'name', 'document'], 'a small envelope with a fixed key order');
  assert.strictEqual(env.format, 'sketch-studio-project'); assert.strictEqual(env.name, 'Bench / part: 1?');
  const first = seam.text;
  // open it into a fresh store (another browser), save it again: identical bytes, every host's sidecar equal
  const other = mk();
  const imported = await other.importFile(seam, { app: 'shaper' });
  assert.strictEqual(imported.name, 'Bench / part: 1?'); assert.strictEqual((await other.current()).id, imported.id, 'an imported project becomes current');
  assert.deepStrictEqual(imported.document.hosts, hosts, 'both hosts\' sidecars survive the file round trip');
  const seam2 = memSeam();
  await other.exportFile(undefined, seam2);
  assert.strictEqual(seam2.text, first, 'save -> open -> save is byte-stable');
  // cancelling a picker is not an error
  assert.strictEqual(await other.importFile({ open: async () => null }), null);
  assert.strictEqual(await other.exportFile(undefined, { save: async () => null }), null);
  // refusals: nothing is stored
  const before = (await other.listRecent()).length;
  const refuse = async (text, re, why) => {
    await assert.rejects(() => other.importFile({ open: async () => ({ name: 'x', text }) }), (e) => e instanceof ProjectFileError && re.test(e.message), why);
    assert.strictEqual((await other.listRecent()).length, before, 'nothing stored after: ' + why);
  };
  const newerDoc = { ...doc(1), version: DOCUMENT_VERSION + 1 };
  await refuse(serializeProjectFile({ app: 'x', name: 'n', document: newerDoc }), /newer version of Sketch Studio.*Update the app/, 'a document from a newer version');
  await refuse(JSON.stringify({ format: 'sketch-studio-project', version: 99, document: doc(1) }), /newer version of Sketch Studio \(file format 99/, 'an envelope from a newer version');
  await refuse('{nope', /not valid JSON/, 'not JSON');
  await refuse(JSON.stringify({ hello: 1 }), /not a Sketch Studio project file/, 'some other JSON');
  await refuse(JSON.stringify({ format: 'sketch-studio-project', version: 1, document: { geometry: {} } }), /damaged \(missing version field\)/, 'a damaged document');
  assert.strictEqual(validateDocument(newerDoc).newer, true);
  assert.strictEqual(projectFileName('  '), 'Untitled' + PROJECT_FILE_EXT);
  assert.deepStrictEqual(parseProjectFile(first).document, JSON.parse(first).document);
}

// 6. the buffer: restore, autosave into the bound project, open / new / save-as / file, and the binding rule
{
  const store = mk({ legacySource: async () => doc(1, { penplotter: { v: 1 } }) });
  const mkState = () => ({ joints: new Map(), shapes: [], constraints: [] });
  const calls = [];
  const sA = mkState();
  const A = createDocumentBuffer({ state: sA, app: 'penplotter', hostName: 'penplotter', getHostData: () => ({ v: sA.joints.size }), store, pollMs: 1e9, onRestored: (r) => calls.push(['A', r.restored, r.name, Object.keys(r.hosts)]) });
  const r0 = await A.restore();
  assert(r0.restored && r0.name === 'Untitled' && sA.joints.get('j1').x === 1, 'the old slot is restored through the migration');
  assert.deepStrictEqual(calls[0], ['A', true, 'Untitled', ['penplotter']]);
  sA.joints.set('j2', { x: 5, y: 5 });
  await A.flush();
  const first = A.designId();
  assert.strictEqual((await store.get(first)).document.geometry.joints.length, 2, 'autosave wrote into the current project');
  assert.strictEqual((await store.get(first)).document.hosts.penplotter.v, 2, 'with the host sidecar');
  // a second app (its own buffer) sharing the project, no sidecar of its own: the plotter sidecar survives its save
  const sB = mkState();
  const B = createDocumentBuffer({ state: sB, app: 'shaper', store, pollMs: 1e9 });
  await B.restore();
  sB.joints.set('j3', { x: 9, y: 9 });
  await B.flush();
  assert.deepStrictEqual((await store.get(first)).document.hosts.penplotter, { v: 2 }, 'the other host\'s sidecar is untouched by B\'s save');
  // Save As from A: new current project; further A autosaves go there, the original stays as it was
  await A.flush();
  const copy = await A.saveAs('Version 2');
  sA.joints.set('j4', { x: 1, y: 1 });
  await A.flush();
  assert.strictEqual(A.designId(), copy.id);
  assert.strictEqual((await store.get(copy.id)).document.geometry.joints.length, 3 + 0 || 3, 'the copy takes the new autosaves');
  // binding: B (still bound to the first project) keeps writing THERE even though the global pointer now names the copy
  sB.joints.set('j5', { x: 2, y: 2 });
  await B.flush();
  assert.strictEqual(B.designId(), first, 'B stays bound to its own project');
  assert(!(await store.get(copy.id)).document.geometry.joints.some((j) => j[0] === 'j5'), 'B\'s drawing did not land in the project another tab opened');
  // open: A loads the first project; its state is REPLACED, its onRestored fires with that project's sidecar
  const ro = await A.openDesign(first);
  assert(ro.restored && ro.name === 'Untitled' && sA.joints.has('j5') && !sA.joints.has('j4'), 'open replaces the whole state');
  assert.strictEqual((await store.current()).id, first);
  assert.deepStrictEqual(calls[calls.length - 1].slice(0, 3), ['A', true, 'Untitled']);
  // new project: empty state, empty hosts (the host resets its own state in onRestored)
  const rn = await A.newDesign('Fresh');
  assert(rn.restored && sA.joints.size === 0 && Object.keys(rn.hosts).length === 0 && rn.name === 'Fresh', 'a new project is empty');
  // files through the buffer
  sA.joints.set('jz', { x: 3, y: 3 });
  const seam = memSeam();
  await A.saveFile(seam);
  assert.strictEqual(JSON.parse(seam.text).name, 'Fresh');
  assert(JSON.parse(seam.text).document.geometry.joints.some((j) => j[0] === 'jz'), 'saveFile flushes pending edits first');
  const rf = await A.openFile(seam);
  assert(rf.restored && rf.name === 'Fresh' && A.designId() !== (await store.listRecent()).find((p) => p.name === 'Version 2').id, 'openFile imports as a NEW project and loads it');
  // a newer-version file is refused by the buffer too, state untouched
  const bad = { open: async () => ({ name: 'n', text: serializeProjectFile({ app: 'x', name: 'n', document: { ...doc(1), version: DOCUMENT_VERSION + 1 } }) }) };
  const sizeBefore = sA.joints.size;
  await assert.rejects(() => A.openFile(bad), /newer version/);
  assert.strictEqual(sA.joints.size, sizeBefore, 'a refused file changes nothing');
}

// 7. PROJECTS (folders): create / rename / pin / order, designs live in one project, listRecent spans projects, move, refusals
{
  const store = mk();
  const d0 = await store.newDesign('First', { app: 'shaper' });
  const defaults = await store.listProjects();
  assert.deepStrictEqual(defaults.map((p) => p.name), ['My Designs'], 'a design with no project lands in the default one');
  assert.strictEqual(d0.projectId, DEFAULT_PROJECT_ID);
  const atelier = await store.createProject('Atelier');
  const bits = await store.createProject('Outils / Bits');
  assert.deepStrictEqual((await store.listProjects()).map((p) => p.name), ['Outils / Bits', 'Atelier', 'My Designs'], 'newest change first');
  await store.pinProject(atelier.id);
  assert.deepStrictEqual((await store.listProjects()).map((p) => p.name), ['Atelier', 'Outils / Bits', 'My Designs'], 'pinned first');
  assert.strictEqual((await store.listProjects())[0].pinned, true);
  await store.pinProject(atelier.id, false);
  assert.strictEqual((await store.listProjects()).find((p) => p.id === atelier.id).pinned, false, 'unpin');
  await store.renameProject(bits.id, ' Bits ');
  assert.strictEqual((await store.listProjects()).find((p) => p.id === bits.id).name, 'Bits');
  await assert.rejects(() => store.createProject(' '), /project needs a name/);
  // designs go to the asked project; listDesigns is per project; listRecent spans all and names the project
  const d1 = await store.newDesign('Shelf', { app: 'penplotter', projectId: atelier.id });
  const d2 = await store.newDesign('Drill', { app: 'shaper', projectId: bits.id });
  assert.deepStrictEqual((await store.listDesigns(atelier.id)).map((d) => d.name), ['Shelf']);
  assert.deepStrictEqual((await store.listDesigns(DEFAULT_PROJECT_ID)).map((d) => d.name), ['First']);
  const recent = await store.listRecent();
  assert.deepStrictEqual(recent.map((d) => d.name), ['Drill', 'Shelf', 'First'], 'recent spans every project, newest first');
  assert.deepStrictEqual(recent.map((d) => d.projectName), ['Bits', 'Atelier', 'My Designs'], 'with the project name');
  assert.deepStrictEqual((await store.listRecent('penplotter')).map((d) => d.name), ['Shelf']);
  // saving a design bumps its project to the top of the recent projects (an unpinned one)
  await store.save(doc(1), { id: d1.id, app: 'penplotter' });
  assert.strictEqual((await store.listProjects())[0].id, atelier.id, 'a save marks its project as recently changed');
  // saveAs / duplicate stay in the source project; the new design of the CURRENT design's project is the default target
  await store.open(d1.id);
  const copy = await store.saveAs('Shelf v2');
  assert.strictEqual(copy.projectId, atelier.id, 'Save As stays in the same project');
  assert.strictEqual((await store.duplicate(d2.id)).projectId, bits.id, 'duplicate stays in the same project');
  const fresh = await store.newDesign('Next');
  assert.strictEqual(fresh.projectId, atelier.id, 'a new design joins the project of the current design');
  // move
  const moved = await store.moveDesign(d1.id, bits.id);
  assert.strictEqual(moved.projectId, bits.id);
  assert.deepStrictEqual((await store.listDesigns(atelier.id)).map((d) => d.name).sort(), ['Next', 'Shelf v2']);
  await assert.rejects(() => store.moveDesign(d1.id, 'nope'), /project no longer exists/);
  // a project that still holds designs is not deleted; an empty one is
  await assert.rejects(() => store.removeProject(bits.id), /still holds \d+ designs?/);
  const empty = await store.createProject('Empty');
  await store.removeProject(empty.id);
  assert.strictEqual((await store.listProjects()).some((p) => p.id === empty.id), false);
  // the file format has no folder: an imported design joins the current project (or the asked one)
  const seam = memSeam();
  await store.exportFile(d2.id, seam);
  const imp = await store.importFile(seam, { projectId: atelier.id });
  assert.strictEqual(imp.projectId, atelier.id);
  // subscribe fires on changes
  let n = 0; const off = store.subscribe(() => n++);
  await store.createProject('Ping'); off(); await store.createProject('Quiet');
  assert.strictEqual(n, 1, 'subscribe fires once per change until unsubscribed');
}
// 8. the adapter seam: a REMOTE-style adapter (async opaque ids, a remote-change hook, local meta) drops in with no store change
{
  const inner = createMemoryAdapter();
  let counter = 0, push = null;
  const remote = { ...inner, newId: async (kind) => { await new Promise((r) => setTimeout(r, 1)); return kind + '-remote-' + (++counter); }, onChange: (fn) => { push = fn; } };
  const store = createProjectStore({ adapter: remote, now: () => ++t, channel: null });
  const p = await store.createProject('Drive folder');
  const d = await store.newDesign('Remote design', { projectId: p.id });
  assert.strictEqual(p.id, 'p-remote-1'); assert.strictEqual(d.id, 'd-remote-2', 'ids come from the adapter (async)');
  assert.strictEqual(d.projectId, p.id);
  let pinged = 0; store.subscribe(() => pinged++);
  push();
  assert.strictEqual(pinged, 1, 'a remote change reaches the store subscribers');
  await store.save(doc(3), { id: d.id, app: 'shaper' });
  assert.strictEqual((await store.get(d.id)).document.geometry.joints[0][1].x, 3);
}
console.log('project-store: ok');
