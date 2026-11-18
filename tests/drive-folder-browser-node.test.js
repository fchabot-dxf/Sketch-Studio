// tests/drive-folder-browser-node.test.js -- Google Drive in-app folder browser (within "Sketch Studio"):
//   1. saveAsDialog / openDialog browseDrive hooks exclude legacy local folders and list only Drive folders under "Sketch Studio".
//   2. Saving an Untitled or stored copy into a chosen or newly created folder writes directly into that Drive folder (parents[0] === folderId).
//   3. Opening navigates a folder via browseDrive.listFolderDesigns and tracks loaded design names.
//   4. Offline / Drive listing failure surfaces clearly via listFolders instead of masking Drive errors as empty.
import assert from 'node:assert';
import { createFakeDrive } from './harness/fake-drive.js';
import { createDriveAdapter } from '../packages/ui/cloud/drive-adapter.js';
import { createRouterAdapter } from '../packages/ui/cloud/router-adapter.js';
import { createProjectStore, createMemoryAdapter } from '../packages/ui/project-store.js';
import { createDocumentBuffer } from '../packages/ui/document-buffer.js';
import { createProjectActions } from '../packages/ui/project-actions.js';
import { createSketchState } from '../packages/core/sketch-state.js';
import { createEngine } from '../packages/core/constraint-solver.js';

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

let nowVal = 50000;
let online = true;
const drive = createFakeDrive();
const local = createMemoryAdapter();
const account = {
  state: () => ({ signedIn: true }),
  authedFetch: (url, opts = {}) => {
    if (!online) return Promise.reject(new TypeError('Failed to fetch'));
    return drive.fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + drive.token, ...(opts.headers || {}) } });
  },
  subscribe: () => () => {},
};
const remote = createDriveAdapter({ account, meta: local });
const router = createRouterAdapter({ local, getRemote: () => remote, signedIn: () => true });
const store = createProjectStore({ adapter: router, legacySource: async () => null, now: () => ++nowVal, channel: null });

// Seed 1 legacy local project + 2 Drive folders ("My Designs", "Furniture") inside "Sketch Studio"
await local.putProject({ id: 'local_only_proj', name: 'Local Legacy', pinned: false, updatedAt: 100 });
const myDesigns = await store.createProject('My Designs');
const furniture = await store.createProject('Furniture');
const chair = await store.newDesign('Chair', { app: 'sketchstudio', projectId: furniture.id });
await store.setCurrent(null);

const engine = createEngine(null);
engine.init();
const state = createSketchState(engine, { x: 0, y: 0, w: 100, h: 80 });
state.joints.set('j1', { x: 10, y: 20 });
const buffer = createDocumentBuffer({ state, app: 'sketchstudio', store, pollMs: 1e9, doc: null, win: null });
await buffer.restore();

// 1. Intercept fileDialog options passed by createProjectActions to inspect & exercise browseDrive directly
let lastDialogOpts = null;
const actions = createProjectActions({
  store,
  getBuffer: () => buffer,
  account,
  fileDialog: async (opts) => { lastDialogOpts = opts; return null; },
});

await actions.saveAsDialog({ name: 'Bench Seat' });
ok(lastDialogOpts && lastDialogOpts.browseDrive, 'saveAsDialog provides browseDrive hooks');
eq(lastDialogOpts.browseDrive.rootLabel, 'Sketch Studio', 'root label is the app root folder name');
const listedFolders = await lastDialogOpts.browseDrive.listFolders();
eq(listedFolders.map((f) => f.name).sort(), ['Furniture', 'My Designs'], 'Drive browser excludes local-only legacy projects');
eq(await lastDialogOpts.browseDrive.initialFolderId(), null, 'Untitled design starts at root (no stored Drive folder yet)');
const inFurn = await lastDialogOpts.browseDrive.listFolderDesigns(furniture.id);
eq(inFurn.map((d) => d.name), ['Chair'], 'lists existing designs inside Furniture folder');

// 2. Create a new folder inside "Sketch Studio" & save the Untitled design directly inside it
const createdFolder = await lastDialogOpts.browseDrive.createFolder('Cabinets');
const cabRaw = drive.files.get(createdFolder.id.replace(/^drive:/, ''));
const rootFolder = drive.byName('Sketch Studio')[0];
eq(cabRaw.parents, [rootFolder.id], 'createFolder creates a real Google Drive folder inside Sketch Studio');
const savedInCab = await lastDialogOpts.onSave('drive', 'Wall Unit', createdFolder.id);
const wallRaw = drive.files.get(savedInCab.id.replace(/^drive:/, ''));
eq(wallRaw.name, 'Wall Unit.sketch.json', 'saved .sketch.json file inside Drive');
eq(wallRaw.parents, [cabRaw.id], 'saved Untitled design lands directly in chosen Drive folder');

// 3. Stored design Save as defaults to its current folder, and can also save a copy into a different Drive folder
await actions.saveAsDialog();
eq(await lastDialogOpts.browseDrive.initialFolderId(), createdFolder.id, 'stored design opens Save as in its current Drive folder');
const copiedToFurn = await lastDialogOpts.onSave('drive', 'Oak Chair', furniture.id);
const oakRaw = drive.files.get(copiedToFurn.id.replace(/^drive:/, ''));
eq(oakRaw.parents, [furniture.id.replace(/^drive:/, '')], 'stored Save as copy into another Drive folder lands in target folder');

// 4. Open dialog lists folders & folder designs and navigates back to Chair
await actions.openDialog();
ok(lastDialogOpts.mode === 'open' && lastDialogOpts.browseDrive, 'openDialog provides browseDrive');
ok(!lastDialogOpts.browseDrive.createFolder, 'openDialog browseDrive is read-only');
const openFurnDesigns = await lastDialogOpts.browseDrive.listFolderDesigns(furniture.id);
ok(openFurnDesigns.some((d) => d.name === 'Chair') && openFurnDesigns.some((d) => d.name === 'Oak Chair'), 'Open dialog folder listing shows both designs');
const opened = await lastDialogOpts.onOpenDesign(chair.id);
ok(opened && buffer.designName() === 'Chair', 'onOpenDesign loads selected file from folder');

// 5. Offline Drive failure surfaces loudly instead of returning an empty folder list
online = false;
await assert.rejects(() => lastDialogOpts.browseDrive.listFolders(), /Google Drive could not be reached/, 'offline listing error surfaced');
online = true;

console.log(`drive-folder-browser-node: ${checks} checks passed`);
