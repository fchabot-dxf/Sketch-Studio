(async () => {
    const { solveConstraints } = await import('#core/solver-core.js');
    const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

    // Setup: two skew lines
    const state = { joints: new Map(), shapes: [], constraints: [] };
    // Line 1: horizontal
    state.joints.set('a', { x: 0, y: 0 });
    state.joints.set('b', { x: 100, y: 0 });
    state.shapes.push({ id: 'L1', type: 'line', joints: ['a', 'b'] });

    // Line 2: tilted and offset
    state.joints.set('p', { x: 20, y: 10 });
    state.joints.set('q', { x: 80, y: 30 });
    state.shapes.push({ id: 'L2', type: 'line', joints: ['p', 'q'] });

    // Apply collinear between shapes
    state.constraints.push({ type: 'collinear', shapes: ['L1', 'L2'] });

    // Run solver
    solveConstraints(state.joints, state.shapes, state.constraints, 1000);

    const a = state.joints.get('a'); const b = state.joints.get('b');
    const p = state.joints.get('p'); const q = state.joints.get('q');

    const ang = (u, v) => Math.atan2(v.y - u.y, v.x - u.x);
    const ang1 = ang(a, b); const ang2 = ang(p, q);
    const diff = Math.atan2(Math.sin(ang1 - ang2), Math.cos(ang1 - ang2));

    // Angles should be aligned
    assert(Math.abs(diff) < 1e-3, `Lines not parallel after collinear: diff=${diff}`);

    // Each endpoint of line2 should be close to line1
    const projectPointOnLine = (pt, a, b) => {
        const vx = b.x - a.x, vy = b.y - a.y; const L2 = vx*vx + vy*vy || 1;
        const t = ((pt.x - a.x)*vx + (pt.y - a.y)*vy) / L2; return { x: a.x + t*vx, y: a.y + t*vy };
    };
    const projP = projectPointOnLine(p, a, b);
    const projQ = projectPointOnLine(q, a, b);
    const distP = Math.hypot(projP.x - p.x, projP.y - p.y);
    const distQ = Math.hypot(projQ.x - q.x, projQ.y - q.y);
    assert(distP < 1e-2, `p not projected close to line: ${distP}`);
    assert(distQ < 1e-2, `q not projected close to line: ${distQ}`);

    // Ensure lines didn't collapse (lengths remain reasonable)
    const len1 = Math.hypot(b.x - a.x, b.y - a.y);
    const len2 = Math.hypot(q.x - p.x, q.y - p.y);
    assert(len1 > 10, `Line1 collapsed: ${len1}`);
    assert(len2 > 10, `Line2 collapsed: ${len2}`);

    console.log('collinear-shape tests passed ✅');
})().catch(e => { console.error('collinear-shape tests failed ❌', e); process.exit(1); });