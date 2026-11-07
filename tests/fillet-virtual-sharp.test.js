// TURN 402: a dimension at a filleted corner keeps meaning the SHARP corner (virtual-sharp joint V,
// two `mutual` pointOnLine constraints), so editing the fillet radius never changes the overall size.
globalThis.document = globalThis.document || { getElementById: () => null };
(async () => {
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const { createEngine } = await import('#core/constraint-solver.js');
  const { createSketchState } = await import('#ui/sketch-state.js');
  const { ConstraintManager } = await import('#core/constraint-manager.js');
  const { makeRectFromTwoJoints } = await import('#core/shapes.js');
  const { CONSTRAINT_TYPES } = await import('#core/constants.js');
  const { findCornerAtPoint, applyFillet } = await import('#core/fillet.js');
  const { commitDimensionEdit } = await import('#ui/dimension-seams.js');
  const { findLoops } = await import('#core/loop-finder.js');
  const { deleteShapes } = await import('#core/delete-manager.js');

  function build(W = 60, H = 40) {
    const engine = createEngine(null); engine.init();
    const state = createSketchState(engine, { x: 0, y: 0, w: 120, h: 90 });
    const c1 = engine.genJ(); engine.addJoint(c1, 0, 0, true);
    const c3 = engine.genJ(); engine.addJoint(c3, W, H, false);
    const b = makeRectFromTwoJoints(state.joints, c1, c3, engine.genJ);
    for (const s of b.shapes) engine.addShape(s);
    for (const c of b.constraints) ConstraintManager.createConstraint(state, c.type, c, { source: 'rect' });
    const hs = state.constraints.filter(c => c.type === 'horizontal'), vs = state.constraints.filter(c => c.type === 'vertical');
    const bot = hs[1].joints, ver = vs[1].joints;
    ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, { joints: [bot[0], bot[1]], value: W }, { source: 'dim' });
    ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, { joints: ver.slice(), value: H }, { source: 'dim' });
    ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, { joints: [c1, c3], value: Math.hypot(W, H) }, { source: 'dim' });
    engine.solve(500);
    return { engine, state, c1, c3 };
  }
  const radiusOf = (state, arc) => { const [c, p] = arc.joints.map(j => state.joints.get(j)); return Math.hypot(p.x - c.x, p.y - c.y); };
  const measures = (state) => state.constraints.filter(c => c.type === 'distance' && !c.isRadius && c.joints);

  // ---- 60x40, width/height/diagonal dims; fillet the (60,40)-ish corner; edit R 8 -> 12, 20, 5
  {
    const { engine, state } = build();
    const before = measures(state).map(c => c.value);
    const corner = findCornerAtPoint(state, { x: 60, y: 40 }, 5);
    const res = applyFillet(state, corner, 8);
    assert(res.success && res.virtualSharp, 'fillet applies and reports V');
    const V = state.joints.get(res.virtualSharp);
    assert(V && V.virtualSharp === true, 'V exists as a flagged bare joint');
    assert(!state.shapes.some(s => (s.joints || []).includes(res.virtualSharp)), 'V is not on any shape');
    assert(res.arc.filletSharp === res.virtualSharp, 'arc remembers its virtual sharp');
    assert(state.constraints.filter(c => c.type === 'pointOnLine' && c.joint === res.virtualSharp && c.mutual).length === 2, 'two mutual pointOnLine on V');
    assert(JSON.stringify(measures(state).map(c => c.value)) === JSON.stringify(before), 'measurement values are KEPT (not shrunk by d)');
    assert(measures(state).some(c => c.joints.includes(res.virtualSharp)), 'a measurement dim is relinked to V');
    let sr = engine.solve(500);
    assert(sr.converged !== false && !sr.rankDeficient, 'converged, not rank deficient after fillet');
    const rd = state.constraints.find(c => c.isRadius);
    for (const R2 of [12, 20, 5]) {
      const e = commitDimensionEdit(state, rd, R2);
      assert(!e.reverted, `R -> ${R2} must be accepted`);
      sr = engine.solve(500);
      assert(sr.converged !== false && !sr.rankDeficient, `R -> ${R2}: converged, not rank deficient`);
      assert(Math.abs(radiusOf(state, res.arc) - R2) < 1e-4, `arc radius ${R2}`);
      const v = state.joints.get(res.virtualSharp);
      assert(Math.abs(v.x - 60) < 1e-3 && Math.abs(v.y - 40) < 1e-3, `V stays at the sharp corner (60,40), got ${v.x},${v.y}`);
      const now = measures(state).map(c => c.value);
      assert(JSON.stringify(now) === JSON.stringify(before), 'dim values never change');
    }
    assert(findLoops(state).length === 1, 'still exactly one loop (V has no shape)');
  }

  // ---- non-90 degree corner with a dimension at it
  {
    const engine = createEngine(null); engine.init();
    const state = createSketchState(engine, { x: 0, y: 0, w: 120, h: 90 });
    const J = (x, y, pin = false) => { const id = engine.genJ(); engine.addJoint(id, x, y, pin); return id; };
    const A = J(0, 0, true), P = J(40, 0), B = J(60, Math.sqrt(3) * 20);
    for (const s of [{ id: 'L1', type: 'line', joints: [A, P] }, { id: 'L2', type: 'line', joints: [P, B] }]) engine.addShape(s);
    ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.HORIZONTAL, { joints: [A, P] }, { source: 't' });
    ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, { joints: [A, P], value: 40 }, { source: 'dim' });
    engine.solve(500);
    const corner = findCornerAtPoint(state, { x: 40, y: 0 }, 3);
    assert(corner, 'non-90 corner found');
    const res = applyFillet(state, corner, 6);
    assert(res.success, 'non-90 fillet applies');
    const dimA = state.constraints.find(c => c.type === 'distance' && !c.isRadius && c.joints.includes(A) && c.joints.includes(res.virtualSharp));
    assert(dimA && dimA.value === 40, 'A-P dim relinked to V with value 40 kept');
    const rd = state.constraints.find(c => c.isRadius);
    for (const R2 of [3, 9]) {
      const e = commitDimensionEdit(state, rd, R2);
      assert(!e.reverted, `non-90 R -> ${R2} accepted`);
      const v = state.joints.get(res.virtualSharp), a = state.joints.get(A);
      assert(Math.abs(Math.hypot(v.x - a.x, v.y - a.y) - 40) < 1e-3, `A-V stays 40 at R ${R2}`);
      assert(Math.abs(radiusOf(state, res.arc) - R2) < 1e-4, `non-90 arc radius ${R2}`);
    }
  }

  // ---- TURN 403: oversized radii, seeded edits, no clamp (V must never move on the pinned 60x40)
  {
    const atCorner = (state, res) => { const v = state.joints.get(res.virtualSharp); return Math.abs(v.x - 60) < 1e-3 && Math.abs(v.y - 40) < 1e-3; };
    const setup = (R0) => { const b = build(); const res = applyFillet(b.state, findCornerAtPoint(b.state, { x: 60, y: 40 }, 5), R0); b.engine.solve(500); b.res = res; return b; };
    const edit = (b, R2) => { const e = commitDimensionEdit(b.state, b.state.constraints.find(c => c.isRadius), R2); const sr = b.engine.solve(500); return { e, sr }; };

    // a fresh oversized fillet applies unclamped and holds
    for (const R0 of [50, 100, 200]) {
      const b = setup(R0);
      assert(b.res.success && b.res.radius === R0, `R${R0} applied unclamped`);
      assert(atCorner(b.state, b.res) && Math.abs(radiusOf(b.state, b.res.arc) - R0) < 1e-4, `R${R0} converged with V at the corner`);
    }
    // the orderings that used to land in the zero-length trap
    for (const [R0, R2] of [[50, 70], [50, 100], [8, 100], [200, 8], [8, 200], [100, 8], [50, 8], [8, 50]]) {
      const b = setup(R0);
      const { e, sr } = edit(b, R2);
      assert(!e.reverted, `${R0} -> ${R2} must be accepted (${e.reason || ''})`);
      assert(sr.converged !== false && !sr.rankDeficient, `${R0} -> ${R2}: converged, not rank deficient`);
      assert(atCorner(b.state, b.res), `${R0} -> ${R2}: V stays at the corner`);
      assert(Math.abs(radiusOf(b.state, b.res.arc) - R2) < 1e-4, `${R0} -> ${R2}: arc radius`);
    }
    // the exact singular values are refused with a message, and nothing changes
    for (const Rbad of [40, 60]) {
      const b = setup(8);
      const before = JSON.stringify([...b.state.joints.entries()].map(([k, j]) => [k, +j.x.toFixed(6), +j.y.toFixed(6)]));
      const { e } = edit(b, Rbad);
      assert(e.reverted === true && /collapse a line to zero length/.test(e.reason || ''), `R${Rbad} refused with the collapse message`);
      const after = JSON.stringify([...b.state.joints.entries()].map(([k, j]) => [k, +j.x.toFixed(6), +j.y.toFixed(6)]));
      assert(before === after, `R${Rbad} refusal leaves the geometry untouched`);
    }
    // property: random radius sequences never move V and always converge
    let seed = 987654321; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let trial = 0; trial < 12; trial++) {
      const b = setup(5 + rnd() * 30);
      for (let k = 0; k < 12; k++) {
        let R2 = 1 + rnd() * 199;
        if (Math.abs(R2 - 40) < 0.05 || Math.abs(R2 - 60) < 0.05) R2 += 0.5; // stay off the exact singular values
        const { e, sr } = edit(b, R2);
        assert(!e.reverted, `property: R ${R2.toFixed(3)} accepted (trial ${trial}, step ${k}): ${e.reason || ''}`);
        assert(sr.converged !== false, `property: converged at R ${R2.toFixed(3)}`);
        assert(atCorner(b.state, b.res), `property: V moved at R ${R2.toFixed(3)} (trial ${trial}, step ${k})`);
        assert(Math.abs(radiusOf(b.state, b.res.arc) - R2) < 1e-3, `property: radius ${R2.toFixed(3)}`);
      }
    }
  }

  // (The `mutual` Jacobian is covered at solver level in packages/core/tests/solver-point-on-line-mutual.test.js;
  //  since 403 a radius edit seeds the analytic geometry, so it no longer DEPENDS on the flag to converge.)

  // ---- undo/redo and serialization keep V; deleting the arc leaves V + open lines (Fusion parity)
  {
    const { state } = build();
    const corner = findCornerAtPoint(state, { x: 60, y: 40 }, 5);
    state.saveState();
    applyFillet(state, corner, 8);
    const hasV = () => [...state.joints.values()].some(j => j.virtualSharp);
    assert(hasV(), 'V present after fillet');
    state.undo(); assert(!hasV(), 'undo removes V with the fillet');
    state.redo(); assert(hasV() && state.shapes.some(s => s.filletSharp), 'redo restores V and the arc marker');
    const clone = JSON.parse(JSON.stringify({ joints: [...state.joints.entries()], shapes: state.shapes, constraints: state.constraints }));
    assert(clone.joints.some(([, j]) => j.virtualSharp) && clone.shapes.some(s => s.filletSharp) && clone.constraints.some(c => c.mutual), 'virtualSharp / filletSharp / mutual survive serialization');
    const arc = state.shapes.find(s => s.type === 'arc');
    deleteShapes(state, [arc.id]);
    assert(hasV() && state.constraints.filter(c => c.mutual).length === 2, 'deleting the arc leaves V and its two constraints (gap stays open, like Fusion)');
    assert(state.shapes.filter(s => s.type === 'line').length === 4, 'the four lines survive');
  }
  console.log('fillet-virtual-sharp test passed ✅');
})().catch(e => { console.error('fillet-virtual-sharp test failed ❌', e.message); process.exit(1); });
