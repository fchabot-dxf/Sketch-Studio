// TASK 645: fillet where a line meets an ARC (the line-line tests are tests/fillet.test.js).
// A leg is trimmed to its tangent point: a line keeps its direction, an arc keeps its centre, radius and direction.
import assert from 'node:assert';
import { findCornerAtJoint, findCornerAtPoint, findCornerBetweenLines, findFilletShapeAtPoint, applyFillet, cornerFilletGeometry, diagnoseNoFillet } from '#core/fillet.js';
import { arcSweepInfo } from '#core/geometry.js';
import { createNewtonSolver } from '#core/solver/engine.js';
import { commitDimensionEdit } from '#ui/dimension-seams.js';

const TOL = 1e-3;
const near = (a, b, msg) => assert(Math.abs(a - b) < TOL, `${msg}: ${a} vs ${b}`);
const P = { x: 20, y: 0 };
const pol = (c, R, ang) => ({ x: c.x + R * Math.cos(ang), y: c.y + R * Math.sin(ang), fixed: false });

// an arc ending at the corner point P: its centre, radius, the angle of P on it, the direction its body leaves P in (+1 = increasing angle)
// and which of its two ends P is. Returns the shape and the far end; the corner joint 'P' is shared.
function addArc(S, id, c, R, ang, bodyDir, atStart, span = Math.PI / 2, cornerJoint = 'P') {
  S.joints.set(id + 'c', { x: c.x, y: c.y, fixed: false });
  S.joints.set(id + 'f', pol(c, R, ang + bodyDir * span));
  const dir = atStart ? bodyDir : -bodyDir;
  const shape = { id, type: 'arc', subType: 'CENTER', joints: atStart ? [id + 'c', cornerJoint, id + 'f'] : [id + 'c', id + 'f', cornerJoint], sweep: dir > 0 };
  S.shapes.push(shape);
  S.constraints.push({ type: 'equal', joints: [id + 'c', shape.joints[1], id + 'c', shape.joints[2]] });
  return shape;
}
function addLine(S, id, u, len, cornerJoint = 'P') {
  S.joints.set(id + 'f', { x: P.x + u.x * len, y: P.y + u.y * len, fixed: false });
  const shape = { id, type: 'line', joints: [cornerJoint, id + 'f'] };
  S.shapes.push(shape);
  return shape;
}
const mk = () => ({ joints: new Map([['P', { x: P.x, y: P.y, fixed: false }]]), shapes: [], constraints: [] });
const pos = (S, id) => S.joints.get(id);
const arcTangent = (ang, bodyDir) => ({ x: -bodyDir * Math.sin(ang), y: bodyDir * Math.cos(ang) });

