// tests/save-as-local-759-node.test.js — TASK 759 (owner turn 2266: Save as / Open with a Google Drive | Local tab): a design saved to and opened from a FILE on
// this device, with no account. No browser, no network: the real document buffer (#ui/document-buffer.js) on the real sketch state, fake file seams, and the
// FAKE Drive (tests/harness/fake-drive.js) for the byte comparison.
//   1. THE HOME MODEL (#ui/document-home.js): drive / local with a handle / local by name only / none, and what Save does for each (saveRoute + the buffer's
//      saveHome through a seam that records what it was asked to do).
//   2. the file a Local save writes == the file a Drive save writes (the same bytes), for the first named save and after an autosaved edit.
//   3. open of a local file round-trips a document of EACH app: SketchStudio, Shaper, Pen Plotter through the real hosts (tests/helpers/node-app.js), Trace
//      through the buffer with its sidecar: open -> Save writes back the same bytes; the sidecar comes back.
//   4. what survives a reload: the open-tabs buffer keeps the content, the file NAME and the unsaved flag; never the handle (the first Save then re-picks).
import assert from 'node:assert';
import { createProjectStore, createMemoryAdapter, emptyDocument } from '../packages/ui/project-store.js';
import { createDocumentBuffer } from '../packages/ui/document-buffer.js';
import { homeOf, saveRoute, homeLabel, HOME_KINDS } from '../packages/ui/document-home.js';
import { serializeProjectFile, parseProjectFile, designNameOfFile, fileAccess } from '../packages/ui/project-file.js';
import { createSketchState } from '../packages/core/sketch-state.js';
import { createEngine } from '../packages/core/constraint-solver.js';
import { createFakeDrive } from './harness/fake-drive.js';
import { createDriveAdapter } from '../packages/ui/cloud/drive-adapter.js';
import { open, createProfile } from './helpers/node-app.js';

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

let t = 9000;
const engine = createEngine(null);
const mkState = () => { engine.init(); return createSketchState(engine, { x: 0, y: 0, w: 100, h: 80 }); };
const mkStore = (adapter = createMemoryAdapter()) => { let n = 0; return createProjectStore({ adapter, legacySource: async () => null, idFn: () => 'd' + (++n), now: () => ++t, channel: null }); };
const drawn = (st) => [...st.joints.keys()].filter((k) => k !== 'j_origin').sort();
/** A seam that records every call: save -> a handle (picker) or a download (no handle); write -> granted or refused; open -> the given file. */
function recSeam({ picker = true, grant = true, file = null } = {}) {
  const calls = [];
  const disk = new Map(); // file name -> text (what the "device" holds)
  const handleFor = (name) => ({ name, kind: 'file' });
  return {
    calls, disk,
    async save(text, suggestedName) { calls.push(['save', suggestedName]); disk.set(suggestedName, text); return { name: suggestedName, handle: picker ? handleFor(suggestedName) : null }; },
    async write(handle, text) { calls.push(['write', handle.name]); if (!grant) return null; disk.set(handle.name, text); return { name: handle.name, handle }; },
    async open() { calls.push(['open']); return file; },
  };
}

// ---- 1. THE HOME MODEL -------------------------------------------------------------------------------------------------------------
eq(homeOf({}), { kind: 'none' }, 'nothing -> no home');
eq(homeOf({ designId: 'drive:abc', file: { name: 'x.sketch.json' } }), { kind: 'drive', id: 'drive:abc' }, 'a stored design: its home is the store (Drive), whatever else');
eq(homeOf({ file: { name: 'a.sketch.json', handle: 'H' } }), { kind: 'file', name: 'a.sketch.json', handle: 'H' }, 'a file with a handle');
eq(homeOf({ file: { name: 'a.sketch.json' } }), { kind: 'file', name: 'a.sketch.json', handle: null }, 'a file by name only');
const R = (h, picker) => saveRoute(homeOf(h), { picker });
eq([R({ designId: 'd' }, true), R({ file: { name: 'a', handle: 'H' } }, true), R({ file: { name: 'a' } }, true), R({ file: { name: 'a' } }, false), R({}, true), R({}, false)],
  ['flush', 'write-back', 'repick', 'download', 'save-as', 'save-as'], 'Save: drive = the autosave now; file+handle = write back; name only = the picker again, or a download; none = Save as');
