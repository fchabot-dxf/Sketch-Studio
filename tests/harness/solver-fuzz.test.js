// AUTOMATED solver fuzzer — runs a few hundred sims so bugs surface WITHOUT hand-drawing.
// Each sim picks a random BASE SHAPE built with the REAL builders the app uses (never hand-assembled):
//   rect (rect tool / makeRectFromTwoJoints) · polyline (line shapes) · polygon (makePolygon) · circle.
// Then it applies VARIED constraints + dimensions (H/V/equal/parallel · edge & diagonal dims) and
// adversarial ops (drag hard · push/pull · over-constrain by edit and by conflicting dimension), checking
// three universal invariants after EVERY step:
//   P1 NO-EXPLODE   every joint stays finite + bounded (no NaN / runaway).
//   P2 NO-LIE       if the solver reports `converged`, EVERY non-driven constraint is ACTUALLY satisfied
//                   (any type, any shape) — the universal "never silently deform" check.
//   P3 NEVER-SILENT after a committed op the sketch is converged OR an error was shown — never left
//                   silently non-converged / mangled.
// Seeded PRNG ⇒ any failure prints a replayable {seed, ops}. Reporter (exits 0) — a bug-finder board.

import { createSketch } from './sketch.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { makePolygon } from '#core/shapes.js';
import { CONSTRAINT_TYPES as T } from '#core/constants.js';
import { updateConstraintOffset } from '#ui/input-handlers/dimension-tool.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// geometric residual per constraint type (mirrors solver/definitions.js) — the ground-truth check.
function residual(s, c) {
  const J = c.joints || [];
  if (J.length < 2) return 0;
  const P = J.map((id) => s.pos(id));
  if (P.some((p) => !p)) return 0;
  const sub = (u, v) => ({ x: u.x - v.x, y: u.y - v.y });
  const len = (u) => Math.hypot(u.x, u.y);
  switch (c.type) {
    case T.HORIZONTAL: return Math.abs(P[0].y - P[1].y);
    case T.VERTICAL: return Math.abs(P[0].x - P[1].x);
    case T.COINCIDENT: return len(sub(P[0], P[1]));
    case T.DISTANCE: return Math.abs(len(sub(P[1], P[0])) - (Number(c.value) || 0));
    case T.EQUAL: { if (P.length < 4) return 0; return Math.abs(len(sub(P[0], P[1])) - len(sub(P[2], P[3]))); }
    case T.PARALLEL: { if (P.length < 4) return 0; const u = sub(P[1], P[0]), v = sub(P[3], P[2]); const d = (len(u) * len(v)) || 1e-9; return Math.abs((u.x * v.y - u.y * v.x) / d); }
    case T.PERPENDICULAR: { if (P.length < 4) return 0; const u = sub(P[1], P[0]), v = sub(P[3], P[2]); const d = (len(u) * len(v)) || 1e-9; return Math.abs((u.x * v.x + u.y * v.y) / d); }
    case T.POINT_ON_LINE: { if (P.length < 3) return 0; const u = sub(P[2], P[1]), w = sub(P[0], P[1]); return Math.abs(u.x * w.y - u.y * w.x) / (len(u) || 1e-9); } // P on line AB
    case T.MIDPOINT: { if (P.length < 3) return 0; return Math.hypot((P[0].x + P[1].x) / 2 - P[2].x, (P[0].y + P[1].y) / 2 - P[2].y); } // m = mid(a,b)
    case T.ANGLE: { if (P.length < 4) return 0; const u = sub(P[1], P[0]), v = sub(P[3], P[2]); const lu = len(u) || 1e-9, lv = len(v) || 1e-9; const cr = (u.x * v.y - u.y * v.x) / (lu * lv), dt = (u.x * v.x + u.y * v.y) / (lu * lv); const t = (Number(c.value) || 0) * Math.PI / 180; return Math.abs(cr * Math.cos(t) - dt * Math.sin(t)); }
    default: return 0; // types the fuzzer doesn't generate
  }
}

