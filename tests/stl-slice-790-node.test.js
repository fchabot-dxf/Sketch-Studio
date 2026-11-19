// tests/stl-slice-790-node.test.js — TASK 790: OPEN STL in Shaper. Every STL is BUILT IN THE TEST (tests/helpers/stl-mesh.js: closed lofted meshes,
// written as binary and ASCII STL), never a stored binary.
//  1. the slicer (#core/stl-slice.js), pure: a 120 x 80 x 19 block with a 60 x 40 x 8 vertical pocket and a d12 through hole (binary == ASCII; TASK 807:
//     ONE region, the relief, Roughing); the six Up sides; mm vs in; broken files refused with a message; the mesh as text and back; the time to
//     slice a 50 000-triangle mesh (printed). (TASK 807: the per-feature tests went with the per-feature import; the relief: stl-relief-807-node.)
//  2. the app (Shaper through tests/helpers/node-app.js, the page's own declared modules): Open STL replaces the design in one undo step with the
//     notice, the STL card shows the file, Up, Units and size; a press on another Up / unit slices again (one undo step each; undo puts the card
//     back); a Fusion selection or a fresh design has no STL card; a broken file changes nothing; the dome's Roughing (TASK 807: as it opens) gives a
//     3D Review level per step; save + reopen keeps the card and the mesh (Up can still be changed), a design without an STL stores no `stl`.
import assert from 'node:assert';
import fs from 'node:fs';
import { parseStl, sliceStl, meshToBase64, meshFromBase64, STL_SLICE, STL_UP_SIDES } from '#core/stl-slice.js';
import { buildRelief } from '#core/relief-model.js';
import SettingsManager from '#core/settings-manager.js';
import { IMPORT_FILE_PICK } from '#ui/project-file.js';
import * as M from './helpers/stl-mesh.js';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { worldToScreen } from '#ui/coords.js';
import { CUT_PLAN, planReliefItems } from '../apps/shaper/src/cut-plan.js';
import { getStock } from '../apps/shaper/src/stock.js';
import { importFusionSelection } from '../apps/shaper/src/fusion-import.js';
import { STL_FILE_PICK } from '../apps/shaper/src/stl-import.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b} (tol ${tol})`); checks++; };

const slice = (input, opts = {}) => {
  const p = input instanceof Float32Array ? { ok: true, triangles: input } : parseStl(input); // a mesh built here, or a file
  assert.ok(p.ok, 'parsed: ' + p.message);
  const r = sliceStl(p.triangles, { name: 'part.stl', ...opts });
  assert.ok(r.ok, 'sliced: ' + r.message);
  return r;
};
const summary = (payload) => payload.regions.map((g) => `${g.label}|${g.cutType}|${g.depthMm}|${g.through}|holes ${g.holes.length}|slope ${g.slope ? g.slope.length : 0}`);
const ptsOf = (segs) => segs.flatMap((s) => (s.type === 'circle' ? [[s.cx, s.cy]] : [[s.x1, s.y1], [s.x2, s.y2]]));
// the farthest any point of A is from the nearest point of B, both ways (the rings' corners: lines only)
const apart = (A, B) => Math.max(...[[A, B], [B, A]].map(([P, Q]) => Math.max(...P.map((a) => Math.min(...Q.map((b) => Math.hypot(a[0] - b[0], a[1] - b[1])))))));

