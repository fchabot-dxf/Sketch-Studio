// DIFFERENTIAL solver test — runs the SAME constraint system through our solver AND FreeCAD's PlaneGCS
// (a battle-tested reference), then compares the resulting geometry. The fuzzer catches INTERNAL
// contradictions (no-lie, never-deform); this catches WRONG-BUT-SELF-CONSISTENT answers — a bad Jacobian
// that converges to the wrong place — by checking us against an independent oracle.
//
// Scenarios are written in a NEUTRAL format and mapped to each solver. Both start from the SAME perturbed
// positions; for a determined system, least-change Newton/LM should land both at the same solution.

import { createEngine } from '#core/constraint-solver.js';
import { CONSTRAINT_TYPES as T } from '#core/constants.js';
import { SolverConfig } from '#core/solver-config.js';
import { init_planegcs_module, GcsWrapper } from '@salusoft89/planegcs';

const TOL = 0.05;

// ── neutral scenarios: points (id,x,y,fixed) · lines (id,p1,p2) · constraints ──
const SCENARIOS = [
  { name: 'coincident → origin', points: [{ id: '1', x: 0, y: 0, fixed: true }, { id: '2', x: 5, y: 5 }], lines: [],
    constraints: [{ type: 'coincident', a: '1', b: '2' }] },
  { name: 'distance from origin', points: [{ id: '1', x: 0, y: 0, fixed: true }, { id: '2', x: 6, y: 0 }], lines: [],
    constraints: [{ type: 'distance', a: '1', b: '2', value: 10 }] },
  { name: 'fully-constrained rect', points: [{ id: '1', x: 0, y: 0, fixed: true }, { id: '2', x: 8, y: 1 }, { id: '3', x: 11, y: 5 }, { id: '4', x: 1, y: 7 }],
    lines: [{ id: 'top', p1: '1', p2: '2' }, { id: 'right', p1: '2', p2: '3' }, { id: 'bot', p1: '4', p2: '3' }, { id: 'left', p1: '1', p2: '4' }],
    constraints: [{ type: 'horizontal', line: 'top' }, { type: 'vertical', line: 'right' }, { type: 'horizontal', line: 'bot' }, { type: 'vertical', line: 'left' },
      { type: 'distance', a: '1', b: '2', value: 10 }, { type: 'distance', a: '2', b: '3', value: 6 }] },
  { name: 'perpendicular L-bracket', points: [{ id: '1', x: 0, y: 0, fixed: true }, { id: '2', x: 10, y: 1 }, { id: '3', x: 1, y: 8 }],
    lines: [{ id: 'a', p1: '1', p2: '2' }, { id: 'b', p1: '1', p2: '3' }],
    constraints: [{ type: 'horizontal', line: 'a' }, { type: 'perpendicular', line1: 'a', line2: 'b' }, { type: 'distance', a: '1', b: '2', value: 10 }, { type: 'distance', a: '1', b: '3', value: 8 }] },
  { name: 'triangle (SSS)', points: [{ id: '1', x: 0, y: 0, fixed: true }, { id: '2', x: 10, y: 0, fixed: true }, { id: '3', x: 4, y: 8 }], lines: [],
    constraints: [{ type: 'distance', a: '1', b: '3', value: 7 }, { type: 'distance', a: '2', b: '3', value: 8 }] },
  { name: 'square (rect + equal)', points: [{ id: '1', x: 0, y: 0, fixed: true }, { id: '2', x: 8, y: 1 }, { id: '3', x: 9, y: 7 }, { id: '4', x: 1, y: 6 }],
    lines: [{ id: 'top', p1: '1', p2: '2' }, { id: 'right', p1: '2', p2: '3' }, { id: 'bot', p1: '4', p2: '3' }, { id: 'left', p1: '1', p2: '4' }],
    constraints: [{ type: 'horizontal', line: 'top' }, { type: 'vertical', line: 'right' }, { type: 'horizontal', line: 'bot' }, { type: 'vertical', line: 'left' },
      { type: 'distance', a: '1', b: '2', value: 5 }, { type: 'equal', line1: 'top', line2: 'right' }] },
];

const lineMap = (sc) => Object.fromEntries(sc.lines.map(l => [l.id, l]));

