// tests/audits/files-audit-1024-fixture.js — TASK 1024 (AUDIT ONLY, outside the gate)
// Builds ONE rich #core document with the app's own tool operations (#core/tool-ops.js, the same calls the tools make), so a round trip
// has every kind of state to lose. Prints what it managed to build (a feature the tools refused is reported, never silently skipped).
// Run: node tests/audits/files-audit-1024-fixture.js   (writes tests/fixtures/files-1024/rich.sketch.json)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ops from '#core/tool-ops.js';
import { serializeDocument } from '#core/document.js';
import { serializeProjectFile } from '#ui/project-file.js';
import { makeBezier } from '#core/shapes.js';
import { makeGroup, setGroupLock } from '#core/group-model.js';
import { addSketch, activateSketch } from '#core/sketch-model.js';
import { applyOffset, offsetChainOf } from '#core/offset.js';
import { mirrorObjects } from '#core/mirror.js';
import { newShapeId } from '#core/shape-id.js';

const T = { H: 'horizontal', V: 'vertical', PAR: 'parallel', PERP: 'perpendicular', COLL: 'collinear', TAN: 'tangent', POL: 'pointOnLine', EQ: 'equal', MID: 'midpoint', SYM: 'symmetric', COI: 'coincident', ANG: 'angle' };

