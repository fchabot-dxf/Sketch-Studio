// tests/stl-slice-790-node.test.js — TASK 790: OPEN STL in Shaper. Every STL is BUILT IN THE TEST (tests/helpers/stl-mesh.js: closed lofted meshes,
// written as binary and ASCII STL), never a stored binary.
//  1. the slicer (#core/stl-slice.js), pure: a 120 x 80 x 19 block with a 60 x 40 x 8 vertical pocket and a d12 through hole (binary == ASCII:
//     regions, depths, through, the hole as a circle); the 10-degree drafted pocket == tests/fixtures/sa7-slope/02-drafted-pocket.json within
//     0.05 mm (regions, outer, every slope ring); a 45-degree drafted pocket; a hemisphere dome (one outline, every ring a circle on the sphere); a
//     dovetail pocket (the undercut warning, cut straight at the top opening); a counterbore (a pocket + a through hole); a boss on a plate (the
//     area around it is a pocket with the boss as its island); the six Up sides; mm vs in; broken files refused with a message; the mesh as text and
//     back; the time to slice a 50 000-triangle mesh (printed).
//  2. the app (Shaper through tests/helpers/node-app.js, the page's own declared modules): Open STL replaces the design in one undo step with the
//     notice, the STL card shows the file, Up, Units and size; a press on another Up / unit slices again (one undo step each; undo puts the card
//     back); a Fusion selection or a fresh design has no STL card; a broken file changes nothing; the dome's Stepped outside gives a 3D Review
//     level per terrace; save + reopen keeps the card and the mesh (Up can still be changed), a design without an STL stores no `stl`.
import assert from 'node:assert';
import fs from 'node:fs';
import { parseStl, sliceStl, meshToBase64, meshFromBase64, STL_SLICE, STL_UP_SIDES } from '#core/stl-slice.js';
import { steppedTerraces } from '#core/stepped-cut.js';
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
{
  // the block: binary and ASCII give the same payload
  const tris = M.blockPocketHole();
  const bin = slice(M.binaryStl(tris), { name: 'block.stl' }), asc = slice(M.asciiStl(tris, 'block'), { name: 'block.stl' });
  eq(parseStl(M.binaryStl(tris)).format, 'binary', 'a binary STL is read as binary');
  eq(parseStl(Buffer.from(M.asciiStl(tris))).format, 'ascii', 'an ASCII STL (its bytes) is read as ASCII');
  eq(asc.payload, bin.payload, 'binary and ASCII STL of the same mesh slice to the same payload');
  const P = bin.payload;
  eq([P.action, P.units, P.coordSystem, P.source, P.stock], ['selection_data', 'mm', { yAxis: 'up', frame: 'plane-2d' }, { kind: 'stl', name: 'block.stl', documentName: 'block' }, { thicknessMm: 19 }], 'the add-in contract: mm, Y up, the source, the stock = the height');
  eq(summary(P), ['Outline|outside|19|true|holes 0|slope 0', 'Pocket 1 (8mm)|pocket|8|false|holes 0|slope 0', 'Through Hole 1|inside|19|true|holes 0|slope 0'], 'the block: outline, an 8 mm pocket, a through hole; vertical walls (no slope)');
  eq(P.warnings, [], 'no warning');
  near(apart(ptsOf(P.regions[0].outer.segments), [[0, 0], [120, 0], [120, 80], [0, 80]]), 0, 1e-6, 'the outline is the 120 x 80 rectangle');
  near(apart(ptsOf(P.regions[1].outer.segments), [[30, 20], [90, 20], [90, 60], [30, 60]]), 0, 1e-6, 'the pocket is 60 x 40 at (30, 20)');
  const hole = P.regions[2].outer.segments;
  eq(hole.length === 1 && hole[0].type, 'circle', 'the d12 hole (a 48-sided cylinder in the mesh) is a circle');
  near(hole[0].r, 6, 0.001, 'its radius'); near(hole[0].cx, 100, 1e-6, 'its centre x'); near(hole[0].cy, 40, 1e-6, 'its centre y');
  ok(bin.info.sections > 76 && bin.info.triangles === tris.length / 9, 'info: ' + JSON.stringify(bin.info));
}
{
  // the 10-degree drafted pocket == the add-in's 02-drafted-pocket.json within 0.05 mm
  const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/sa7-slope/02-drafted-pocket.json', import.meta.url), 'utf8'));
  const P = slice(M.binaryStl(M.draftedPocket(10)), { name: '02-drafted-pocket.stl' }).payload;
  eq(summary(P), summary(fx), 'the drafted pocket: the same regions as the add-in (labels, cut types, depths, through, slope ring counts)');
  let worst = 0;
  fx.regions.forEach((a, i) => {
    const b = P.regions[i];
    worst = Math.max(worst, apart(ptsOf(a.outer.segments), ptsOf(b.outer.segments)));
    (a.slope || []).forEach((ra, k) => {
      eq(b.slope[k].zFromTopMm, ra.zFromTopMm, `ring ${k}: its depth`);
      worst = Math.max(worst, apart(ptsOf(ra.segments), ptsOf(b.slope[k].segments)));
    });
  });
  ok(worst <= 0.05, `every outer and slope ring within 0.05 mm of the add-in's (worst ${worst.toExponential(2)} mm)`);
  console.log(`drafted pocket vs 02-drafted-pocket.json: worst ${worst.toExponential(2)} mm over ${fx.regions[1].slope.length} rings`);
  eq(P.warnings, ['Pocket 1: drafted walls cut straight at the top opening'], "the add-in's own warning for a drafted pocket");
}
{
  // a 45-degree drafted pocket: inset 8 mm at its 8 mm floor
  const P = slice(M.binaryStl(M.draftedPocket(45))).payload;
  const pk = P.regions[1];
  eq([pk.label, pk.depthMm, pk.slope.length, pk.slope[32].zFromTopMm], ['Pocket 1 (8mm)', 8, 33, 8], '45 degrees: a ring every 0.25 mm to the 8 mm floor');
  near(apart(ptsOf(pk.slope[32].segments), [[38, 28], [82, 28], [82, 52], [38, 52]]), 0, 0.05, 'the floor ring is inset 8 mm');
  near(apart(ptsOf(pk.slope[4].segments), [[31, 21], [89, 21], [89, 59], [31, 59]]), 0, 0.05, 'the 1 mm ring is inset 1 mm');
  near(apart(ptsOf(pk.outer.segments), [[30, 20], [90, 20], [90, 60], [30, 60]]), 0, 1e-6, 'the plain cut: the top opening');
}
{
  // a hemisphere dome R 30: one outline, every ring a circle on the sphere
  const R = 30;
  const P = slice(M.binaryStl(M.dome(R, 96, 64))).payload; // 96 latitude bands: the mesh itself within 0.05 mm of the sphere
  eq(summary(P).map((s) => s.replace(/slope \d+/, 'slope')), ['Outline|outside|30|true|holes 0|slope'], 'the dome: ONE outline, through, 30 high');
  const rings = P.regions[0].slope;
  ok(rings.length >= 100, 'a ring every 0.25 mm: ' + rings.length);
  ok(rings.every((r) => r.segments.length === 1 && r.segments[0].type === 'circle'), 'every ring is a circle');
  let worst = 0;
  for (const r of rings) worst = Math.max(worst, Math.abs(r.segments[0].r - Math.sqrt(R * R - (R - r.zFromTopMm) ** 2)));
  ok(worst <= 0.05, `every ring on the sphere within 0.05 mm (worst ${worst.toFixed(4)} mm)`);
  near(P.regions[0].outer.segments[0].r, R, 0.01, 'the plain cut: the base (the widest)');
  eq(P.warnings, ['Outline: sloped walls cut straight at the widest outline'], 'the warning: a plain cut is straight');
  const T = steppedTerraces({ kind: 'outside', rings: rings.map((r) => ({ z: r.zFromTopMm, segments: r.segments })) }, { kind: 'outside', step: 1, depth: R });
  eq(T.steps.length, 30, 'Stepped outside at 1 mm: 30 terraces');
}
{
  // a dovetail pocket (40 x 20 at the top, 50 x 30 at its 6 mm floor): the undercut, cut straight at the top opening
  const P = slice(M.binaryStl(M.dovetailPocket())).payload;
  eq(P.warnings, ['Pocket 1: undercut below 0 mm cut straight'], "the undercut, in the add-in's / the cut card's words");
  near(apart(ptsOf(P.regions[1].outer.segments), [[30, 20], [70, 20], [70, 40], [30, 40]]), 0, 1e-6, 'the plain cut: the top opening, never the wider floor');
  eq(P.regions[1].depthMm, 6, 'its depth');
}
{
  // a counterbore (d16 x 5 over a d6 through hole): its shoulder is a floor: a pocket and a through hole
  const T = M.lofted({ outer: [{ z: 19, pts: M.rect(0, 0, 50, 50) }, { z: 0, pts: M.rect(0, 0, 50, 50) }], cavities: [{ through: true, rings: [{ z: 19, pts: M.circle(25, 25, 8) }, { z: 14, pts: M.circle(25, 25, 8) }, { z: 14, pts: M.circle(25, 25, 3) }, { z: 0, pts: M.circle(25, 25, 3) }] }] });
  const P = slice(T).payload;
  eq(summary(P), ['Outline|outside|19|true|holes 0|slope 0', 'Pocket 1 (5mm)|pocket|5|false|holes 0|slope 0', 'Through Hole 1|inside|19|true|holes 0|slope 0'], 'a counterbore: a 5 mm pocket + a through hole');
  eq([P.regions[1].outer.segments[0].r, P.regions[2].outer.segments[0].r].map((r) => Math.round(r * 1000) / 1000), [8, 3], 'their circles');
  // a 40 x 20 x 6 boss standing on a 120 x 80 x 19 plate: the area around it down to the plate is a pocket with the boss as its island
  const B = M.lofted({ outer: [{ z: 25, pts: M.rect(40, 30, 80, 50) }, { z: 19, pts: M.rect(40, 30, 80, 50) }, { z: 19, pts: M.rect(0, 0, 120, 80) }, { z: 0, pts: M.rect(0, 0, 120, 80) }] });
  const Q = slice(B).payload;
  eq(summary(Q), ['Outline|outside|25|true|holes 0|slope 0', 'Pocket 1 (6mm)|pocket|6|false|holes 1|slope 0'], 'a boss on a plate: the outline + a 6 mm pocket around the boss');
  near(apart(ptsOf(Q.regions[1].holes[0].segments), [[40, 30], [80, 30], [80, 50], [40, 50]]), 0, 1e-6, 'the pocket island is the boss');
  eq(Q.warnings, [], 'no warning');
}
{
  // the six Up sides: the block turned so that side is up, sliced with that Up side = the block sliced +Z up
  const tris = M.blockPocketHole();
  const ref = JSON.stringify(slice(tris).payload.regions);
  const INV = { '+Z': (x, y, z) => [x, y, z], '-Z': (x, y, z) => [x, -y, -z], '+Y': (x, y, z) => [x, z, -y], '-Y': (x, y, z) => [x, -z, y], '+X': (x, y, z) => [z, x, y], '-X': (x, y, z) => [-z, x, -y] };
  eq(Object.keys(INV), [...STL_UP_SIDES], 'every Up side is tested');
  for (const up of STL_UP_SIDES) eq(JSON.stringify(slice(M.transformMesh(tris, INV[up]), { up }).payload.regions), ref, `Up ${up}: the same regions`);
  const down = slice(tris, { up: '-Z' }).payload;
  eq(summary(down), ['Outline|outside|19|true|holes 0|slope 0', 'Through Hole 1|inside|19|true|holes 0|slope 0'], 'the block upside down: the pocket is under it (not cut)');
  eq(down.warnings, ['A recess in the bottom (up to 11 mm from the top) cannot be reached from the top: not cut'], 'with a warning, never a silent drop');
}
{
  // Units: STL has none; the same part drawn in inches and read as `in` = the part drawn in mm
  const tris = M.blockPocketHole();
  const inch = M.transformMesh(tris, (x, y, z) => [x / 25.4, y / 25.4, z / 25.4]);
  const a = slice(tris).payload, b = slice(inch, { unit: 'in' });
  eq(summary(b.payload), summary(a), 'read as inches: the same regions and depths');
  near(apart(ptsOf(b.payload.regions[1].outer.segments), ptsOf(a.regions[1].outer.segments)), 0, 1e-4, 'the same pocket');
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
    eq([res.ok, res.message], [true, 'Added block.stl: 3 regions, 0 chains'], 'Open STL: the notice');
    eq(app.modes.current(), 'prepare', 'shown in Prepare (its cuts and its card)');
    eq(app.document.getElementById('prepare-notice').textContent, 'Added block.stl: 3 regions, 0 chains', "Prepare's notice says it");
    eq(plan(), ['exterior@19', 'pocket@8', 'interior@19'], 'the cut plan: the outline, the pocket, the hole');
    eq(getStock().thickness, 19, 'the stock thickness = the part height');
    eq(h.card(), { name: 'block.stl', up: '+Z', unit: 'mm', size: '120 × 80 × 19 mm', ups: ['+Z', '−Z', '+Y', '−Y', '+X', '−X'], labels: ['Up', 'Units', 'Size'] }, 'the STL card');
    const steps = st.history.length;
    h.pressEl('.stl-ups .cut-preset[data-value="-Z"]');
    eq(st.history.length, steps + 1, 'a new Up side: ONE undo step');
    eq(plan(), ['exterior@19', 'interior@19'], 'upside down: the pocket is under the part');
    eq(app.document.getElementById('prepare-notice').textContent, 'Replaced with block.stl: 2 regions, 0 chains (A recess in the bottom (up to 11 mm from the top) cannot be reached from the top: not cut)', 'the notice: replaced, with the warning');
    eq(h.card().up, '−Z', 'the card: -Z');
    st.undo();
    eq([plan(), h.card().up], [['exterior@19', 'pocket@8', 'interior@19'], '+Z'], 'undo: the +Z design and its card');
    st.redo();
    eq([plan(), h.card().up], [['exterior@19', 'interior@19'], '−Z'], 'redo: -Z again');
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

    // the dome, Roughing (TASK 792: it replaced Stepped outside; an STL outline carries its levels: a pocket round the part at each level): the 3D Review has a level per step
    app.stl.openFile(M.asciiStl(M.dome(30), 'dome'), 'dome.stl');
    eq(plan(), ['exterior@30'], 'the dome: one outline');
    h.clickAt(30, -30);
    h.pick('roughing');
    const items = planReliefItems(st);
    eq(items.length, 30, 'Roughing at the default 1 mm step: 30 level pockets');
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
      eq(Object.keys(d0.hosts.shaper), ['version', 'cutPlan', 'stock', 'opOrder'], 'a design not from an STL (here from Fusion) stores no `stl`: its Shaper part is as before');
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
      eq(plan(), ['exterior@19', 'pocket@8'], 'and its cuts');
      h.pressEl('.stl-ups .cut-preset[data-value="+X"]');
      eq([h.card().up, h.card().size], ['+X', '80 × 19 × 120 mm'], 'reopened, Up +X slices the stored mesh again');
    } finally { await app.close(); }
  }
}

console.log(`stl-slice-790-node: ok (${checks} checks)`);
