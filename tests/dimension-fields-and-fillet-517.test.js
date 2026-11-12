// TASK 517 -- (1) every dimension mode x {driving, reference} keeps EVERY dimension field through save / load and through undo / redo
// (createConstraint carries them through ONE helper); (2) a fillet at the origin keeps j_origin; (3) a Polygon-tool corner can be filleted.
import * as L from './harness/audit/lib.js';
import { serializeDocument, deserializeDocument } from '#core/document.js';
import { createConstraint } from '#core/constraints.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { applyFillet, findCornerBetweenLines } from '#core/fillet.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x));
const dimOf = (S) => S.state.constraints.find(c => c.type === 'distance' || c.type === 'angle');

// one builder per dimension mode (inventory.dimensionModes): a sketch + the createConstraint params of its dimension
const MODES = {
  'dist-aligned': (S) => { const a = L.point(S, 10, 10), b = L.point(S, 50, 30); L.line(S, a, b); return { type: 'distance', joints: [a, b], value: 44.7, dimMode: 'aligned' }; },
  'dist-horizontal': (S) => { const a = L.point(S, 10, 10), b = L.point(S, 50, 30); L.line(S, a, b); return { type: 'distance', joints: [a, b], value: 40, dimMode: 'horizontal' }; },
  'dist-vertical': (S) => { const a = L.point(S, 10, 10), b = L.point(S, 50, 30); L.line(S, a, b); return { type: 'distance', joints: [a, b], value: 20, dimMode: 'vertical' }; },
  'dist-line': (S) => { const a = L.point(S, 10, 10), b = L.point(S, 50, 30); L.line(S, a, b); return { type: 'distance', joints: [a, b], value: 44.7 }; },
  'dist-point-line': (S) => { const a = L.point(S, 10, 10), b = L.point(S, 50, 10), p = L.point(S, 30, 25); L.line(S, a, b); return { type: 'distance', joints: [p, b], value: 15, dimMode: 'aligned' }; },
  'dist-line-line': (S) => { const s = L.polyline(S, [[0, 0], [40, 0]], false)[0], t = L.polyline(S, [[0, 15], [40, 15]], false)[0]; return { type: 'distance', shapes: [s.id, t.id], value: 15 }; },
  angle: (S) => { const seg = L.polyline(S, [[0, 0], [50, 0], [50, 30]], false); return { type: 'angle', shapes: [seg[0].id, seg[1].id], value: Math.PI / 2 }; },
  radius: (S) => { const c = L.circle(S, 30, 30, 10); return { type: 'distance', shape: c, value: 10, isRadius: true }; },
};

function build(mode, driven) {
  const S = L.newSketch();
  const params = MODES[mode](S);
  if (driven) { params.isDriven = true; params.driven = true; params.drivenReason = 'redundant'; }
  // the visual / lock fields every dimension may carry
  Object.assign(params, { offset: 37, glyphPos: { x: 3, y: 4 }, labelPos: { x: 5, y: 6 }, __pos: { x: 7, y: 8 }, labelAngle: 0.5 });
  if (params.dimMode === 'horizontal' || params.dimMode === 'vertical') Object.assign(params, { dimSign: -1, dimSignMode: params.dimMode });
  const c = createConstraint(params.type, params);
  assert(c, `${mode}: createConstraint accepted`);
  S.state.constraints.push(c);
  return { S, c, params };
}

const modes = Object.keys(MODES);
for (const mode of modes) {
  for (const driven of [false, true]) {
    const tag = `${mode} ${driven ? 'reference' : 'driving'}`;
    const { S, c, params } = build(mode, driven);
    for (const k of ['offset', 'glyphPos', 'labelPos', '__pos', 'labelAngle', 'dimSign', 'dimSignMode', 'drivenReason']) {
      if (params[k] !== undefined) assert(canon(c[k]) === canon(params[k]), `${tag}: ${k} kept by createConstraint (${canon(c[k])})`);
    }
    assert(c.isDriven === driven && c.driven === driven, `${tag}: isDriven/driven = ${driven}`);
    const want = canon(c);

    // save / load
    const doc = JSON.parse(JSON.stringify(serializeDocument(S.state)));
    const S2 = L.newSketch();
    assert(deserializeDocument(doc, S2.state).ok, `${tag}: loads`);
    assert(canon(dimOf(S2)) === want, `${tag}: save/load keeps every field\n  before ${want}\n  after  ${canon(dimOf(S2))}`);

    // undo / redo (both restore through _restoreSnapshot -> createConstraint)
    const S3 = L.newSketch();
    deserializeDocument(JSON.parse(JSON.stringify(doc)), S3.state);
    S3.state.saveState('edit');
    S3.state.constraints.length = 0;
    S3.state.undo();
    assert(canon(dimOf(S3)) === want, `${tag}: undo keeps every field\n  before ${want}\n  after  ${canon(dimOf(S3))}`);
    S3.state.redo();
    S3.state.undo();
    assert(canon(dimOf(S3)) === want, `${tag}: redo then undo keeps every field`);
  }
}
console.log(`dimension fields: ${modes.length} modes x {driving, reference} x {save/load, undo/redo} keep every field`);

