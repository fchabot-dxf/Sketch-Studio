// tests/newer-sidecar-812-node.test.js — TASK 812 (S0 of docs/OPERATIONS-MODEL.md, the version guard): a host that reads a sidecar whose `version` is ABOVE its
// own (createDocumentBuffer's `hostVersion`; Shaper passes DOC_VERSION) opens the document but NEVER writes over it.
//  A. the buffer, with a fake host and the profile's project store (every write the buffer could make is counted): a version-3 sidecar is opened (onRestored gets
//     `newer: true`), an edit does NOT autosave, the page-hide flush writes nothing, Save as over another design / Save as to a file / Save to the file home
//     refuse with the one message and write nothing, the working buffer keeps the sidecar byte for byte; controls: a version-2 sidecar autosaves, and a host
//     without `hostVersion` is unaffected (the guard is opt-in).
//  B. the real Shaper page: a stored design with a sidecar of a version above the app's (TASK S2: Shaper writes version 4: a version-5 one) is opened, a line is
//     drawn, the stored document's bytes are unchanged, Prepare shows the one notice; a version-2 design draws and saves (as version 4, TASK S2), no notice.
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { createDocumentBuffer } from '#ui/document-buffer.js';
import { serializeProjectFile } from '#ui/project-file.js';

const NEWER = 'Made by a newer version of the app: reload to edit.';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const mk = () => ({ joints: new Map(), shapes: [], constraints: [] });
const sidecar = (version) => ({ version, cutPlan: [], stock: null, opOrder: [], operations: [{ id: 'op-1', type: 'pocket', shapes: ['loop:a', 'loop:b'] }], regions: { 'loop:a': { levels: [1, 2, 3] } } });
const docWith = (shaper) => ({ version: 2, geometry: { joints: [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }]], shapes: [], constraints: [], sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }], activeSketchId: 'sketch-1' }, hosts: { shaper } });

// a store whose every write is counted (the buffer's writes: autosave, Save as, the Drive write-through all go through these)
const WRITES = ['save', 'overwrite', 'saveAs', 'newDesign', 'flushDrive'];
const counted = (store) => {
  const calls = [];
  const proxy = new Proxy(store, { get(t, k) { const v = t[k]; return WRITES.includes(k) && typeof v === 'function' ? (...a) => { calls.push(k); return v.apply(t, a); } : v; } });
  return { store: proxy, calls, reset: () => { calls.length = 0; } };
};

