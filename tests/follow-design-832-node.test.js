// tests/follow-design-832-node.test.js — TASK 832 (owner turns 2955-2965: "NOTHING TO CUT AFTER SIMPLY SNAPPING THE SHAPE ONTO ANOTHER"; "this makes the toolpath out of
// date, but not nothing to cut, simple recalc"): an operation's shapes FOLLOW the Design edits made to them, on the Shaper node page (tests/helpers/node-app.js),
// through the page's own Prepare (its type pick, field edits, OK; entering Prepare = cut-plan.js followDesign, then the derivation). TASK S3: a Design edit makes them out
// of date: the test presses Recalculate after each (the owner's "simple recalc").
//  1. THE OWNER'S CASE: three identical 25.4 mm squares, each in its own Pocket (0.125 / 0.25 / 0.375 in), stacked exactly by snapping a corner of each onto the
//     first one's corner, that corner snapped to the ORIGIN: each Pocket cuts its own square at its own depth (#core/loop-finder.js: shapes that overlap and share
//     one node are traversed per block, each its own loop; before: no loop at all, every Pocket "1 shape: nothing to cut"); two stacked, then the third;
//  2. THE MATRIX: a square A in a Pocket, an Outside and an On line operation; each Design edit, then Undo, Redo and a reload of the document (shaper-doc.js
//     applyShaperDoc of the saved sidecar): every operation cuts A as it is now (the edited shape: its key follows, cut-plan.js followDesign) or, for the edits
//     that take the shape away (a side trimmed out, a side made construction: the outline is open), keeps its key and cuts nothing until the outline is whole again;
//     a split shape is cut as its pieces, a merged one as the merged face; a copy (paste, mirror, pattern) is in no operation.
// It prints one line per row (`ROW <edit> | after <..> | undo <..> | redo <..> | reload <..>`): the table of the task's REPORT.
import assert from 'node:assert/strict';
import { open } from './helpers/node-app.js';
import SettingsManager from '#core/settings-manager.js';
import { rect, fillet, snap, constrain, dimension, typeDimension, polyline } from '#core/tool-ops.js';
import { findLoops, buildNodeMap } from '#core/loop-finder.js';
import { breakShape } from '#core/break.js';
import { trimShape } from '#core/trim.js';
import { mirrorObjects } from '#core/mirror.js';
import { applyPattern, patternDefaults } from '#core/pattern.js';
import { transformShapes } from '#core/transform.js';
import { makeGroup, ungroup } from '#core/group-model.js';
import { deleteShapes, deleteConstraints } from '#core/delete-manager.js';
import { CONSTRAINT_TYPES as T, ORIGIN_JOINT_ID } from '#core/constants.js';
import { selectionToEnvelope, pasteDocument } from '#ui/clipboard.js';
import { describeOperations } from '../apps/shaper/src/operations.js';
import { storeOps, applyStore } from '../apps/shaper/src/operations-store.js';
import { captureShaperDoc, applyShaperDoc } from '../apps/shaper/src/shaper-doc.js';
import { keyOf } from '../apps/shaper/src/cut-plan.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
SettingsManager.set('DOC_UNIT', 'mm', { persist: false });
const S = 25.4, IN = 25.4;

