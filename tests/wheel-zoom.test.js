(async () => {
    const { handleWheel } = await import('../apps/sketchstudio/ui/input-manager.js');
    const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

    // Minimal fake svg and state
    const svg = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }), setAttribute: () => {}, style: {}, addEventListener: () => {} };
    const state = { view: { x: 0, y: 0, w: 100, h: 100 }, lastMouse: null };

    // Simulate wheel up (zoom in)
    const e = { clientX: 50, clientY: 50, deltaY: -100, preventDefault: () => {} };
    handleWheel(e, svg, state);
    const wAfter = state.view.w;

    // Simulate wheel down (zoom out)
    const e2 = { clientX: 50, clientY: 50, deltaY: 100, preventDefault: () => {} };
    handleWheel(e2, svg, state);
    const wAfter2 = state.view.w;

    assert(wAfter < 100, 'Zoom in should reduce view.w');
    assert(wAfter2 > wAfter, 'Zoom out should increase view.w');

    console.log('wheel-zoom test passed ✅');
})().catch(e => { console.error('wheel-zoom test failed ❌', e); process.exit(1); });