// what the fillet must satisfy, from the state alone: centre O, radius r; each leg tangent; each arc keeps centre / radius / direction;
// the fillet lies inside the wedge the two legs open at the corner
function checkFillet(S, res, r, legs, label) {
  assert(res && res.success, `${label}: fillet applied (${res && res.reason})`);
  const O = pos(S, res.arc.joints[0]), t1 = pos(S, res.arc.joints[1]), t2 = pos(S, res.arc.joints[2]);
  near(Math.hypot(t1.x - O.x, t1.y - O.y), r, `${label}: fillet radius (start)`);
  near(Math.hypot(t2.x - O.x, t2.y - O.y), r, `${label}: fillet radius (end)`);
  for (const leg of legs) {
    const sh = leg.shape;
    const rim = res.arc.joints.slice(1).find(j => sh.joints.includes(j));
    assert(rim, `${label}: ${sh.id} ends on the fillet arc (shares its tangent joint)`);
    if (sh.type === 'line') {
      const a = pos(S, sh.joints[0]), b = pos(S, sh.joints[1]), L = Math.hypot(b.x - a.x, b.y - a.y);
      near(Math.abs((O.x - a.x) * (b.y - a.y) - (O.y - a.y) * (b.x - a.x)) / L, r, `${label}: fillet centre is r from the line`);
      const u = leg.u, d = (pos(S, rim).x - P.x) * u.x + (pos(S, rim).y - P.y) * u.y;
      near((pos(S, rim).x - P.x) * u.y - (pos(S, rim).y - P.y) * u.x, 0, `${label}: the trimmed line keeps its direction`);
      assert(d > 0, `${label}: the line's tangent point is ahead of the corner`);
    } else {
      const c = pos(S, sh.joints[0]);
      near(c.x, leg.c.x, `${label}: arc centre x unchanged`); near(c.y, leg.c.y, `${label}: arc centre y unchanged`);
      for (const j of [sh.joints[1], sh.joints[2]]) near(Math.hypot(pos(S, j).x - c.x, pos(S, j).y - c.y), leg.R, `${label}: arc radius unchanged`);
      near(Math.abs(Math.hypot(O.x - c.x, O.y - c.y) - leg.R), r, `${label}: fillet centre is R -/+ r from the arc centre`);
      assert.strictEqual(sh.sweep, leg.sweep, `${label}: arc keeps its direction`);
      const before = leg.span, after = arcSweepInfo(c, pos(S, sh.joints[1]), pos(S, sh.joints[2]), { sweep: sh.sweep }).span;
      assert(after < before - 1e-3 && after > 1e-3, `${label}: the arc is trimmed (swept ${before} -> ${after})`);
      const tg = (pos(S, rim).x - c.x) * (O.x - c.x) + (pos(S, rim).y - c.y) * (O.y - c.y);
      near(Math.abs(tg), leg.R * Math.hypot(O.x - c.x, O.y - c.y), `${label}: tangent point is on the line of centres`);
    }
    // constraints
    if (sh.type === 'line') assert(S.constraints.some(c => c.type === 'tangent' && c.line === sh.id && c.circle === res.arc.id), `${label}: tangent line-arc constraint`);
    else assert(S.constraints.some(c => c.type === 'tangent' && c.shapes && c.shapes.includes(sh.id) && c.shapes.includes(res.arc.id) && c.branch === leg.branch), `${label}: tangent arc-arc constraint on branch ${leg.branch}`);
    assert(S.constraints.some(c => c.type === 'pointOnLine' && c.joint === res.virtualSharp && c.shape === sh.id), `${label}: the virtual sharp is on ${sh.id}`);
  }
  const V = pos(S, res.virtualSharp);
  near(V.x, P.x, `${label}: virtual sharp stays at the corner x`); near(V.y, P.y, `${label}: virtual sharp stays at the corner y`);
  assert(S.constraints.some(c => c.type === 'distance' && c.isRadius && c.shape === res.arc.id && Math.abs(c.value - r) < 1e-9), `${label}: radius dimension`);
  // the wedge: O - P = alpha u1 + beta u2 with both positive (the inside of the corner)
  const [u1, u2] = legs.map(l => l.u), w = { x: O.x - P.x, y: O.y - P.y }, det = u1.x * u2.y - u1.y * u2.x;
  const alpha = (w.x * u2.y - w.y * u2.x) / det, beta = (u1.x * w.y - u1.y * w.x) / det;
  assert(alpha > 0 && beta > 0, `${label}: the fillet lies inside the corner (alpha ${alpha.toFixed(3)}, beta ${beta.toFixed(3)})`);
}

// --- line + arc: both arc ends, both arc directions, a convex and a concave arc ---
let n = 0;
for (const bodyDir of [1, -1]) for (const atStart of [true, false]) for (const concave of [false, true]) {
  const S = mk(), r = 3, R = 20;
  const arc = addArc(S, 'A', { x: 0, y: 0 }, R, 0, bodyDir, atStart);
  const t = arcTangent(0, bodyDir);
  // convex: the line leaves to the right (the fillet sits outside the circle); concave: back over the circle (inside it)
  const u = concave ? { x: -0.894427, y: 0.447214 * (t.y > 0 ? 1 : -1) } : { x: 1, y: 0 };
  const line = addLine(S, 'L', u, 30);
  const label = `line+arc bodyDir=${bodyDir} ${atStart ? 'start' : 'end'} ${concave ? 'concave' : 'convex'}`;
  const sweepBefore = arcSweepInfo(pos(S, 'Ac'), pos(S, arc.joints[1]), pos(S, arc.joints[2]), { sweep: arc.sweep });
  const corner = findCornerAtPoint(S, P, 1);
  assert(corner, `${label}: corner found`);
  const res = applyFillet(S, corner, r);
  const legs = [
    { shape: line, u },
    { shape: arc, u: t, c: { x: 0, y: 0 }, R, sweep: arc.sweep, span: sweepBefore.span, branch: concave ? 'internal' : 'external' }
  ];
  // corner.lineA / lineB order follows the shape order in the sketch: the arc was added first
  checkFillet(S, res, r, [legs[1], legs[0]], label);
  // the solver keeps the answer, and the radius dimension re-edits it
  S.engine = createNewtonSolver(S.joints, S.constraints, S.shapes, {});
  S.engine.solve(200);
  const rc = S.constraints.find(c => c.isRadius && c.shape === res.arc.id);
  const ed = commitDimensionEdit(S, rc, 5);
  assert.strictEqual(ed.reverted, false, `${label}: radius edit converges (${ed.clash || ed.reason})`);
  const fillet = S.shapes.find(s => s.id === res.arc.id);
  const O = pos(S, fillet.joints[0]);
  near(Math.hypot(pos(S, fillet.joints[1]).x - O.x, pos(S, fillet.joints[1]).y - O.y), 5, `${label}: edited radius`);
  near(Math.abs(Math.hypot(O.x, O.y) - R), 5, `${label}: edited fillet still tangent to the arc`);
  near(Math.hypot(pos(S, arc.joints[1]).x, pos(S, arc.joints[1]).y), R, `${label}: arc radius unchanged by the edit`);
  n++;
}