// ---- N-F1: fillet on a corner at the origin
{
  const S = L.newSketch();
  const seg = L.polyline(S, [[0, 0], [60, 0], [60, 40]], true);   // closed triangle, one corner ON the origin (snapped: coincident with it)
  ConstraintManager.createConstraint(S.state, 'coincident', { joints: [seg[0].a, L.origin] }, { source: 'test' });
  S.engine.solve(L.ITER);
  const nullBefore = L.nullity(S);
  L.fillet(S, seg[2].id, seg[0].id, 6);
  const o = S.state.joints.get(L.origin);
  assert(o && o.fixed === true && o.x === 0 && o.y === 0, 'origin still exists, fixed, at (0,0)');
  assert(S.engine.solve(L.ITER).converged, 'solves after the fillet');
  const arc = S.state.shapes.find(s => s.type === 'arc');
  assert(arc && arc.filletSharp === L.origin, "the origin is the fillet's virtual sharp");
  assert(S.state.shapes.every(s => !s.joints || s.joints.every(j => S.state.joints.has(j))), 'no shape references a missing joint');
  assert(L.hasNaN(S) === false, 'no NaN');
  assert(L.nullity(S) === nullBefore, `triangle: the sketch keeps its freedom (${nullBefore} -> ${L.nullity(S)})`);
  console.log(`fillet at the origin (triangle): j_origin kept, nullity ${nullBefore} -> ${L.nullity(S)}`);

  const R = L.newSketch();
  const rs = L.polyline(R, [[0, 0], [60, 0], [60, 40], [0, 40]], true);
  ConstraintManager.createConstraint(R.state, 'coincident', { joints: [rs[0].a, L.origin] }, { source: 'test' });
  R.engine.solve(L.ITER);
  const rn0 = L.nullity(R);
  L.fillet(R, rs[3].id, rs[0].id, 8);
  assert(R.state.joints.get(L.origin) && R.state.joints.get(L.origin).fixed, 'rectangle: origin kept and fixed');
  assert(R.engine.solve(L.ITER).converged, 'rectangle fillet solves');
  const a = R.state.shapes.find(s => s.type === 'arc');
  const [cj, p1, p2] = a.joints.map(j => R.state.joints.get(j));
  assert(Math.abs(Math.hypot(p1.x - cj.x, p1.y - cj.y) - 8) < 1e-4 && Math.abs(Math.hypot(p2.x - cj.x, p2.y - cj.y) - 8) < 1e-4, 'fillet radius 8');
  assert(Math.abs(cj.x - 8) < 1e-4 && Math.abs(cj.y - 8) < 1e-4, `fillet centre at (8,8): (${cj.x}, ${cj.y})`);
  assert(L.nullity(R) === rn0, `rectangle: the sketch keeps its freedom (${rn0} -> ${L.nullity(R)})`);
  console.log(`fillet at the origin (rectangle): nullity ${rn0} -> ${L.nullity(R)}`);
}

// ---- N-F2: a Polygon-tool corner, then all six
{
  const S = L.newSketch();
  const O = L.point(S, 0, 0), k0 = L.point(S, 40, 0);
  const built = L.polygon(S, O, k0, 6);
  const sides = built.shapes.filter(s => !s.isConstruction);
  const radials = built.shapes.filter(s => s.isConstruction);
  S.engine.solve(L.ITER);
  const n0 = L.nullity(S);
  const R = 4;
  for (let i = 0; i < 6; i++) {
    const corner = findCornerBetweenLines(S.state, sides[i], sides[(i + 1) % 6]);
    assert(corner, `hexagon corner ${i} is filletable`);
    const res = applyFillet(S.state, corner, R);
    assert(res && res.success, `hexagon corner ${i} fillet accepted: ${res && res.reason}`);
    assert(S.engine.solve(L.ITER).converged, `hexagon solves after fillet ${i}`);
    if (i === 0) assert(radials.every(r => r.joints.every(j => S.state.joints.has(j))), 'the radials keep valid joints after the first fillet');
  }
  const arcs = S.state.shapes.filter(s => s.type === 'arc');
  assert(arcs.length === 6, `six fillet arcs (${arcs.length})`);
  for (const a of arcs) { const [c, p] = a.joints.map(j => S.state.joints.get(j)); assert(Math.abs(Math.hypot(p.x - c.x, p.y - c.y) - R) < 1e-4, 'arc radius ' + R); }
  const len = (s) => { const [a, b] = s.joints.map(j => S.state.joints.get(j)); return Math.hypot(a.x - b.x, a.y - b.y); };
  const rl = radials.map(len), sl = sides.map(len);
  assert(Math.max(...rl) - Math.min(...rl) < 1e-4, `radials equal (the free polygon may rescale): ${rl.map(v => v.toFixed(4))}`);
  assert(Math.max(...sl) - Math.min(...sl) < 1e-4, `trimmed sides equal: ${sl.map(v => v.toFixed(4))}`);
  console.log(`polygon: six corners filleted (R ${R}), nullity ${n0} -> ${L.nullity(S)}`);
}
console.log('task 517 tests passed');
