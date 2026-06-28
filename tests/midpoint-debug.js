(async () => {
    const { findSnap } = await import('../apps/sketchstudio/snap-detection.js');
    const { worldToScreen } = await import('../packages/ui/coords.js');

    const joints = new Map();
    joints.set('j1', { x: 0, y: 0 });
    joints.set('j2', { x: 100, y: 0 });
    joints.set('j3', { x: 5, y: 5 });
    const shapes = [{ id: 's1', type: 'line', joints: ['j1','j2'] }];

    const svg = {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }),
        viewBox: { baseVal: { x: 0, y: 0, width: 200, height: 200 } },
        setPointerCapture: () => {}, releasePointerCapture: () => {}
    };

    const mid = { x: 50, y: 0 };
    const midSC = worldToScreen(svg, mid);
    console.log('mid screen:', midSC);
    const lastMouse = { x: midSC.x + 1, y: midSC.y + 1 };

    const s = findSnap(joints, shapes, svg, lastMouse);
    console.log('findSnap result:', s);
})();