// ---- A. the buffer
{
  const profile = await createProfile();
  const raw = profile.createProjectStore({ adapter: profile.adapter, legacySource: async () => null, channel: null });
  const original = sidecar(3);
  const id = await createNamedDesign(profile, 'shaper', 'Made by v3', docWith(original));
  const other = await createNamedDesign(profile, 'shaper', 'Another design', docWith(sidecar(2)));
  await raw.open(id); // the current design
  const stored = async (did) => JSON.stringify((await raw.get(did)).document);
  const before = await stored(id), beforeOther = await stored(other);

  const c = counted(raw);
  const host = { edits: 0 }; // what a Shaper that did not know the newer sidecar would write: version 2 + its own data
  const hostData = () => ({ version: 2, cutPlan: [], edits: host.edits });
  const restores = [];
  const buf = createDocumentBuffer({ state: mk(), app: 'shaper', hostName: 'shaper', hostVersion: 2, getHostData: hostData, store: c.store, pollMs: 40, onRestored: (r) => restores.push(r) });
  await buf.restore();
  assert.strictEqual(restores.length, 1, 'restored once');
  assert.strictEqual(restores[0].newer, true, 'onRestored says: a newer version made it');
  assert.deepStrictEqual(restores[0].hosts.shaper, original, 'and still hands the host the sidecar to read');
  c.reset();
  host.edits = 1; buf.start(); await wait(300); // an edit: the autosave tick would write
  host.edits = 2; await wait(200);
  await buf.flush();
  assert.deepStrictEqual(c.calls.filter((k) => k !== 'flushDrive'), [], 'autosave and flush wrote nothing: ' + c.calls);
  assert.strictEqual(await stored(id), before, 'the stored design is byte for byte what it was (autosave)');
  await assert.rejects(buf.saveAs('Another design', { overwriteId: other }), (e) => e.message === NEWER, 'Save as over another design refuses with the one message');
  assert.strictEqual(await stored(other), beforeOther, 'the other design is untouched');
  let seamCalls = 0;
  const seam = {
    save: async () => { seamCalls++; return { name: 'x.json', handle: null }; },
    write: async () => { seamCalls++; return { name: 'x.json', handle: {} }; },
    open: async () => ({ name: 'n.json', text: serializeProjectFile({ app: 'shaper', name: 'n', document: docWith(original) }), handle: {} }),
  };
  await assert.rejects(buf.saveToFile('Copy', seam), (e) => e.message === NEWER, 'Save as to a file refuses');
  assert.strictEqual(seamCalls, 0, 'no file was written');
  const snap = await raw.readBuffer({ app: 'shaper' });
  const tab = snap.tabs.find((t) => t.designId === id);
  assert.strictEqual(JSON.stringify(tab.doc.hosts.shaper), JSON.stringify(original), 'the working buffer keeps the sidecar byte for byte (not the version-2 one the host would write)');
  buf.stop();

  // Save to the file home: a version-3 design opened from a file
  const c2 = counted(raw);
  const restores2 = [];
  const fb = createDocumentBuffer({ state: mk(), app: 'shaper', hostName: 'shaper', hostVersion: 2, getHostData: hostData, store: c2.store, pollMs: 40, onRestored: (r) => restores2.push(r) });
  await fb.restore();
  await fb.openFile(seam);
  assert(restores2.some((r) => r.reason === 'file' && r.newer === true), 'a file of a newer version opens, flagged');
  c2.reset();
  await assert.rejects(fb.saveHome(seam), (e) => e.message === NEWER, 'Save (to the file home) refuses');
  assert.strictEqual(seamCalls, 0, 'the file was not written');
  assert.deepStrictEqual(c2.calls, [], 'and nothing went to the store');

  // controls: a sidecar of the host's own version autosaves; a host without hostVersion is unaffected
  for (const [label, version, hostVersion] of [['version 2, hostVersion 2', 2, 2], ['version 3, no hostVersion', 3, undefined]]) {
    const p = await createProfile();
    const s = p.createProjectStore({ adapter: p.adapter, legacySource: async () => null, channel: null });
    const did = await createNamedDesign(p, 'shaper', label, docWith(sidecar(version)));
    await s.open(did);
    const hd = { n: 0 };
    const rs = [];
    const b = createDocumentBuffer({ state: mk(), app: 'shaper', hostName: 'shaper', hostVersion, getHostData: () => ({ version: 2, n: hd.n }), store: s, pollMs: 40, onRestored: (r) => rs.push(r) });
    await b.restore();
    assert.notStrictEqual(rs[0].newer, true, label + ': not flagged');
    hd.n = 1; b.start(); await wait(300); b.stop();
    assert.deepStrictEqual((await s.get(did)).document.hosts.shaper, { version: 2, n: 1 }, label + ': autosaved as before');
  }
}

// ---- B. the real Shaper page
const noticeOf = (app) => { const el = app.document.getElementById('prepare-notice'); return el && !el.hidden ? el.textContent : null; };
const drawLine = (app) => { const o = app.toScreen(0, 0); app.tool('line'); app.click(o.x + 40, o.y - 40); app.click(o.x + 200, o.y - 40); app.esc(); };
{
  const profile = await createProfile();
  const original = sidecar(5); // TASK S2: above the app's DOC_VERSION 4
  await createNamedDesign(profile, 'shaper', 'Newer design', docWith(original));
  const app = await open({ host: 'shaper', profile });
  try {
    drawLine(app);
    assert(app.state.shapes.length > 0, 'the line is drawn (the design opened and takes edits)');
    const d = await app.storedDoc();
    assert.strictEqual(JSON.stringify(d.hosts.shaper), JSON.stringify(original), 'the stored sidecar is byte for byte the version-5 one');
    assert.strictEqual(d.geometry.shapes.length, 0, 'and so is the drawing: nothing was saved');
    app.modes.showMode('prepare');
    assert.strictEqual(noticeOf(app), NEWER, 'Prepare shows the one notice');
  } finally { await app.close(); }
}
{
  const profile = await createProfile();
  await createNamedDesign(profile, 'shaper', 'Own design', docWith(sidecar(2)));
  const app = await open({ host: 'shaper', profile });
  try {
    drawLine(app);
    const d = await app.storedDoc();
    assert(d.geometry.shapes.length > 0, 'a version-2 design saves the line');
    assert.strictEqual(d.hosts.shaper.version, 4, 'with its sidecar (TASK S2: migrated, written as version 4)');
    app.modes.showMode('prepare');
    assert.strictEqual(noticeOf(app), null, 'no notice');
  } finally { await app.close(); }
}
console.log('newer-sidecar-812-node: ok');
