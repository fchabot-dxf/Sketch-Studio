(async () => {
    const { handleConstraintPointerDown, resetConstraintState } = await import('../apps/sketchstudio/ui/input-handlers/constraint-tools.js');
    const { TOOL_MODES } = await import('../src/core/constants.js');
    const { CONSTRAINT_TYPES } = await import('../src/core/constants.js');
    const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

    let counter = 1;
    const createState = () => ({
        joints: new Map(),
        shapes: [],
        constraints: [],
        genJ: () => 'j' + (counter++),
        genS: (t) => 's' + (counter++),
        selectedJoints: new Set(),
        selectedShapes: new Set()
    });

    // Coincident: Joint-to-Joint only
    (() => {
        const state = createState();
        state.currentTool = TOOL_MODES.COINCIDENT;
        const j1 = state.genJ(); const j2 = state.genJ();
        state.joints.set(j1, { x: 0, y: 0 }); state.joints.set(j2, { x: 10, y: 0 });

        // First click on joint 1
        const hit1 = { id: j1, j: state.joints.get(j1) };
        let ok = handleConstraintPointerDown(null, null, state, hit1, null, null);
        assert(ok === true, 'First joint click should be accepted');
        assert(state.selectedJoints.has(j1), 'First joint should be selected');

        // Second click on joint 2
        const hit2 = { id: j2, j: state.joints.get(j2) };
        ok = handleConstraintPointerDown(null, null, state, hit2, null, null);
        assert(ok === true, 'Second joint click should finalize');
        const found = state.constraints.some(c => c.type === CONSTRAINT_TYPES.COINCIDENT && c.joints && c.joints.includes(j1) && c.joints.includes(j2));
        assert(found, 'Coincident constraint should be created between joints');

        // Clicking a shape should be ignored by COINCIDENT (joints-only policy)
        resetConstraintState();
        const shape = { id: 's1', type: 'line', joints: ['a','b'] };
        state.shapes.push(shape);
        const hitShape = { shape };
        ok = handleConstraintPointerDown(null, null, state, null, hitShape, null);
        assert(ok === false, 'Clicking a shape should not start COINCIDENT selection');
    })();

    // Tangent: Line + Arc and Arc + Arc
    (() => {
        const state = createState();
        state.currentTool = TOOL_MODES.TANGENT;

        // Line + Arc
        const lineId = state.genS('line');
        const l1 = state.genJ(); const l2 = state.genJ();
        state.joints.set(l1, { x: 0, y: 0 }); state.joints.set(l2, { x: 10, y: 0 });
        const line = { id: lineId, type: 'line', joints: [l1, l2] };

        const cId = state.genJ(); const rId = state.genJ();
        state.joints.set(cId, { x: 5, y: 5 }); state.joints.set(rId, { x: 10, y: 5 });
        const arc = { id: state.genS('arc'), type: 'arc', joints: [cId, rId] };

        state.shapes.push(line, arc);

        let ok = handleConstraintPointerDown(null, null, state, null, { shape: line }, null);
        assert(ok === true, 'Selecting first shape should be accepted');
        ok = handleConstraintPointerDown(null, null, state, null, { shape: arc }, null);
        assert(ok === true, 'Selecting second shape should finalize tangent');

        const found = state.constraints.some(c => c.type === CONSTRAINT_TYPES.TANGENT && ((c.line && c.circle === arc.id) || (c.shapes && c.shapes.includes(arc.id) && c.shapes.includes(line.id))));
        assert(found, 'Tangent constraint should be created for Line + Arc');

        // Arc + Arc
        resetConstraintState();
        state.constraints = [];
        const cId2 = state.genJ(); const rId2 = state.genJ();
        state.joints.set(cId2, { x: 30, y: 5 }); state.joints.set(rId2, { x: 35, y: 5 });
        const arc2 = { id: state.genS('arc'), type: 'arc', joints: [cId2, rId2] };
        state.shapes.push(arc2);

        ok = handleConstraintPointerDown(null, null, state, null, { shape: arc }, null);
        assert(ok === true, 'First arc selection accepted');
        ok = handleConstraintPointerDown(null, null, state, null, { shape: arc2 }, null);
        assert(ok === true, 'Second arc selection finalizes tangent');

        const found2 = state.constraints.some(c => c.type === CONSTRAINT_TYPES.TANGENT && c.shapes && c.shapes.includes(arc.id) && c.shapes.includes(arc2.id));
        assert(found2, 'Tangent constraint should be created for Arc + Arc');
    })();

    // Equal: Arc + Arc is allowed
    (() => {
        const state = createState();
        state.currentTool = TOOL_MODES.EQUAL;
        const a1 = { id: state.genS('arc'), type: 'arc', joints: [state.genJ(), state.genJ()] };
        const a2 = { id: state.genS('arc'), type: 'arc', joints: [state.genJ(), state.genJ()] };
        state.shapes.push(a1, a2);

        let ok = handleConstraintPointerDown(null, null, state, null, { shape: a1 }, null);
        assert(ok === true, 'First arc selection accepted');
        ok = handleConstraintPointerDown(null, null, state, null, { shape: a2 }, null);
        assert(ok === true, 'Second arc selection finalizes equal');

        const found = state.constraints.some(c => c.type === CONSTRAINT_TYPES.EQUAL && c.shapes && c.shapes.includes(a1.id) && c.shapes.includes(a2.id));
        assert(found, 'Equal constraint should be created for Arc + Arc');
    })();

    // Parallel/Perpendicular: must be lines only
    (() => {
        const state = createState();
        state.currentTool = TOOL_MODES.PARALLEL;
        const circle = { id: state.genS('circle'), type: 'circle', joints: [state.genJ(), state.genJ()] };
        state.shapes.push(circle);

        // Clicking a circle for a line-only tool should be rejected
        let ok = handleConstraintPointerDown(null, null, state, null, { shape: circle }, null);
        assert(ok === false, 'Parallel tool should reject non-line shapes');
    })();

    console.log('constraint-tools tests passed ✅');
})().catch(e => { console.error('constraint-tools tests failed ❌', e); process.exit(1); });