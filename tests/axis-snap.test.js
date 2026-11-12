// tests/axis-snap.test.js - TASK 537: snap to the X axis (y = 0) and the Y axis (x = 0).
// findSnap returns 'axis-x' / 'axis-y' inside AXIS_PX (screen px, so at every zoom), below every real target and above the
// bare grid; applySnapConstraint turns it into the existing horizontal / vertical constraint with j_origin; AXIS_SNAP off = none.
(async () => {
  const { findSnap } = await import('#ui/snap-detection.js');
  const { applySnapConstraint } = await import('#core/snap-constraints.js');
  const { SNAP, CONSTRAINT_TYPES, AXIS_SNAP_TARGETS } = await import('#core/constants.js');
  const SettingsManager = (await import('#core/settings-manager.js')).default;
  const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };
  const near = (a, b, m) => assert(Math.abs(a - b) < 1e-9, `${m}: ${a} !== ${b}`);

  // a 1000 x 800 px canvas whose centre is the world origin; `zoom` = screen px per world unit
  const mkSvg = (zoom) => ({
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 800 }),
    viewBox: { baseVal: { x: -500 / zoom, y: -400 / zoom, width: 1000 / zoom, height: 800 / zoom } },
    clientWidth: 1000, clientHeight: 800,
  });
  const mkJoints = () => new Map([['j_origin', { x: 0, y: 0, fixed: true }]]);
  const find = (joints, shapes, svg, m, ...rest) => findSnap(joints, shapes, svg, m, ...rest);

  assert(SettingsManager.get('AXIS_SNAP') === true, 'AXIS_SNAP defaults to ON');
  assert(AXIS_SNAP_TARGETS['axis-x'].constraint === CONSTRAINT_TYPES.HORIZONTAL && AXIS_SNAP_TARGETS['axis-x'].across === 'y', 'axis-x = horizontal, pins y');
  assert(AXIS_SNAP_TARGETS['axis-y'].constraint === CONSTRAINT_TYPES.VERTICAL && AXIS_SNAP_TARGETS['axis-y'].across === 'x', 'axis-y = vertical, pins x');

  // inside the radius and not outside, at several zooms (the radius is in SCREEN px)
  for (const zoom of [0.25, 1, 4, 20]) {
    const svg = mkSvg(zoom), joints = mkJoints();
    const inX = find(joints, [], svg, { x: 600, y: 400 + (SNAP.AXIS_PX - 1) });
    assert(inX && inX.type === 'axis-x', `zoom ${zoom}: ${SNAP.AXIS_PX - 1}px below the X axis snaps to it`);
    near(inX.pt.y, 0, `zoom ${zoom} axis-x pt.y`); near(inX.pt.x, 100 / zoom, `zoom ${zoom} axis-x pt.x (free along the axis)`);
    assert(find(joints, [], svg, { x: 600, y: 400 + SNAP.AXIS_PX + 1 }) === null, `zoom ${zoom}: outside the radius = no snap`);
    assert(find(joints, [], svg, { x: 600, y: 400 - (SNAP.AXIS_PX + 1) }) === null, `zoom ${zoom}: outside above = no snap`);
    const inY = find(joints, [], svg, { x: 500 - (SNAP.AXIS_PX - 1), y: 500 });
    assert(inY && inY.type === 'axis-y', `zoom ${zoom}: near the Y axis snaps to it`);
    near(inY.pt.x, 0, `zoom ${zoom} axis-y pt.x`); near(inY.pt.y, 100 / zoom, `zoom ${zoom} axis-y pt.y (free along)`);
    assert(find(joints, [], svg, { x: 500 + SNAP.AXIS_PX + 1, y: 500 }) === null, `zoom ${zoom}: outside the Y radius = no snap`);
  }

  // priority: a real target beats the axis; the origin wins inside its radius
  const svg = mkSvg(1);
  {
    const joints = mkJoints(); joints.set('p1', { x: 100, y: 5 });
    const r = find(joints, [], svg, { x: 600, y: 410 });
    assert(r && r.type === 'joint' && r.targetId === 'p1', 'an endpoint near the axis beats the axis, got ' + JSON.stringify(r));
    const r2 = find(mkJoints(), [], svg, { x: 510, y: 405 });
    assert(r2 && r2.type === 'joint' && r2.targetId === 'j_origin', 'inside the origin radius the origin wins, got ' + JSON.stringify(r2));
    const j3 = mkJoints(); j3.set('a', { x: 100, y: -100 }); j3.set('b', { x: 100, y: 100 });
    const r3 = find(j3, [{ id: 'sv', type: 'line', joints: ['a', 'b'] }], svg, { x: 603, y: 408 });
    assert(r3 && r3.type === 'shape' && r3.targetId === 'sv', 'a line crossing the axis beats the axis, got ' + JSON.stringify(r3));
    const j4 = mkJoints(); j4.set('a', { x: 100, y: -50 }); j4.set('b', { x: 100, y: 50 });
    const r4 = find(j4, [{ id: 'sv', type: 'line', joints: ['a', 'b'] }], svg, { x: 600, y: 405 });
    assert(r4 && (r4.type === 'midpoint' || r4.type === 'shape'), 'a line midpoint on the axis beats the axis, got ' + JSON.stringify(r4));
    const j5 = mkJoints(); j5.set('a', { x: 300, y: -300 }); j5.set('b', { x: 300, y: -200 });
    const r5 = find(j5, [{ id: 'sv', type: 'line', joints: ['a', 'b'] }], svg, { x: 600, y: 410 });
    assert(r5 && r5.type === 'axis-x', 'with no real target near, the axis snaps');
  }

  // a point far from both axes snaps exactly as before, with the setting on or off
  {
    const joints = mkJoints(); joints.set('a', { x: 100, y: 100 }); joints.set('b', { x: 200, y: 100 });
    const shapes = [{ id: 's1', type: 'line', joints: ['a', 'b'] }];
    const probes = [{ x: 600, y: 500 }, { x: 650, y: 505 }, { x: 700, y: 520 }, { x: 800, y: 700 }, { x: 640, y: 470 }, { x: 300, y: 300 }, { x: 650, y: 500 }];
    const on = probes.map((m) => JSON.stringify(find(joints, shapes, svg, m)));
    SettingsManager.set('AXIS_SNAP', false, { persist: 'session' });
    const off = probes.map((m) => JSON.stringify(find(joints, shapes, svg, m)));
    SettingsManager.set('AXIS_SNAP', true, { persist: 'session' });
    assert(JSON.stringify(on) === JSON.stringify(off), 'away from the axes the result is identical with the setting on or off');
    assert(on.some((s) => s !== 'null'), 'the probe set does hit real snaps (so the comparison is not vacuous)');
  }

  // setting off = no axis snap
  {
    const joints = mkJoints();
    assert(find(joints, [], svg, { x: 600, y: 405 }).type === 'axis-x', 'on: snaps');
    SettingsManager.set('AXIS_SNAP', false, { persist: 'session' });
    assert(find(joints, [], svg, { x: 600, y: 405 }) === null, 'off: no axis snap');
    SettingsManager.set('AXIS_SNAP', true, { persist: 'session' });
    assert(find(joints, [], svg, { x: 600, y: 405 }, [], true) === null, 'excludeLineSnap = no axis snap');
  }

  // a host without the origin joint does not snap to axes it does not have
  assert(find(new Map(), [], svg, { x: 600, y: 405 }) === null, 'no j_origin = no axis snap');
  assert(find(mkJoints(), [], svg, { x: 600, y: 405 }, ['j_origin']) === null, 'origin excluded = no axis snap');

  // applySnapConstraint: the existing H / V constraint with the origin, through the normal path
  {
    const mkState = () => { const joints = mkJoints(); joints.set('p', { x: 120, y: 0.3 }); joints.set('q', { x: 5, y: 90 }); return { joints, shapes: [], constraints: [] }; };
    let st = mkState();
    assert(applySnapConstraint(st, 'p', { type: 'axis-x', pt: { x: 120, y: 0 } }, {}) === true, 'axis-x snap creates a constraint');
    assert(st.constraints.length === 1 && st.constraints[0].type === CONSTRAINT_TYPES.HORIZONTAL && st.constraints[0].joints.includes('p') && st.constraints[0].joints.includes('j_origin'), 'horizontal with j_origin: ' + JSON.stringify(st.constraints));
    applySnapConstraint(st, 'p', { type: 'axis-x', pt: { x: 120, y: 0 } }, {});
    assert(st.constraints.filter((c) => c.type === CONSTRAINT_TYPES.HORIZONTAL).length === 1, 'no duplicate constraint');
    st = mkState();
    assert(applySnapConstraint(st, 'q', { type: 'axis-y', pt: { x: 0, y: 90 } }, {}) === true, 'axis-y snap creates a constraint');
    assert(st.constraints.length === 1 && st.constraints[0].type === CONSTRAINT_TYPES.VERTICAL && st.constraints[0].joints.includes('q') && st.constraints[0].joints.includes('j_origin'), 'vertical with j_origin');
    // refusal: q is already held vertical to the origin; also holding it horizontal would pin it onto the origin: refused, nothing added
    st = mkState();
    applySnapConstraint(st, 'q', { type: 'axis-y', pt: { x: 0, y: 90 } }, {});
    const n = st.constraints.length;
    const refused = applySnapConstraint(st, 'q', { type: 'axis-x', pt: { x: 0, y: 0 } }, {});
    assert(refused === false && st.constraints.length === n, 'a conflicting axis snap is refused and adds nothing; got ' + refused);
    assert(applySnapConstraint(st, 'j_origin', { type: 'axis-x' }, {}) === false, 'the origin is not snapped to its own axis');
    assert(applySnapConstraint({ joints: new Map([['p', { x: 1, y: 1 }]]), shapes: [], constraints: [] }, 'p', { type: 'axis-x' }, {}) === false, 'no origin = nothing');
  }

  // every snapping tool reaches the axis through the shared path (findSnap via the input manager, applySnapConstraint for the
  // constraint); none has its own snapping copy. The bezier pen does not snap at all (its own header says so): it gets no axis snap.
  {
    const fs = await import('node:fs');
    const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    const tools = { line: 'line-tool', rect: 'rect-tool', circle: 'circle-tool', arc: 'arc-tool', polygon: 'polygon-tool', 'select (joint drag)': 'selection-tools' };
    for (const [name, file] of Object.entries(tools)) {
      const src = read('packages/ui/input-handlers/' + file + '.js');
      assert(/applySnapConstraint\s*\(/.test(src), name + ' tool applies its snap through applySnapConstraint');
      assert(!/axis-x|axis-y|y\s*=\s*0.*snap|snap.*\.y\s*=\s*0/.test(src.replace(/\/\/.*$/gm, '')), name + ' tool has no axis snapping of its own');
    }
    const input = read('packages/ui/input-manager.js');
    assert(/findSnap\s*\(/.test(input), 'the input manager snaps through findSnap');
    assert(!/applySnapConstraint|findSnap/.test(read('packages/ui/input-handlers/bezier-tool.js').replace(/\/\/.*$/gm, '')), 'the bezier pen does not snap (no axis snap, no snapping copy)');
    // the declaration is read in exactly these places
    for (const f of ['packages/ui/snap-detection.js', 'packages/core/snap-constraints.js', 'packages/ui/svg-renderer.js', 'packages/ui/input-manager.js', 'packages/ui/input-handlers/selection-tools.js']) assert(/AXIS_SNAP_TARGETS/.test(read(f)), f + ' reads the axis declaration');
  }

  console.log('axis-snap tests passed');
})().catch((e) => { console.error('axis-snap tests failed', e); process.exit(1); });
