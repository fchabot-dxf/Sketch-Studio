// AUTOMATED solver fuzzer — runs a few hundred sims so bugs surface WITHOUT hand-drawing.
// Every sketch is built with the REAL RECT TOOL (s.rect → makeRectFromTwoJoints → ConstraintManager,
// the exact rect-tool.js path — never a hand-assembled rect), then exercised with VARIED constraints +
// dimensions (edge dims · diagonal dims · equal→square) and adversarial ops (drag hard · push/pull ·
// over-constrain by edit and by conflicting dimension). Three universal invariants are checked after
// EVERY step:
//   P1 NO-EXPLODE   every joint stays finite + bounded (no NaN / runaway).
//   P2 NO-LIE       if the solver reports `converged`, EVERY non-driven constraint is ACTUALLY satisfied
//                   (any type). This is the universal "never silently deform" check — for a plain rect it
//                   means it stays a rectangle; for a rect+equal it stays a square; for any constraint set
//                   it means the geometry matches what the constraints demand.
//   P3 NEVER-SILENT after a committed op (dimension / constraint / edit) the sketch is converged OR an
//                   error was shown — it is never left silently non-converged / mangled.
// Seeded PRNG ⇒ any failure prints a replayable {seed, ops} to promote into solver-scenarios.
// Reporter (exits 0) — a bug-finder board, not a gate.

import { createSketch } from './sketch.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { CONSTRAINT_TYPES as T } from '#core/constants.js';

// deterministic PRNG (mulberry32) — a failing seed replays the exact sketch.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// geometric residual per constraint type (mirrors solver/definitions.js) — the ground-truth check.
function residual(s, c) {
  const J = c.joints || [];
  if (J.length < 2) return 0;
  const p = (i) => s.pos(J[i]);
  const sub = (u, v) => ({ x: u.x - v.x, y: u.y - v.y });
  const len = (u) => Math.hypot(u.x, u.y);
  switch (c.type) {
    case T.HORIZONTAL: return Math.abs(p(0).y - p(1).y);
    case T.VERTICAL: return Math.abs(p(0).x - p(1).x);
    case T.COINCIDENT: return len(sub(p(0), p(1)));
    case T.DISTANCE: return Math.abs(len(sub(p(1), p(0))) - (Number(c.value) || 0));
    case T.EQUAL: { if (J.length < 4) return 0; return Math.abs(len(sub(p(0), p(1))) - len(sub(p(2), p(3)))); }
    case T.PARALLEL: { if (J.length < 4) return 0; const u = sub(p(1), p(0)), v = sub(p(3), p(2)); const d = (len(u) * len(v)) || 1e-9; return Math.abs((u.x * v.y - u.y * v.x) / d); }
    case T.PERPENDICULAR: { if (J.length < 4) return 0; const u = sub(p(1), p(0)), v = sub(p(3), p(2)); const d = (len(u) * len(v)) || 1e-9; return Math.abs((u.x * v.x + u.y * v.y) / d); }
    default: return 0; // types the fuzzer doesn't generate
  }
}

const addCon = (s, type, joints, extra = {}) => ConstraintManager.createConstraint(s.state, type, { joints: [...joints], ...extra }, { source: 'fuzz' });

