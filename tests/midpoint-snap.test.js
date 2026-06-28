(async () => {
    const { findSnap } = await import('../apps/sketchstudio/snap-detection.js');
    const { applySnapConstraint, previewSnapConstraint } = await import('../src/core/snap-constraints.js');
    const { worldToScreen } = await import('../apps/sketchstudio/coords.js');
    const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

    // Setup simple line and a free joint
    const state = {
        joints: new Map(),
        shapes: [],
        constraints: [],
        beginUndoGroup: () => {},
        endUndoGroup: () => {},
        saveState: () => {}
    };

    state.joints.set('j1', { x: 0, y: 0 });
    state.joints.set('j2', { x: 100, y: 0 });
    state.joints.set('j3', { x: 5, y: 5 });
    state.shapes.push({ id: 's1', type: 'line', joints: ['j1', 'j2'] });

    const svg = {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }),
        viewBox: { baseVal: { x: 0, y: 0, width: 200, height: 200 } },
        setPointerCapture: () => {}, releasePointerCapture: () => {}
    };

    // Compute screen coords for midpoint
    const mid = { x: 50, y: 0 };
    const midSC = worldToScreen(svg, mid);

    // findSnap should detect midpoint as a snap when near
    const snap = findSnap(state.joints, state.shapes, svg, { x: midSC.x + 1, y: midSC.y + 1 });
    assert(snap && snap.type === 'midpoint', 'findSnap should detect midpoint snap');

    // preview should show a midpoint preview
    const preview = previewSnapConstraint(snap, 'j3');
    assert(preview && preview.type === 'midpoint', 'previewSnapConstraint should return midpoint preview');

    // Applying midpoint snap should create a MIDPOINT constraint linking j1,j2,j3
    const applied = applySnapConstraint(state, 'j3', snap, {});
    assert(applied === true, 'applySnapConstraint should return true for midpoint');
    const midC = (state.constraints || []).find(c => c && c.type === 'midpoint');
    assert(midC, 'MIDPOINT constraint should be present after applySnapConstraint');
    const ids = new Set(midC.joints || []);
    assert(ids.has('j1') && ids.has('j2') && ids.has('j3'), 'MIDPOINT constraint should reference endpoints and dragged joint');

    console.log('midpoint-snap tests passed ✅');
})().catch(e => { console.error('midpoint-snap tests failed ❌', e); process.exit(1); });