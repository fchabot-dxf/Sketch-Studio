(async () => {
    const { addConstraintObject } = await import('#core/constraints.js');
    const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

    const state = { constraints: [] };

    // Simulate imported constraint object that was exported with isDriven and visual placement
    const imported = {
        type: 'distance',
        joints: ['j1','j2'],
        isDriven: true,
        value: undefined,
        offset: 28,
        __pos: { x: 123, y: 456 },
        glyphPos: { x: 321, y: 654 }
    };

    const ok = addConstraintObject(state, imported);
    assert(ok === true, 'addConstraintObject should return true');
    const c = state.constraints[0];
    assert(c, 'constraint should be present');
    assert(c.type === 'distance', 'type preserved');
    assert(c.isDriven === true, 'isDriven should be preserved on import');
    assert(c.offset === 28, 'offset should be preserved');
    assert(c.__pos && c.__pos.x === 123 && c.__pos.y === 456, '__pos preserved');
    assert(c.glyphPos && c.glyphPos.x === 321 && c.glyphPos.y === 654, 'glyphPos preserved');

    // Legacy export might use `driven` instead of `isDriven` - ensure import still recognizes it
    const importedLegacy = Object.assign({}, imported, { driven: true, isDriven: undefined, __pos: { x: 11, y: 22 }, glyphPos: { x: 33, y: 44 } });
    state.constraints.length = 0;
    const ok2 = addConstraintObject(state, importedLegacy);
    assert(ok2 === true, 'addConstraintObject should accept legacy driven flag');
    const c2 = state.constraints[0];
    assert(c2.isDriven === true, 'legacy "driven" should be mapped to isDriven on import');
    assert(c2.__pos && c2.__pos.x === 11 && c2.__pos.y === 22, 'legacy __pos preserved');
    assert(c2.glyphPos && c2.glyphPos.x === 33 && c2.glyphPos.y === 44, 'legacy glyphPos preserved');

    console.log('distance-import tests passed ✅');
})().catch(e => { console.error('distance-import tests failed ❌', e); process.exit(1); });