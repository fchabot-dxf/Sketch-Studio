// tests/shaper-persist-node.test.js — TASK 583 (node port of tests/shaper-persist.test.js, TASK 460): the Shaper cut plan + stock survive a page reload through the
// document's Shaper sidecar (doc.hosts.shaper), an old document gets the defaults, a SketchStudio save in between keeps the sidecar, and the export is byte-identical.
// A reload = close + open on the same profile (tests/helpers/node-app.js, with Shaper's declared Prepare stage, mode router and Review stock card).
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { applyShaperUnitDefault } from '../apps/shaper/src/design-canvas.js';
import { exportShaperSVG } from '#core/shaper-export.js';
import { CUT_TYPES } from '../apps/shaper/src/shaper.js';
import { CUT_PLAN, cutPlanEntries, keyOf } from '../apps/shaper/src/cut-plan.js';
import { getStock, setStockField } from '../apps/shaper/src/stock.js';
import { findLoops, findOpenChains } from '#core/loop-finder.js';
import { loopPolygon } from '#core/loop-geometry.js';

const planJson = () => JSON.stringify([...CUT_PLAN.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
const stockJson = () => JSON.stringify(getStock());
const exportStr = (app) => {
  const st = app.state; const by = new Map(st.shapes.map((s) => [s.id, s])); const lp = {};
  for (const l of findLoops(st)) lp[l.id] = loopPolygon(l, st, by);
  return exportShaperSVG({ state: st, entries: cutPlanEntries(), encoding: CUT_TYPES, docUnit: 'in', options: { groupByCut: true }, loopPolys: lp });
};
const openMode = (app, mode) => { app.press(app.document.querySelector(`[data-mode="${mode}"]`)); assert.strictEqual(app.document.querySelector('.mode-btn.active').dataset.mode, mode, 'the ' + mode + ' tab opens'); };
const edges = (app) => app.document.querySelectorAll('#prepare-canvas .sk-edge').length;

applyShaperUnitDefault(); // the page's own default document unit (U3b: inch unless the user chose one): the Review card shows inches. The kit leaves a host's unit alone.
const profile = await createProfile();
const designId = await createNamedDesign(profile, 'shaper', 'Persist test'); // TASK 558: only a NAMED design autosaves; the next load restores it
let planBefore, stockBefore, exportBefore;

{ // seed, assign cuts, autosave
  const app = await open({ host: 'shaper', profile });
  try {
    openMode(app, 'design');
    const st = app.state;
    for (const k of [...st.joints.keys()]) st.joints.delete(k);
    st.shapes.length = 0; st.constraints.length = 0; CUT_PLAN.clear();
    let n = 0; const J = (x, y) => { const id = 'j' + (++n); st.joints.set(id, { x, y }); return id; };
    const line = (a, b) => st.shapes.push({ id: 's' + (++n), type: 'line', joints: [a, b] });
    const rect = (x, y, w, h) => { const p = [J(x, y), J(x + w, y), J(x + w, y + h), J(x, y + h)]; for (let i = 0; i < 4; i++) line(p[i], p[(i + 1) % 4]); };
    rect(0, 0, 60, 40); rect(80, 0, 40, 40); rect(140, 0, 40, 40); line(J(0, 60), J(40, 60)); line(J(60, 60), J(100, 60));
    const loops = findLoops(st); const chains = findOpenChains(st, loops);
    const L = loops.sort((a, b) => st.joints.get(a.joints[0]).x - st.joints.get(b.joints[0]).x);
    const C = chains.sort((a, b) => st.joints.get(a.shapes[0].joints[0]).x - st.joints.get(b.shapes[0].joints[0]).x);
    CUT_PLAN.set(keyOf('loop', L[0].id), { cutType: 'pocket', cutDepth: 7.62, cutOffset: 1.5, toolDia: 6.35, cutterShape: 'endmill', cutterAngle: 90 });
    CUT_PLAN.set(keyOf('loop', L[1].id), { cutType: 'exterior', cutDepth: 5, cutOffset: 0, toolDia: 3.175, cutterShape: 'ballnose', cutterAngle: 90 });
    CUT_PLAN.set(keyOf('loop', L[2].id), { cutType: 'interior', cutDepth: 'unset', cutOffset: -2, toolDia: 6.35, cutterShape: 'vbit', cutterAngle: 60 });
    CUT_PLAN.set(keyOf('chain', C[0].id), { cutType: 'online', cutDepth: 3, cutOffset: 0, toolDia: 3.175, cutterShape: 'endmill', cutterAngle: 90 });
    CUT_PLAN.set(keyOf('chain', C[1].id), { cutType: 'guide', cutDepth: 'unset', cutOffset: 0, toolDia: 3.175, cutterShape: 'endmill', cutterAngle: 90 });
    setStockField('thickness', 25.4); setStockField('margin', 6);
    openMode(app, 'prepare');
    assert(edges(app) >= 14, 'Prepare shows the seeded geometry');
    planBefore = planJson(); stockBefore = stockJson(); exportBefore = exportStr(app);
    assert.strictEqual(JSON.parse(planBefore).length, 5, 'five cut records assigned');
    assert.deepStrictEqual(JSON.parse(stockBefore), { thickness: 25.4, width: null, height: null, margin: 6 });
    const d = await app.storedDoc(); // the autosave (page-hide path)
    assert(d.hosts.shaper && d.hosts.shaper.cutPlan.length === 5 && d.hosts.shaper.stock.thickness === 25.4 && d.hosts.shaper.stock.margin === 6, 'the autosave stores the cut plan and stock');
  } finally { await app.close(); }
}

{ // reload: Prepare, then the Review stock card
  const app = await open({ host: 'shaper', profile });
  try {
    openMode(app, 'prepare');
    assert(app.state.shapes.length > 0, 'the document is restored');
    assert.strictEqual(planJson(), planBefore, 'every cut record is equal after a reload (all fields, incl. cutterShape/cutterAngle)');
    assert.strictEqual(stockJson(), stockBefore, 'the stock round-trips');
    assert.strictEqual(exportStr(app), exportBefore, 'the export is byte-identical before vs after the reload');
    assert(edges(app) >= 14, 'Prepare shows the restored geometry');

    openMode(app, 'review');
    const thick = app.document.getElementById('review-stock-thickness');
    assert(thick, 'the Review stock field');
    assert.strictEqual(thick.value, '1.000', 'the card shows the restored 25.4 mm = 1.000 in');
    app.press(thick); app.key('a', { ctrl: true });
    app.type('1.25');
    app.key('Enter');
    assert(Math.abs(getStock().thickness - 31.75) < 1e-9, 'typing 1.25 in sets the stock thickness to 31.75 mm');
    const d = await app.storedDoc();
    assert(Math.abs(d.hosts.shaper.stock.thickness - 31.75) < 1e-9, 'the autosave stores the typed thickness');
  } finally { await app.close(); }
}

{ // reload again: the card shows the typed thickness
  const app = await open({ host: 'shaper', profile });
  try {
    openMode(app, 'review');
    assert.strictEqual(app.document.getElementById('review-stock-thickness').value, '1.250', 'after a reload the card shows 1.250 in');
    assert.ok(Math.abs(getStock().thickness - 31.75) < 1e-9, 'and the stock is 31.75 mm');
    setStockField('thickness', 25.4);
    const d = await app.storedDoc();
    assert.strictEqual(d.hosts.shaper.stock.thickness, 25.4, 'the autosave stores the restored thickness');
  } finally { await app.close(); }
}

{ // a SketchStudio save in between keeps the sidecar
  const app = await open({ host: 'sketchstudio', profile });
  try {
    assert(app.state.shapes.length > 0, 'SketchStudio shows the restored drawing');
    const r = app.svg.getBoundingClientRect();
    const box = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    app.key('l');
    app.click(box.x - 150, box.y + 100); app.click(box.x + 150, box.y + 100);
    app.key('Escape');
    const d = await app.storedDoc();
    assert(d.geometry.shapes.length > 14, 'the SketchStudio autosave stores the drawn line');
  } finally { await app.close(); }
}
{
  const app = await open({ host: 'shaper', profile });
  try {
    openMode(app, 'prepare');
    assert.strictEqual(planJson(), planBefore, 'the cut plan survives a SketchStudio save in between');
    assert.strictEqual(stockJson(), stockBefore, 'and so does the stock');
  } finally { await app.close(); }
}

// an OLD document: the Shaper sidecar is gone
await profile.adapter.updateDesign(designId, (d) => { delete d.document.hosts.shaper; return d; });
{
  const app = await open({ host: 'shaper', profile });
  try {
    openMode(app, 'prepare');
    assert.strictEqual(planJson(), '[]', 'an old document (no sidecar) has an empty cut plan');
    assert.deepStrictEqual(JSON.parse(stockJson()), { thickness: 19.05, width: null, height: null, margin: 12.7 }, 'and the owner-confirmed stock defaults: 3/4 in thick, 1/2 in margin');
    assert(edges(app) >= 14, 'the geometry still loads');
  } finally { await app.close(); }
}
console.log('shaper-persist-node: ok');