eq([homeLabel(homeOf({})), homeLabel(homeOf({ designId: 'd' })), homeLabel(homeOf({ designId: 'd' }), { where: 'device' }), homeLabel(homeOf({ file: { name: 'a.sketch.json' } }))],
  ['Not saved yet', 'Saved to Google Drive', 'Saved on this device', 'On this device: a.sketch.json'], 'the one line that says where it lives');
eq(designNameOfFile('Bracket.sketch.json'), 'Bracket', 'the design name of a file: without .sketch.json'); eq(designNameOfFile('B.json'), 'B', '... or .json');
eq(fileAccess(null), { picker: false, openPicker: false }, 'no window: no picker'); eq(fileAccess({ showSaveFilePicker() {}, showOpenFilePicker() {} }), { picker: true, openPicker: true }, 'the capability is the File System Access API');
eq(fileAccess({ showSaveFilePicker() {} }), { picker: true, openPicker: false }, 'each picker on its own');

// the buffer: each home and what Save does
{
  const store = mkStore();
  const st = mkState();
  const buf = createDocumentBuffer({ state: st, app: 'sketchstudio', store, pollMs: 1e9, doc: null, win: null });
  await buf.restore();
  eq(buf.home(), { kind: 'none' }, 'a fresh page: an Untitled with no home');
  st.saveState('line'); st.joints.set('j1', { x: 1, y: 2 });
  eq(buf.needsSavePrompt(), 'unsaved', 'an Untitled with content: the dot');
  // Save as > Local with the picker: a handle
  const seam = recSeam({ picker: true });
  const r = await buf.saveToFile('Bracket', seam);
  eq(r, { name: 'Bracket.sketch.json', handle: { name: 'Bracket.sketch.json', kind: 'file' }, downloaded: false }, 'Save as > Local: the picked file');
  eq(buf.home().kind, HOME_KINDS.FILE, 'its home is now the file'); eq(buf.designName(), 'Bracket', 'named after the file');
  eq(buf.designId(), null, 'NOT stored in the project store'); eq((await store.listRecent()).length, 0, 'nothing stored in the store (Drive)');
  eq(buf.needsSavePrompt(), null, 'saved: no dot');
  const first = seam.disk.get('Bracket.sketch.json');
  eq(parseProjectFile(first).document.geometry.joints.map((j) => j[0]).filter((k) => k !== 'j_origin'), ['j1'], 'the file holds the drawing');
  st.saveState('more'); st.joints.set('j2', { x: 3, y: 4 });
  eq(buf.needsSavePrompt(), 'unsaved', 'an edit after the save: the dot again');
  eq(saveRoute(buf.home(), { picker: true }), 'write-back', 'with a handle: Save writes back');
  let s = await buf.saveHome(seam);
  eq(s, { route: 'write-back', name: 'Bracket.sketch.json' }, 'Save wrote back to the same file'); eq(seam.calls.slice(-1), [['write', 'Bracket.sketch.json']], 'through its handle, no picker');
  eq(buf.needsSavePrompt(), null, 'clean again');
  ok(seam.disk.get('Bracket.sketch.json') !== first && parseProjectFile(seam.disk.get('Bracket.sketch.json')).document.geometry.joints.length === 3, 'the file now holds both joints (+ origin)');
  // the browser refuses the handle (permission): the picker again
  const refused = recSeam({ picker: true, grant: false });
  st.saveState('m'); st.joints.set('j3', { x: 5, y: 5 });
  s = await buf.saveHome(refused);
  eq(refused.calls, [['write', 'Bracket.sketch.json'], ['save', 'Bracket.sketch.json']], 'a refused handle: asked for the file again (the picker, same name)');
  eq(s.route, 'repick', 'route repick');
  // name only, a browser without the picker: a download under the same name
  const dl = recSeam({ picker: false });
  const st2 = mkState();
  const buf2 = createDocumentBuffer({ state: st2, app: 'sketchstudio', store: mkStore(), pollMs: 1e9, doc: null, win: null });
  await buf2.restore();
  st2.saveState('l'); st2.joints.set('k1', { x: 1, y: 1 });
  const r2 = await buf2.saveToFile('Plate', dl);
  eq(r2.downloaded, true, 'no picker: Save as > Local downloads the file'); eq(buf2.home(), { kind: 'file', name: 'Plate.sketch.json', handle: null }, 'home: the name only');
  eq(saveRoute(buf2.home(), { picker: false }), 'download', 'Save of a name-only home without a picker: a download');
  st2.saveState('l2'); st2.joints.set('k2', { x: 2, y: 2 });
  s = await buf2.saveHome(dl);
  eq(s, { route: 'download', name: 'Plate.sketch.json' }, 'Save downloaded it again under the same name'); eq(dl.calls.slice(-1), [['save', 'Plate.sketch.json']], 'one save call, same name');
  // the picker cancelled: nothing changes
  const cancel = { save: async () => null, write: async () => null };
  st2.saveState('l3'); st2.joints.set('k3', { x: 3, y: 3 });
  eq(await buf2.saveHome(cancel), null, 'a cancelled picker: null'); eq(buf2.needsSavePrompt(), 'unsaved', 'and the design still has its dot');
  // Save as > Drive of a file home: the store, from then on autosaved
  const d = await buf2.saveAs('Plate on Drive');
  eq(buf2.home(), { kind: 'drive', id: d.id }, 'Save as > Drive: its home is the store'); eq(saveRoute(buf2.home(), { picker: false }), 'flush', 'Save = the autosave now');
  // rename of a file home: the name its next Save writes
  await buf.rename('Bracket B');
  eq(buf.designName(), 'Bracket B', 'renamed in the page'); eq(buf.home().name, 'Bracket.sketch.json', 'the file keeps its name (the handle is the same file)');
}

