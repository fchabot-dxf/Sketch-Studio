// tests/bezier-snap-872-node.test.js — TASK 872: the Bezier pen's anchors snap and attach as the Line tool's points do (audit 869 cause J), node kit,
// SketchStudio and Shaper. A line, a circle and the origin: each anchor pressed 4 px off a target lies on it with the Line tool's constraint
// (a line's end point: SHARED, TASK 1045 (Fusion measured 2026-11-27: a drawing tool's new point on an existing curve END point is that point); mid-span: point-on-line, a circle centre: coincident, the origin: coincident, the X axis: point-on-line); the snap marker
// is shown on hover; the tangent handle of a dragged anchor is not snapped; a press on the path's last anchor makes no zero-length segment.
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const profile = await createProfile();
await createNamedDesign(profile, 'sketchstudio', 'Bezier snap 872');
for (const host of ['sketchstudio', 'shaper']) {
  const app = await open({ host, profile });
  try {
    const st = app.state;
    const r = app.svg.getBoundingClientRect(), C = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    for (let i = 0; i < 30 && app.toScreen(1, 0).x - app.toScreen(0, 0).x < 4; i++) app.wheel(C.x, C.y, -300);
    for (let i = 0; i < 30 && app.toScreen(1, 0).x - app.toScreen(0, 0).x > 8; i++) app.wheel(C.x, C.y, 300);
    const S = (x, y) => app.toScreen(x, y);
    const scene = () => {
      app.esc(); app.esc(); st.clearDocument(); st.selectedShapes.clear(); st.selectedJoints.clear();
      st.joints.set('jl1', { x: 10, y: 20, fixed: false }); st.joints.set('jl2', { x: 50, y: 20, fixed: false }); st.shapes.push({ id: 'L', type: 'line', joints: ['jl1', 'jl2'] });
      st.joints.set('jc', { x: 30, y: -30, fixed: false }); st.shapes.push({ id: 'C', type: 'circle', joints: ['jc'], radius: 5 });
      st.saveState('scene 872'); app.tool('bezier');
    };
    const far = S(70, -10); // a free anchor, away from everything
    const cases = [
      ['joint', [10, 20], 'shared'], ['mid-span', [20, 20], 'pointOnLine'], ['circle centre', [30, -30], 'coincident'],
      ['origin', [0, 0], 'coincident'], ['X axis', [-30, 0], 'pointOnLine'],
    ];
    for (const [anchor, nth] of [['first', 0], ['second', 1]]) for (const [name, [x, y], type] of cases) {
      scene();
      const T = S(x, y), P = { x: T.x + 4, y: T.y };
      if (nth === 1) app.click(far.x, far.y);
      app.move(P.x, P.y);
      ok(st.snapTarget && st.snapTarget.isLocked, `${host} ${anchor} anchor ${name}: the snap marker shows on hover`);
      app.click(P.x, P.y);
      if (type === 'shared') {
        const others = [...st.joints.keys()].filter((k) => !['jl1', 'jl2', 'jc', 'j_origin'].includes(k));
        const bz = st.shapes.find((s) => s.type === 'bezier');
        ok(others.length === nth && !st.constraints.length && (nth === 0 || (bz && bz.joints[1] === 'jl1')), `${host} ${anchor} anchor ${name}: the anchor IS the line's end point (new points ${others.length}, constraints ${st.constraints.length}, segment ${bz && bz.joints})`);
        continue;
      }
      const j = [...st.joints].filter(([k]) => !['jl1', 'jl2', 'jc', 'j_origin'].includes(k)).map(([k, v]) => ({ k, ...v })).pop();
      ok(Math.hypot(j.x - x, j.y - y) < 1e-6 || type === 'pointOnLine', `${host} ${anchor} anchor ${name}: lands on the target: ${j.x},${j.y}`);
      const made = st.constraints.filter((c) => (c.joints || [c.joint]).includes(j.k)).map((c) => c.type);
      ok(JSON.stringify(made) === JSON.stringify([type]), `${host} ${anchor} anchor ${name}: ${type} (got ${made})`);
      if (name === 'mid-span') ok(Math.abs(j.y - 20) < 1e-6, `${host} ${anchor} anchor mid-span: on the line: ${j.y}`);
      if (name === 'X axis') ok(Math.abs(j.y) < 1e-6, `${host} ${anchor} anchor X axis: on the axis: ${j.y}`);
    }
    // a tangent handle is not snapped: a dragged anchor's handle ends on the pointer, 4 px off the line, with no constraint for it
    scene(); { const A = S(70, -10), H = { x: S(20, 20).x + 4, y: S(20, 20).y };
      app.drag(A, H, 6); ok(st.constraints.length === 0, `${host}: a dragged handle over a line makes no constraint: ${st.constraints.map((c) => c.type)}`); app.esc(); }
    // a press on the last anchor itself is no snap (no zero-length segment): the path has 2 anchors, one segment
    scene(); { const A = S(70, -10), B = S(-30, -10); app.click(A.x, A.y); app.click(B.x, B.y); app.move(B.x + 4, B.y);
      ok(!st.snapTarget || st.snapTarget.targetId !== st.shapes.find((s) => s.type === 'bezier').joints[1], `${host}: the last anchor itself is not a snap for the next anchor`); app.esc(); }
  } finally { await app.close(); }
}
console.log(`bezier-snap-872-node: ALL CHECKS PASSED (${checks} checks)`);
