// tests/insert-stl-841-node.test.js — TASK 841: INSERT STL (an STL ADDED to the design as one more relief part; Open STL still replaces it), on the Shaper node
// page (tests/helpers/node-app.js), STLs built in the test (tests/helpers/stl-mesh.js):
//  1. LEVELS FOLLOW THE PART: an opened STL's outline moved and turned in Design (a Design edit, one undo step): its levels stay where they were until the plan is
//     read again (entering Prepare: today's recalculation), then they are moved by EXACTLY the move and turned by the turn; Undo / Redo; the derivation reads them.
//  2. INSERT into a design with shapes + operations (a plate in an Outside, a square in a Pocket): every shape, point, constraint, operation (and their order) and
//     region byte-identical; ONE new part (its work area) in ONE new Roughing holding its levels; one selection, one STL source; the stock unchanged; the notice;
//     the part lands clear of the plate (INSERT_PLACE); ONE undo step (Undo = the design before, Redo = the insert).
//  3. A SECOND insert (a part taller than the stock): two parts, two sources, two Roughings; the notice says the part is taller than the stock, the stock is not
//     changed. The card follows the relief selected in Prepare; a re-slice of one (Up -Z) leaves the other part, its operation and its region identical, the
//     re-sliced part where it was.
//  4. The inserted part moved: out of date until Prepare is entered again, then its levels moved by exactly the move (and turned); Undo / Redo.
//  5. SAVE / LOAD round trip: the sources list (both parts), the regions' frames; a document of before 841 (ONE source, an object) loads as a list of one (part =
//     its STL selection, opened); OPEN STL still replaces the design (the list = its one STL, the stock = its height).
import assert from 'node:assert/strict';
import { open } from './helpers/node-app.js';
import SettingsManager from '#core/settings-manager.js';
import { rect } from '#core/tool-ops.js';
import { findLoops } from '#core/loop-finder.js';
import { transformShapes } from '#core/transform.js';
import { computeGeometryBounds } from '#core/geometry-bounds.js';
import * as M from './helpers/stl-mesh.js';
import { storeOps, regionOf, applyStore, captureStore, opById } from '../apps/shaper/src/operations-store.js';
import { captureShaperDoc, applyShaperDoc, applyPrepare } from '../apps/shaper/src/shaper-doc.js';
import { keyOf, planEntries } from '../apps/shaper/src/cut-plan.js';
import { getSelections } from '../apps/shaper/src/selection-list.js';
import { getStlSources, getStlSource } from '../apps/shaper/src/stl-source.js';
import { getStock, setStock } from '../apps/shaper/src/stock.js';
import { INSERT_PLACE } from '../apps/shaper/src/stl-import.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
SettingsManager.set('DOC_UNIT', 'mm', { persist: false });
const SMALL = M.binaryStl(M.smallBlock()), DOME = M.binaryStl(M.dome(30, 16, 48)), BLOCK = M.binaryStl(M.blockPocketHole());
const J = (v) => JSON.stringify(v);
const near = (a, b, tol, m) => { ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b}`); };

const app = await open({ host: 'shaper' });
try {
  const st = app.state;
  const pv = () => app.prepare.view();
  const toPrepare = () => { app.modes.showMode('design'); app.modes.showMode('prepare'); };
  const solve = () => app.engine.solve(500);
  const notice = () => app.document.getElementById('prepare-notice').textContent;
  const make = (keys, type, fields = {}) => {
    app.prepare.ok();
    pv().setSelection(keys.map((k) => { const i = k.indexOf(':'); return { kind: k.slice(0, i), id: k.slice(i + 1) }; }));
    app.prepare.pickType(type);
    for (const [f, v] of Object.entries(fields)) pv().setOpField(f, v);
    app.prepare.ok();
    return storeOps()[storeOps().length - 1].id;
  };
  const select = (key) => { app.prepare.ok(); const i = key.indexOf(':'); pv().setSelection([{ kind: key.slice(0, i), id: key.slice(i + 1) }]); }; // a click on the shape: Prepare's focus
  const loopKeyOf = (lines) => keyOf('loop', findLoops(st).find((l) => l.edges.length === lines.length && lines.every((e) => l.edges.includes(e))).id);
  const fresh = () => { app.modes.showMode('design'); app.prepare.ok(); st.clearDocument(); applyPrepare(null); }; // the store, the STL sources, the selection list
  const entryOf = (name) => getSelections().filter((e) => e.kind === 'stl' && e.name === name).pop();
  const keyOfPart = (e) => e.cutKeys[0];
  const partJoints = (e) => [...new Set(st.shapes.filter((s) => e.shapeIds.includes(s.id)).flatMap((s) => s.joints))];
  const partBox = (e) => computeGeometryBounds(Object.create(st, { shapes: { value: st.shapes.filter((s) => e.shapeIds.includes(s.id)) } }));
  const pts = (levels) => levels.flatMap((lv) => lv.loops.flatMap((f) => f));
  // a Design move: every joint of `ids` moved by (dx, dy), then turned by `deg` about `pivot` (#core/transform.js transformShapes, the transform box's rewrite)
  const moveTurn = (e, dx, dy, deg, pivot) => {
    app.modes.showMode('design');
    st.saveState('move');
    for (const j of partJoints(e)) { const p = st.joints.get(j); p.x += dx; p.y += dy; }
    transformShapes(st, e.shapeIds, { pivot, angle: (deg * Math.PI) / 180, scale: 1 });
  };
  const expectMoved = (before, after, dx, dy, deg, pivot, what) => {
    const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), P = pts(before), Q = pts(after);
    eq(Q.length, P.length, `${what}: the same level points`);
    let worst = 0;
    for (let i = 0; i < P.length; i += 2) {
      const x = P[i] + dx - pivot.x, y = P[i + 1] + dy - pivot.y;
      worst = Math.max(worst, Math.hypot(pivot.x + c * x - s * y - Q[i], pivot.y + s * x + c * y - Q[i + 1]));
    }
    ok(worst <= 2e-6, `${what}: every level point moved by exactly the move and turned by ${deg} deg (worst ${worst} mm)`);
    return worst;
  };

  // ── 1. an OPENED STL's levels follow its outline (fail-first: before 841 they were left where the part was sliced)
  {
    fresh();
    const res = app.stl.openFile(SMALL, 'small.stl');
    ok(res.ok && res.imported, '1: Open STL');
    toPrepare();
    const e = entryOf('small.stl'), key = keyOfPart(e), lv0 = regionOf(key).levels;
    ok(Array.isArray(lv0) && lv0.length > 2, `1: the relief has ${lv0.length} levels`);
    const pivot = { x: 20, y: -15 };
    moveTurn(e, 37.5, -12.25, 30, pivot);
    eq(regionOf(key).levels, lv0, '1: right after the Design move the levels are as they were (out of date until the plan is read again)');
    toPrepare();
    const w = expectMoved(lv0, regionOf(key).levels, 37.5, -12.25, 30, pivot, '1: Prepare entered (the recalculation)');
    console.log(`ROW opened part moved 37.5, -12.25 + turned 30 deg | levels follow | worst ${w.toExponential(2)} mm`);
    const entry = planEntries().find((x) => x.planKey === key);
    ok(entry && entry.rec.levels === regionOf(key).levels, '1: the derivation reads the moved levels');
    app.modes.showMode('design'); st.undo(); toPrepare();
    expectMoved(lv0, regionOf(key).levels, 0, 0, 0, pivot, '1: Undo: the levels where they were');
    app.modes.showMode('design'); st.redo(); toPrepare();
    expectMoved(lv0, regionOf(key).levels, 37.5, -12.25, 30, pivot, '1: Redo: moved again');
  }

  // ── 2. INSERT into a design with shapes and operations
  let plateKey, squareKey, outsideId, pocketId;
  {
    fresh();
    setStock({ ...getStock(), thickness: 19.05 }); // 3/4 in board
    const plate = rect(st, 0, -60, 100, 0), sq = rect(st, 20, -40, 40, -20);
    solve();
    toPrepare();
    plateKey = loopKeyOf(plate.lines); squareKey = loopKeyOf(sq.lines);
    outsideId = make([plateKey], 'exterior'); pocketId = make([squareKey], 'pocket', { cutDepth: 6 });
    Object.assign(st.view, { x: 50, y: -30, w: 400, h: 300 }); // the Design view centred on the plate: the part cannot land in the middle
    app.modes.showMode('design');
    const before = { shapes: J(st.shapes), joints: J([...st.joints]), constraints: J(st.constraints), ops: J(captureStore().operations), regions: captureStore().regions, stock: getStock().thickness, sketches: J(st.sketches) };
    const shapeIds = new Set(st.shapes.map((s) => s.id)), jointIds = new Set(st.joints.keys()), opIds = storeOps().map((o) => o.id);
    const res = app.stl.insertFile(SMALL, 'small.stl');
    const n = res.info && res.info.sections;
    eq([res.ok, res.message], [true, `Inserted small.stl: a relief, ${n} levels`], '2: the notice');
    eq(notice(), `Inserted small.stl: a relief, ${n} levels`, "2: Prepare's notice");
    eq(J(st.shapes.filter((s) => shapeIds.has(s.id))), before.shapes, '2: every shape that was there: byte-identical');
    eq(J([...st.joints].filter(([id]) => jointIds.has(id))), before.joints, '2: every point that was there: byte-identical');
    eq(J(st.constraints.slice(0, JSON.parse(before.constraints).length)), before.constraints, '2: every constraint that was there: byte-identical');
    eq(J(captureStore().operations.filter((o) => opIds.includes(o.id))), before.ops, '2: every operation that was there (and their order): byte-identical');
    const regionsNow = captureStore().regions;
    ok(Object.entries(before.regions).every(([k, v]) => regionsNow[k] === v), '2: every region that was there: the same entry');
    eq(getStock().thickness, before.stock, '2: the stock thickness unchanged');
    const added = st.shapes.filter((s) => !shapeIds.has(s.id));
    eq(added.map((s) => s.type), ['line', 'line', 'line', 'line'], '2: ONE new part: its work area (4 sides)');
    const newOps = storeOps().filter((o) => !opIds.includes(o.id));
    eq(newOps.map((o) => [o.type, o.geometry.length]), [['roughing', 1]], '2: ONE new operation: a Roughing holding the part');
    const e = entryOf('small.stl'), key = keyOfPart(e);
    eq(newOps[0].geometry[0].key, key, '2: the Roughing holds the part');
    eq(regionOf(key).levels.length, n, '2: with its levels');
    ok(regionOf(key).frame && regionOf(key).frame.joints.length === 4, "2: and the part's own frame (its 4 corners)");
    eq(getSelections().map((x) => x.kind), ['stl'], '2: one selection (the part)');
    eq(getStlSources().map((s) => [s.name, s.part, Boolean(s.opened)]), [['small.stl', e.id, false]], '2: one STL source, keyed by the part');
    const pb = partBox(e), plateBox = { minX: 0, minY: -60, maxX: 100, maxY: 0 }, g = INSERT_PLACE.gapMm;
    near(pb.w, 40, 1e-6, '2: the part is 40 wide'); near(pb.h, 30, 1e-6, '2: and 30 long');
    ok(pb.minX >= plateBox.maxX + g - 1e-6 || pb.maxX <= plateBox.minX - g + 1e-6 || pb.minY >= plateBox.maxY + g - 1e-6 || pb.maxY <= plateBox.minY - g + 1e-6, `2: the part lands clear of the plate by ${g} mm: ${J(pb)}`);
    const L = pts(regionOf(key).levels), xs = L.filter((_, i) => i % 2 === 0), ys = L.filter((_, i) => i % 2 === 1);
    ok(Math.min(...xs) >= pb.minX - 1e-6 && Math.max(...xs) <= pb.maxX + 1e-6 && Math.min(...ys) >= pb.minY - 1e-6 && Math.max(...ys) <= pb.maxY + 1e-6, '2: its levels lie on the part where it landed');
    console.log(`ROW insert next to a plate | part box ${J({ x: [pb.minX, pb.maxX], y: [pb.minY, pb.maxY] })} | ${n} levels | ops ${storeOps().map((o) => o.type).join(', ')}`);
    // ONE undo step
    app.modes.showMode('design'); st.undo(); toPrepare();
    eq([J(st.shapes), J(captureStore().operations), getStlSources().length, getSelections().length], [before.shapes, before.ops, 0, 0], '2: Undo: the design as before the insert');
    app.modes.showMode('design'); st.redo(); toPrepare();
    eq([st.shapes.length, storeOps().length, getStlSources().length, getSelections().length], [12, 3, 1, 1], '2: Redo: the insert again');
  }

  // ── 3. a second insert (taller than the stock), the card, a re-slice of one part
  {
    app.modes.showMode('design');
    const res = app.stl.insertFile(DOME, 'dome.stl');
    const n = res.info.sections;
    eq(res.message, `Inserted dome.stl: a relief, ${n} levels · dome.stl is 30 mm tall: the stock is 19.05 mm`, '3: a part taller than the stock: said in the notice');
    eq(getStock().thickness, 19.05, '3: the stock is NOT changed');
    eq(getStlSources().map((s) => s.name), ['small.stl', 'dome.stl'], '3: two STL sources');
    eq(storeOps().filter((o) => o.type === 'roughing').length, 2, '3: two Roughings, one per part');
    eq(getStlSource().name, 'dome.stl', '3: the card shows the part just inserted');
    toPrepare();
    const small = entryOf('small.stl'), dome = entryOf('dome.stl');
    const sKey = keyOfPart(small), dKey = keyOfPart(dome);
    select(sKey);
    eq(getStlSource().name, 'small.stl', '3: the card follows the relief selected in Prepare');
    eq(app.document.querySelector('.stl-card .stl-name').textContent, 'small.stl', "3: the card's name");
    const domeShapes = J(st.shapes.filter((s) => dome.shapeIds.includes(s.id))), domeOp = J(storeOps().find((o) => o.geometry.some((r) => r.key === dKey))), domeRegion = regionOf(dKey);
    const smallBox = partBox(small), sourcesBefore = getStlSources();
    const rs = app.stl.reslice({ up: '-Z' });
    eq(rs.message.startsWith('Replaced with small.stl: a relief, '), true, `3: the re-slice notice: ${rs.message}`);
    eq(J(st.shapes.filter((s) => dome.shapeIds.includes(s.id))), domeShapes, '3: the other part: byte-identical');
    eq(J(storeOps().find((o) => o.geometry.some((r) => r.key === dKey))), domeOp, "3: the other part's operation: byte-identical");
    ok(regionOf(dKey) === domeRegion, "3: the other part's region: the same entry");
    eq(getStlSources().map((s) => [s.name, s.up]), [['small.stl', '-Z'], ['dome.stl', '+Z']], '3: the re-sliced source in its place, the other unchanged');
    eq(getStlSources()[1], sourcesBefore[1], "3: the other part's source: identical");
    const small2 = entryOf('small.stl'), box2 = partBox(small2);
    eq([box2.minX, box2.maxX, box2.minY, box2.maxY].map((v) => Math.round(v * 1e6) / 1e6), [smallBox.minX, smallBox.maxX, smallBox.minY, smallBox.maxY].map((v) => Math.round(v * 1e6) / 1e6), '3: the re-sliced part where it was (the same footprint)');
    eq(getStock().thickness, 19.05, '3: the re-slice of an inserted part leaves the stock');
    app.modes.showMode('design'); st.undo(); toPrepare();
    eq(getStlSources().map((s) => [s.name, s.up]), [['small.stl', '+Z'], ['dome.stl', '+Z']], '3: Undo: the part as it was sliced');
    app.modes.showMode('design'); st.redo(); toPrepare();
    eq(getStlSources().map((s) => [s.name, s.up]), [['small.stl', '-Z'], ['dome.stl', '+Z']], '3: Redo');
  }

  // ── 4. the inserted part moved: out of date, then the levels moved by exactly the move
  {
    const e = entryOf('dome.stl'), key = keyOfPart(e), lv0 = regionOf(key).levels, b = partBox(e);
    const pivot = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
    moveTurn(e, -55, 20, -45, pivot);
    eq(regionOf(key).levels, lv0, '4: right after the move: the levels as they were (out of date)');
    toPrepare();
    const w = expectMoved(lv0, regionOf(key).levels, -55, 20, -45, pivot, '4: Prepare entered');
    console.log(`ROW inserted part moved -55, 20 + turned -45 deg | levels follow | worst ${w.toExponential(2)} mm`);
    app.modes.showMode('design'); st.undo(); toPrepare();
    expectMoved(lv0, regionOf(key).levels, 0, 0, 0, pivot, '4: Undo');
    app.modes.showMode('design'); st.redo(); toPrepare();
    expectMoved(lv0, regionOf(key).levels, -55, 20, -45, pivot, '4: Redo');
  }

  // ── 5. save / load, an old document, Open STL
  {
    const doc = JSON.parse(JSON.stringify(captureShaperDoc()));
    eq(doc.stl.map((s) => [s.name, s.part, s.up, 'mesh' in s, s.relief, s.opened]), getStlSources().map((s) => [s.name, s.part, s.up, true, true, undefined]), '5: the document stores the list (each with its part and mesh)');
    const sourcesBefore = getStlSources().map(({ key, ...rest }) => rest), regionsBefore = J(captureStore().regions);
    applyStore(null);
    applyShaperDoc(doc, st);
    eq(getStlSources().map(({ key, ...rest }) => rest), sourcesBefore, '5: reloaded: the same sources');
    eq(J(captureStore().regions), regionsBefore, '5: reloaded: the same regions (levels + frames)');
    // a document of before 841: ONE source (an object)
    fresh();
    app.stl.openFile(BLOCK, 'block.stl');
    const one = JSON.parse(JSON.stringify(captureShaperDoc()));
    const { part, opened, ...single } = one.stl[0];
    one.stl = single;
    applyStore(null);
    applyShaperDoc(one, st);
    const stlEntry = getSelections().find((x) => x.kind === 'stl');
    eq(getStlSources().map((s) => [s.name, s.part, s.opened]), [['block.stl', stlEntry.id, true]], '5: a document of before 841 loads as a list of one (its STL selection, opened)');
    // OPEN STL still replaces the design
    app.stl.insertFile(SMALL, 'small.stl');
    eq(getStlSources().length, 2, '5: an insert into the opened design: two sources');
    const res = app.stl.openFile(DOME, 'dome.stl');
    eq(res.message, `Replaced with dome.stl: a relief, ${res.info.sections} levels`, '5: Open STL: the design replaced');
    eq(getStlSources().map((s) => [s.name, s.opened]), [['dome.stl', true]], '5: the list = its one STL');
    eq(storeOps().map((o) => o.type), ['roughing'], '5: one Roughing');
    eq(getStock().thickness, 30, '5: the stock = its height (as Open STL always did)');
    const domeEntry = entryOf('dome.stl');
    eq([getSelections().length, st.shapes.every((s) => domeEntry.shapeIds.includes(s.id))], [1, true], '5: only the opened part is in the design');
    ok(opById(storeOps()[0].id).geometry[0].key === keyOfPart(domeEntry), '5: its Roughing holds it');
  }
} finally { await app.close(); }

console.log(`insert-stl-841-node: ${checks} checks passed`);