// --- arc + arc is NOT built (owner ruling): no corner, and a clear message ---
{
  const S = mk(); addArc(S, 'A', { x: 0, y: 0 }, 20, 0, 1, true); addArc(S, 'B', { x: 30, y: 10 }, Math.hypot(10, 10), Math.atan2(-10, -10), 1, false);
  assert.strictEqual(findCornerAtPoint(S, P, 1), null, 'two arcs: no corner');
  assert.strictEqual(diagnoseNoFillet(S, P, 1), 'Fillet needs a line on at least one side');
}

// --- both pick styles reach the same corner; a pick lands on an arc's drawn sweep only ---
{
  const S = mk(); const arc = addArc(S, 'A', { x: 0, y: 0 }, 20, 0, 1, true); const line = addLine(S, 'L', { x: 1, y: 0 }, 30);
  assert.strictEqual(findFilletShapeAtPoint(S, { x: 0, y: 20 }, 2), arc, 'a pick on the arc finds the arc');
  assert.strictEqual(findFilletShapeAtPoint(S, { x: 0, y: -20 }, 2), null, 'the arc is picked on its drawn sweep only, not its whole circle');
  assert.strictEqual(findFilletShapeAtPoint(S, { x: 40, y: 0 }, 2), line, 'a pick on the line finds the line');
  const c = findCornerBetweenLines(S, arc, line);
  assert(c && c.cornerJointId, 'pick-one-then-the-other finds the line-arc corner');
  assert.strictEqual(c.cornerPt.x, 20);
}

// --- a corner whose joints are separate but coincident (constraint) is found, the arc's end moves ---
{
  const S = mk(); S.joints.set('Q', { x: 20, y: 0, fixed: false });
  addArc(S, 'A', { x: 0, y: 0 }, 20, 0, 1, true, Math.PI / 2, 'P'); addLine(S, 'L', { x: 1, y: 0 }, 30, 'Q');
  S.constraints.push({ type: 'coincident', joints: ['P', 'Q'] });
  const res = applyFillet(S, findCornerAtPoint(S, P, 1), 3);
  assert(res.success, 'coincident-joint line-arc corner fillets');
  assert(!S.joints.has('Q') || S.constraints.every(c => !(c.type === 'coincident')), 'the corner coincident constraint is gone');
}

// --- refusals, each with its reason ---
{
  // the fillet would pass the arc's far end (a short arc)
  const S = mk(); addArc(S, 'A', { x: 0, y: 0 }, 20, 0, 1, true, 0.2); addLine(S, 'L', { x: 1, y: 0 }, 30);
  const bad = applyFillet(S, findCornerAtPoint(S, P, 1), 15);
  assert(bad.success === false && /past the far end of the arc/.test(bad.reason), 'oversized radius past the arc end is refused: ' + bad.reason);
  assert.strictEqual(S.shapes.length, 2, 'a refusal changes nothing');
  // a concave fillet bigger than the arc's own radius
  const S2 = mk(); addArc(S2, 'A', { x: 0, y: 0 }, 20, 0, 1, true); addLine(S2, 'L', { x: -0.894427, y: 0.447214 }, 30);
  const big = applyFillet(S2, findCornerAtPoint(S2, P, 1), 25);
  assert(big.success === false && /too large for the arc/.test(big.reason), 'a radius over the arc radius is refused: ' + big.reason);
  // a line meeting an arc along its tangent is no corner; the message says so
  const S3 = mk(); addArc(S3, 'A', { x: 0, y: 0 }, 20, 0, 1, true); addLine(S3, 'L', { x: 0, y: -1 }, 30);
  assert.strictEqual(findCornerAtJoint(S3, 'P'), null, 'a tangent join is not a corner');
  assert.strictEqual(diagnoseNoFillet(S3, P, 1), 'These curves already run tangent to each other: nothing to fillet');
  // three curves at one corner: still the T-junction refusal
  const S4 = mk(); addArc(S4, 'A', { x: 0, y: 0 }, 20, 0, 1, true); addLine(S4, 'L', { x: 1, y: 0 }, 30); addLine(S4, 'M', { x: 1, y: 1 }, 30);
  assert.strictEqual(findCornerAtJoint(S4, 'P'), null);
  assert.strictEqual(diagnoseNoFillet(S4, P, 1), 'Fillet needs a corner between exactly two lines or arcs (T-junction)');
  // an arc + line geometry call is exposed on the corner
  const g = cornerFilletGeometry(findCornerAtPoint(mkLineArc(), P, 1), 3);
  assert(g.valid && [g.insideA, g.insideB].includes(false), 'a convex line-arc corner: the fillet lies outside the arc circle');
}
function mkLineArc() { const S = mk(); addArc(S, 'A', { x: 0, y: 0 }, 20, 0, 1, true); addLine(S, 'L', { x: 1, y: 0 }, 30); return S; }

console.log(`fillet-arc-645 tests passed (${n} line+arc cases)`);