// ── 1. the slicer ──
// TASK 807 (owner turns 2638-2640): an STL is a RELIEF (ONE region, Roughing, its levels from the height map); the per-feature tests (the outline,
// pockets, through holes, slope rings, the drafted pocket vs the add-in's fixture, the dome's rings, the dovetail, the counterbore, the boss) went with
// the per-feature import; the relief's own tests are tests/stl-relief-807-node.test.js.
{
  // the block: binary and ASCII give the same payload
  const tris = M.blockPocketHole();
  const bin = slice(M.binaryStl(tris), { name: 'block.stl' }), asc = slice(M.asciiStl(tris, 'block'), { name: 'block.stl' });
  eq(parseStl(M.binaryStl(tris)).format, 'binary', 'a binary STL is read as binary');
  eq(parseStl(Buffer.from(M.asciiStl(tris))).format, 'ascii', 'an ASCII STL (its bytes) is read as ASCII');
  eq(asc.payload, bin.payload, 'binary and ASCII STL of the same mesh slice to the same payload');
  const P = bin.payload;
  eq([P.action, P.units, P.coordSystem, P.source, P.stock], ['selection_data', 'mm', { yAxis: 'up', frame: 'plane-2d' }, { kind: 'stl', name: 'block.stl', documentName: 'block' }, { thicknessMm: 19 }], 'the add-in contract: mm, Y up, the source, the stock = the height');
  eq(summary(P), ['Relief|roughing|19|true|holes 0|slope 0'], 'the block: ONE region, the relief');
  eq(P.warnings, [], 'no warning');
  ok(bin.info.sections > 76 && bin.info.triangles === tris.length / 9, 'info: ' + JSON.stringify(bin.info));
}
{
  // the six Up sides: the block turned so that side is up, sliced with that Up side = the block sliced +Z up
  const tris = M.blockPocketHole();
  const ref = JSON.stringify(slice(tris).payload.regions);
  const INV = { '+Z': (x, y, z) => [x, y, z], '-Z': (x, y, z) => [x, -y, -z], '+Y': (x, y, z) => [x, z, -y], '-Y': (x, y, z) => [x, -z, y], '+X': (x, y, z) => [z, x, y], '-X': (x, y, z) => [-z, x, -y] };
  eq(Object.keys(INV), [...STL_UP_SIDES], 'every Up side is tested');
  for (const up of STL_UP_SIDES) eq(JSON.stringify(slice(M.transformMesh(tris, INV[up]), { up }).payload.regions), ref, `Up ${up}: the same relief`);
  eq(slice(tris, { up: '-Z' }).payload.warnings, ['2400 mm² of the part is out of the top\'s reach (an overhang, a hollow, a recess under it): the wood there is left'], 'the block upside down: the pocket is under it, with a warning, never a silent drop');
}
{
  // Units: STL has none; the same part drawn in inches and read as `in` = the part drawn in mm
  const tris = M.blockPocketHole();
  const inch = M.transformMesh(tris, (x, y, z) => [x / 25.4, y / 25.4, z / 25.4]);
  const a = slice(tris).payload, b = slice(inch, { unit: 'in' });
  eq(summary(b.payload), summary(a), 'read as inches: the same relief and depth');
  near(apart(ptsOf(b.payload.regions[0].outer.segments), ptsOf(a.regions[0].outer.segments)), 0, 1e-4, 'the same work area');
  for (const [k, v] of Object.entries({ x: 120, y: 80, z: 19 })) near(b.info.sizeMm[k], v, 1e-4, `its size in mm (${k}; the file's float32 inches)`);
  const asMm = slice(inch);
  near(asMm.info.sizeMm.x, 120 / 25.4, 1e-4, 'read as mm the inch drawing is 25.4 times smaller');
}
{
  // broken files are refused with a message
  const good = M.binaryStl(M.blockPocketHole());
  const cases = {
    empty: [Buffer.alloc(0), 'The file is empty.'],
    'not an STL': [Buffer.from('PK\u0003\u0004 a zip file, not a mesh at all, long enough to have an 80 byte header and a count field......................'), /^This binary STL is damaged: its header says/],
    'short text': [Buffer.from('hello'), 'This is not an STL file.'],
    'truncated binary': [good.subarray(0, good.length - 7), /^This binary STL is damaged: its header says 224 triangles \(11,284 bytes\) but the file has 11,277 bytes\.$/],
    'no triangles': [M.binaryStl(new Float32Array(0)), 'This STL has no triangles.'],
    'ASCII cut short': [M.asciiStl(M.blockPocketHole()).slice(0, 3000), /^This ASCII STL is damaged: .*no endsolid \(the file ends early\)\.$/],
    'ASCII bad number': [M.asciiStl(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).replace('vertex 1.00000000', 'vertex 1.0x'), 'This STL is damaged: "1.0x" (triangle 1) is not a number.'],
    'binary NaN': [(() => { const b = M.binaryStl(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])); b.writeFloatLE(NaN, 84 + 12 + 8); return b; })(), 'This STL is damaged: triangle 1 has a coordinate that is not a number.'],
  };
  for (const [name, [input, want]] of Object.entries(cases)) {
    const r = parseStl(input);
    ok(r.ok === false, name + ': refused');
    if (want instanceof RegExp) ok(want.test(r.message), `${name}: ${r.message}`); else eq(r.message, want, name);
  }
  // over the limit: the header's count is refused before anything is read
  const big = Buffer.alloc(84 + 50 * (STL_SLICE.maxTriangles + 1));
  big.writeUInt32LE(STL_SLICE.maxTriangles + 1, 80);
  const fmt = (n) => n.toLocaleString('en-US');
  eq(parseStl(big).message, `This STL has ${fmt(STL_SLICE.maxTriangles + 1)} triangles; the limit is ${fmt(STL_SLICE.maxTriangles)}.`, 'over the limit');
  eq(sliceStl(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).message, 'This STL is flat: it has no height or no area seen from the chosen Up side.', 'a flat mesh: nothing to cut');
}
{
  // the mesh as text (the Shaper document keeps it) and back, exactly
  const tris = M.dovetailPocket();
  eq([...meshFromBase64(meshToBase64(tris))], [...tris], 'the mesh as base64 and back');
  // the size limit's time: a 50 000-triangle dome (196 latitude bands x 128 sides)
  const big = M.dome(30, 196, 128);
  const t0 = performance.now();
  const r = sliceStl(big, { name: 'dome-50k.stl' });
  const ms = Math.round(performance.now() - t0);
  console.log(`50k: ${big.length / 9} triangles, ${r.info.sections} sections, ${ms} ms`);
  ok(r.ok && big.length / 9 >= 50000 && ms < 5000, `a 50 000-triangle mesh slices in under 5 s (${ms} ms)`);
}