const addCon = (s, type, joints, extra = {}) => ConstraintManager.createConstraint(s.state, type, { joints: [...joints], ...extra }, { source: 'fuzz' });
// NOTE: point_on_line / angle / tangent are SHAPE-based in ConstraintManager (joint params get dropped), so
// fuzzing them through the REAL app path needs edge→line-shape-id tracking — a follow-up. Added raw they'd
// bypass the refuse/never-silent layer and produce artifact "failures", so they're left out for now.

// Drive the REAL app placement step (dimension-tool.updateConstraintOffset) after every dimension add —
// this is where Root1 lived: it re-evaluated isDriven and could re-promote a redundant REFERENCE back to a
// DRIVER. The harness's `dimension()` only hits the core (ConstraintManager); without this, the fuzzer is
// blind to app-layer bugs (exactly the one the user had to find by hand).
function placeDim(s, dim, a, b) {
  if (!dim) return;
  const A = s.pos(a), B = s.pos(b);
  if (!A || !B) return;
  const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
  const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1;
  const w = { x: mx - (dy / L) * 8, y: my + (dx / L) * 8 };   // glyph drop-point, perpendicular to the edge
  try { updateConstraintOffset(s.state, dim, w); } catch (_) {}
  s.solve();
}

// build a random base shape with the REAL builders → { name, edges:[[label,a,b]...], drag:[jointId...] }
function buildShape(s, ri) {
  const kind = ri(0, 3);
  if (kind === 0) {                                   // RECTANGLE via the rect tool
    const w = ri(4, 16), h = ri(4, 16);
    const r = s.rect(0, 0, w, h);
    const [c1, c2, c3, c4] = r.corners;
    return { name: `rect(${w}x${h})`, edges: [['top', c1, c2], ['bot', c4, c3], ['left', c1, c4], ['right', c2, c3]], drag: r.corners, wEdges: [[c1, c2], [c4, c3]], hEdges: [[c1, c4], [c2, c3]] };
  }
  if (kind === 1) {                                   // POLYLINE — a chain of real line shapes
    const n = ri(3, 5);
    const pts = [s.point(0, 0, true)];
    let px = 0, py = 0;
    for (let i = 1; i < n; i++) { px += (ri(-9, 9) || 6); py += (ri(-9, 9) || 6); pts.push(s.point(px, py, false)); }
    const edges = [];
    for (let i = 0; i < n - 1; i++) { s.engine.addShape({ id: `seg_${i}`, type: 'line', joints: [pts[i], pts[i + 1]] }); edges.push([`e${i}`, pts[i], pts[i + 1]]); }
    return { name: `polyline${n}`, edges, drag: pts.slice(1) };
  }
  if (kind === 2) {                                   // POLYGON via makePolygon (real builder, welded)
    const n = ri(3, 6);
    const center = s.point(0, 0, true);
    const vertex = s.point(ri(5, 12), 0, false);
    const built = makePolygon(s.state.joints, center, vertex, n, s.engine.genJ);
    for (const sh of built.shapes) s.engine.addShape(sh);
    for (const c of built.constraints) ConstraintManager.createConstraint(s.state, c.type, c, { source: 'fuzz' });
    const edges = built.shapes.filter((sh) => /^s_poly_\d/.test(sh.id)).map((sh, i) => [`p${i}`, sh.joints[0], sh.joints[1]]);
    const drag = [...new Set(edges.flatMap((e) => [e[1], e[2]]))];
    return { name: `poly${n}`, edges, drag };
  }
  // kind === 3: CIRCLE — center + rim joint (radius = dist)
  const center = s.point(0, 0, true);
  const rim = s.point(ri(4, 12), 0, false);
  s.engine.addShape({ id: 'circ0', type: 'circle', joints: [center, rim] });
  return { name: 'circle', edges: [['radius', center, rim]], drag: [rim] };
}

