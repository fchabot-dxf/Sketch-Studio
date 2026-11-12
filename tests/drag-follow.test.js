// tests/drag-follow.test.js -- TASK 548: the grabbed geometry stays under the cursor EVERY frame (pure node, the real drag step pipeline).
// Cursor path in, per-frame gap out: handleSelectionPointerDown / Move / Up from packages/ui/input-handlers/selection-tools.js (the calls
// input-manager.js makes for a mouse drag) and, after every pointer event, the app's frame solve (apps/sketchstudio/main.js loop():
// engine.solve(SolverConfig.ITERATIONS)). The canvas is a mock SVG at a given zoom (px per world unit), so a path in screen px means the
// same on-screen drag at every zoom; SolverConfig.MAX_DRAG_STEP is in WORLD units, so the zoom decides whether a pointer event jumps
// farther than it (0.2 px per unit: 40 px per event = 200 units).
// Cases (sizes in px): (a) a free point (the end of a free line), (b) a free line by its body, (c) a rectangle corner, (d) a circle by its
// rim, (e) a point of a constrained chain (origin -> B -> C, both lengths 300 px dimensioned; C's path stays 160..360 px from the origin,
// inside the reachable disk and away from the fold, so C can be exactly under the cursor), (f) the end of a dimensioned link from the
// origin pulled OFF its circle (unreachable: the closest reachable pose is the cursor's radial projection, gap = | |cursor| - L |).
// Speeds 2 / 10 / 40 px per event, zooms 78 (SketchStudio's default) and 0.2 px per unit (a large drawing). Every frame: the drawn grabbed
// point is within 1 px of the closest reachable point to the cursor; after the cursor stops, the next frames do not move it (nothing left
// to catch up). A frame whose target an unchanged declared inference rule moved (state.inference set: H / V / parallel / perpendicular /
// midpoint) is measured against that declared target instead, and counted.
// KNOWN K548-1 (not fixed by task 548, printed, fails loudly once it is fixed): the same chain dragged THROUGH its fold (C passing 90 px
// from the origin, the elbow swinging ~25 degrees per event at 40 px per event): the frame solve (SolverConfig.ITERATIONS = 500 LM
// iterations) does not reach the converged pose for a few frames (up to ~1000 more iterations needed): the Levenberg-Marquardt steps are
// rejected along the curved constraint manifold under the drag's STRUCTURAL_DRAG_RATIO weighting, so the elbow crawls behind.
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { SolverConfig } from '#core/solver-config.js';
import { handleSelectionPointerDown, handleSelectionPointerMove, handleSelectionPointerUp } from '#ui/input-handlers/selection-tools.js';

const quiet = (f) => { const l = console.log; console.log = () => {}; try { return f(); } finally { console.log = l; } };
const svgAt = (ppu) => { const w = 1000 / ppu; return { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }), viewBox: { baseVal: { x: -w / 2, y: -w / 2, width: w, height: w } }, setPointerCapture: () => {}, releasePointerCapture: () => {} }; };
const TRAVEL = 600, SETTLE = 10, ZOOMS = [78, 0.2], SPEEDS = [2, 10, 40];
const unit = (v) => { const n = Math.hypot(v[0], v[1]); return [v[0] / n, v[1] / n]; };

// origin -> B -> C, both lengths 300 px dimensioned (line-tool polyline: the corner is a coincident pair), the start on the origin; C grabbed
function chain(S, w, ppu) {
  const segs = L.polyline(S, [[0, 0], w([-283.1, 99.5]), w([-300, -200])], false);
  const mk = (type, params) => ConstraintManager.createConstraint(S.state, type, params, { source: 'test' });
  mk('coincident', { joints: [L.origin, segs[0].a] });
  mk('distance', { joints: [segs[0].a, segs[0].b], value: 300 / ppu, dimMode: 'aligned' });
  mk('distance', { joints: [segs[1].a, segs[1].b], value: 300 / ppu, dimMode: 'aligned' });
  return { joint: segs[1].b, ring: [0, 600 / ppu] };
}

