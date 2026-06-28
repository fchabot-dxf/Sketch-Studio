(async () => {
  const { findSnap } = await import('#ui/snap-detection.js');
  const { SNAP } = await import('#core/constants.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Setup minimal state: one joint near a point, and a long line further away
  const joints = new Map();
  joints.set('j1', { x: 50, y: 50 });
  const shapes = [ { id: 's1', type: 'line', joints: ['l1','l2'] } ]; // line coords not needed for this unit test

  // Create a lastMouse such that both joint and line are plausible; the joint is within 5px
  const svg = { getBoundingClientRect: () => ({ width: 100, height: 100 }), viewBox: { baseVal: { x:0,y:0,width:100,height:100 } }, clientWidth:100, clientHeight:100 };
  const lastMouse = { x: 51, y: 50 }; // 1px from j1

  const snap = findSnap(joints, shapes, svg, lastMouse, [], false, false, 1.0);
  assert(snap && snap.type === 'joint', 'Expected joint to be prioritized by findSnap when within priority radius');
  console.log('snap-detection-priority test (case 1) passed ✅');

  // Case 2: Joint slightly farther but still within the JOINT_PRIORITY_RADIUS (12px)
  // and a line whose closest point is closer in pixels - joint should still win due to priority.
  joints.set('l1', { x:70, y:50 });
  joints.set('l2', { x:80, y:50 });
  const shapes2 = [ { id: 's1', type: 'line', joints: ['l1','l2'] } ];
  const lastMouse2 = { x: 62, y: 50 }; // 12px from j1, ~8px from line at x=70

  const snap2 = findSnap(joints, shapes2, svg, lastMouse2, [], false, false, 1.0);
  assert(snap2 && snap2.type === 'joint', 'Expected joint to be prioritized even when line is nominally closer');
  console.log('snap-detection-priority test (case 2) passed ✅');
})().catch(e => { console.error('snap-detection-priority tests failed ❌', e); process.exit(1); });