// ── 0. the loop finder (#core/loop-finder.js): closed shapes that overlap and share ONE node are each their own loop (before: no loop at all); a drawing whose curves
// meet at nodes only keeps exactly its faces of before (a tail inside a square, a triangle pinned in its corner: the face around it)
{
  const sq = (st, n, x, y, s = S) => {
    [[x, y], [x + s, y], [x + s, y + s], [x, y + s]].forEach(([px, py], i) => st.joints.set(`${n}j${i}`, { x: px, y: py }));
    for (let i = 0; i < 4; i++) st.shapes.push({ id: `${n}s${i}`, type: 'line', joints: [`${n}j${i}`, `${n}j${(i + 1) % 4}`] });
  };
  const ids = (st) => findLoops(st).map((l) => l.id);
  const blank = (constraints = []) => ({ joints: new Map(), shapes: [], constraints });
  const AL = 'loop_As0-As1-As2-As3', BL = 'loop_Bs0-Bs1-Bs2-Bs3', CL = 'loop_Cs0-Cs1-Cs2-Cs3';
  let st = blank([{ type: 'coincident', joints: ['Aj0', 'Bj0'] }]); sq(st, 'A', 0, 0); sq(st, 'B', 0, 0);
  eq(ids(st), [AL, BL], '0: two identical squares sharing a corner: two loops');
  st = blank([{ type: 'coincident', joints: ['Aj0', 'Bj0'] }, { type: 'coincident', joints: ['Bj0', 'Cj0'] }, { type: 'coincident', joints: ['Aj0', ORIGIN_JOINT_ID] }]);
  st.joints.set(ORIGIN_JOINT_ID, { x: 0, y: 0, fixed: true }); sq(st, 'A', 0, 0); sq(st, 'B', 0, 0); sq(st, 'C', 0, 0);
  eq(ids(st), [AL, BL, CL], '0: three identical squares sharing a corner on the origin: three loops');
  st = blank([{ type: 'coincident', joints: ['Aj0', 'Bj0'] }]); sq(st, 'A', 0, 0); sq(st, 'B', 0, 0); st.joints.set('Bj1', { x: S, y: -10 }); st.joints.set('Bj2', { x: S + 10, y: S - 10 }); st.joints.set('Bj3', { x: 10, y: S });
  eq(ids(st), [AL, BL], '0: a turned square crossing another, a shared corner: two loops');
  st = blank(); sq(st, 'A', 0, 0); sq(st, 'B', 0, 0);
  eq(ids(st), [AL, BL], '0: two identical squares sharing nothing: two loops (as before)');
  st = blank(); sq(st, 'A', 0, 0); st.joints.set('t', { x: 10, y: 10 }); st.shapes.push({ id: 'T', type: 'line', joints: ['Aj0', 't'] });
  eq(ids(st), ['loop_As0-As1-As2-As3-T-T'], '0: a tail inside a square (planar): its face as before');
  st = blank([{ type: 'coincident', joints: ['Aj0', 'Bj0'] }]); sq(st, 'A', 0, 0); st.joints.set('Bj0', { x: 0, y: 0 }); st.joints.set('Bj1', { x: 10, y: 5 }); st.joints.set('Bj2', { x: 5, y: 10 });
  st.shapes.push({ id: 'Bs0', type: 'line', joints: ['Bj0', 'Bj1'] }, { id: 'Bs1', type: 'line', joints: ['Bj1', 'Bj2'] }, { id: 'Bs2', type: 'line', joints: ['Bj2', 'Bj0'] });
  eq(ids(st), ['loop_As0-As1-As2-As3-Bs0-Bs1-Bs2', 'loop_Bs0-Bs1-Bs2'], '0: a triangle pinned in the corner of a square (planar): the faces as before');
}

