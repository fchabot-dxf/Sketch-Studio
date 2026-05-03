// Comprehensive audit: feed every constraint type through the solver in the
// same shape that ConstraintManager.createConstraint persists, verify the
// solve actually moves geometry to satisfy the constraint.
//
// This is a TRIAGE test — failures are expected. Each one names a broken
// constraint type so we can fix them in one pass.

(async () => {
  const { createNewtonSolver } = await import('../src/core/solver/engine.js');

  const results = [];
  function run(name, build, verify) {
    try {
      const { joints, shapes, constraints } = build();
      const solver = createNewtonSolver(joints, constraints, shapes, { maxIter: 500, tol: 1e-6 });
      const result = solver.solve();
      const ok = verify(joints, shapes, constraints, result);
      results.push({ name, status: ok.pass ? 'PASS' : 'FAIL', detail: ok.detail, error: result.error });
    } catch (e) {
      results.push({ name, status: 'THROW', detail: String(e && e.message || e), error: NaN });
    }
  }

  function J(map) { const m = new Map(); for (const [id, j] of Object.entries(map)) m.set(id, j); return m; }

  // ── DISTANCE: joint pair ────────────────────────────────────────────
  run('distance(joints)', () => ({
    joints: J({ a: { x: 0, y: 0, fixed: true }, b: { x: 1, y: 0, fixed: false } }),
    shapes: [],
    constraints: [{ type: 'distance', joints: ['a','b'], value: 5 }]
  }), (joints) => {
    const d = Math.hypot(joints.get('b').x, joints.get('b').y);
    return { pass: Math.abs(d - 5) < 1e-3, detail: `dist=${d.toFixed(4)} (target 5)` };
  });

  // ── DISTANCE: radius on circle ──────────────────────────────────────
  run('distance(radius on circle)', () => ({
    joints: J({ c: { x: 0, y: 0, fixed: true }, r: { x: 1, y: 0, fixed: false } }),
    shapes: [{ id: 's1', type: 'circle', joints: ['c','r'] }],
    constraints: [{ type: 'distance', shape: 's1', isRadius: true, value: 7 }]
  }), (joints) => {
    const r = Math.hypot(joints.get('r').x, joints.get('r').y);
    return { pass: Math.abs(r - 7) < 1e-3, detail: `radius=${r.toFixed(4)} (target 7)` };
  });

  // ── DISTANCE: line-line (parallel-distance) ─────────────────────────
  run('distance(shapes line-line)', () => ({
    joints: J({
      a: { x: 0, y: 0, fixed: true }, b: { x: 10, y: 0, fixed: true },     // line 1 fixed
      c: { x: 0, y: 1, fixed: false }, d: { x: 10, y: 1, fixed: false }    // line 2 free, parallel, dist 1
    }),
    shapes: [
      { id: 's1', type: 'line', joints: ['a','b'] },
      { id: 's2', type: 'line', joints: ['c','d'] }
    ],
    constraints: [{ type: 'distance', shapes: ['s1','s2'], value: 5 }]
  }), (joints) => {
    const c = joints.get('c'), d = joints.get('d');
    // For two parallel horizontal lines, perpendicular distance = |c.y - 0|
    const sep = Math.abs(c.y);
    return { pass: Math.abs(sep - 5) < 1e-3, detail: `sep=${sep.toFixed(4)} (target 5)` };
  });

  // ── COINCIDENT ──────────────────────────────────────────────────────
  run('coincident', () => ({
    joints: J({ a: { x: 0, y: 0, fixed: true }, b: { x: 5, y: 5, fixed: false } }),
    shapes: [],
    constraints: [{ type: 'coincident', joints: ['a','b'] }]
  }), (joints) => {
    const b = joints.get('b');
    return { pass: Math.hypot(b.x, b.y) < 1e-3, detail: `b=(${b.x.toFixed(4)},${b.y.toFixed(4)})` };
  });

  // ── HORIZONTAL ──────────────────────────────────────────────────────
  run('horizontal', () => ({
    joints: J({ a: { x: 0, y: 0, fixed: true }, b: { x: 10, y: 5, fixed: false } }),
    shapes: [],
    constraints: [{ type: 'horizontal', joints: ['a','b'] }]
  }), (joints) => {
    const b = joints.get('b');
    return { pass: Math.abs(b.y) < 1e-3, detail: `b.y=${b.y.toFixed(4)}` };
  });

  // ── VERTICAL ────────────────────────────────────────────────────────
  run('vertical', () => ({
    joints: J({ a: { x: 0, y: 0, fixed: true }, b: { x: 5, y: 10, fixed: false } }),
    shapes: [],
    constraints: [{ type: 'vertical', joints: ['a','b'] }]
  }), (joints) => {
    const b = joints.get('b');
    return { pass: Math.abs(b.x) < 1e-3, detail: `b.x=${b.x.toFixed(4)}` };
  });

  // ── POINT_ON_LINE ───────────────────────────────────────────────────
  run('point_on_line', () => ({
    joints: J({
      a: { x: 0, y: 0, fixed: true }, b: { x: 10, y: 0, fixed: true },     // line along x-axis
      p: { x: 5, y: 3, fixed: false }
    }),
    shapes: [{ id: 's1', type: 'line', joints: ['a','b'] }],
    constraints: [{ type: 'pointOnLine', joint: 'p', shape: 's1' }]
  }), (joints) => {
    const p = joints.get('p');
    return { pass: Math.abs(p.y) < 1e-3, detail: `p.y=${p.y.toFixed(4)} (should be 0)` };
  });

  // ── PARALLEL (shapes) ───────────────────────────────────────────────
  run('parallel(shapes)', () => ({
    joints: J({
      a: { x: 0, y: 0, fixed: true }, b: { x: 10, y: 0, fixed: true },     // line 1: along +x
      c: { x: 0, y: 5, fixed: false }, d: { x: 10, y: 8, fixed: false }    // line 2: tilted
    }),
    shapes: [
      { id: 's1', type: 'line', joints: ['a','b'] },
      { id: 's2', type: 'line', joints: ['c','d'] }
    ],
    constraints: [{ type: 'parallel', shapes: ['s1','s2'] }]
  }), (joints) => {
    const c = joints.get('c'), d = joints.get('d');
    // line 2 should be horizontal too → c.y should equal d.y
    const dy = Math.abs(d.y - c.y);
    return { pass: dy < 1e-3, detail: `Δy=${dy.toFixed(4)} (parallel to horizontal: should be 0)` };
  });

  // ── PERPENDICULAR (shapes) ──────────────────────────────────────────
  run('perpendicular(shapes)', () => ({
    joints: J({
      a: { x: 0, y: 0, fixed: true }, b: { x: 10, y: 0, fixed: true },     // line 1: +x
      c: { x: 5, y: 0, fixed: true }, d: { x: 10, y: 5, fixed: false }     // line 2: tilted
    }),
    shapes: [
      { id: 's1', type: 'line', joints: ['a','b'] },
      { id: 's2', type: 'line', joints: ['c','d'] }
    ],
    constraints: [{ type: 'perpendicular', shapes: ['s1','s2'] }]
  }), (joints) => {
    const c = joints.get('c'), d = joints.get('d');
    const ux = 10, uy = 0;
    const vx = d.x - c.x, vy = d.y - c.y;
    const dot = ux * vx + uy * vy;
    const lenU = Math.hypot(ux, uy), lenV = Math.hypot(vx, vy);
    const relDot = Math.abs(dot) / (lenU * lenV);
    return { pass: relDot < 1e-3, detail: `cos(θ)=${relDot.toFixed(6)}` };
  });

  // ── COLLINEAR (joints) ──────────────────────────────────────────────
  run('collinear(joints)', () => ({
    joints: J({
      a: { x: 0, y: 0, fixed: true }, b: { x: 10, y: 0, fixed: true },
      c: { x: 5, y: 4, fixed: false }
    }),
    shapes: [],
    constraints: [{ type: 'collinear', joints: ['a','b','c'] }]
  }), (joints) => {
    const c = joints.get('c');
    return { pass: Math.abs(c.y) < 1e-3, detail: `c.y=${c.y.toFixed(4)}` };
  });

  // ── COLLINEAR (shapes) ──────────────────────────────────────────────
  run('collinear(shapes)', () => ({
    joints: J({
      a: { x: 0, y: 0, fixed: true }, b: { x: 10, y: 0, fixed: true },     // line 1 fixed
      c: { x: 0, y: 3, fixed: false }, d: { x: 10, y: 3, fixed: false }    // line 2 parallel offset
    }),
    shapes: [
      { id: 's1', type: 'line', joints: ['a','b'] },
      { id: 's2', type: 'line', joints: ['c','d'] }
    ],
    constraints: [{ type: 'collinear', shapes: ['s1','s2'] }]
  }), (joints) => {
    const c = joints.get('c'), d = joints.get('d');
    return { pass: Math.abs(c.y) < 1e-3 && Math.abs(d.y) < 1e-3, detail: `c.y=${c.y.toFixed(4)} d.y=${d.y.toFixed(4)}` };
  });

  // ── TANGENT (circle-circle via shapes) ──────────────────────────────
  run('tangent(circle-circle, shapes)', () => ({
    joints: J({
      c1: { x: 0, y: 0, fixed: true }, r1: { x: 5, y: 0, fixed: true },     // circle 1: r=5 fixed
      c2: { x: 20, y: 0, fixed: false }, r2: { x: 23, y: 0, fixed: true }   // circle 2: r=3, c2 free
    }),
    shapes: [
      { id: 's1', type: 'circle', joints: ['c1','r1'] },
      { id: 's2', type: 'circle', joints: ['c2','r2'] }
    ],
    constraints: [{ type: 'tangent', shapes: ['s1','s2'] }]
  }), (joints) => {
    const c2 = joints.get('c2'), r2 = joints.get('r2');
    const dist = Math.hypot(c2.x, c2.y);
    const r2v = Math.hypot(r2.x - c2.x, r2.y - c2.y);
    // External target = 5 + r2v; internal target = |5 - r2v|
    const ext = 5 + r2v, int_ = Math.abs(5 - r2v);
    const ok = Math.abs(dist - ext) < 1e-3 || Math.abs(dist - int_) < 1e-3;
    return { pass: ok, detail: `dist=${dist.toFixed(4)} ext=${ext.toFixed(4)} int=${int_.toFixed(4)}` };
  });

  // ── TANGENT (line-circle via {line, circle}) ────────────────────────
  // This is the form the UI tool produces for line+circle clicks.
  run('tangent(line-circle, {line,circle})', () => ({
    joints: J({
      a: { x: 0, y: 0, fixed: true }, b: { x: 10, y: 0, fixed: true },     // line along x-axis (fixed)
      c: { x: 5, y: 3, fixed: false }, r: { x: 5, y: 5, fixed: true }      // circle r=2, center free above line
    }),
    shapes: [
      { id: 's_line', type: 'line', joints: ['a','b'] },
      { id: 's_circ', type: 'circle', joints: ['c','r'] }
    ],
    constraints: [{ type: 'tangent', line: 's_line', circle: 's_circ' }]
  }), (joints) => {
    const c = joints.get('c'), r = joints.get('r');
    const radius = Math.hypot(r.x - c.x, r.y - c.y);
    // Distance from center to x-axis is |c.y|; tangent requires it = radius.
    const distToLine = Math.abs(c.y);
    return { pass: Math.abs(distToLine - radius) < 1e-3, detail: `dist-to-line=${distToLine.toFixed(4)} radius=${radius.toFixed(4)}` };
  });

  // ── EQUAL (lines via shapes) ────────────────────────────────────────
  run('equal(lines, shapes)', () => ({
    joints: J({
      a: { x: 0, y: 0, fixed: true }, b: { x: 10, y: 0, fixed: true },     // line 1 length 10 fixed
      c: { x: 0, y: 5, fixed: true }, d: { x: 4, y: 5, fixed: false }      // line 2 length 4
    }),
    shapes: [
      { id: 's1', type: 'line', joints: ['a','b'] },
      { id: 's2', type: 'line', joints: ['c','d'] }
    ],
    constraints: [{ type: 'equal', shapes: ['s1','s2'] }]
  }), (joints) => {
    const c = joints.get('c'), d = joints.get('d');
    const len2 = Math.hypot(d.x - c.x, d.y - c.y);
    return { pass: Math.abs(len2 - 10) < 1e-3, detail: `len2=${len2.toFixed(4)} (target 10)` };
  });

  // ── EQUAL (circles via shapes) ──────────────────────────────────────
  run('equal(circles, shapes)', () => ({
    joints: J({
      c1: { x: 0, y: 0, fixed: true }, r1: { x: 5, y: 0, fixed: true },     // circle 1 r=5 fixed
      c2: { x: 10, y: 0, fixed: true }, r2: { x: 12, y: 0, fixed: false }   // circle 2 r=2
    }),
    shapes: [
      { id: 's1', type: 'circle', joints: ['c1','r1'] },
      { id: 's2', type: 'circle', joints: ['c2','r2'] }
    ],
    constraints: [{ type: 'equal', shapes: ['s1','s2'] }]
  }), (joints) => {
    const c2 = joints.get('c2'), r2 = joints.get('r2');
    const r2v = Math.hypot(r2.x - c2.x, r2.y - c2.y);
    return { pass: Math.abs(r2v - 5) < 1e-3, detail: `r2=${r2v.toFixed(4)} (target 5)` };
  });

  // ── MIDPOINT ────────────────────────────────────────────────────────
  run('midpoint', () => ({
    joints: J({
      a: { x: 0, y: 0, fixed: true }, b: { x: 10, y: 0, fixed: true },
      m: { x: 3, y: 2, fixed: false }                                       // should land at (5, 0)
    }),
    shapes: [],
    constraints: [{ type: 'midpoint', joints: ['a','b','m'] }]
  }), (joints) => {
    const m = joints.get('m');
    return { pass: Math.abs(m.x - 5) < 1e-3 && Math.abs(m.y) < 1e-3, detail: `m=(${m.x.toFixed(4)},${m.y.toFixed(4)})` };
  });

  // ── ANGLE ───────────────────────────────────────────────────────────
  run('angle(shapes, value=90°)', () => ({
    joints: J({
      a: { x: 0, y: 0, fixed: true }, b: { x: 10, y: 0, fixed: true },     // line 1: +x
      c: { x: 5, y: 0, fixed: true }, d: { x: 10, y: 5, fixed: false }     // line 2: 45°
    }),
    shapes: [
      { id: 's1', type: 'line', joints: ['a','b'] },
      { id: 's2', type: 'line', joints: ['c','d'] }
    ],
    constraints: [{ type: 'angle', shapes: ['s1','s2'], value: 90 }]
  }), (joints) => {
    const c = joints.get('c'), d = joints.get('d');
    const ux = 10, uy = 0;
    const vx = d.x - c.x, vy = d.y - c.y;
    const dot = ux * vx + uy * vy;
    const cos = dot / (Math.hypot(ux, uy) * Math.hypot(vx, vy));
    return { pass: Math.abs(cos) < 1e-3, detail: `cos(θ)=${cos.toFixed(6)} (90° expects 0)` };
  });

  // ── REPORT ──────────────────────────────────────────────────────────
  console.log('\n=== Constraint audit ===');
  let passed = 0, failed = 0, threw = 0;
  for (const r of results) {
    const tag = r.status === 'PASS' ? '✅' : (r.status === 'THROW' ? '💥' : '❌');
    console.log(`${tag} ${r.status.padEnd(5)} ${r.name.padEnd(40)} ${r.detail}  [error=${typeof r.error === 'number' ? r.error.toExponential(2) : r.error}]`);
    if (r.status === 'PASS') passed++;
    else if (r.status === 'THROW') threw++;
    else failed++;
  }
  console.log(`\n${passed} passed, ${failed} failed, ${threw} threw, ${results.length} total.`);
  if (failed > 0 || threw > 0) {
    console.log('Audit found broken constraints — see ❌/💥 lines above.');
    process.exit(1);
  }
})().catch(e => { console.error('audit harness failed:', e); process.exit(1); });
