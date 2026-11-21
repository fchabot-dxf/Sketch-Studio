// tests/pattern-arcs-846-node.test.js - TASK 846: a PATTERN of shapes with ARCS (#core/pattern.js) copies every arc congruent to its source, for a
// rectangular and a circular pattern, so each copy is one closed loop (#core/loop-finder.js) and the Shaper 3D cuts each copy through (an Inside cut at
// the board's thickness: apps/shaper/src/cut-plan.js planReliefItems -> #core/relief-model.js buildRelief).
//   The owner's case (task 838's showcase panel): 5 vent slots (a 0.3 x 0.7 in rectangle with four R 0.1 in fillets) in a rectangular pattern came out
//   D-shaped in 2D and missing in the 3D. Task 846 found the copies congruent to their source: the SOURCE itself had gone self-crossing (the script had
//   deleted the slot fillets' radius dimensions, and a later dimension edit moved the free fillets, inverting one); the copies followed it, and an Inside
//   cut of a self-crossing loop derives no cut, so the 3D had no slot. This test holds the pattern's part: copies of the Slot tool's slot, a filleted
//   rectangle, a circle and an arc + lines (a 270 degree pie: a large arc, lines on its centre point) are each the source moved by the pattern's step
//   (lines' ends, arcs' centre / start / end, radius, sweep and direction), each copy is one closed loop, and the 3D cuts each through.
//   Beziers: a pattern refuses them (PATTERN_KINDS: lines, arcs, circles, points), with its reason.
// Node has no SVG DOM: the 3D derivation reads the arcs' samples from withArcSamples (#core/curve-kinds.js: what the page hands the paths worker),
// sampled here from the arc's own declared sweep (arcSweepInfo), the way the page's SVG path walks it.
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import * as ops from '#core/tool-ops.js';
import { applyPattern, patternDefaults, isPatternConstraint } from '#core/pattern.js';
import { measureResidual } from '#core/constraint-verifier.js';
import { arcSweepInfo } from '#core/geometry.js';
import { withArcSamples } from '#core/curve-kinds.js';
import { findLoops } from '#core/loop-finder.js';
import { buildRelief } from '#core/relief-model.js';
import { planReliefItems, loopsWithPolygons } from '../apps/shaper/src/cut-plan.js';
import { defaultCutRecord } from '../apps/shaper/src/shaper.js';
import { withPlan } from './helpers/plan-v2.js';

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, m, tol = 1e-6) => ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b}`);
const IN = 25.4, BOARD = 19.05, T = 0.75 * IN;
const RECT = 'rectangularPattern', CIRC = 'circularPattern';

// the sources (world mm, y down), each with a point strictly inside it
const SOURCES = {
  'filleted rectangle': (S) => {
    const r = L.rect(S, 2 * IN, 4.3 * IN, 2.3 * IN, 5 * IN);
    for (const [a, b] of [[r.top, r.right], [r.right, r.bottom], [r.bottom, r.left], [r.left, r.top]]) L.fillet(S, a, b, 0.1 * IN);
    return { inside: { x: 2.15 * IN, y: 4.65 * IN } };
  },
  'slot (Slot tool)': (S) => {
    ops.slot(S.state, L.point(S, 2.1 * IN, 4.4 * IN), L.point(S, 2.1 * IN, 4.9 * IN), 0.2 * IN);
    return { inside: { x: 2.1 * IN, y: 4.65 * IN } };
  },
  circle: (S) => { L.circle(S, 2.1 * IN, 4.65 * IN, 0.15 * IN); return { inside: { x: 2.1 * IN, y: 4.65 * IN } }; },
  'arc + lines (270 degree pie)': (S) => {
    const c = L.point(S, 2.1 * IN, 4.65 * IN), a = L.point(S, 2.4 * IN, 4.65 * IN), b = L.point(S, 2.1 * IN, 4.35 * IN);
    ops.arc(S.state, c, a, b, { sweep: true }); // from +x the long way round (increasing world angle): 270 degrees
    S.state.shapes.push({ id: 'pieA', type: 'line', joints: [b, c], isConstruction: false }, { id: 'pieB', type: 'line', joints: [c, a], isConstruction: false });
    return { inside: { x: 2.0 * IN, y: 4.75 * IN } };
  },
};
// the patterns: rectangular 5 at 0.45 in along X (the owner's vents); circular 4 over 360 degrees about a point below the sources
const PATTERNS = {
  [RECT]: () => ({ quantity: [5, 1], distance: [0.45 * IN, 0.45 * IN] }),
  [CIRC]: (S) => ({ quantity: 4, angle: 360, centre: L.point(S, 3 * IN, 6.5 * IN) }),
};
// the pattern's step as the test computes it (independent of #core/pattern.js): instance `at` of `c`
function stepOf(S, c, at) {
  if (c.type === RECT) return (p) => ({ x: p.x + at[0] * c.distance[0], y: p.y });
  const C = S.state.joints.get(c.centre), th = -at[0] * (c.angle / c.quantity) * Math.PI / 180; // user CCW = world -angle (y down)
  const co = Math.cos(th), si = Math.sin(th);
  return (p) => ({ x: C.x + co * (p.x - C.x) - si * (p.y - C.y), y: C.y + si * (p.x - C.x) + co * (p.y - C.y) });
}
const P = (S, id) => S.state.joints.get(id);
// every arc's samples, start -> end along its declared sweep (what sampleArc reads off the page's SVG path)
function arcTable(state, N = 24) {
  const byId = {};
  for (const s of state.shapes) {
    if (s.type !== 'arc') continue;
    const [c, a, b] = s.joints.map((j) => state.joints.get(j));
    const info = arcSweepInfo(c, a, b, { sweep: s.sweep }), r = Math.hypot(a.x - c.x, a.y - c.y);
    byId[s.id] = Array.from({ length: N + 1 }, (_, i) => { const t = info.a0 + info.dir * info.span * (i / N); return { x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) }; });
  }
  return { N, byId };
}
const ptIn = (g, x, y) => { let c = false; for (let i = 0, j = g.length - 1; i < g.length; j = i++) { if ((g[i][1] > y) !== (g[j][1] > y) && x < (g[j][0] - g[i][0]) * (y - g[i][1]) / (g[j][1] - g[i][1]) + g[i][0]) c = !c; } return c; };
const inRegions = (rs, x, y) => rs.some((g) => ptIn(g.outer, x, y) && !g.holes.some((h) => ptIn(h, x, y)));
const depthAt = (rel, p) => { let d = 0; for (const l of rel.levels) if (inRegions(l.regions, p.x, p.y)) d = Math.max(d, l.depth); return d; };

for (const [name, build] of Object.entries(SOURCES)) {
  for (const [type, valuesOf] of Object.entries(PATTERNS)) {
    const label = `${name}, ${type}`;
    const S = L.newSketch();
    const { inside } = build(S);
    const src = S.state.shapes.filter((s) => !s.reference && !s.isConstruction);
    const res = applyPattern(S.state, type, { shapes: src.map((s) => s.id), joints: [] }, { ...patternDefaults(type), ...valuesOf(S) });
    ok(res.ok, `${label}: made (${res.reason})`);
    const c = res.constraint;
    const solved = S.engine.solve(L.ITER);
    ok(!solved || solved.converged !== false, `${label}: the sketch solves`);
    near(measureResidual(c, S.state.joints, S.state.shapes), 0, `${label}: the pattern is satisfied`, 1e-9);
    const n = type === RECT ? 4 : 3;
    ok(c.instances.length === n, `${label}: ${n} copies (${c.instances.length})`);

    // 1. every copy congruent to its source: the source moved by the instance's step
    for (const inst of c.instances) {
      const M = stepOf(S, c, inst.at), at = `${label} copy ${inst.at}`;
      src.forEach((s, si) => {
        const cp = S.state.shapes.find((x) => x.id === inst.shapes[si]);
        ok(cp && cp.type === s.type, `${at}: shape ${si} a ${s.type} (${cp && cp.type})`);
        s.joints.forEach((j, k) => {
          const want = M(P(S, j)), got = P(S, cp.joints[k]);
          near(Math.hypot(got.x - want.x, got.y - want.y), 0, `${at}: ${s.type} ${si} point ${k} at the source's moved by the step`);
        });
        if (s.type === 'circle') near(cp.radius, s.radius, `${at}: circle radius`, 1e-9);
        if (s.type === 'arc') {
          const [sc, sa, sb] = s.joints.map((j) => P(S, j)), [qc, qa, qb] = cp.joints.map((j) => P(S, j));
          ok(cp.sweep === s.sweep, `${at}: arc ${si} keeps its stored sweep (${cp.sweep} vs ${s.sweep})`);
          near(Math.hypot(qa.x - qc.x, qa.y - qc.y), Math.hypot(sa.x - sc.x, sa.y - sc.y), `${at}: arc ${si} radius (start)`);
          near(Math.hypot(qb.x - qc.x, qb.y - qc.y), Math.hypot(sb.x - sc.x, sb.y - sc.y), `${at}: arc ${si} radius (end)`);
          const si0 = arcSweepInfo(sc, sa, sb, { sweep: s.sweep }), qi = arcSweepInfo(qc, qa, qb, { sweep: cp.sweep });
          near(qi.span, si0.span, `${at}: arc ${si} sweeps the same angle`, 1e-9);
          ok(qi.dir === si0.dir, `${at}: arc ${si} runs the same direction (${qi.dir} vs ${si0.dir})`);
        }
      });
    }

    // 2. the loop finder: the source and every copy are each ONE closed loop of exactly their shapes
    const loops = findLoops(S.state);
    const loopOf = (ids) => loops.find((l) => l.edges.length === ids.length && ids.every((id) => l.edges.includes(id)));
    ok(loopOf(src.map((s) => s.id)), `${label}: the source is one closed loop`);
    for (const inst of c.instances) ok(loopOf(inst.shapes), `${label}: copy ${inst.at} is one closed loop of its ${inst.shapes.length} shapes`);

    // 3. the Shaper 3D: an Inside cut at the board's thickness on the source and every copy cuts each through (its inside open)
    withArcSamples(arcTable(S.state), () => {
      const geo = loopsWithPolygons(S.state);
      const keys = [src.map((s) => s.id), ...c.instances.map((i) => i.shapes)].map((ids) => `loop:${geo.loops.find((l) => l.edges.length === ids.length && ids.every((id) => l.edges.includes(id))).id}`);
      const rec = { ...defaultCutRecord(), toolDia: 0.0625 * IN, cutType: 'interior', cutDepth: T };
      const items = withPlan(S.state, keys.map((k) => [k, { ...rec }]), () => planReliefItems(S.state));
      for (const k of keys) ok(items.some((i) => i.key === k && i.cutType === 'interior' && i.footprints.some((f) => f.rings && f.rings.length)), `${label}: ${k.slice(0, 40)}: the 3D has its Inside cut`);
      const rel = buildRelief({ stock: { thickness: BOARD, margin: 0 }, bounds: { minX: -50, maxX: 400, minY: -50, maxY: 400 }, items });
      near(depthAt(rel, inside), BOARD, `${label}: the source's inside is cut through`, 1e-9);
      for (const inst of c.instances) near(depthAt(rel, stepOf(S, c, inst.at)(inside)), BOARD, `${label}: copy ${inst.at}'s inside is cut through`, 1e-9);
    });
  }
}

// 4. a bezier is no pattern object: refused with its reason, nothing made
{
  const S = L.newSketch();
  const j = [[0, 0], [10, -10], [20, -10], [30, 0]].map(([x, y]) => L.point(S, x, y));
  S.state.shapes.push({ id: 'bz', type: 'bezier', joints: j, isConstruction: false });
  const n = S.state.constraints.length;
  const res = applyPattern(S.state, RECT, { shapes: ['bz'], joints: [] }, patternDefaults(RECT));
  ok(!res.ok && /bezier cannot be patterned/.test(res.reason), `a bezier is refused (${res.reason})`);
  ok(S.state.constraints.length === n && !S.state.constraints.some(isPatternConstraint), 'nothing made');
}

console.log(`pattern-arcs-846: ${checks} checks passed`);
