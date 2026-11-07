(async () => {
  const { createNewtonSolver } = await import('#core/solver/engine.js');
  const { makeRectFromTwoJoints } = await import('#core/shapes.js');
  const { findCornerAtPoint, applyFillet } = await import('#core/fillet.js');
  const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };

  // Helper to clone joints map
  function cloneJoints(joints) {
    const m = new Map();
    for (const [k, v] of joints.entries()) {
      m.set(k, { ...v });
    }
    return m;
  }

  // Helper to deep clone shapes
  function cloneShapes(shapes) {
    return shapes.map(s => ({ ...s, joints: s.joints ? [...s.joints] : undefined }));
  }

  console.log('Testing (a): line+circle shapes form [circle, line] and [line, circle]');
  {
    // Circle at (0, 0), radius = 10 (rim at (10, 0)), center and rim fixed.
    // Line from (-20, 15) to (20, 15).
    const makeSetup = (tangentConstraint) => {
      const joints = new Map();
      joints.set('c', { x: 0, y: 0, fixed: true });
      joints.set('r', { x: 10, y: 0, fixed: true });
      joints.set('l1', { x: -20, y: 15, fixed: false });
      joints.set('l2', { x: 20, y: 15, fixed: false });

      const shapes = [
        { id: 'circ', type: 'circle', joints: ['c', 'r'] },
        { id: 'line', type: 'line', joints: ['l1', 'l2'] }
      ];

      // Keep line horizontal
      const constraints = [
        { type: 'horizontal', joints: ['l1', 'l2'] },
        tangentConstraint
      ];

      return { joints, shapes, constraints };
    };

    // Reference solve using { line, circle }
    const refSetup = makeSetup({ type: 'tangent', line: 'line', circle: 'circ' });
    const refSolver = createNewtonSolver(refSetup.joints, refSetup.constraints, refSetup.shapes, {});
    const refRes = refSolver.solve(100);
    assert(refRes.converged === true, `Reference {line, circle} must converge, got ${JSON.stringify(refRes)}`);
    assert(refRes.error < 1e-6, `Reference error must be < 1e-6, got ${refRes.error}`);
    const refY = refSetup.joints.get('l1').y;

    // Test order A: shapes: [line, circ]
    const setupA = makeSetup({ type: 'tangent', shapes: ['line', 'circ'] });
    const solverA = createNewtonSolver(setupA.joints, setupA.constraints, setupA.shapes, {});
    const resA = solverA.solve(100);
    assert(resA.converged === true, `Order [line, circ] must converge, got converged=${resA.converged}, error=${resA.error}`);
    assert(resA.error < 1e-6, `Order [line, circ] error must be < 1e-6, got ${resA.error}`);
    assert(Math.abs(setupA.joints.get('l1').y - refY) < 1e-6, `Order [line, circ] geometry must match ref`);

    // Test order B: shapes: [circ, line]
    const setupB = makeSetup({ type: 'tangent', shapes: ['circ', 'line'] });
    const solverB = createNewtonSolver(setupB.joints, setupB.constraints, setupB.shapes, {});
    const resB = solverB.solve(100);
    assert(resB.converged === true, `Order [circ, line] must converge, got converged=${resB.converged}, error=${resB.error}`);
    assert(resB.error < 1e-6, `Order [circ, line] error must be < 1e-6, got ${resB.error}`);
    assert(Math.abs(setupB.joints.get('l1').y - refY) < 1e-6, `Order [circ, line] geometry must match ref`);
  }

  console.log('Testing (b): fillet-like shared-endpoint case in shapes form');
  {
    // Build a rectangle with fillet at corner (80, 0)
    let n = 0; const g = () => 'j' + (++n);
    const joints = new Map();
    const a = g(), b = g();
    joints.set(a, { x: 0, y: 0, fixed: false });
    joints.set(b, { x: 80, y: 60, fixed: false });
    const { shapes, constraints } = makeRectFromTwoJoints(joints, a, b, g);
    const state = { joints, shapes, constraints };
    const res = applyFillet(state, findCornerAtPoint(state, { x: 80, y: 0 }, 0.5), 20);

    res.radiusConstraint.value = 10;

    // Reference solve with {line, circle} constraints
    const refJoints = cloneJoints(joints);
    const refShapes = cloneShapes(shapes);
    const refConstraints = constraints.map(c => ({ ...c }));
    const refSolver = createNewtonSolver(refJoints, refConstraints, refShapes, {});
    const refRes = refSolver.solve(500);
    assert(refRes.converged === true, `Fillet ref must converge, got ${JSON.stringify(refRes)}`);
    const [refCj, refRj] = res.arc.joints;
    const refD = Math.hypot(refJoints.get(refCj).x - refJoints.get(refRj).x, refJoints.get(refCj).y - refJoints.get(refRj).y);
    assert(Math.abs(refD - 10) < 1e-6, `Fillet ref radius must be 10, got ${refD}`);

    // Shapes-form solve: convert fillet tangent constraints to shapes form [circle, line] and [line, circle]
    const testJoints = cloneJoints(joints);
    const testShapes = cloneShapes(shapes);
    let toggle = false;
    const testConstraints = constraints.map(c => {
      if (c.type === 'tangent' && c.line && c.circle) {
        toggle = !toggle;
        return {
          type: 'tangent',
          shapes: toggle ? [c.circle, c.line] : [c.line, c.circle]
        };
      }
      return { ...c };
    });

    const testSolver = createNewtonSolver(testJoints, testConstraints, testShapes, {});
    const testRes = testSolver.solve(500);
    assert(testRes.converged === true, `Fillet shapes-form must converge, got converged=${testRes.converged}, error=${testRes.error}`);
    assert(testRes.error < 1e-6, `Fillet shapes-form error must be < 1e-6, got ${testRes.error}`);
    const [testCj, testRj] = res.arc.joints;
    const testD = Math.hypot(testJoints.get(testCj).x - testJoints.get(testRj).x, testJoints.get(testCj).y - testJoints.get(testRj).y);
    assert(Math.abs(testD - 10) < 1e-6, `Fillet shapes-form radius must be 10, got ${testD}`);
    assert(Math.abs(testD - refD) < 1e-6, `Fillet shapes-form must match ref`);
  }

  console.log('solver-tangent-shapes-form test passed ✅');
})().catch(e => {
  console.error('solver-tangent-shapes-form test failed ❌:', e.message);
  process.exit(1);
});