function solveOurs(sc) {
  const engine = createEngine(null); engine.init();
  for (const p of sc.points) engine.addJoint(p.id, p.x, p.y, !!p.fixed);
  for (const l of sc.lines) engine.addShape({ id: l.id, type: 'line', joints: [l.p1, l.p2] });
  const L = lineMap(sc); let cid = 0;
  for (const c of sc.constraints) {
    const id = 'c' + (++cid);
    if (c.type === 'coincident') engine.addConstraint({ id, type: T.COINCIDENT, joints: [c.a, c.b] });
    else if (c.type === 'distance') engine.addConstraint({ id, type: T.DISTANCE, joints: [c.a, c.b], value: c.value });
    else if (c.type === 'horizontal') engine.addConstraint({ id, type: T.HORIZONTAL, joints: [L[c.line].p1, L[c.line].p2] });
    else if (c.type === 'vertical') engine.addConstraint({ id, type: T.VERTICAL, joints: [L[c.line].p1, L[c.line].p2] });
    else if (c.type === 'parallel') engine.addConstraint({ id, type: T.PARALLEL, joints: [L[c.line1].p1, L[c.line1].p2, L[c.line2].p1, L[c.line2].p2] });
    else if (c.type === 'perpendicular') engine.addConstraint({ id, type: T.PERPENDICULAR, joints: [L[c.line1].p1, L[c.line1].p2, L[c.line2].p1, L[c.line2].p2] });
    else if (c.type === 'equal') engine.addConstraint({ id, type: T.EQUAL, joints: [L[c.line1].p1, L[c.line1].p2, L[c.line2].p1, L[c.line2].p2] });
  }
  engine.solve(SolverConfig.ITERATIONS || 500);
  const j = engine.getJoints(); const out = {};
  for (const p of sc.points) { const q = j.get(p.id); out[p.id] = { x: q.x, y: q.y }; }
  return out;
}

function solvePlanegcs(sc, mod) {
  const w = new GcsWrapper(new mod.GcsSystem());
  const prims = [];
  for (const p of sc.points) prims.push({ id: p.id, type: 'point', x: p.x, y: p.y, fixed: !!p.fixed });
  for (const l of sc.lines) prims.push({ id: l.id, type: 'line', p1_id: l.p1, p2_id: l.p2 });
  let cid = 1000;
  for (const c of sc.constraints) {
    const id = '' + (++cid);
    if (c.type === 'coincident') prims.push({ id, type: 'p2p_coincident', p1_id: c.a, p2_id: c.b });
    else if (c.type === 'distance') prims.push({ id, type: 'p2p_distance', p1_id: c.a, p2_id: c.b, distance: c.value });
    else if (c.type === 'horizontal') prims.push({ id, type: 'horizontal_l', l_id: c.line });
    else if (c.type === 'vertical') prims.push({ id, type: 'vertical_l', l_id: c.line });
    else if (c.type === 'parallel') prims.push({ id, type: 'parallel', l1_id: c.line1, l2_id: c.line2 });
    else if (c.type === 'perpendicular') prims.push({ id, type: 'perpendicular_ll', l1_id: c.line1, l2_id: c.line2 });
    else if (c.type === 'equal') prims.push({ id, type: 'equal_length', l1_id: c.line1, l2_id: c.line2 });
  }
  w.push_primitives_and_params(prims);
  w.solve(); w.apply_solution();
  const res = w.sketch_index.get_primitives(); const out = {};
  for (const p of res) if (p.type === 'point') out[p.id] = { x: p.x, y: p.y };
  w.destroy_gcs_module();
  return out;
}

const mod = await init_planegcs_module();
console.log('\n=============== DIFFERENTIAL: our solver vs PlaneGCS (FreeCAD reference) ===============');
let agree = 0;
for (const sc of SCENARIOS) {
  const ours = solveOurs(sc);
  let pg; try { pg = solvePlanegcs(sc, mod); } catch (e) { console.log(`  ${sc.name.padEnd(26)} planegcs ERROR: ${e.message}`); continue; }
  let maxD = 0, worst = '';
  for (const p of sc.points) {
    if (p.fixed) continue;
    const d = Math.hypot(ours[p.id].x - pg[p.id].x, ours[p.id].y - pg[p.id].y);
    if (d > maxD) { maxD = d; worst = p.id; }
  }
  const ok = maxD <= TOL; if (ok) agree++;
  console.log(`  ${sc.name.padEnd(26)} ${ok ? 'AGREE ✅' : 'DIVERGE ❌'}  maxΔ=${maxD.toFixed(4)}${ok ? '' : ` @pt ${worst}  ours=(${ours[worst].x.toFixed(2)},${ours[worst].y.toFixed(2)}) pgcs=(${pg[worst].x.toFixed(2)},${pg[worst].y.toFixed(2)})`}`);
}
console.log('  --------------------------------------------------------------------------------------');
console.log(`  ${agree}/${SCENARIOS.length} scenarios match the PlaneGCS reference within ${TOL}.`);
console.log('========================================================================================\n');
// GATING: if our solver ever diverges from the FreeCAD reference on a determined system, fail the suite.
process.exit(agree === SCENARIOS.length ? 0 : 1);