export function buildRich() {
  const built = [], refused = [];
  const state = ops.newSketchState();
  const tryIt = (what, fn) => { try { const r = fn(); built.push(what); return r; } catch (e) { refused.push(`${what}: ${e.message}`); return null; } };

  // user parameters (+ a formula-driven dimension below)
  tryIt('parameter plate_w', () => ops.parameter(state, 'plate_w', 'mm', '80 mm', 'plate width'));
  tryIt('parameter plate_h', () => ops.parameter(state, 'plate_h', 'mm', 'plate_w / 2', 'half of the width (a formula)'));

  // rectangle 80 x 40 anchored on the origin, driving dimensions: one a number, one a formula, one named
  const r = ops.rect(state, 0, 0, 80, 40);
  tryIt('anchor rect corner to origin', () => ops.snap(state, r.c1, 'j_origin'));
  const dW = tryIt('width dimension = plate_w (formula, named)', () => ops.dimension(state, { joints: [r.c1, r.c3], dimMode: 'horizontal' }, { x: 40, y: -12 }, 'plate_w'));
  const dH = tryIt('height dimension = plate_h (formula)', () => ops.dimension(state, { joints: [r.c3, r.c1], dimMode: 'vertical' }, { x: 100, y: 20 }, 'plate_h'));
  if (dW) tryIt('rename width dimension to W_main', () => ops.typeDimension && (dW.name = dW.name)); // name kept as the app gave it

  // circle with a radius dimension (driving) and a reference (driven) dimension
  const c1 = ops.circle(state, 20, 20, 6);
  tryIt('circle radius dimension 6', () => ops.dimension(state, { shape: c1.id }, { x: 30, y: 28 }, '6'));
  tryIt('circle centre horizontal to origin', () => ops.constrain(state, T.H, { joints: ['j_origin', c1.c] }));
  tryIt('reference (driven) dimension origin->circle centre', () => { const c = ops.constrain(state, 'distance', { joints: ['j_origin', c1.c], value: 20, dimMode: 'vertical', isDriven: true }); c.isDriven = true; });

  // arc (centre mode) + its structural equal, tangent target
  const ca = ops.click(state, 100, 20), sa = ops.click(state, 110, 20), ea = ops.click(state, 100, 30);
  const arcId = tryIt('arc (centre, start, end)', () => ops.arc(state, ca, sa, ea, { sweep: true }));

  // construction line, with horizontal + midpoint
  const cons = tryIt('construction line', () => ops.polyline(state, [[0, 60], [80, 60]], false, true));
  if (cons) tryIt('construction line horizontal', () => ops.constrain(state, T.H, { joints: [cons[0].a, cons[0].b] }));

  // a free polyline + parallel / perpendicular / collinear / equal / pointOnLine / midpoint / angle / symmetric
  const poly = tryIt('open polyline of 3 lines', () => ops.polyline(state, [[0, 80], [30, 85], [60, 100], [90, 100]], false));
  if (poly) {
    tryIt('parallel', () => ops.constrain(state, T.PAR, { shapes: [poly[0].id, poly[2].id] }));
    tryIt('perpendicular', () => ops.constrain(state, T.PERP, { shapes: [poly[0].id, poly[1].id] }));
    tryIt('equal', () => ops.constrain(state, T.EQ, { shapes: [poly[0].id, poly[2].id] }));
  }
  const L2 = tryIt('second line for collinear', () => ops.polyline(state, [[0, 120], [20, 120]], false));
  const L3 = tryIt('third line for collinear', () => ops.polyline(state, [[40, 120], [70, 120]], false));
  if (L2 && L3) tryIt('collinear', () => ops.constrain(state, T.COLL, { shapes: [L2[0].id, L3[0].id] }));
  const P = tryIt('free point for pointOnLine', () => ops.click(state, 10, 119));
  if (P && L2) tryIt('pointOnLine', () => ops.constrain(state, T.POL, { joint: P, shape: L2[0].id }));
  const L4 = tryIt('line for midpoint', () => ops.polyline(state, [[100, 60], [140, 60]], false));
  const M = tryIt('midpoint joint', () => ops.click(state, 120, 61));
  if (L4 && M) tryIt('midpoint', () => ops.constrain(state, T.MID, { joints: [L4[0].a, L4[0].b, M] }));
  const A1 = tryIt('two lines for an angle', () => ops.polyline(state, [[150, 0], [190, 0]], false));
  const A2 = tryIt('second line for an angle', () => ops.polyline(state, [[150, 0], [180, 25]], false));
  if (A1 && A2) tryIt('angle dimension 30 deg', () => ops.dimension(state, { lines: [A1[0].id, A2[0].id] }, { x: 165, y: 6 }, '30'));
  // bezier
  const b0 = ops.click(state, 160, 60), b3 = ops.click(state, 200, 60);
  tryIt('bezier', () => { const b = makeBezier(state.joints, b0, b3, [170, 40], [190, 80]); b.shapes.forEach((s) => state.shapes.push(s)); });
  // fillet on the rectangle
  tryIt('fillet r=4 on the rectangle corner', () => ops.fillet(state, r.top, r.right, 4));
  // mirror about the y axis
  tryIt('mirror a line about the Y axis', () => { const ln = ops.polyline(state, [[-30, 0], [-30, 30]], false); const m = mirrorObjects(state, { shapes: [ln[0].id], joints: [] }, 'ref_axis_y'); if (!m.ok) throw new Error(m.reason); });
  // offset of the rectangle's left line chain
  tryIt('offset a chain by 5', () => { const ch = offsetChainOf(state, c1.id); if (!ch.ok) throw new Error(ch.reason); const o = applyOffset(state, ch.chain, 5, 1); if (!o.ok) throw new Error(o.reason); });
  // rectangular + circular patterns
  const hole = ops.circle(state, 60, 20, 3);
  tryIt('rectangular pattern 3 x 1 of a hole', () => ops.pattern(state, 'rectangularPattern', { shapes: [hole.id], joints: [] }, { quantity: [3, 1], distance: [8, 8] }));
  const h2 = ops.circle(state, 200, 100, 2);
  tryIt('circular pattern 4 of a hole', () => ops.pattern(state, 'circularPattern', { shapes: [h2.id], joints: [] }, { quantity: 4, angle: 360, centre: 'j_origin' }));
  // groups + locks
  tryIt('group of the rect lines', () => { const g = makeGroup(state, r.lines, 'Plate'); if (!g) throw new Error('no group'); setGroupLock(state, g.id, 'sizeAngle', true); });
  // a fixed (locked) free joint
  const lj = tryIt('locked (fixed) joint', () => { const j = ops.click(state, 210, 10); state.joints.get(j).fixed = true; return j; });
  // construction + a 2nd sketch (layers) with a hidden state
  tryIt('second sketch (hidden) with a line', () => { const sk = addSketch(state, 'Layer two'); activateSketch(state, sk.id); ops.polyline(state, [[0, 200], [30, 200]], false); sk.visible = false; activateSketch(state, 'sketch-1'); });
  // styles: stroke style on a shape (the style panel writes shape.style? record whatever the model carries)
  if (poly) poly[0] && (state.shapes.find((s) => s.id === poly[0].id).strokeStyle = 'dashed');

  const doc = serializeDocument(state, { hosts: {} });
  return { doc, built, refused, state };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { doc, built, refused } = buildRich();
  const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'files-1024', 'rich.sketch.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, serializeProjectFile({ app: 'sketchstudio', name: 'Rich 1024', document: doc }));
  console.log('BUILT', built.length, JSON.stringify(built));
  console.log('REFUSED', refused.length, JSON.stringify(refused, null, 1));
  const types = {}; for (const c of doc.geometry.constraints) types[c.type] = (types[c.type] || 0) + 1;
  console.log('constraint types', JSON.stringify(types), 'shapes', doc.geometry.shapes.length, 'joints', doc.geometry.joints.length);
}