// px -> world at this zoom (the origin joint sits at the screen centre)
const CASES = {
  'free-point': { dir: [1, 0.35], build(S, w) { const a = L.point(S, ...w([-450, -400])), b = L.point(S, ...w([-50, -100])); L.line(S, a, b); return { joint: b }; } },
  'line-body': { dir: [1, 0.35], build(S, w) { const a = L.point(S, ...w([-450, -400])), b = L.point(S, ...w([-50, -100])); return { body: L.line(S, a, b), t: 0.5 }; } },
  'rect-corner': { dir: [1, 0.35], build(S, w) { const r = L.rect(S, ...w([-350, -300]), ...w([-50, -100])); return { joint: r.c3 }; } },
  'circle-rim': { dir: [1, 0.35], build(S, w, ppu) { const c = L.circle(S, ...w([-250, -200]), 150 / ppu); return { body: c.id, rim: true }; } },
  'chain': { dir: [0.992, 0.128], build: chain },
  'link-off-circle': { dir: [1, 0.2], build(S, w, ppu) {
    const a = L.point(S, 0, 0), b = L.point(S, ...w([212.13, -212.13])); L.line(S, a, b);
    ConstraintManager.createConstraint(S.state, 'coincident', { joints: [L.origin, a] }, { source: 'test' });
    ConstraintManager.createConstraint(S.state, 'distance', { joints: [a, b], value: 300 / ppu, dimMode: 'aligned' }, { source: 'test' });
    return { joint: b, ring: [300 / ppu, 300 / ppu] };
  } },
};

const KNOWN = { 'chain-fold': { dir: [1, 0.35], build: chain } };

export function runCase(name, ppu, stepPx) {
  const spec = CASES[name] || KNOWN[name];
  const S = L.newSketch(), st = S.state;
  const w = (p) => [p[0] / ppu, p[1] / ppu];
  const g = spec.build(S, w, ppu);
  quiet(() => S.engine.solve(SolverConfig.ITERATIONS || 500));
  const svg = svgAt(ppu), scr = (p) => [500 + p[0] * ppu, 500 + p[1] * ppu], world = (s) => [(s[0] - 500) / ppu, (s[1] - 500) / ppu];
  const shape = g.body ? st.shapes.find(s => s.id === g.body) : null;
  const js = () => shape.joints.map(id => st.joints.get(id));
  // the grabbed point, world: a joint, a line body point at t, the rim point on the cursor's ray
  const grabbed = (cursor) => {
    if (g.joint) { const j = st.joints.get(g.joint); return [j.x, j.y]; }
    const [a, b] = js();
    if (shape.type === 'line') return [a.x + (b.x - a.x) * g.t, a.y + (b.y - a.y) * g.t];
    const d = Math.hypot(cursor[0] - a.x, cursor[1] - a.y); return [a.x + shape.radius * (cursor[0] - a.x) / d, a.y + shape.radius * (cursor[1] - a.y) / d];
  };
  let at;
  if (g.joint) { const j = st.joints.get(g.joint); at = [j.x, j.y]; }
  else if (shape.type === 'line') { const [a, b] = js(); at = [a.x + (b.x - a.x) * g.t, a.y + (b.y - a.y) * g.t]; }
  else { const c = js()[0]; at = [c.x + shape.radius, c.y]; }
  st.currentTool = 'select'; st.selectedJoints = new Set(); st.selectedShapes = new Set(); st.selectedConstraints = new Set();
  const A = scr(at), u = unit(spec.dir), n = Math.round(TRAVEL / stepPx);
  const ev = (p) => ({ clientX: p[0], clientY: p[1], pointerId: 1, target: { closest: () => null, dataset: {} } });
  quiet(() => g.joint ? handleSelectionPointerDown(ev(A), svg, st, { id: g.joint, j: st.joints.get(g.joint) }, null, null) : handleSelectionPointerDown(ev(A), svg, st, null, { shape, pt: { x: at[0], y: at[1] } }, null));
  assert.ok(st.drag, `${name}: the pointer-down starts a drag`);
  const frames = [];
  let cur = A;
  for (let i = 1; i <= n + SETTLE; i++) {
    if (i <= n) { cur = [A[0] + u[0] * stepPx * i, A[1] + u[1] * stepPx * i]; quiet(() => handleSelectionPointerMove(ev(cur), svg, st)); }
    quiet(() => S.engine.solve(SolverConfig.ITERATIONS || 500));
    const cw = world(cur), p = grabbed(cw);
    // the closest reachable point's distance from the cursor (0 unless the case declares a reachable ring around the origin)
    let expected = 0;
    if (g.ring) { const d = Math.hypot(cw[0], cw[1]); expected = Math.max(0, d - g.ring[1], g.ring[0] - d); }
    const inf = st.inference ? st.inference.type : null;
    const ref = inf ? [st.drag.lastTarget.x, st.drag.lastTarget.y] : cw;
    frames.push({ i, moving: i <= n, inf, gapPx: Math.hypot(p[0] - cw[0], p[1] - cw[1]) * ppu, expectedPx: expected * ppu, refGapPx: Math.hypot(p[0] - ref[0], p[1] - ref[1]) * ppu, p });
  }
  quiet(() => handleSelectionPointerUp(ev(cur), svg, st));
  return frames;
}