function fuzzOne(seed) {
  const rand = rng(seed);
  const ri = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  const s = createSketch();
  const ops = [];
  const dims = [];
  const shape = buildShape(s, ri);
  ops.push(shape.name);
  const E = shape.edges, D = shape.drag;
  s.solve();

  const violations = [];
  const check = (label, committed) => {
    s.state.joints.forEach((j) => {
      if (!isFinite(j.x) || !isFinite(j.y) || Math.abs(j.x) > 1e5 || Math.abs(j.y) > 1e5)
        violations.push(`P1 EXPLODE@${label}: (${j.x},${j.y})`);
    });
    if (s.converged) {
      for (const c of s.state.constraints) {
        if (c.isDriven || c.driven) continue;
        const res = residual(s, c);
        if (res > 0.03) violations.push(`P2 LIE@${label}: converged but ${c.type} residual=${res.toFixed(2)}`);
      }
      // P4 NO-REDUNDANT-DRIVER (rects, via the app placement path): top/bottom share ONE width, left/right
      // ONE height — each group may have at most 1 DRIVING dim. A 2nd surviving as a driver = a redundant
      // reference re-promoted (the Root1 app-placement bug). Only catchable because placeDim drives the real
      // dimension-tool step — this is the invariant the fuzzer was BLIND to before.
      if (shape.wEdges) {
        const grp = (es) => es.reduce((n, [a, b]) => n + s.drivingDistanceCount(a, b), 0);
        if (grp(shape.wEdges) > 1) violations.push(`P4 REDUNDANT-DRIVER@${label}: ${grp(shape.wEdges)} width drivers (redundant reference re-promoted)`);
        if (grp(shape.hEdges) > 1) violations.push(`P4 REDUNDANT-DRIVER@${label}: ${grp(shape.hEdges)} height drivers (redundant reference re-promoted)`);
      }
    } else if (committed && !s.lastError) {
      violations.push(`P3 SILENT@${label}: not converged after a committed op but NO error shown`);
    }
  };
  check('build', true);

  const K = ri(5, 12);
  for (let k = 0; k < K && violations.length === 0; k++) {
    const choice = ri(0, 10);
    if (choice <= 1) {                                // DIMENSION an edge (consistent or new) — varied dims
      const [name, a, b] = E[ri(0, E.length - 1)];
      const cur = s.edgeLen(a, b);
      const val = ri(0, 1) ? Math.round(cur * 10) / 10 : ri(3, 16);
      const d = s.dimension(a, b, val); s.solve(); if (d) { placeDim(s, d, a, b); dims.push(d); }
      ops.push(`dim(${name},${val})`); check('dim', true);
    } else if (choice === 2) {                        // ADD H or V on an edge — a different constraint type
      const [name, a, b] = E[ri(0, E.length - 1)];
      const t = ri(0, 1) ? T.HORIZONTAL : T.VERTICAL;
      addCon(s, t, [a, b]); s.solve();
      ops.push(`${t === T.HORIZONTAL ? 'horiz' : 'vert'}(${name})`); check('hv', true);
    } else if (choice === 3 && E.length >= 2) {       // EQUAL or PARALLEL between two edges
      const e1 = E[ri(0, E.length - 1)], e2 = E[ri(0, E.length - 1)];
      const t = ri(0, 1) ? T.EQUAL : T.PARALLEL;
      addCon(s, t, [e1[1], e1[2], e2[1], e2[2]]); s.solve();
      ops.push(`${t === T.EQUAL ? 'equal' : 'parallel'}`); check('eqpar', true);
    } else if (choice === 4) {                        // DRAG HARD — push/pull a joint a long way
      const j = D[ri(0, D.length - 1)]; const dx = ri(-15, 15), dy = ri(-15, 15);
      s.drag(j, dx, dy);
      ops.push(`drag(${dx},${dy})`); check('drag', false);
    } else if (choice === 5) {                        // PUSH-THEN-PULL — two hard drags
      const j = D[ri(0, D.length - 1)];
      s.drag(j, ri(-15, 15), ri(-15, 15)); s.drag(j, ri(-15, 15), ri(-15, 15));
      ops.push('pushpull'); check('pushpull', false);
    } else if (choice === 6) {                        // OVER-CONSTRAIN by editing a driver to a wild value
      const drv = dims.filter((d) => d && !s.isDriven(d));
      if (drv.length) { const d = drv[ri(0, drv.length - 1)]; s.editValue(d, ri(1, 40)); ops.push('edit-wild'); check('edit', true); }
    } else if (choice === 7) {                        // OVER-CONSTRAIN by a conflicting dimension
      const [name, a, b] = E[ri(0, E.length - 1)];
      const val = Math.max(1, Math.round(s.edgeLen(a, b)) + ri(-9, 9));
      const d = s.dimension(a, b, val); s.solve(); if (d) { placeDim(s, d, a, b); dims.push(d); }
      ops.push(`dimX(${name},${val})`); check('dimX', true);
    } else if (choice === 8) {                        // TOGGLE a dim driver<->reference (real toggleDriving seam)
      if (dims.length) {
        const dim = dims[ri(0, dims.length - 1)];
        if (s.isDriven(dim)) s.setDriving(dim); else s.setReference(dim);
        s.solve();
        ops.push('toggle'); check('toggle', true);
      }
    } else if (choice === 9 && D.length >= 2) {       // COINCIDENT two joints (structural — may collapse an edge)
      let i = ri(0, D.length - 1), j = ri(0, D.length - 1); if (j === i) j = (j + 1) % D.length;
      addCon(s, T.COINCIDENT, [D[i], D[j]]); s.solve();
      ops.push('coincident'); check('coincident', true);
    } else if (E.length >= 1) {                        // MIDPOINT: a fresh point = midpoint of an edge (bidirectional)
      const [, a, b] = E[ri(0, E.length - 1)]; const M = s.point(ri(-6, 16), ri(-6, 16), false);
      addCon(s, T.MIDPOINT, [a, b, M]); s.solve(); ops.push('midpoint'); check('midpoint', true);
    }
  }
  return { seed, shape: shape.name, ops, violations };
}