// ---- 4. a reload: what survives ------------------------------------------------------------------------------------------------------
{
  const adapter = createMemoryAdapter();
  const store = mkStore(adapter);
  const st = mkState();
  const buf = createDocumentBuffer({ state: st, app: 'sketchstudio', store, pollMs: 1e9, doc: null, win: null });
  await buf.restore();
  st.saveState('a'); st.joints.set('r1', { x: 1, y: 1 });
  const seam = recSeam({ picker: true });
  await buf.saveToFile('Reload me', seam);
  st.saveState('b'); st.joints.set('r2', { x: 2, y: 2 }); // an edit not written to the file
  await buf.flush();                                     // the page's poll: writes the open-tabs buffer
  const stored = await adapter.getMeta('openTabsBuffer');
  eq(stored.tabs.map((x) => ({ designId: x.designId, name: x.name, file: x.file, content: x.content })), [{ designId: null, name: 'Reload me', file: { name: 'Reload me.sketch.json' }, content: true }],
    'the open-tabs buffer keeps the file NAME and the unsaved flag, never the handle');
  // the next page
  const st2 = mkState();
  const buf2 = createDocumentBuffer({ state: st2, app: 'sketchstudio', store: mkStore(adapter), pollMs: 1e9, doc: null, win: null });
  await buf2.restore();
  eq(drawn(st2), ['r1', 'r2'], 'the content came back (the open-tabs buffer, as today)');
  eq(buf2.home(), { kind: 'file', name: 'Reload me.sketch.json', handle: null }, 'its home came back by name only');
  eq(buf2.needsSavePrompt(), 'unsaved', 'still marked as not written to its file');
  eq(saveRoute(buf2.home(), { picker: true }), 'repick', 'the first Save after a reload asks for the file again (where there is a picker)');
  const again = recSeam({ picker: true });
  const s = await buf2.saveHome(again);
  eq(again.calls, [['save', 'Reload me.sketch.json']], 'the picker, suggesting the same name'); eq(s.route, 'repick', 'repick');
  eq(buf2.home().handle, { name: 'Reload me.sketch.json', kind: 'file' }, 'and the home has a handle again'); eq(buf2.needsSavePrompt(), null, 'clean');
}

