// tests/design-only-706-node.test.js — TASK 706 ("everything in Design", owner turns 1884 / 1886):
//   A. Shaper's stages: Explore is gone; Design is the first and default stage; a stored MODE_KEY 'explore' (an existing user's) opens Design; Fusion
//      mode keeps Prepare / Review (and opens on Prepare).
//   B. the shared rule (packages/ui/document-buffer.js OPENING_REASONS + the optional host hook `showDesign`): a host that declares it is asked to show
//      its Design view BEFORE onRestored for a design the user opened (new / Open / Open from file, a new tab), never for a tab switch or the page's
//      restore; a host that declares nothing (Trace) gets exactly the calls it got before. The shared importer (packages/ui/sketch-import.js) calls
//      its `showDesign` option first, and nothing when it is not given.
//   C. Shaper (node kit: the page's own modes.js / cut-import.js / design-canvas.js): an import, a new design and a new tab started on Prepare, Vcarve
//      or Review show Design; a tab switch keeps the stage. Pen Plotter (its own stages.js / sketch-stage.js): the same from Toolpath and Export.
//   D. GAP 4: a Shaper SVG whose cut attributes sit on a <g> (Shaper's own export, groupByCut) keeps every cut on import: export -> import -> the same
//      records (type, depth, offset, bit); an element's own attribute wins over its group's; the root <svg>'s paint is not a cut.
//   E. the tab session: a session stored before TASK 706 (with its `explore` part) still restores Prepare's selection; a new capture has no `explore`.
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { SHAPER_STAGES, shaperStagesFor, resolveInitialMode, FUSION_HIDDEN_STAGES } from '../apps/shaper/src/modes.js';
import * as documentBuffer from '../packages/ui/document-buffer.js';
import { createProjectStore, createMemoryAdapter, emptyDocument } from '../packages/ui/project-store.js';
import { serializeProjectFile } from '../packages/ui/project-file.js';
import { importIntoSketch } from '../packages/ui/sketch-import.js';
import { createSketchState } from '../packages/core/sketch-state.js';
import { createEngine } from '../packages/core/constraint-solver.js';
import { CUT_PLAN, cutPlanEntries } from '../apps/shaper/src/cut-plan.js';
import { exportEncoding } from '../apps/shaper/src/shaper.js';
import { createShaperSession } from '../apps/shaper/src/shaper-session.js';
import { exportShaperSVG } from '#core/shaper-export.js';
import { findLoops } from '#core/loop-finder.js';
import { loopPolygon } from '#core/loop-geometry.js';

let checks = 0;
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); checks++; };

// ---- A. the stages -------------------------------------------------------------------------------------------------------------------------------------
eq(SHAPER_STAGES.map((s) => s.id), ['design', 'vcarve', 'prepare', 'review'], 'Shaper has no Explore stage; Design is first');
eq(resolveInitialMode(null), 'design', 'a fresh Shaper opens on Design');
eq(resolveInitialMode('explore'), 'design', "an existing user's stored MODE_KEY 'explore' opens Design");
eq(resolveInitialMode('simexport'), 'review', 'the older stored Simulate/Export still opens Review');
eq(resolveInitialMode('prepare'), 'prepare', 'a stored stage that still exists is kept');
eq(shaperStagesFor({ fusion: true }).map((s) => s.id), ['prepare', 'review'], 'Fusion mode keeps its own stages');
eq(FUSION_HIDDEN_STAGES, ['design', 'vcarve'], 'Fusion mode hides Design and Vcarve');
for (const stored of [null, 'explore', 'design', 'vcarve']) eq(resolveInitialMode(stored, { fusion: true }), 'prepare', `Fusion mode opens on Prepare (stored ${stored})`);

