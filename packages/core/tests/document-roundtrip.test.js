// PERSIST-1 oracle: serializeDocument/deserializeDocument must round-trip EVERY shape kind and a
// representative spread of constraint types with nothing silently dropped. Builds a sketch, serializes
// it, deserializes into a FRESH engine, then asserts the restored geometry/constraints are equivalent
// AND that solving the restored document converges to the same positions as the original.
(async () => {
    const { createEngine } = await import('#core/constraint-solver.js');
    const { ConstraintManager, setConstraintNotifier } = await import('#core/constraint-manager.js');
    const { makeRectFromTwoJoints, makeArc, makeBezier } = await import('#core/shapes.js');
    const { CONSTRAINT_TYPES } = await import('#core/constants.js');
    const { createSketches } = await import('#core/sketch-model.js');
    const { serializeDocument, deserializeDocument, DOCUMENT_VERSION } = await import('#core/document.js');
    const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

    setConstraintNotifier(() => {});

    function buildSketch() {
        const engine = createEngine(null);
        engine.init(); // adds fixed j_origin at (0,0)
        const state = {
            joints: engine.getJoints(),
            shapes: engine.getShapes(),
            constraints: engine.getConstraints(),
            engine,
            genJ: engine.genJ,
            ...createSketches(),
        };

        // 1) A coincident-welded rect: line shapes x4, HORIZONTAL/VERTICAL x4, COINCIDENT x4.
        const c1 = engine.genJ(); engine.addJoint(c1, 0, 0, false);
        const c3 = engine.genJ(); engine.addJoint(c3, 40, 30, false);
        const rect = makeRectFromTwoJoints(state.joints, c1, c3, engine.genJ);
        for (const s of rect.shapes) engine.addShape(s);
        for (const c of rect.constraints) ConstraintManager.createConstraint(state, c.type, c, { source: 'test' });

        // 2) A circle with a driving RADIUS dimension (a distance constraint, isRadius:true).
        const cc = engine.genJ(); engine.addJoint(cc, 60, 15, false);
        const circleId = 's_circle_test';
        engine.addShape({ id: circleId, type: 'circle', joints: [cc], radius: 10 });
        ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, { shape: circleId, value: 10, isRadius: true }, { source: 'test' });

        // 3) A standalone line tangent to the circle (dist from (60,15) to line y=25 == radius 10).
        const t1 = engine.genJ(); engine.addJoint(t1, 60, 25, false);
        const t2 = engine.genJ(); engine.addJoint(t2, 80, 25, false);
        const tangentLineId = 's_tangent_line_test';
        engine.addShape({ id: tangentLineId, type: 'line', joints: [t1, t2] });
        ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.TANGENT, { shapes: [circleId, tangentLineId] }, { source: 'test' });

        // 4) An arc (its OWN structural equal-radius constraint is added by makeArc), radius 10, already satisfied.
        const ap1 = engine.genJ(); engine.addJoint(ap1, 100, 15, false); // center
        const ap2 = engine.genJ(); engine.addJoint(ap2, 110, 15, false); // start (r=10)
        const ap3 = engine.genJ(); engine.addJoint(ap3, 100, 25, false); // end (r=10)
        const arcResult = makeArc(state.joints, ap1, ap2, ap3, 'CENTER');
        for (const s of arcResult.shapes) engine.addShape(s);
        for (const c of arcResult.constraints) ConstraintManager.createConstraint(state, c.type, c, { source: 'test' });

        // 5) A bezier (endpoints are joints; c1/c2 are shape DATA, not solver joints).
        const bp0 = engine.genJ(); engine.addJoint(bp0, 0, 50, false);
        const bp3 = engine.genJ(); engine.addJoint(bp3, 40, 50, false);
        const bezier = makeBezier(state.joints, bp0, bp3, [10, 60], [30, 60]);
        for (const s of bezier.shapes) engine.addShape(s);

        // 6) A driving DIMENSION (distance) on the bezier's own endpoints, already satisfied (40 apart).
        ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, { joints: [bp0, bp3], value: 40 }, { source: 'test' });

        engine.solve(500);
        return { engine, state };
    }

    // ── Build, solve, snapshot positions ────────────────────────────────────────
    const original = buildSketch();
    const beforeConverged = original.engine.solve(500);
    assert(beforeConverged.converged === true, 'the built fixture itself must converge before round-tripping it');
    const beforePositions = new Map([...original.state.joints].map(([id, j]) => [id, { x: j.x, y: j.y }]));

    // ── Serialize, then verify EVERY shape kind and constraint type actually made it into the doc ────
    const doc = serializeDocument(original.state);
    assert(doc.version === DOCUMENT_VERSION, 'document carries the current version');
    const kinds = new Set(doc.geometry.shapes.map((s) => s.type));
    for (const kind of ['line', 'circle', 'arc', 'bezier']) {
        assert(kinds.has(kind), `serialized document is missing shape kind: ${kind}`);
    }
    const cTypes = new Set(doc.geometry.constraints.map((c) => c.type));
    for (const t of [CONSTRAINT_TYPES.HORIZONTAL, CONSTRAINT_TYPES.VERTICAL, CONSTRAINT_TYPES.COINCIDENT, CONSTRAINT_TYPES.TANGENT, CONSTRAINT_TYPES.EQUAL, CONSTRAINT_TYPES.DISTANCE]) {
        assert(cTypes.has(t), `serialized document is missing constraint type: ${t}`);
    }
    assert(doc.geometry.joints.length === original.state.joints.size, 'every joint made it into the document');
    assert(doc.geometry.shapes.length === original.state.shapes.length, 'every shape made it into the document');
    assert(doc.geometry.constraints.length === original.state.constraints.length, 'every constraint made it into the document');

    // ── Deserialize into a FRESH engine ─────────────────────────────────────────
    const fresh = createEngine(null);
    fresh.init();
    const freshState = {
        joints: fresh.getJoints(),
        shapes: fresh.getShapes(),
        constraints: fresh.getConstraints(),
        engine: fresh,
        genJ: fresh.genJ,
        ...createSketches(),
    };
    const result = deserializeDocument(doc, freshState);
    assert(result.ok === true, `deserializeDocument failed: ${result.reason}`);

    assert(freshState.joints.size === original.state.joints.size, `joint count mismatch after restore: ${freshState.joints.size} vs ${original.state.joints.size}`);
    assert(freshState.shapes.length === original.state.shapes.length, 'shape count mismatch after restore');
    assert(freshState.constraints.length === original.state.constraints.length, 'constraint count mismatch after restore');
    const restoredKinds = new Set(freshState.shapes.map((s) => s.type));
    for (const kind of ['line', 'circle', 'arc', 'bezier']) {
        assert(restoredKinds.has(kind), `restored state is missing shape kind: ${kind}`);
    }

    // Positions restored EXACTLY (deserialize just re-hydrates the last-saved snapshot, no solve yet).
    for (const [id, pos] of beforePositions) {
        const j = freshState.joints.get(id);
        assert(j, `restored joint ${id} exists`);
        assert(Math.abs(j.x - pos.x) < 1e-9 && Math.abs(j.y - pos.y) < 1e-9, `restored joint ${id} position matches exactly`);
    }

    // ── Solve the restored document — must converge to the SAME positions as the original ──────────
    const afterResult = fresh.solve(500);
    assert(afterResult.converged === true, 'the restored document converges when re-solved');
    for (const [id, pos] of beforePositions) {
        const j = freshState.joints.get(id);
        const dist = Math.hypot(j.x - pos.x, j.y - pos.y);
        assert(dist < 0.01, `restored+resolved joint ${id} matches original position (off by ${dist.toFixed(4)})`);
    }

    // ── Newer-version rejection (lesson: flag, never half-read) ────────────────
    const futureDoc = { ...doc, version: DOCUMENT_VERSION + 1 };
    const rejected = deserializeDocument(futureDoc, freshState);
    assert(rejected.ok === false, 'a document from a newer, not-yet-understood version must be rejected');

    console.log('document-roundtrip test passed ✅');
})().catch(e => { console.error('document-roundtrip test failed ❌', e); process.exit(1); });