const N = Number(process.argv[2]) || 150;
console.log(`\n====== SOLVER FUZZER  (${N} sims · 4 shapes · REAL app paths: placement/edit/toggle · adversarial) ======`);
const buckets = {};
const shapeFail = {};
for (let seed = 1; seed <= N; seed++) {
  const r = fuzzOne(seed);
  if (!r.violations.length) continue;
  const base = r.shape.replace(/[0-9(].*$/, '');
  shapeFail[base] = (shapeFail[base] || 0) + 1;
  const v = r.violations[0];
  let kind = 'OTHER';
  if (v.startsWith('P1')) kind = 'EXPLODE (NaN / runaway)';
  else if (v.startsWith('P2')) kind = 'DEFORM (converged but a constraint is violated)';
  else if (v.startsWith('P3')) kind = 'OVER-CONSTRAIN not reverted (mangled, no error)';
  else if (v.startsWith('P4')) kind = 'REDUNDANT-DRIVER (app placement re-promoted a reference)';
  if (!buckets[kind]) buckets[kind] = { count: 0, repro: r };
  buckets[kind].count++;
}
const failed = Object.values(buckets).reduce((a, b) => a + b.count, 0);
if (failed === 0) {
  console.log(`  ${N}/${N} clean — every shape survives varied constraints + drag-hard + over-constrain with NO silent deform.`);
} else {
  console.log(`  ${failed}/${N} sims broke an invariant. By failure mode (worst first):\n`);
  for (const [kind, b] of Object.entries(buckets).sort((a, c) => c[1].count - a[1].count)) {
    console.log(`  ▸ ${b.count.toString().padStart(3)} ×  ${kind}`);
    console.log(`           e.g. seed ${b.repro.seed} [${b.repro.shape}]: ${b.repro.ops.join(' → ')}`);
    console.log(`                ✗ ${b.repro.violations[0]}`);
  }
  console.log(`\n  failures by base shape: ${Object.entries(shapeFail).map(([k, n]) => `${k}=${n}`).join('  ')}`);
}
console.log('\n  P1 explode · P2 deform · P3 over-constrain-never-silent · P4 redundant-driver(app placement)  ·  4 shapes');
console.log('==========================================================================================================\n');
process.exit(0);
