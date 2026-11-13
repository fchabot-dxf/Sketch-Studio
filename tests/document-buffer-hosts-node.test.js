// tests/document-buffer-hosts-node.test.js — TASK 569 (node port of tests/document-buffer-hosts.test.js, TASK 458 / 474): the shared autosave
// buffer keeps OTHER apps' host sidecars, per design in the project store. One profile (the browser profile: its project store and
// localStorage), apps opened on it one after another through tests/helpers/node-app.js (a page load = close + open on the same profile).
//  A. Pen Plotter saves pens / toolpaths -> SketchStudio (no host sidecar) draws a line and autosaves -> Pen Plotter opened again restores
//     its plotter document unchanged (before task 458 SketchStudio's save wrote hosts: {} and wiped it).
//  B. buffers side by side on the same store: two hosts saving alternately both keep their sidecar; a host-less buffer never deletes any.
// Differs from the browser test in setup only: the Pen Plotter geometry is drawn with the Line tool (the browser test imported an SVG through
// the File menu's file chooser) and the pen is added to the plotter state directly (the browser test clicked the Toolpath stage's "+ Pen").

import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { createDocumentBuffer } from '#ui/document-buffer.js';

const profile = await createProfile();
// the stored current design, as the browser test read it from IndexedDB: { shapes, hosts: [names], penplotter }
const stored = async (app) => {
  const d = await app.storedDoc();
  return d ? JSON.parse(JSON.stringify({ shapes: d.geometry.shapes.length, hosts: Object.keys(d.hosts || {}).sort(), penplotter: d.hosts && d.hosts.penplotter })) : null;
};

// ---- A. Pen Plotter -> SketchStudio edit -> Pen Plotter
await createNamedDesign(profile, 'penplotter', 'Hosts test'); // TASK 558: only a NAMED design autosaves; the page load restores it
let pp = await open({ host: 'penplotter', profile });
const pd = pp.sidecar.plotterDoc;
const { state: plotter, makeToolpath, makePlotColor } = await import('../apps/penplotter/src/state.js');
let plotterBefore, s1;
try {
  const o = pp.toScreen(0, 0);
  pp.tool('line'); pp.click(o.x + 40, o.y - 40); pp.click(o.x + 200, o.y - 40); pp.click(o.x + 200, o.y - 160); pp.esc();
  assert(pp.state.shapes.length > 0, 'Pen Plotter drew shapes');
  plotter.plotColors.push(makePlotColor(`pen ${plotter.plotColors.length + 1}`, '#111111'));
  const a = makeToolpath('Tri', 'outline'); a.targetShapeIds = pp.state.shapes.map((s) => s.id); a.plotColorId = plotter.plotColors[0].id; a.outline.passes = 2;
  plotter.toolpaths = [a]; plotter.activeToolpathId = a.id;
  plotter.settings = { pen_up_z: 7, pen_down_z: -2, draw_feed: 1234, z_feed: 567, tolerance_mm: 0.2, export_files: 'pen' };
  s1 = await stored(pp);
  assert(s1 && s1.penplotter && s1.penplotter.toolpaths.length === 1 && s1.penplotter.toolpaths[0].name === 'Tri' && s1.penplotter.settings.draw_feed === 1234, 'Pen Plotter autosaved its toolpath sidecar (its own toolpath and settings, not the starter toolpath)');
  assert.strictEqual(pp.saveStatus(), 'Saved', 'autosave reports Saved');
  plotterBefore = JSON.parse(JSON.stringify(pd.capturePlotterDoc()));
  assert(s1.hosts.includes('penplotter'), 'Pen Plotter saved its sidecar: ' + JSON.stringify(s1.hosts));
  assert(plotterBefore.toolpaths.length === 1 && plotterBefore.plotColors.length >= 1, 'plotter state built');
} finally { await pp.close(); }