// ---- B. the shared rule, on a bare buffer and the bare importer --------------------------------------------------------------------------------------
const { createDocumentBuffer, OPENING_REASONS } = documentBuffer; // (a namespace import: the fail-first run on main reports the first behaviour that differs, not a link error)
eq([...(OPENING_REASONS || [])].sort(), ['file', 'new', 'open'], 'the opening reasons: a new design (or tab), Open, Open from file');
{
  let t = 1000;
  const engine = createEngine(null);
  const mkState = () => { engine.init(); return createSketchState(engine, { x: 0, y: 0, w: 100, h: 80 }); };
  const run = async (declare) => {
    let n = 0;
    const store = createProjectStore({ adapter: createMemoryAdapter(), legacySource: async () => null, idFn: () => 'd' + (++n), now: () => ++t, channel: null });
    const a = await store.newDesign('A'); await store.save(emptyDocument(), { id: a.id });
    await store.open(a.id);
    const calls = [];
    const buf = createDocumentBuffer({ state: mkState(), app: 'trace', store, pollMs: 1e9, doc: null, win: null,
      onRestored: ({ reason }) => calls.push('restored:' + reason), ...(declare ? { showDesign: () => calls.push('showDesign') } : {}) });
    await buf.restore();
    await buf.newDesign();
    await buf.openDesign(a.id);
    await buf.openFile({ open: async () => ({ name: 'f.json', text: serializeProjectFile({ app: 'trace', name: 'F', document: emptyDocument() }) }) });
    await buf.newTab();
    await buf.activate(buf.tabs()[0].key);
    return calls;
  };
  eq(await run(false), ['restored:restore', 'restored:new', 'restored:open', 'restored:file', 'restored:new', 'restored:switch'],
    'a host that declares no showDesign (Trace) gets only its onRestored calls, as before');
  eq(await run(true), ['restored:restore', 'showDesign', 'restored:new', 'showDesign', 'restored:open', 'showDesign', 'restored:file', 'showDesign', 'restored:new', 'restored:switch'],
    'a host that declares showDesign is asked BEFORE onRestored for new / open / file / a new tab, never for the restore or a tab switch');
  const st = mkState();
  const order = [];
  const svgText = '<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm" viewBox="0 0 10 10"><path d="M1 1 L9 1 L9 9 Z"/></svg>';
  const res = importIntoSketch(svgText, 'a.svg', { state: st, svg: null }, { showDesign: () => order.push('showDesign:' + st.shapes.length), afterImport: () => { order.push('afterImport:' + st.shapes.length); } });
  eq([res.ok, order], [true, ['showDesign:0', 'afterImport:3']], 'the shared importer shows Design first, before any shape lands');
  const res2 = importIntoSketch(svgText, 'b.svg', { state: st, svg: null }, {});
  eq(res2.ok, true, 'and imports as before with no showDesign (Trace)');
}

// ---- C. Shaper and Pen Plotter through the node kit ----------------------------------------------------------------------------------------------------
const RECT = '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><rect x="10" y="10" width="40" height="30" fill="none" stroke="#000"/></svg>';
{
  const profile = await createProfile();
  await createNamedDesign(profile, 'shaper', 'Sign');
  const sh = await open({ host: 'shaper', profile });
  try {
    for (const stage of ['prepare', 'vcarve', 'review']) {
      sh.modes.showMode(stage);
      const n0 = sh.state.shapes.length;
      sh.importFile(RECT, 'from-' + stage + '.svg');
      eq([sh.modes.current(), sh.state.shapes.length - n0], ['design', 4], `Shaper: an import started on ${stage} lands in Design, shown`);
    }
    sh.modes.showMode('prepare');
    await sh.buffer.newTab();
    eq(sh.modes.current(), 'design', 'Shaper: a new tab started on Prepare shows Design');
    sh.modes.showMode('prepare');
    await sh.buffer.activate(sh.buffer.tabs()[0].key);
    eq(sh.modes.current(), 'prepare', 'Shaper: a tab switch keeps Prepare');
    sh.modes.showMode('review');
    await sh.buffer.activate(sh.buffer.tabs()[1].key);
    eq(sh.modes.current(), 'review', 'Shaper: a tab switch keeps Review');
  } finally { await sh.close(); }
}
{
  const profile = await createProfile();
  await createNamedDesign(profile, 'penplotter', 'Plot');
  const pp = await open({ host: 'penplotter', profile });
  try {
    const doc = pp.document;
    for (const stage of ['toolpath', 'export']) {
      pp.router.showStage(stage);
      const res = pp.importFile(RECT, 'from-' + stage + '.svg');
      const status = doc.getElementById('importStatus');
      eq([res.ok, pp.router.currentStageId(), status.closest('section.stage').hidden, /^Imported 4 shapes/.test(status.textContent)], [true, 'design', false, true],
        `Pen Plotter: an import started on ${stage} lands in Design, its result line shown`);
    }
    pp.router.showStage('toolpath');
    await pp.buffer.newTab();
    eq(pp.router.currentStageId(), 'design', 'Pen Plotter: a new tab started on Toolpath shows Design');
    pp.router.showStage('export');
    await pp.buffer.activate(pp.buffer.tabs()[0].key);
    eq(pp.router.currentStageId(), 'export', 'Pen Plotter: a tab switch keeps Export');
  } finally { await pp.close(); }
}

