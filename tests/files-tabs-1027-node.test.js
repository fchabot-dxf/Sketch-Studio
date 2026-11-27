// tests/files-tabs-1027-node.test.js — TASK 1027 (files audit 1024):
//   BUG-306 (F-03 / F-32): a design opened from a FILE and not edited is kept in the open-tabs buffer like an edited one: it survives a reload and follows to another app.
//   BUG-305 (F-105): a file whose shape names a joint the file does not have loads as before (nothing else changes) and says so ONCE ("1 shape in this design was damaged ...").
import assert from 'node:assert';
import fs from 'node:fs';
import { createProjectStore, createMemoryAdapter, emptyDocument } from '../packages/ui/project-store.js';
import { createDocumentBuffer } from '../packages/ui/document-buffer.js';
import { serializeProjectFile } from '../packages/ui/project-file.js';
import { createSketchState } from '../packages/core/sketch-state.js';
import { createEngine } from '../packages/core/constraint-solver.js';
import { open } from './helpers/node-app.js';

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
let t = 9000;
const engine = createEngine(null);
const mkState = () => { engine.init(); return createSketchState(engine, { x: 0, y: 0, w: 100, h: 80 }); };
const mkStore = (adapter) => { let n = 0; return createProjectStore({ adapter, legacySource: async () => null, idFn: () => 'd' + (++n), now: () => ++t, channel: null }); };
const drawn = (st) => [...st.joints.keys()].filter((k) => k !== 'j_origin').sort();
const mkBuf = (adapter, app) => { const state = mkState(); return { state, buf: createDocumentBuffer({ state, app, store: mkStore(adapter), pollMs: 1e9, doc: null, win: null }) }; };

// ---- F-03 / F-32: the file is a design with two joints and a line; opened, never edited
const doc = emptyDocument();
doc.geometry.joints = [['j_origin', { x: 0, y: 0, fixed: true }], ['p', { x: 5, y: 5 }], ['q', { x: 20, y: 5 }]];
doc.geometry.shapes = [{ id: 's1', type: 'line', joints: ['p', 'q'] }];
const text = serializeProjectFile({ app: 'sketchstudio', name: 'Plate', document: doc });
const seam = { calls: [], async open() { return { name: 'Plate.sketch.json', text, handle: null }; } };
{
  const adapter = createMemoryAdapter();
  const a = mkBuf(adapter, 'sketchstudio');
  await a.buf.restore();
  await a.buf.openFile(seam);                       // the single tab: a file design, not edited
  eq(a.buf.needsSavePrompt(), null, 'opened and not edited: no dot');
  await a.buf.flush();
  const stored = await adapter.getMeta('openTabsBuffer');
  ok(stored && stored.tabs.length === 1, 'F-03: the open-tabs buffer still holds the opened file (it was null)');
  eq([stored.tabs[0].name, stored.tabs[0].file, stored.tabs[0].content], ['Plate', { name: 'Plate.sketch.json' }, false], 'F-03: the tab keeps its name and its file, not marked as changed');
  const b = mkBuf(adapter, 'sketchstudio');            // the page after a reload
  await b.buf.restore();
  eq(drawn(b.state), ['p', 'q'], 'F-03: after a reload the drawing is there');
  eq(b.buf.home(), { kind: 'file', name: 'Plate.sketch.json', handle: null }, 'F-03: its home is the file (by name)');
  eq(b.buf.needsSavePrompt(), null, 'F-03: still no dot');
  const c = mkBuf(adapter, 'shaper');                  // F-32: another app on the same shared buffer
  await c.buf.restore();
  eq(drawn(c.state), ['p', 'q'], 'F-32: the other app shows the opened file');
}

// ---- F-105
{
  const damaged = fs.readFileSync(new URL('./fixtures/files-1024/dangling-refs.sketch.json', import.meta.url), 'utf8');
  const app = await open({ host: 'sketchstudio' });
  try {
    const notices = () => [...app.document.querySelectorAll('#notification-container [data-level]')].map((e) => `[${e.dataset.level}] ${e.textContent.trim()}`);
    await app.buffer.openFile({ open: async () => ({ name: 'Bad refs.sketch.json', text: damaged, handle: null }) });
    app.frames(3);
    const n = notices().filter((x) => /damaged/.test(x));
    eq(n.length, 1, 'F-105: ONE notice');
    ok(/^\[warning\] \S*1 shape in this design was damaged and could not be loaded/.test(n[0]), 'F-105: its words: ' + n[0]);
    eq(app.state.shapes.length, 1, 'F-105: what loads is unchanged (the shape is still in the document, as before)');
    app.document.querySelectorAll('#notification-container [data-level]').forEach((e) => e.remove());
    await app.buffer.openFile({ open: async () => ({ name: 'Plate.sketch.json', text, handle: null }) });
    eq(notices().filter((x) => /damaged/.test(x)).length, 0, 'a sound file says nothing');
  } finally { await app.close(); }
}
console.log(`files-tabs-1027: ${checks} checks ok`);
