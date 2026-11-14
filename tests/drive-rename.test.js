// tests/drive-rename.test.js — TASK 635: renaming a design on Drive renames the Drive FILE and the "name" saved inside it (one place: the
// Drive adapter's write), the Projects-list rename and the drawer rename are the same store.rename; a project rename renames the Drive
// folder; the "Open in Drive" link targets the design's project FOLDER. FAKE Drive only (no Google call anywhere).
import assert from 'node:assert';
import { createFakeDrive } from './harness/fake-drive.js';
import { createDriveAdapter, driveFolderUrl } from '../packages/ui/cloud/drive-adapter.js';
import { createRouterAdapter } from '../packages/ui/cloud/router-adapter.js';
import { createProjectStore, createMemoryAdapter } from '../packages/ui/project-store.js';

const drive = createFakeDrive();
const account = { authedFetch: (url, opts = {}) => drive.fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + drive.token, ...(opts.headers || {}) } }) };
const local = createMemoryAdapter();
const remote = createDriveAdapter({ account, meta: local });
const router = createRouterAdapter({ local, getRemote: () => remote, signedIn: () => true });
const store = createProjectStore({ adapter: router, channel: null });
const files = () => [...drive.files.values()].filter((f) => !f.trashed && f.name.endsWith('.sketch.json'));
const fileOf = (id) => drive.files.get(id.replace(/^drive:/, ''));
const inner = (f) => JSON.parse(f.content).name;

const p = await store.createProject('Garage');
const d = await store.newDesign('Untitled', { app: 'sketchstudio', projectId: p.id });
assert.deepStrictEqual(files().map((f) => [f.name, inner(f)]), [['Untitled.sketch.json', 'Untitled']]);

// rename (drawer / tab / Projects list all call store.rename): the file name AND the saved name follow
await store.rename(d.id, 'bromont');
await store.flushDrive(d.id);
assert.deepStrictEqual(files().map((f) => [f.name, inner(f)]), [['bromont.sketch.json', 'bromont']], 'file + saved name renamed');
assert.deepStrictEqual((await store.listRecent()).map((r) => r.name), ['bromont'], 'Open recent follows');
assert.strictEqual((await store.current()).name, 'bromont', 'current (tab label) follows');

// a rename while an autosave is still pending must not write the old name back
await store.save({ ...(await store.get(d.id)).document, geometry: { joints: [['j1', { x: 1, y: 1 }]], shapes: [], constraints: [] } }, { id: d.id });
await store.rename(d.id, 'bromont 2');
await store.flushDrive(d.id);
assert.deepStrictEqual(files().map((f) => [f.name, inner(f)]), [['bromont 2.sketch.json', 'bromont 2']], 'pending autosave keeps the new name');
assert.strictEqual(JSON.parse(files()[0].content).document.geometry.joints[0][1].x, 1, 'the pending edit was written too');

// naming an Untitled = its first named save (Save as): the file is "<name>.sketch.json"
const saved = await store.saveAs('Fresh', { app: 'sketchstudio', projectId: p.id });
assert(files().some((f) => f.name === 'Fresh.sketch.json' && inner(f) === 'Fresh'), 'new named save is Fresh.sketch.json');

// project rename renames the Drive folder
await store.renameProject(p.id, 'Garage2');
assert(drive.byName('Garage2').some((f) => !f.trashed) && !drive.byName('Garage').some((f) => !f.trashed), 'folder renamed on Drive');

// Open in Drive = the design's project folder
const st = store.status(d.id);
assert.strictEqual(st.projectId, p.id, 'status carries the design\'s project');
const folder = fileOf(p.id);
assert.strictEqual(driveFolderUrl(st.projectId), `https://drive.google.com/drive/folders/${folder.id}`);
assert.strictEqual(fileOf(d.id).parents[0], folder.id, 'the file is in that folder');
assert.strictEqual(driveFolderUrl(folder.id), driveFolderUrl(p.id), 'plain and prefixed ids give the same URL');
console.log('drive-rename: ok');