const app = await open({ host: 'shaper' });
try {
  const st = app.state;
  const pv = () => app.prepare.view();
  // TASK S3 (owner turns 3046-3047, Fusion style): a Design edit makes the operations OUT OF DATE (not regenerated): back in Prepare the test presses Recalculate (nothing
  // selected: every one), the owner's "simple recalc" (task 832); section 1 asserts the out-of-date state before it
  const toPrepareOnly = () => { app.modes.showMode('design'); app.modes.showMode('prepare'); };
  const toPrepare = () => { toPrepareOnly(); app.prepare.recalculate(); };
  const solve = () => app.engine.solve(500);
  // the page's own steps: shapes picked + a type = a NEW operation, its fields set, OK
  const make = (keys, type, fields = {}) => {
    app.prepare.ok();
    pv().setSelection(keys.map((k) => { const i = k.indexOf(':'); return { kind: k.slice(0, i), id: k.slice(i + 1) }; }));
    app.prepare.addOperation(type); // TASK S3: the operations toolbar's button (a NEW operation of the selection, open)
    for (const [f, v] of Object.entries(fields)) pv().setOpField(f, v);
    app.prepare.ok();
    return storeOps()[storeOps().length - 1].id;
  };
  const loopKeyOf = (lines) => keyOf('loop', findLoops(st).find((l) => l.edges.length === lines.length && lines.every((e) => l.edges.includes(e))).id);
  const lineJoints = (id) => st.shapes.find((s) => s.id === id).joints;
  const cornerOf = (a, b) => { const node = buildNodeMap(st); return lineJoints(a).find((j) => lineJoints(b).some((k) => node(k) === node(j))); }; // a rect's sides meet through coincidents
  const square = (x, y) => { const r = rect(st, x, y, x + S, y + S); dimension(st, { joints: lineJoints(r.top) }, { x: x + S / 2, y: y - 8 }, String(S)); dimension(st, { joints: lineJoints(r.left) }, { x: x - 8, y: y + S / 2 }, String(S)); solve(); return r; };
  const fresh = () => { app.modes.showMode('design'); app.prepare.ok(); st.clearDocument(); applyStore(null); };
  const opsNow = () => describeOperations(st);
  const reload = () => { const doc = JSON.parse(JSON.stringify(captureShaperDoc())); applyStore(null); applyShaperDoc(doc, st); };

  // ── 1. the owner's case: three identical squares stacked by snapping, the first corner on the origin, three Pockets at 0.125 / 0.25 / 0.375 in
  {
    fresh();
    const sq = [square(40, -60), square(100, -60), square(160, -60)];
    toPrepare();
    const keys = sq.map((r) => loopKeyOf(r.lines));
    const depths = [0.125 * IN, 0.25 * IN, 0.375 * IN];
    const ids = keys.map((k, i) => make([k], 'pocket', { cutDepth: depths[i] }));
    const cutOf = (id) => { const op = opsNow().find((o) => o.id === id); return { regions: op.regions, targets: op.records.map((r) => keyOf(r.target.kind, r.target.id)), depth: op.records.length ? op.records[0].rec.cutDepth : null }; };
    eq(ids.map(cutOf), keys.map((k, i) => ({ regions: '1 region', targets: [k], depth: depths[i] })), '1: three squares apart, three Pockets, each cuts its square');
    const c = sq.map((r) => cornerOf(r.bottom, r.left));
    app.modes.showMode('design');
    st.saveState('drag points'); snap(st, c[0], ORIGIN_JOINT_ID); solve();
    st.saveState('drag points'); snap(st, c[1], c[0]); solve();
    toPrepareOnly();
    eq(opsNow().map((o) => [o.outOfDate, o.records.length]), ids.map(() => [true, 0]), '1: TASK S3: the Design edit: every Pocket OUT OF DATE, nothing generated (until Recalculate)');
    app.prepare.recalculate();
    const at = (j) => { const p = st.joints.get(j); return [Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000]; };
    eq([at(c[0]), at(c[1])], [[0, 0], [0, 0]], '1: the first square on the origin, the second snapped onto it');
    eq(ids.map(cutOf), keys.map((k, i) => ({ regions: '1 region', targets: [k], depth: depths[i] })), '1: TWO stacked squares (a shared corner): each Pocket still cuts its own square at its own depth');
    app.modes.showMode('design');
    st.saveState('drag points'); snap(st, c[2], c[0]); solve();
    toPrepare();
    eq(at(c[2]), [0, 0], '1: the third snapped onto them');
    const rows = ids.map(cutOf);
    console.log('ROW owner repro (3 stacked, origin) |', rows.map((r) => `${r.regions} @ ${r.depth}`).join(' ; '));
    eq(rows, keys.map((k, i) => ({ regions: '1 region', targets: [k], depth: depths[i] })), '1: THREE stacked squares: each Pocket cuts its own square at its own depth');
    reload(); toPrepare();
    eq(ids.map(cutOf), keys.map((k, i) => ({ regions: '1 region', targets: [k], depth: depths[i] })), '1: the same after a reload');
  }

  // ── 1b. two identical squares stacked exactly (a shared corner, NOT on the origin), each in its own Pocket; a triangle snapped by a corner onto a square it overlaps
  {
    fresh();
    const sq = [square(40, -60), square(100, -60)];
    const tri = polyline(st, [[180, -60], [210, -50], [190, -20]]);
    solve();
    toPrepare();
    const keys = [...sq.map((r) => loopKeyOf(r.lines)), loopKeyOf(tri.map((t) => t.id))];
    const depths = [2, 5, 7];
    const ids = keys.map((k, i) => make([k], 'pocket', { cutDepth: depths[i] }));
    const cutOf = (id) => { const op = opsNow().find((o) => o.id === id); return { regions: op.regions, targets: op.records.map((r) => keyOf(r.target.kind, r.target.id)), depth: op.records.length ? op.records[0].rec.cutDepth : null }; };
    app.modes.showMode('design');
    const c0 = cornerOf(sq[0].bottom, sq[0].left);
    st.saveState('drag points'); snap(st, cornerOf(sq[1].bottom, sq[1].left), c0); solve();
    st.saveState('drag points'); snap(st, tri[0].a, c0); solve();
    toPrepare();
    const rows = ids.map(cutOf);
    console.log('ROW 2 identical stacked (no origin) + a triangle on their corner |', rows.map((r) => `${r.regions} @ ${r.depth}`).join(' ; '));
    eq(rows, keys.map((k, i) => ({ regions: '1 region', targets: [k], depth: depths[i] })), '1b: two stacked squares and the triangle on their corner: each Pocket cuts its own shape at its own depth');
  }

  // ── 2. the matrix
  const TYPES = [['pocket', { cutDepth: 3 }], ['exterior', { cutDepth: 3 }], ['online', { cutDepth: 1 }]];
  // what an operation cuts now: its records' loops' edges (every record), its words
  const cutsOf = (id) => { const op = opsNow().find((o) => o.id === id); return { regions: op.regions, keys: op.records.map((r) => keyOf(r.target.kind, r.target.id)), stored: storeOps().find((o) => o.id === id).geometry.map((g) => g.key) }; };
  const edgesOf = (key) => { const l = findLoops(st).find((x) => keyOf('loop', x.id) === key); return l ? l.edges : []; };
  const alive = (lines) => lines.filter((id) => st.shapes.some((s) => s.id === id && !s.isConstruction));
  // every operation cuts A (or what A became): records, each holding an edge of A, together holding all of A's edges that are still in the sketch
  const cutsA = (ids, lines, n = 1) => ids.every((id) => { const c = cutsOf(id); const all = new Set(c.keys.flatMap(edgesOf)); return c.keys.length === n && c.keys.every((k) => edgesOf(k).some((e) => lines.includes(e))) && alive(lines).every((e) => all.has(e)); });
  const keepsKey = (ids, key) => ids.every((id) => { const c = cutsOf(id); return c.keys.length === 0 && /nothing to cut/.test(c.regions) && c.stored.length === 1 && c.stored[0] === key; });
  const ROWS = [
    ['change a dimension value', ({ A }) => { st.saveState('dimension'); typeDimension(st, st.constraints.find((c) => c.type === T.DISTANCE && String(c.joints) === String(lineJoints(A.top))), '30'); solve(); }],
    ['move / drag a point', ({ A }) => { st.saveState('drag points'); const j = st.joints.get(cornerOf(A.top, A.right)); j.x += 6; j.y -= 3; solve(); }],
    ['snap onto another shape (identical, a shared corner)', ({ A, B }) => { st.saveState('drag points'); snap(st, cornerOf(B.bottom, B.left), cornerOf(A.bottom, A.left)); solve(); }],
    ['snap a corner to the origin', ({ A }) => { st.saveState('drag points'); snap(st, cornerOf(A.bottom, A.left), ORIGIN_JOINT_ID); solve(); }],
    ['add a constraint', ({ A, B }) => { st.saveState('constraint'); constrain(st, T.EQUAL, { shapes: [A.top, B.top] }); solve(); }],
    ['delete a constraint', ({ A }) => { st.saveState('delete'); deleteConstraints(st, [st.constraints.find((c) => c.type !== T.COINCIDENT && (c.shapes || []).includes(A.top))]); solve(); }],
    ['fillet a corner', ({ A }) => { st.saveState('fillet'); fillet(st, A.top, A.right, 4); solve(); }],
    ['add a point on a line (Break)', ({ A }) => { st.saveState('break'); breakShape(st, A.top, 0.5); }],
    ['split: a divider across (Break both sides + a line)', ({ A }) => {
      st.saveState('split');
      const p = breakShape(st, A.top, 0.5), q = breakShape(st, A.bottom, 0.5);
      polyline(st, [p.midJointId, q.midJointId], false);
    }, 'split'],
    ['merge: the shared side of two faces deleted', ({ A }) => {
      st.saveState('delete');
      deleteShapes(st, [A.right]);
    }, 'merge'],
    ['trim a side out (the outline opens)', ({ A, X }) => { st.saveState('trim'); trimShape(st, A.top, { x: S / 2, y: st.joints.get(lineJoints(A.top)[0]).y }); }, 'open'],
    ['construction on a side', ({ A }) => { st.saveState('construction'); st.shapes.find((s) => s.id === A.top).isConstruction = true; }, 'open'],
    ['construction on, then off', ({ A }) => { st.saveState('construction'); st.shapes.find((s) => s.id === A.top).isConstruction = true; st.saveState('construction'); st.shapes.find((s) => s.id === A.top).isConstruction = false; }],
    ['mirror (the copy has no op)', ({ A, B }) => { st.saveState('mirror'); ok(mirrorObjects(st, { shapes: A.lines, joints: [] }, B.right).ok, 'mirror made'); }],
    ['rotate', ({ A }) => { st.saveState('rotate group'); transformShapes(st, A.lines, { pivot: { x: S / 2, y: -S / 2 }, angle: 0.4, scale: 1 }); }],
    ['pattern (the copies have no op)', ({ A }) => { st.saveState('rectangular pattern'); ok(applyPattern(st, T.RECTANGULAR_PATTERN, { shapes: A.lines, joints: [] }, { ...patternDefaults(T.RECTANGULAR_PATTERN), quantity: [2, 1], distance: [120, 10], distanceType: 'spacing' }).ok, 'pattern made'); solve(); }],
    ['group / ungroup', ({ A }) => { st.saveState('group'); const g = makeGroup(st, A.lines); st.saveState('ungroup'); ungroup(st, g.id); }],
    ['paste a copy (the copy has no op)', ({ A }) => { st.selectedShapes.clear(); A.lines.forEach((i) => st.selectedShapes.add(i)); const env = selectionToEnvelope(st); ok(pasteDocument(st, env.document || env).ok, 'pasted'); }],
    ['pin a small shape into a corner (planar)', ({ A }) => { st.saveState('line'); polyline(st, [cornerOf(A.bottom, A.left), [8, -2], [3, -9], cornerOf(A.bottom, A.left)], false); solve(); }],
  ];
  for (const [name, edit, kind] of ROWS) {
    fresh();
    const A = square(0, -S), B = square(60, -S);
    if (kind === 'merge') { // a second face sharing A's right side: a domino, drawn from A's top side's end round to its bottom side's (they stay when the side goes)
      const t = cornerOf(A.top, A.right), b = cornerOf(A.bottom, A.right);
      polyline(st, [t, [S + 30, st.joints.get(t).y], [S + 30, st.joints.get(b).y], b], false); solve();
    }
    toPrepare();
    const KA = loopKeyOf(A.lines);
    const ids = TYPES.map(([t, f]) => make([KA], t, f));
    ok(cutsA(ids, A.lines), `${name}: before the edit, the three operations cut A`);
    app.modes.showMode('design');
    const nShapes = st.shapes.length;
    edit({ A, B });
    toPrepare();
    const n = kind === 'split' ? 2 : 1;
    const expected = () => (kind === 'open' ? keepsKey(ids, KA) : cutsA(ids, A.lines, n));
    const after = expected(), afterOps = JSON.stringify(ids.map(cutsOf));
    const copyFree = !(st.shapes.length > nShapes && /copy|mirror|pattern|paste/.test(name)) || ids.every((id) => cutsOf(id).keys.length === 1);
    const twice = name === 'group / ungroup' || name === 'construction on, then off'; // two steps
    app.modes.showMode('design'); st.undo(); if (twice) st.undo(); toPrepare();
    const undo = cutsA(ids, A.lines) && ids.every((id) => cutsOf(id).stored[0] === KA);
    app.modes.showMode('design'); st.redo(); if (twice) st.redo(); toPrepare();
    const redo = expected();
    reload(); toPrepare();
    const rel = expected();
    const word = (b) => (kind === 'open' ? (b ? 'kept (open: nothing to cut)' : 'LOST') : b ? 'cut' : 'LOST');
    console.log(`ROW ${name} | after ${word(after)} | undo ${undo ? 'cut' : 'LOST'} | redo ${word(redo)} | reload ${word(rel)}`);
    eq(after, true, kind === 'open' ? `${name}: the outline is open: the operations keep A's key and cut nothing (not dropped)` : `${name}: after the edit every operation cuts A as it is now (${afterOps})`);
    ok(copyFree, `${name}: the copy is in no operation`);
    eq(undo, true, `${name}: Undo: every operation cuts A as it was, under its key`);
    eq(redo, true, `${name}: Redo: as after the edit`);
    eq(rel, true, `${name}: reloaded: as after the edit`);
  }
} finally { await app.close(); }
console.log(`follow-design-832-node: ${checks} checks passed`);