// ---- 2. Local bytes == Drive bytes -----------------------------------------------------------------------------------------------------
// What is compared on the Drive side is the media part the Drive adapter SENDS (the file's bytes as Drive stores them). The fake Drive's own copy is not
// used: its multipart parser trims the part (tests/harness/fake-drive.js), so it drops the file's trailing newline that a real Drive keeps.
const mediaOf = (opts) => {
  const ctype = (opts.headers || {})['Content-Type'] || '';
  const m = /boundary=(.+)$/.exec(ctype);
  if (!m) return null;
  const body = String(opts.body);
  const second = body.split('--' + m[1] + '\r\n')[2];       // the media part: its header, a blank line, the bytes, then CRLF--boundary--
  const bytes = second.slice(second.indexOf('\r\n\r\n') + 4);
  return bytes.slice(0, bytes.lastIndexOf('\r\n--' + m[1] + '--'));
};
const driveRun = async () => {
  const drive = createFakeDrive();
  const sent = [];
  // the bytes sent: a new file is a multipart upload (its media part), an update is the bytes alone (uploadType=media)
  const account = { authedFetch: (url, opts = {}) => { if (/\/upload\//.test(url)) sent.push(/uploadType=media/.test(url) ? String(opts.body) : mediaOf(opts)); return drive.fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + drive.token, ...(opts.headers || {}) } }); } };
  const store = createProjectStore({ adapter: createDriveAdapter({ account, meta: createMemoryAdapter() }), now: () => ++t, channel: null });
  const st = mkState();
  const buf = createDocumentBuffer({ state: st, app: 'penplotter', hostName: 'penplotter', getHostData: () => ({ pens: [{ id: 'p1', color: '#000' }] }), store, pollMs: 1e9, doc: null, win: null });
  await buf.restore();
  st.saveState('a'); st.joints.set('b1', { x: 1, y: 2 }); st.joints.set('b2', { x: 3, y: 4 }); st.shapes.push({ id: 's1', type: 'line', joints: ['b1', 'b2'] });
  const d = await buf.saveAs('Shelf');                      // Save as > Google Drive (the first named save)
  await store.flushDrive();
  return { drive, sent, store, st, buf, d };
};
{
  const { drive, sent, buf, d } = await driveRun();
  const local = recSeam({ picker: true });
  await buf.saveToFile('Shelf', local);                     // the same design, Save as > Local
  eq(sent.length, 1, 'one Drive upload (the first named save)');
  eq(local.disk.get('Shelf.sketch.json'), sent[0], 'the first named save: the Local file bytes == the bytes written to Drive');
  ok(drive.files.get(d.id).name === 'Shelf.sketch.json', 'the Drive file has the same name and extension (.sketch.json)');
}
{
  const { sent, store, st, buf } = await driveRun();
  st.saveState('b'); st.joints.set('b3', { x: 9, y: 9 });   // an edit, autosaved to Drive
  await buf.flush(); await store.flushDrive();
  const local = recSeam({ picker: true });
  await buf.saveToFile('Shelf', local);
  eq(sent.length, 2, 'two Drive uploads (the named save, the autosave)');
  eq(local.disk.get('Shelf.sketch.json'), sent[1], 'after an autosaved edit: the Local file bytes == the bytes written to Drive');
}

// ---- 3. open of a local file round-trips a document of EACH app ------------------------------------------------------------------------
// Trace: through the buffer with its sidecar (node-app has no Trace page)
{
  const st = mkState();
  let sidecar = { photo: null, threshold: 128, traced: true }; // the first page's sidecar, changed by the user
  let restoredHosts = null;
  const DEFAULTS = { photo: null, threshold: 128, traced: false };
  // a host applies ITS sidecar from what was restored, or its defaults (document-buffer.js onRestored)
  const opts = (store) => ({ state: st, app: 'trace', hostName: 'trace', getHostData: () => sidecar, onRestored: (o) => { restoredHosts = o.hosts; sidecar = (o.hosts && o.hosts.trace) || { ...DEFAULTS }; }, store, pollMs: 1e9, doc: null, win: null });
  const buf = createDocumentBuffer(opts(mkStore()));
  await buf.restore();
  st.saveState('a'); st.joints.set('t1', { x: 1, y: 1 }); sidecar = { ...sidecar, threshold: 90 };
  const seam = recSeam({ picker: true });
  await buf.saveToFile('Traced', seam);
  const text = seam.disk.get('Traced.sketch.json');
  const st2 = mkState();
  sidecar = { ...DEFAULTS }; // the second page's own defaults
  const buf2 = createDocumentBuffer({ ...opts(mkStore()), state: st2 });
  await buf2.restore();
  const out = await buf2.openFileTab({ open: async () => ({ name: 'Traced.sketch.json', text, handle: { name: 'Traced.sketch.json' } }) });
  eq(out.reason, 'file', 'trace: opened as a file'); eq(restoredHosts.trace, { photo: null, threshold: 90, traced: true }, 'trace: its sidecar came back');
  eq(drawn(st2), ['t1'], 'trace: the drawing came back');
  const back = recSeam({ picker: true });
  await buf2.saveHome(back);
  eq(back.disk.get('Traced.sketch.json'), text, 'trace: open -> Save writes back the SAME bytes');
}
// SketchStudio, Shaper, Pen Plotter: the real hosts
for (const host of ['sketchstudio', 'shaper', 'penplotter']) {
  const profile = await createProfile();
  let app = await open({ host, profile });
  app.frames(3);
  // a line drawn with the host's own line tool
  app.tool('line');
  const r = app.svg.getBoundingClientRect();
  app.click(Math.round(r.left + r.width * 0.3), Math.round(r.top + r.height * 0.6)); app.click(Math.round(r.left + r.width * 0.55), Math.round(r.top + r.height * 0.4));
  app.esc();
  const seam = recSeam({ picker: true });
  await app.buffer.saveToFile('Part ' + host, seam);
  const text = seam.disk.get(`Part ${host}.sketch.json`);
  const parsed = parseProjectFile(text);
  eq(parsed.app, host, `${host}: the file says which app saved it`);
  ok(parsed.document.geometry.shapes.length === 1, `${host}: the file holds the drawn line`);
  await app.close();
  // a fresh profile (another device): open the file
  app = await open({ host, profile: await createProfile() });
  app.frames(3);
  const out = await app.buffer.openFile({ open: async () => ({ name: `Part ${host}.sketch.json`, text, handle: { name: `Part ${host}.sketch.json` } }) });
  app.frames(3);
  eq(out.reason, 'file', `${host}: opened as a file`);
  eq(app.document.querySelectorAll('.shape-elem').length >= 1, true, `${host}: the line is on the canvas`);
  eq(app.buffer.home().kind, 'file', `${host}: its home is the file`); eq((await app.store.listRecent({})).length, 0, `${host}: nothing stored in the project store`);
  eq(app.buffer.needsSavePrompt(), null, `${host}: just opened: no dot`);
  const back = recSeam({ picker: true });
  await app.buffer.saveHome(back);
  eq(back.disk.get(`Part ${host}.sketch.json`), text, `${host}: open -> Save writes back the SAME bytes`);
  await app.close();
}
ok(serializeProjectFile({ app: 'x', name: 'n', document: emptyDocument() }).endsWith('\n'), 'the format is unchanged (deterministic text, trailing newline)');
console.log(`save-as-local-759-node: ${checks} checks pass`);