const ss = await open({ host: 'sketchstudio', profile });
try {
  const r = ss.svg.getBoundingClientRect();
  ss.tool('line');
  ss.click(Math.round(r.left + r.width * 0.30), Math.round(r.top + r.height * 0.70));
  ss.click(Math.round(r.left + r.width * 0.55), Math.round(r.top + r.height * 0.70));
  ss.esc();
  const s2 = await stored(ss);
  assert(s2 && s2.shapes > s1.shapes, 'SketchStudio autosaved its edit: shapes ' + (s1 && s1.shapes) + ' -> ' + (s2 && s2.shapes));
  console.log('after SketchStudio save: shapes', s1.shapes, '->', s2.shapes, '| hosts', JSON.stringify(s2.hosts));
  assert(s2.hosts.includes('penplotter'), 'SketchStudio\'s save dropped the Pen Plotter sidecar (hosts: ' + JSON.stringify(s2.hosts) + ')');
} finally { await ss.close(); }

pp = await open({ host: 'penplotter', profile });
try {
  assert(pd.capturePlotterDoc().plotColors.length > 0, 'Pen Plotter restored its pens from the buffer');
  const plotterAfter = JSON.parse(JSON.stringify(pd.capturePlotterDoc()));
  assert.deepStrictEqual(plotterAfter, plotterBefore, 'Pen Plotter state is unchanged after another app saved');
} finally { await pp.close(); }

// ---- B. buffers side by side: two hosts alternate, a host-less buffer never deletes
const store = profile.createProjectStore({ adapter: profile.adapter, legacySource: async () => null, channel: null });
const mk = () => ({ joints: new Map(), shapes: [], constraints: [] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const read = async () => (await store.loadCurrent()).document.hosts;
const a = { v: 0 }, b = { v: 0 }; // set to 1 after the restore: a buffer writes only what CHANGED since it was bound (TASK 558)
const sa = mk(), sb = mk(), sc = mk();
const opts = { store, pollMs: 40 }; // the browser test used the page's shared store (getProjectStore()); here the profile's store, without a cross-tab channel
const A = createDocumentBuffer({ state: sa, hostName: 'hostA', getHostData: () => a, ...opts });
const B = createDocumentBuffer({ state: sb, hostName: 'hostB', getHostData: () => b, ...opts });
const C = createDocumentBuffer({ state: sc, ...opts });
await A.restore(); await B.restore(); await C.restore(); // TASK 558: bound to the current NAMED design (an unbound buffer never writes)
a.v = 1; b.v = 1;
const result = [];
A.start(); await wait(250); result.push(['A saves', Object.keys(await read()).sort()]);
A.stop(); B.start(); await wait(250); result.push(['B saves', Object.keys(await read()).sort()]);
B.stop(); a.v = 2; A.start(); await wait(250); result.push(['A changes', JSON.stringify((await read()).hostA), Object.keys(await read()).sort()]);
A.stop(); b.v = 2; B.start(); await wait(250); result.push(['B changes', JSON.stringify((await read()).hostB), Object.keys(await read()).sort()]);
B.stop(); sc.shapes.push({ id: 'x', type: 'line', joints: [] }); C.start(); await wait(250); result.push(['host-less saves', Object.keys(await read()).sort()]);
C.stop();
for (const r of result) console.log('  ', JSON.stringify(r));
const has = (r, ...names) => names.every((n) => r.includes(n));
assert(has(result[0][1], 'hostA'), 'A saved');
assert(has(result[1][1], 'hostA', 'hostB'), 'B saved and A survived: ' + JSON.stringify(result[1][1]));
assert(result[2][1] === '{"v":2}' && has(result[2][2], 'hostA', 'hostB'), 'A updated its own sidecar, B kept: ' + JSON.stringify(result[2]));
assert(result[3][1] === '{"v":2}' && has(result[3][2], 'hostA', 'hostB'), 'B updated its own sidecar, A kept: ' + JSON.stringify(result[3]));
assert(has(result[4][1], 'hostA', 'hostB', 'penplotter'), 'a host-less save deleted no sidecar: ' + JSON.stringify(result[4]));
console.log('document-buffer-hosts-node: ok');
