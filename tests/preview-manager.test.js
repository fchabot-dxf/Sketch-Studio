(async () => {
    const { updatePreview, clearPreview, getPreviewData } = await import('../src/ui/preview-manager.js');
    const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

    const state = {
        joints: new Map([['j1',{x:10,y:10}], ['j2',{x:20,y:20}]]),
        active: { mode: 'line', start: 'j1', preview: null }
    };

    updatePreview(state, 'line', ['j1'], { x: 15, y: 15 });
    assert(state.preview && state.preview.type === 'line', 'state.preview.type should be line');
    assert(state.active.preview && state.active.preview.type === 'line', 'legacy active.preview should be set');
    assert(state.tempMousePos && state.tempMousePos.x === 15 && state.tempMousePos.y === 15, 'tempMousePos should be set');

    updatePreview(state, 'circle', ['j1'], { x: 25, y: 25 }, { radius: 5 });
    assert(state.active.preview && state.active.preview.type === 'circle' && state.active.preview.radius === 5, 'circle preview set with radius');

    updatePreview(state, 'rect', ['j1'], { x: 30, y: 30 }, { mode: 'center' });
    assert(state.active.preview && (state.active.preview.type === 'rect-center'), 'rect-center preview');

    clearPreview(state);
    assert(!state.preview, 'state.preview cleared');
    assert(!state.active.preview, 'active.preview cleared');
    assert(state.tempMousePos === null, 'tempMousePos cleared');

    console.log('preview-manager tests passed ✅');
})().catch(e => { console.error('preview-manager tests failed ❌', e); process.exit(1); });