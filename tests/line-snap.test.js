(async () => {
    const { handleLinePointerUp } = await import('../src/ui/input-handlers/line-tool.js');
    const { CONSTRAINT_TYPES } = await import('../src/core/constants.js');
    const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

    // Setup state with an existing line shape to snap to
    let counter = 1;
    const state = {
        joints: new Map(),
        shapes: [],
        constraints: [],
        genJ: () => 'j' + (counter++),
        beginUndoGroup: () => {},
        endUndoGroup: () => {},
        saveState: () => {}
    };

    // Create a reference line shape la-lb
    state.joints.set('la', { x: 0, y: 0 }); state.joints.set('lb', { x: 100, y: 0 });
    const sId = 's_lineA'; state.shapes.push({ id: sId, type: 'line', joints: ['la','lb'] });

    // Simulate active line start
    const startId = state.genJ(); state.joints.set(startId, { x: -10, y: 0 });
    state.active = { mode: 'line', start: startId, startPt: { x: -10, y: 0 }, preview: null, polylineOrigin: startId };

    // Simulate pointerUp with a line snap (should create a new end joint and a POINT_ON_LINE constraint)
    const hitSnap = { type: 'line', shape: state.shapes[0], pt: { x: 50, y: 0 }, isLocked: true };
    const res = handleLinePointerUp({ clientX: 0, clientY: 0 }, null, state, hitSnap, hitSnap.pt, false);

    // If function returned object, use it to find new ids
    let newShapeId = null; let endId = null;
    if (res && res.newShapeId) { newShapeId = res.newShapeId; endId = res.endId; }
    // Otherwise inspect last shape created
    if(!newShapeId && state.shapes.length){ const s = state.shapes[state.shapes.length - 1]; newShapeId = s.id; endId = s.joints[1]; }

    assert(newShapeId, 'A new line shape should be created');
    // Verify there is a POINT_ON_LINE constraint referencing the new end joint and the line shape
    const p = state.constraints.find(c => c.type === CONSTRAINT_TYPES.POINT_ON_LINE && c.joint && c.shape && c.joint === endId && c.shape === sId);
    assert(!!p, 'Point-on-line constraint should be present for snapped end');

    console.log('line-tool snap test passed ✅');
})().catch(e => { console.error('line-snap tests failed ❌', e); process.exit(1); });