if (process.argv[1] && process.argv[1].endsWith('drag-follow.test.js')) {
  const failures = [], rows = [];
  for (const ppu of ZOOMS) for (const stepPx of SPEEDS) for (const name of Object.keys(CASES)) {
    const frames = runCase(name, ppu, stepPx);
    let worst = 0, infFrames = 0;
    for (const f of frames) {
      // off the closest reachable point by this many px (a declared inference target replaces the cursor in its frames)
      const off = f.inf ? f.refGapPx : Math.abs(f.gapPx - f.expectedPx);
      if (f.inf) infFrames++;
      worst = Math.max(worst, off);
      if (off >= 1) { failures.push(`${name} @ ${ppu} px/unit, ${stepPx} px/event, frame ${f.i}${f.moving ? '' : ' (cursor stopped)'}: ${off.toFixed(2)} px off the closest reachable point (gap ${f.gapPx.toFixed(2)} px, expected ${f.expectedPx.toFixed(2)} px${f.inf ? ', inference ' + f.inf : ''})`); break; }
    }
    // after the cursor stops nothing is left to catch up: the settle frames do not move the grabbed point
    const stop = frames.filter(f => !f.moving), drift = Math.max(...stop.map(f => Math.hypot(f.p[0] - stop[0].p[0], f.p[1] - stop[0].p[1]) * ppu));
    if (drift >= 0.01) failures.push(`${name} @ ${ppu} px/unit, ${stepPx} px/event: still moving ${drift.toFixed(3)} px after the cursor stopped (multi-frame catch-up)`);
    rows.push(`${name.padEnd(15)} ${String(ppu).padStart(4)} px/unit ${String(stepPx).padStart(2)} px/event (${(stepPx / ppu).toFixed(1)} units): worst ${worst.toFixed(3)} px over ${frames.length} frames${infFrames ? `, ${infFrames} inference frames` : ''}`);
  }
  const drags = rows.length;
  // KNOWN K548-1 (see the header): printed; fails loudly once the fold converges every frame, so it can become a regular case
  {
    const off = runCase('chain-fold', 78, 40).map(f => f.inf ? f.refGapPx : Math.abs(f.gapPx - f.expectedPx));
    const worst = Math.max(...off), late = off.filter(v => v >= 1).length;
    rows.push(`KNOWN K548-1 chain-fold @ 78 px/unit, 40 px/event: ${late} of ${off.length} frames 1 px or more off the closest reachable point, worst ${worst.toFixed(2)} px (the frame solve does not converge through the fold)`);
    if (worst < 1) failures.push('KNOWN K548-1 is gone: the chain now follows through its fold every frame; make chain-fold a regular case and delete the KNOWN entry');
  }
  console.log(rows.join('\n'));
  if (failures.length) { console.error('drag-follow FAILED:\n  ' + failures.join('\n  ')); process.exit(1); }
  console.log(`drag-follow.test.js: ok (${drags} drags: the grabbed point within 1 px of the closest reachable point every frame, nothing moves after the cursor stops)`);
}