// ---- D. GAP 4: grouped Shaper cut attributes -------------------------------------------------------------------------------------------------------------
const record = (r) => [r.cutType, Math.round(Number(r.cutDepth) * 1000) / 1000, Math.round(Number(r.cutOffset) * 1000) / 1000, Math.round(Number(r.toolDia) * 1000) / 1000];
{
  const sh = await open({ host: 'shaper' });
  try {
    // a design with four separate cuts: two identical pockets (the export groups them under ONE <g>), an outside, an on-line chain with its own bit + offset
    const src = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:shaper="http://www.shapertools.com/namespaces/shaper" width="200mm" height="100mm" viewBox="0 0 200 100">' +
      '<rect x="10" y="10" width="30" height="20" fill="#7F7F7F" shaper:cutType="pocket" shaper:cutDepth="6 mm" shaper:toolDia="6.35 mm"/>' +
      '<rect x="60" y="10" width="30" height="20" fill="#7F7F7F" shaper:cutType="pocket" shaper:cutDepth="6 mm" shaper:toolDia="6.35 mm"/>' +
      '<rect x="110" y="10" width="40" height="40" fill="#000000" shaper:cutType="outside" shaper:cutDepth="12 mm" shaper:cutOffset="0.5 mm"/>' +
      '<path d="M 10 80 L 90 80 L 90 95" fill="none" stroke="#7F7F7F" shaper:cutType="online" shaper:cutDepth="1 mm" shaper:toolDia="3 mm"/></svg>';
    const before = new Set(CUT_PLAN.keys());
    sh.importFile(src, 'cuts.svg');
    const keysA = [...CUT_PLAN.keys()].filter((k) => !before.has(k));
    const original = keysA.map((k) => record(CUT_PLAN.get(k))).sort();
    eq(original, [['exterior', 12, 0.5, 3.175], ['online', 1, 0, 3], ['pocket', 6, 0, 6.35], ['pocket', 6, 0, 6.35]], 'the source design: 4 cuts');
    // the Shaper export, with the inputs main.js generateShaperSvgPayload gives it (groupByCut: true)
    const st = sh.state;
    const sById = new Map(st.shapes.map((s) => [s.id, s]));
    const loopPolys = {}; for (const l of findLoops(st)) loopPolys[l.id] = loopPolygon(l, st, sById);
    const entries = cutPlanEntries().filter((e) => keysA.includes(e.target.kind + ':' + e.target.id));
    const exported = exportShaperSVG({ state: st, entries, encoding: exportEncoding(), docUnit: 'mm', options: { groupByCut: true }, loopPolys });
    const groups = [...exported.matchAll(/<g [^>]*shaper:cutType="([^"]+)"[^>]*>/g)].map((m) => m[1]);
    eq(groups, ['pocket'], 'the export carries the two pockets\' cut on ONE <g> (the case that lost its cuts)');
    const before2 = new Set(CUT_PLAN.keys());
    sh.importFile(exported, 'cuts-export.svg');
    const keysB = [...CUT_PLAN.keys()].filter((k) => !before2.has(k));
    eq(keysB.map((k) => record(CUT_PLAN.get(k))).sort(), original, 'export -> import: every record (type, depth, offset, bit) comes back');

    // an element's own attribute wins over its group's; what it lacks comes from the nearest <g>
    const nested = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:shaper="http://www.shapertools.com/namespaces/shaper" width="200mm" height="100mm" viewBox="0 0 200 100">' +
      '<g fill="#000000" shaper:cutType="outside" shaper:cutDepth="9 mm"><g fill="#7F7F7F" shaper:cutType="pocket" shaper:cutDepth="4 mm">' +
      '<rect x="10" y="10" width="30" height="20"/>' +
      '<rect x="60" y="10" width="30" height="20" fill="#FFFFFF" stroke="#000000" shaper:cutType="inside"/></g></g></svg>';
    const before3 = new Set(CUT_PLAN.keys());
    sh.importFile(nested, 'nested.svg');
    const got = [...CUT_PLAN.keys()].filter((k) => !before3.has(k)).map((k) => record(CUT_PLAN.get(k))).sort();
    eq(got, [['interior', 4, 0, 3.175], ['pocket', 4, 0, 3.175]], "the nearest <g> gives what an element lacks; the element's own cut type wins");
    // the root <svg>'s paint is not inherited (icon sets put fill on the root)
    const rooted = '<svg xmlns="http://www.w3.org/2000/svg" fill="#000000" width="100mm" height="100mm" viewBox="0 0 100 100"><rect x="10" y="10" width="30" height="20"/></svg>';
    const before4 = new Set(CUT_PLAN.keys());
    sh.importFile(rooted, 'rooted.svg');
    eq([...CUT_PLAN.keys()].filter((k) => !before4.has(k)).length, 0, "the root <svg>'s fill is not a cut");
  } finally { await sh.close(); }
}

// ---- E. the tab session: an old stored blob (with its `explore` part) still restores -------------------------------------------------------------
{
  const seen = [];
  const prepare = { captureSession: () => ({ targets: ['loop:L1'], view: { x: 1, y: 2, w: 3, h: 4 } }), restoreSession: (p) => seen.push(p) };
  const session = createShaperSession({ prepare });
  const oldBlob = { explore: { doc: null, selected: null }, prepare: { targets: ['loop:L9'], view: { x: 5, y: 6, w: 7, h: 8 } }, vcarveView: null }; // main e7aae72's stored() form
  session.restore(oldBlob);
  eq(seen, [{ targets: ['loop:L9'], view: { x: 5, y: 6, w: 7, h: 8 } }], 'a session stored before TASK 706 restores Prepare (its explore part is ignored)');
  eq(Object.keys(session.capture()).sort(), ['prepare', 'vcarveView'], 'a new capture has no explore part');
  eq(typeof session.stored, 'undefined', 'all of it is storable: no stored() filter left');
}
console.log(`design-only-706-node: ${checks} checks pass`);
