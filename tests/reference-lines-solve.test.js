// tests/reference-lines-solve.test.js - TASK 539: the two axes are built-in REFERENCE LINES a constraint can name (ref_axis_x / ref_axis_y):
// parallel / perpendicular / collinear / point-on-line / distance / angle / tangent solve against them, they are in no document container,
// a constraint on an axis survives save / load, and the 537 horizontal / vertical-with-origin constraints are untouched.
(async () => {
  const { createEngine } = await import('#core/constraint-solver.js');
  const { ConstraintManager } = await import('#core/constraint-manager.js');
  const { CONSTRAINT_TYPES: T, TOOL_MODES, AXIS_SNAP_TARGETS } = await import('#core/constants.js');
  const R = await import('#core/reference-lines.js');
  const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };
  const near = (a, b, m, tol = 1e-3) => assert(Math.abs(a - b) < tol, `${m}: ${a} !== ${b}`);
  const AX = AXIS_SNAP_TARGETS['axis-x'].shapeId, AY = AXIS_SNAP_TARGETS['axis-y'].shapeId;
  assert(AX === 'ref_axis_x' && AY === 'ref_axis_y', 'the declared ids');

  const mk = () => {
    const engine = createEngine(null); engine.init();
    const state = { joints: engine.getJoints(), shapes: engine.getShapes(), constraints: engine.getConstraints(), engine, genJ: engine.genJ };
    const pt = (x, y) => { const id = engine.genJ(); engine.addJoint(id, x, y, false); return id; };
    const line = (x1, y1, x2, y2) => { const a = pt(x1, y1), b = pt(x2, y2), id = 'L_' + a + '_' + b; engine.addShape({ id, type: 'line', joints: [a, b] }); return { id, a, b }; };
    const add = (type, p) => ConstraintManager.createConstraint(state, type, p, { source: 'test' });
    const solve = () => engine.solve(200);
    const p = (id) => state.joints.get(id);
    return { engine, state, pt, line, add, solve, p };
  };

  // not document geometry
  { const s = mk(); s.line(10, 10, 60, 30);
    assert(s.state.shapes.length === 1 && !s.state.shapes.some(x => x.reference), 'no reference shape in state.shapes');
    assert(![...s.state.joints.keys()].some(k => R.isReferenceJointId(k)), 'no reference joint in state.joints'); }

  // parallel to each axis
  for (const [ax, dirOK] of [[AX, (a, b) => Math.abs(a.y - b.y) < 1e-3], [AY, (a, b) => Math.abs(a.x - b.x) < 1e-3]]) {
    const s = mk(); const L = s.line(10, 10, 60, 30);
    assert(s.add(T.PARALLEL, { shapes: [L.id, ax] }), 'parallel to ' + ax + ' is created');
    s.solve(); assert(dirOK(s.p(L.a), s.p(L.b)), 'parallel to ' + ax + ' solved: ' + JSON.stringify([s.p(L.a), s.p(L.b)]));
  }
  // perpendicular
  { const s = mk(); const L = s.line(10, 10, 60, 30);
    assert(s.add(T.PERPENDICULAR, { shapes: [L.id, AX] }), 'perpendicular created'); s.solve();
    near(s.p(L.a).x, s.p(L.b).x, 'perpendicular to the X axis = vertical'); }
  { const s = mk(); const L = s.line(10, 10, 60, 30);
    assert(s.add(T.PERPENDICULAR, { shapes: [AY, L.id] }), 'perpendicular (axis first) created'); s.solve();
    near(s.p(L.a).y, s.p(L.b).y, 'perpendicular to the Y axis = horizontal'); }
  // collinear: the line lies ON the axis
  { const s = mk(); const L = s.line(10, 10, 60, 30);
    assert(s.add(T.COLLINEAR, { shapes: [L.id, AX] }), 'collinear created'); s.solve();
    near(s.p(L.a).y, 0, 'collinear a.y'); near(s.p(L.b).y, 0, 'collinear b.y'); }
  // point on an axis (endless: far outside the unit segment)
  { const s = mk(); const a = s.pt(350, 120);
    assert(s.add(T.POINT_ON_LINE, { joint: a, shape: AX }), 'point-on-axis created'); s.solve();
    near(s.p(a).y, 0, 'point on the X axis: y = 0'); near(s.p(a).x, 350, 'x stays free (not clamped to the unit segment)', 1); }
  { const s = mk(); const a = s.pt(40, -250);
    assert(s.add(T.POINT_ON_LINE, { joint: a, shape: AY }), 'point-on-Y-axis created'); s.solve();
    near(s.p(a).x, 0, 'point on the Y axis: x = 0'); near(s.p(a).y, -250, 'y stays free', 1); }
  // distance from a parallel line to an axis
  { const s = mk(); const L = s.line(10, 10, 60, 10);
    assert(s.add(T.PARALLEL, { shapes: [L.id, AX] }), 'parallel');
    assert(s.add(T.DISTANCE, { shapes: [AX, L.id], value: 25 }), 'distance axis-line created'); s.solve();
    near(Math.abs(s.p(L.a).y), 25, 'line 25 from the X axis'); near(Math.abs(s.p(L.b).y), 25, 'both ends'); }
  // angle between a line and an axis
  { const s = mk(); const L = s.line(10, 10, 60, 20);
    assert(s.add(T.ANGLE, { shapes: [AX, L.id], value: 30 }), 'angle to an axis created'); s.solve();
    const a = s.p(L.a), b = s.p(L.b); const ang = Math.abs(Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI);
    assert(Math.abs(ang - 30) < 0.05 || Math.abs(ang - 150) < 0.05, 'angle 30 to the X axis, got ' + ang); }
  // tangent: a circle tangent to an axis
  { const s = mk(); const c = s.pt(100, 70); const rimId = s.pt(130, 70);
    s.engine.addShape({ id: 'C1', type: 'circle', joints: [c, rimId], radius: 30 });
    assert(s.add(T.TANGENT, { line: AX, circle: 'C1' }), 'tangent to an axis created'); s.solve();
    near(Math.abs(s.p(c).y), s.state.shapes.find(x => x.id === 'C1').radius, 'circle tangent to the X axis: |cy| = r', 0.05); }

  // save / load: the constraint stores the reserved id, nothing else is saved for the axis
  { const s = mk(); const L = s.line(10, 10, 60, 30); s.add(T.PARALLEL, { shapes: [L.id, AX] }); s.solve();
    const c = s.state.constraints.find(x => x.type === T.PARALLEL);
    assert(JSON.stringify(c.shapes) === JSON.stringify([L.id, AX]), 'stored as the reserved id: ' + JSON.stringify(c));
    const json = JSON.parse(JSON.stringify(s.state.constraints));
    assert(json[0].shapes[1] === AX && R.constraintReferencesAxis(json[0]), 'survives JSON');
    assert(!JSON.stringify([...s.state.joints.entries()]).includes('j_ref'), 'no reserved joint saved'); }

  // an old file: the 537 form (horizontal with j_origin) is still valid and solves
  { const s = mk(); const a = s.pt(30, 40); s.add(T.HORIZONTAL, { joints: [a, 'j_origin'] }); s.solve(); near(s.p(a).y, 0, '537 constraint untouched'); }

  // the picking rule
  for (const t of [TOOL_MODES.PARALLEL, TOOL_MODES.PERPENDICULAR, TOOL_MODES.COLLINEAR, TOOL_MODES.TANGENT, TOOL_MODES.COINCIDENT]) assert(R.referenceLinesPickable({ currentTool: t }), t + ' asks for a target');
  for (const t of [TOOL_MODES.SELECT, TOOL_MODES.PAN, TOOL_MODES.LINE, TOOL_MODES.RECT, TOOL_MODES.CIRCLE, TOOL_MODES.ARC, TOOL_MODES.HORIZONTAL_VERTICAL, TOOL_MODES.EQUAL, TOOL_MODES.MIDPOINT, TOOL_MODES.DIMENSION, TOOL_MODES.TRIM, TOOL_MODES.BREAK]) assert(!R.referenceLinesPickable({ currentTool: t }), t + ' never sees an axis');
  { const st = { currentTool: TOOL_MODES.SELECT, shapes: [{ id: 'a' }] };
    assert(R.pickableShapes(st) === st.shapes, 'select: the real shapes, untouched');
    st.currentTool = TOOL_MODES.PARALLEL;
    const ps = R.pickableShapes(st); assert(ps.length === 3 && ps[0].id === 'a' && ps[1].id === AX && ps[2].id === AY, 'parallel: real first, axes last'); }
  console.log('reference-lines-solve OK');
})().catch(e => { console.error(e); process.exit(1); });