// ── 2. the app ──
const harness = (app) => {
  const doc = app.document, q = (s) => doc.querySelector(s);
  const pressEl = (s) => { const e = q(s); assert(e, s + ' not found'); app.press(e); };
  const pc = doc.getElementById('prepare-canvas');
  const clickAt = (x, y) => { const p = worldToScreen(pc, { x, y }); app.click(Math.round(p.x), Math.round(p.y), { target: pc }); };
  const pick = (id) => { pressEl('.cut-type-trigger'); pressEl(`.cut-type-opt[data-id="${id}"]`); };
  const card = () => {
    const c = q('.stl-card');
    if (!c || c.hidden) return null;
    return { name: q('.stl-name').textContent, up: q('.stl-ups .is-active').textContent, unit: q('.stl-units .is-active').textContent, size: q('.stl-size').textContent,
      ups: [...doc.querySelectorAll('.stl-ups .cut-preset')].map((b) => b.textContent), labels: [...doc.querySelectorAll('.stl-card .cut-field-label')].map((b) => b.textContent) };
  };
  return { q, pressEl, clickAt, pick, card };
};
const plan = () => [...CUT_PLAN.values()].map((r) => `${r.cutType}@${r.cutDepth}`);

eq(STL_FILE_PICK.exts, ['.stl'], "Shaper's own pick offers STL");
ok(!IMPORT_FILE_PICK.exts.includes('.stl'), 'the SHARED import pick (SketchStudio, Pen Plotter, Trace, Shaper SVG / DXF) never offers STL: ' + IMPORT_FILE_PICK.exts);
{
  CUT_PLAN.clear();
  SettingsManager.set('DOC_UNIT', 'mm');
  const app = await open({ host: 'shaper' });
  try {
    const h = harness(app);
    eq(h.card(), null, 'a fresh design: no STL card');
    const st = app.state;
    const res = app.stl.openFile(M.binaryStl(M.blockPocketHole()), 'block.stl');
    const nLv = res.info.sections; // TASK 807: a relief
    eq([res.ok, res.message], [true, `Added block.stl: a relief, ${nLv} levels`], 'Open STL: the notice');
    eq(app.modes.current(), 'prepare', 'shown in Prepare (its cuts and its card)');
    eq(app.document.getElementById('prepare-notice').textContent, `Added block.stl: a relief, ${nLv} levels`, "Prepare's notice says it");
    eq(plan(), ['roughing@19'], 'the cut plan: ONE Roughing (TASK 807: the relief)');
    eq(getStock().thickness, 19, 'the stock thickness = the part height');
    eq(h.card(), { name: 'block.stl', up: '+Z', unit: 'mm', size: '120 × 80 × 19 mm', ups: ['+Z', '−Z', '+Y', '−Y', '+X', '−X'], labels: ['Up', 'Units', 'Size'] }, 'the STL card');
    const steps = st.history.length;
    h.pressEl('.stl-ups .cut-preset[data-value="-Z"]');
    eq(st.history.length, steps + 1, 'a new Up side: ONE undo step');
    eq(plan(), ['roughing@19'], 'upside down: the relief again');
    ok(CUT_PLAN.values().next().value.levels.every((l) => l.loops.length === 2), 'upside down: the pocket is under the part (every level: the block + the hole)');
    eq(app.document.getElementById('prepare-notice').textContent, `Replaced with block.stl: a relief, ${nLv} levels (2400 mm² of the part is out of the top's reach (an overhang, a hollow, a recess under it): the wood there is left)`, 'the notice: replaced, with the warning');
    eq(h.card().up, '−Z', 'the card: -Z');
    st.undo();
    eq([CUT_PLAN.values().next().value.levels.some((l) => l.loops.length === 3), h.card().up], [true, '+Z'], 'undo: the +Z design (its pocket in the levels) and its card');
    st.redo();
    eq([CUT_PLAN.values().next().value.levels.some((l) => l.loops.length === 3), h.card().up], [false, '−Z'], 'redo: -Z again');
    st.undo();
    h.pressEl('.stl-units .cut-preset[data-value="in"]');
    eq([h.card().unit, h.card().size, getStock().thickness], ['in', '3048 × 2032 × 482.6 mm', 482.6], 'Units in: the size and the stock follow');
    st.undo();
    eq([h.card().unit, h.card().size], ['mm', '120 × 80 × 19 mm'], 'undo: mm again');
    SettingsManager.set('DOC_UNIT', 'in');
    ok(/^4\.724 × 3\.15 × 0\.748 in$|"/.test(h.card().size), 'the size follows the document unit: ' + h.card().size);
    SettingsManager.set('DOC_UNIT', 'mm');

    // a broken file changes nothing
    const shapes = st.shapes.length, before = st.history.length;
    const bad = app.stl.openFile(Buffer.from('hello'), 'bad.stl');
    eq([bad.ok, bad.message, st.shapes.length, st.history.length], [false, 'This is not an STL file.', shapes, before], 'a broken file: refused, the design and its history unchanged');

    // a Fusion selection replaces the design: no STL card; undo puts the STL design (and its card) back
    importFusionSelection(fs.readFileSync(new URL('./fixtures/sa7-slope/06-countersink.json', import.meta.url), 'utf8'), { controller: app.controller, prepare: app.prepare });
    eq(h.card(), null, 'a design from Fusion has no STL card');
    st.undo();
    eq(h.card() && h.card().name, 'block.stl', 'undo: the STL design and its card');

    // the dome, Roughing (TASK 807: an STL opens as Roughing with its levels: a pocket round the part at each level): the 3D Review has a level per step
    app.stl.openFile(M.asciiStl(M.dome(30), 'dome'), 'dome.stl');
    eq(plan(), ['roughing@30'], 'the dome: one Roughing');
    const items = planReliefItems(st);
    ok(items.length >= 30 && items.length <= 34, `Roughing at the default 1 mm step: a terrace path per level (${items.length}: TASK 807, the levels off the height map split the 0.03 mm bands at the dome's foot in a few pieces)`);
    const levels = buildRelief({ stock: { thickness: getStock().thickness }, items }).levels.map((l) => l.depth);
    eq(levels, Array.from({ length: 30 }, (_, i) => i + 1), 'the 3D Review: a level at every 1 mm, 1..30');
  } finally { await app.close(); }
}
{
  // save + reopen: the card and the mesh are kept; a design without an STL stores none
  CUT_PLAN.clear();
  const profile = await createProfile();
  await createNamedDesign(profile, 'shaper', 'STL 790');
  {
    const app = await open({ host: 'shaper', profile });
    try {
      importFusionSelection(fs.readFileSync(new URL('./fixtures/sa7-slope/06-countersink.json', import.meta.url), 'utf8'), { controller: app.controller, prepare: app.prepare });
      const d0 = await app.storedDoc();
      eq(Object.keys(d0.hosts.shaper), ['version', 'cutPlan', 'stock', 'opOrder', 'selections'], 'a design not from an STL (here from Fusion) stores no `stl`: its Shaper part is as before (TASK 795: + its selection list, one row)');
      app.stl.openFile(M.binaryStl(M.draftedPocket(10)), 'drafted.stl');
      harness(app).pressEl('.stl-units .cut-preset[data-value="mm"]'); // the current unit: nothing happens
      const d = await app.storedDoc();
      const s = d.hosts.shaper.stl;
      eq([s.name, s.up, s.unit, s.triangles, s.sizeMm], ['drafted.stl', '+Z', 'mm', 28, { x: 120, y: 80, z: 19 }], 'the document stores the STL source');
      eq([...meshFromBase64(s.mesh)], [...M.draftedPocket(10)], '... with its mesh');
    } finally { await app.close(); }
  }
  {
    const app = await open({ host: 'shaper', profile });
    try {
      app.modes.showMode('prepare');
      const h = harness(app);
      eq(h.card() && [h.card().name, h.card().up, h.card().unit, h.card().size], ['drafted.stl', '+Z', 'mm', '120 × 80 × 19 mm'], 'reopened: the STL card');
      eq(plan(), ['roughing@19'], 'and its cut (the relief)');
      h.pressEl('.stl-ups .cut-preset[data-value="+X"]');
      eq([h.card().up, h.card().size], ['+X', '80 × 19 × 120 mm'], 'reopened, Up +X slices the stored mesh again');
    } finally { await app.close(); }
  }
}

console.log(`stl-slice-790-node: ok (${checks} checks)`);
