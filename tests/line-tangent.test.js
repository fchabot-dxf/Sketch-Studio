(async () => {
    const { finalizeLineFromActive } = await import('../apps/sketchstudio/ui/input-handlers/line-tool.js');
    const { CONSTRAINT_TYPES } = await import('../src/core/constants.js');
    const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

    // Simple circle + line tangent test
    let counter = 1;
    const createState = () => ({
        joints: new Map(),
        shapes: [],
        constraints: [],
        genJ: () => 'j' + (counter++),
        beginUndoGroup: () => {},
        endUndoGroup: () => {},
        saveState: () => {}
    });

    (() => {
        const state = createState();
        // Circle center
        const cId = state.genJ(); state.joints.set(cId, { x: 0, y: 0 });
        // Circle radius 10
        const circleId = 's' + Date.now();
        state.shapes.push({ id: circleId, type: 'circle', joints: [cId], radius: 10 });

        // Start point on circle at (10,0)
        const startId = state.genJ(); state.joints.set(startId, { x: 10, y: 0 });

        state.active = {
            mode: 'line',
            start: startId,
            startPt: { x: 10, y: 0 },
            preview: { type: 'line', pt: { x: 10, y: 50 } } // vertical line => tangent at (10,0)
        };
        // Simulate the inference computed during interactive preview
        try{ state.activeInference = { type: 'tangent', targetId: circleId }; }catch(_){ state.inference = { type: 'tangent', targetId: circleId }; }

        const ok = finalizeLineFromActive(null, state);
        assert(ok === true, 'finalizeLineFromActive should return true');
        // After finalization, tangent constraint should be present linking the line and the circle
        const found = state.constraints.some(c => c.type === CONSTRAINT_TYPES.TANGENT && c.line && c.circle === circleId);
        assert(found, 'A tangent constraint should be created between the new line and the circle');
    })();

    console.log('line-tangent tests passed ✅');
})().catch(e => { console.error('line-tangent tests failed ❌', e); process.exit(1); });