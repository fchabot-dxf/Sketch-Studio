// SOLVER SCENARIO TESTER — seeds the harness (./sketch.js) with user-level scenarios, runs them
// against the REAL packages/core, and prints a backlog table labelling each CURRENT pass/fail
// HONESTLY. The 3 known bugs are expected to FAIL today; the table IS the solver fix backlog.
//
// This file is a REPORTER, not a gate: it always exits 0 (so it never adds a baseline failure).
// Fixes come later, one at a time, each guarded by re-running its scenario here.

import { createSketch } from './sketch.js';

const rows = [];
function record(name, pass, expected, nums) {
  rows.push({ name, pass, expected, nums });
}
function run(name, expected, fn) {
  try {
    const r = fn();
    record(name, !!r.pass, expected, r.nums || {});
  } catch (e) {
    record(name, false, expected, { ERROR: (e && e.message) ? e.message : String(e) });
  }
}
const f = (v) => (typeof v === 'number' ? (Math.abs(v) < 1e-4 ? '0' : v.toFixed(3)) : String(v));
const numsStr = (n) => Object.entries(n).map(([k, v]) => `${k}=${f(v)}`).join(' ');

// 1 — plain rect, drag a corner → still a rectangle (expect PASS)
run('1. plain rect + drag corner → isRectangle', 'PASS', () => {
  const s = createSketch();
  const r = s.rect(0, 0, 100, 60);
  s.solve();
  s.drag(r.j3, 40, 20);
  return { pass: s.isRectangle(r.corners), nums: { converged: s.converged, conflicts: s.conflicts.length } };
});

// 2 — rect + a dimension on an edge, drag a corner → still a rectangle (expect PASS — the drag fix)
run('2. dimensioned rect + drag corner → isRectangle', 'PASS', () => {
  const s = createSketch();
  const r = s.rect(0, 0, 100, 60);
  s.dimension(r.corners[0], r.corners[1], 100); // width dim on top edge
  s.solve();
  s.drag(r.j3, 40, 20);
  return { pass: s.isRectangle(r.corners), nums: { converged: s.converged, width: s.edgeLen(r.corners[0], r.corners[1]) } };
});

// 3 — over-constrain via an impossible dimension EDIT → must end as a valid, converged rect
//      (refuse+revert, or stay rectangular). Expect FAIL today (ERR-SOLVE-01 + geometry mangled).
run('3. over-constrain edit → stays a valid converged rect', 'FAIL(today)', () => {
  const s = createSketch();
  const r = s.rect(0, 0, 100, 60);
  s.dimension(r.corners[0], r.corners[1], 100);                 // width = 100 (driving)
  const diagNow = s.edgeLen(r.corners[0], r.corners[2]);
  const diag = s.dimension(r.corners[0], r.corners[2], diagNow); // diagonal (driving, independent)
  s.solve();
  s.editValue(diag, 50); // impossible: diagonal (50) < width (100) — triangle inequality
  const maxRes = s.conflicts.reduce((m, c) => Math.max(m, c.residual || 0), 0);
  return {
    pass: s.isRectangle(r.corners) && s.converged === true,
    nums: { converged: s.converged, isRect: s.isRectangle(r.corners), maxResidual: maxRes, lastError: s.lastError || 'none' },
  };
});

// 4 — dimension an already-dimensioned edge → no silent duplicate DRIVING distance.
//      Two distances on the same edge are only allowed by the code with different dimModes; a 2nd
//      same-mode one is dropped. Either way there must be exactly ONE driver (no 2nd silent driver).
//      Expect FAIL today.
run('4. dimension already-dimensioned edge → one driver', 'FAIL(today)', () => {
  const s = createSketch();
  const r = s.rect(0, 0, 100, 60);
  const before = s.constraintCount;
  const d1 = s.dimension(r.corners[0], r.corners[1], 100, { dimMode: 'horizontal' }); // D1 driving
  const d2 = s.dimension(r.corners[0], r.corners[1], 100, { dimMode: 'aligned' });    // 2nd dim, same edge
  const addedSecond = s.constraintCount - before === 2;
  const drivers = s.drivingDistanceCount(r.corners[0], r.corners[1]);
  return {
    pass: drivers === 1, // exactly one driving distance — the 2nd was rejected or made a reference
    nums: { drivers, secondAdded: addedSecond, d1driving: !s.isDriven(d1), d2reference: s.isDriven(d2), lastError: s.lastError || 'none' },
  };
});

// 5 — toggle a reference dim → driving, when it is the ONLY would-be driver → should succeed.
//      A single edge dimension, demoted to reference, then promoted back to driving (nothing else
//      drives that edge, so there is no real conflict). Expect FAIL today.
run('5. toggle reference→driving (only would-be driver)', 'FAIL(today)', () => {
  const s = createSketch();
  const r = s.rect(0, 0, 100, 60);
  const d1 = s.dimension(r.corners[0], r.corners[1], 100); // D1 driving (the only dim on this edge)
  s.setReference(d1);            // demote to reference
  const wasRef = s.isDriven(d1); // true
  const ok = s.setDriving(d1);   // promote back — it is the sole would-be driver
  return {
    pass: ok === true && s.isDriven(d1) === false && s.lastError === null && s.converged === true,
    nums: { wasReference: wasRef, toggleOk: ok, nowDriving: !s.isDriven(d1), converged: s.converged, lastError: s.lastError || 'none' },
  };
});

// BRIDGE — serialize → load → solve round-trip (proves s.load replays a real exported sketch)
run('bridge: serialize → load → solve round-trip', 'PASS', () => {
  const a = createSketch();
  const ra = a.rect(0, 0, 80, 50);
  a.dimension(ra.corners[0], ra.corners[1], 80);
  a.solve();
  const model = a.serialize();
  const b = createSketch();
  b.load(model);
  b.solve();
  return {
    pass: b.constraintCount === a.constraintCount && b.isRectangle(ra.corners),
    nums: { constraints: b.constraintCount, converged: b.converged, isRect: b.isRectangle(ra.corners) },
  };
});

// ── REPORT ────────────────────────────────────────────────────────────────────
const w = Math.max(...rows.map(r => r.name.length));
console.log('\n========================= SOLVER SCENARIO BACKLOG =========================');
console.log(`  ${'scenario'.padEnd(w)}  result  (expected)`);
console.log('  ' + '-'.repeat(w + 22));
for (const r of rows) {
  const tag = r.pass ? 'PASS ✅' : 'FAIL ❌';
  console.log(`  ${r.name.padEnd(w)}  ${tag}  (${r.expected})`);
  console.log(`  ${' '.repeat(w)}    └─ ${numsStr(r.nums)}`);
}
const failing = rows.filter(r => !r.pass).map(r => r.name);
console.log('  ' + '-'.repeat(w + 22));
console.log(`  ${rows.filter(r => r.pass).length}/${rows.length} pass. FIX BACKLOG (failing): ${failing.length ? failing.map(n => n.split('.')[0]).join(', ') : 'none'}`);
console.log('===========================================================================\n');

// Reporter: never fail the suite — the table above is the deliverable. (exit 0)
