// Regression test for "point-on-circle silently ignored" (Phase 0 medium).
//
// The snap pipeline creates a POINT_ON_LINE constraint {joint, shape} where the
// shape can be a CIRCLE/ARC (snap-constraints.js case 'shape'). The solver's
// _assemble only synthesized joints for LINE shapes, so for a circle the
// constraint ran with empty joints -> NaN residual, and the point was never
// pulled onto the rim (silently ignored).
//
// Fix: _assemble handles circle/arc targets (joints = [point, center], radius
// from the shape) and the point_on_line definition pulls the point onto the rim
// (residual = dist(point, center) - radius), moving only the point.
//
// DoD: a point-on-circle constraint pulls the point onto the circle (dist ~
// radius, converged), with no NaN.
(async () => {
  const { createEngine } = await import('#core/constraint-solver.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  const eng = createEngine(null);
  eng.init();                          // fixed j_origin at (0,0) = circle center
  eng.addJoint('r', 5, 0, true);       // rim -> radius 5 (fixed)
  eng.addJoint('p', 8, 6, false);      // free point off the circle (dist 10)
  eng.addShape({ id: 'circ', type: 'circle', joints: ['j_origin', 'r'] });
  eng.addConstraint({ id: 'c_poc', type: 'pointOnLine', joint: 'p', shape: 'circ' });

  const res = eng.solve(200);
  const p = eng.getJoints().get('p');
  const dist = Math.hypot(p.x, p.y);
  console.log(`[point-on-circle] p=(${p.x.toFixed(4)},${p.y.toFixed(4)}) dist=${dist.toFixed(4)} conv=${res.converged} err=${(+res.error).toExponential(2)}`);

  assert(Number.isFinite(p.x) && Number.isFinite(p.y), 'point must stay finite (no NaN from an unhandled circle target)');
  assert(Math.abs(dist - 5) < 1e-3, 'the point must be pulled onto the circle rim (dist ~ radius 5)');
  assert(res.converged === true, 'a satisfiable point-on-circle constraint must report converged:true');

  console.log('solver-point-on-circle tests passed ✅');
})().catch(e => { console.error('solver-point-on-circle tests failed ❌', e && e.message ? e.message : e); process.exit(1); });
