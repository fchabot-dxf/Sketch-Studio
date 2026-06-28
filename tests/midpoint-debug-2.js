(async () => {
    const { findSnap } = await import('#ui/snap-detection.js');
    const { worldToScreen } = await import('../packages/ui/coords.js');

    const joints = new Map();
    joints.set('j1', { x: 0, y: 0 });
    joints.set('j2', { x: 10, y: 0 });
    joints.set('j3', { x: 30, y: 0 });
    joints.set('j4', { x: 40, y: 0 });

    const shapes = [{ id: 'l1', type: 'line', joints: ['j1','j2'] }, { id: 'l2', type: 'line', joints: ['j3','j4'] }];

    const svg = {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }),
        viewBox: { baseVal: { x: 0, y: 0, width: 200, height: 200 } },
        setPointerCapture: () => {}, releasePointerCapture: () => {}
    };

    const lastMouse = { x: 20, y: 0 };
    const s = findSnap(joints, shapes, svg, lastMouse);
    console.log('findSnap result:', s);
})();