function fuzzOne(seed) {
  const rand = rng(seed);
  const ri = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  const s = createSketch();
  const ops = [];
  const dims = [];

  // ── build with the REAL RECT TOOL (no hand-drawn rect) ──
  const w = ri(4, 16), h = ri(4, 16);
  const r = s.rect(0, 0, w, h);
  ops.push(`rectTool(${w}x${h})`);
  const [c1, c2, c3, c4] = r.corners;
  const edgeList = [['top', c1, c2], ['bottom', c4, c3], ['left', c1, c4], ['right', c2, c3]];
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
    } else if (committed && !s.lastError) {
      violations.push(`P3 SILENT@${label}: not converged after a committed op but NO error shown`);
    }
  };
  check('build', true);

  const K = ri(5, 12);
  for (let k = 0; k < K && violations.length === 0; k++) {
    const choice = ri(0, 7);
    if (choice <= 1) {                              // DIMENSION an edge (consistent or a new value) — varied dims
      const [name, a, b] = edgeList[ri(0, 3)];
      const cur = s.edgeLen(a, b);
      const val = ri(0, 1) ? Math.round(cur * 10) / 10 : ri(3, 16);
      const d = s.dimension(a, b, val); s.solve(); if (d) dims.push(d);
      ops.push(`dim(${name},${val})`); check(`dim(${name})`, true);
    } else if (choice === 2) {                      // DIAGONAL dimension — a different distance
      const val = Math.round(s.edgeLen(c1, c3));
      const d = s.dimension(c1, c3, val); s.solve(); if (d) dims.push(d);
      ops.push(`diag(${val})`); check('diag', true);
    } else if (choice === 3) {                      // EQUAL two edges — a different constraint type (→ square)
      addCon(s, T.EQUAL, [c1, c2, c2, c3]); s.solve();
      ops.push('equal(top,right)'); check('equal', true);
    } else if (choice === 4) {                      // DRAG HARD — push/pull a corner a long way
      const corner = r.corners[ri(0, 3)]; const dx = ri(-15, 15), dy = ri(-15, 15);
      s.drag(corner, dx, dy);
      ops.push(`drag(${dx},${dy})`); check('drag', false);
    } else if (choice === 5) {                      // PUSH-THEN-PULL — two hard drags
      const corner = r.corners[ri(0, 3)];
      s.drag(corner, ri(-15, 15), ri(-15, 15)); s.drag(corner, ri(-15, 15), ri(-15, 15));
      ops.push('pushpull'); check('pushpull', false);
    } else if (choice === 6) {                      // OVER-CONSTRAIN by editing a driver to a wild value
      const drv = dims.filter(d => d && !s.isDriven(d));
      if (drv.length) { const d = drv[ri(0, drv.length - 1)]; const val = ri(1, 40); s.editValue(d, val); ops.push(`edit(${val})`); check('edit', true); }
    } else {                                        // OVER-CONSTRAIN by a conflicting dimension on a parallel edge
      const [name, a, b] = edgeList[ri(0, 3)];
      const val = Math.max(1, Math.round(s.edgeLen(a, b)) + ri(-9, 9));
      const d = s.dimension(a, b, val); s.solve(); if (d) dims.push(d);
      ops.push(`dimX(${name},${val})`); check('dimX', true);
    }
  }
  return { seed, ops, violations };
}

const N = Number(process.argv[2]) || 150;
console.log(`\n====== SOLVER FUZZER  (${N} sims · rect TOOL · varied constraints+dims · drag-hard · over-constrain) ======`);
const buckets = {};
for (let seed = 1; seed <= N; seed++) {
  const r = fuzzOne(seed);
  if (!r.violations.length) continue;
  const v = r.violations[0];
  let kind = 'OTHER';
  if (v.startsWith('P1')) kind = 'EXPLODE (NaN / runaway)';
  else if (v.startsWith('P2')) kind = 'DEFORM (converged but a constraint is violated)';
  else if (v.startsWith('P3')) kind = 'OVER-CONSTRAIN not reverted (mangled, no error)';
  if (!buckets[kind]) buckets[kind] = { count: 0, repro: r };
  buckets[kind].count++;
}
const failed = Object.values(buckets).reduce((a, b) => a + b.count, 0);
if (failed === 0) {
  console.log(`  ${N}/${N} clean — every sim survives varied constraints + drag-hard + over-constrain with NO silent deform.`);
} else {
  console.log(`  ${failed}/${N} sims broke an invariant. By failure mode (worst first):\n`);
  for (const [kind, b] of Object.entries(buckets).sort((a, c) => c[1].count - a[1].count)) {
    console.log(`  ▸ ${b.count.toString().padStart(3)} ×  ${kind}`);
    console.log(`           e.g. seed ${b.repro.seed}: ${b.repro.ops.join(' → ')}`);
    console.log(`                ✗ ${b.repro.violations[0]}`);
  }
}
console.log('\n  P1 explode · P2 deform(no-lie, all constraint types) · P3 over-constrain-never-silent');
console.log('================================================================================================\n');
process.exit(0);
