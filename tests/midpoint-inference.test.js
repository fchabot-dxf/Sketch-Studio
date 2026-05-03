(async () => {
    const { findInference } = await import('../src/ui/inference-engine.js');
    const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

    // Setup a simple line from (0,0) to (100,0)
    const joints = new Map();
    joints.set('j1', { x: 0, y: 0 });
    joints.set('j2', { x: 100, y: 0 });
    const shapes = [ { id: 'l1', type: 'line', joints: ['j1','j2'] } ];

    const startPt = { x: 0, y: 0 };

    // Case 1: close to midpoint (within scaled threshold) should infer MIDPOINT
    const nearMid = { x: 51.5, y: 0 }; // dmid = 1.5, lineLen=100 => MID_THRESH = 2.0
    let inf = findInference(startPt, nearMid, shapes, joints, null, { draggedType: 'joint', draggedId: 'j_test' });
    assert(inf && inf.type === 'midpoint', 'Expected MIDPOINT inference for near-midpoint');

    // Case 2: slightly outside threshold should NOT infer
    const justOutside = { x: 53, y: 0 }; // dmid = 3, should be outside
    inf = findInference(startPt, justOutside, shapes, joints, null, { draggedType: 'joint', draggedId: 'j_test' });
    assert(!(inf && inf.type === 'midpoint'), 'Did not expect MIDPOINT inference for point outside threshold');

    // Case 3: very short line - threshold clamps to minimum (1.0)
    const sj = new Map(); sj.set('a', { x: 0, y: 0 }); sj.set('b', { x: 10, y: 0 });
    const sShapes = [{ id: 'l2', type: 'line', joints: ['a','b'] }];
    const shortStart = { x: 0, y: 0 };
    const closeShort = { x: 5.6, y: 0 }; // dmid = 0.6 < 1.0 -> should infer
    inf = findInference(shortStart, closeShort, sShapes, sj, null, { draggedType: 'joint', draggedId: 'j_short' });
    assert(inf && inf.type === 'midpoint', 'Expected MIDPOINT inference on short line when within minimum threshold');

    const farShort = { x: 6.5, y: 0 }; // dmid = 1.5 > 1.0 -> should NOT infer
    inf = findInference(shortStart, farShort, sShapes, sj, null, { draggedType: 'joint', draggedId: 'j_short' });
    assert(!(inf && inf.type === 'midpoint'), 'Did not expect MIDPOINT inference on short line when outside min threshold');

    console.log('midpoint-inference tests passed ✅');
})().catch(e => { console.error('midpoint-inference tests failed ❌', e); process.exit(1); });