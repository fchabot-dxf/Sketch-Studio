// tests/snap-threshold-zoom.test.js -- TASK 552: every snap / inference threshold given in SCREEN pixels engages at the same on-screen
// distance at every zoom (0.2, 1, 78 px per world unit). Until task 552 the drag's MIDPOINT inference (SNAP.MIDPOINT 1..4) was compared
// with a WORLD distance: at 78 px per unit a line end 78..312 px from a midpoint snapped to it. Also: a joint dragged near the midpoint
// of ITS OWN line never snaps to it; the H/V inference skips a line that already has an H or V constraint (task 548 F2).
import assert from 'node:assert';
import { findInference } from '#core/inference-engine.js';
import { findSnap } from '#ui/snap-detection.js';
import { getZoomFactor } from '#ui/coords.js';
import { SNAP, ORIGIN_JOINT_ID } from '#core/constants.js';

const ZOOMS = [0.2, 1, 78];
// a canvas whose centre (500, 500) is the world origin at `ppu` px per world unit
const svgAt = (ppu) => { const w = 1000 / ppu; return { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }), viewBox: { baseVal: { x: -w / 2, y: -w / 2, width: w, height: w } } }; };
const near = (found, msg) => assert.ok(found, msg);

for (const ppu of ZOOMS) {
  const svg = svgAt(ppu);
  assert.ok(Math.abs(getZoomFactor(svg) - 1 / ppu) < 1e-12, `getZoomFactor is world units per px at ${ppu}`);
  const px = (n) => n / ppu; // screen px -> world

  // ---- MIDPOINT inference: a free joint dragged to d px from the midpoint of another line (400 px long: 2% = 8 -> clamped to MAX 4 px)
  const joints = new Map([['a', { x: px(-200), y: px(-300) }], ['b', { x: px(200), y: px(-300) }], ['drag', { x: 0, y: 0 }]]);
  const shapes = [{ id: 'l1', type: 'line', joints: ['a', 'b'] }];
  const midInf = (dpx) => findInference({ x: 0, y: 0 }, { x: px(dpx), y: px(-300) }, shapes, joints, null, { draggedType: 'joint', draggedId: 'drag', worldPerPx: getZoomFactor(svg) });
  const inside = midInf(SNAP.MIDPOINT.MAX - 1), outside = midInf(SNAP.MIDPOINT.MAX + 1);
  assert.ok(inside && inside.type === 'midpoint', `${ppu} px/unit: ${SNAP.MIDPOINT.MAX - 1} px from a midpoint snaps`);
  assert.ok(!(outside && outside.type === 'midpoint'), `${ppu} px/unit: ${SNAP.MIDPOINT.MAX + 1} px from a midpoint does not snap`);
  // short line (40 px: 2% = 0.8 -> clamped up to MIN 1 px)
  const sj = new Map([['a', { x: px(-20), y: px(-300) }], ['b', { x: px(20), y: px(-300) }]]);
  const sInf = (dpx) => findInference({ x: 0, y: 0 }, { x: px(dpx), y: px(-300) }, shapes, sj, null, { draggedType: 'joint', draggedId: 'drag', worldPerPx: getZoomFactor(svg) });
  assert.ok(sInf(SNAP.MIDPOINT.MIN - 0.3)?.type === 'midpoint' && !(sInf(SNAP.MIDPOINT.MIN + 0.5)?.type === 'midpoint'), `${ppu} px/unit: the MIN clamp is in px`);

  // ---- the dragged end's OWN line: its midpoint is never a target (the end is 3 px from it)
  const own = new Map([['p', { x: px(-300), y: 0 }], ['q', { x: px(300), y: 0 }]]);
  const ownShapes = [{ id: 'own', type: 'line', joints: ['p', 'q'] }];
  const ownInf = findInference({ x: px(300), y: 0 }, { x: px(3), y: 0 }, ownShapes, own, null, { draggedType: 'joint', draggedId: 'q', worldPerPx: getZoomFactor(svg) });
  assert.ok(!(ownInf && ownInf.type === 'midpoint'), `${ppu} px/unit: a line end does not snap to the midpoint of its own line`);

  // ---- findSnap (screen px): joint JOINT_PX, line LINE_PX, axis AXIS_PX
  const sn = (j, shapesL, mouse) => findSnap(j, shapesL, svg, mouse, []);
  const jm = new Map([['j1', { x: 0, y: px(-200) }]]);                      // screen (500, 300)
  assert.ok(sn(jm, [], { x: 500 + SNAP.JOINT_PX - 1, y: 300 })?.type === 'joint', `${ppu}: joint snaps at JOINT_PX - 1`);
  assert.ok(sn(jm, [], { x: 500 + SNAP.JOINT_PX + 1, y: 300 }) === null, `${ppu}: joint does not snap at JOINT_PX + 1`);
  const lm = new Map([['l1', { x: px(-300), y: px(-200) }], ['l2', { x: px(300), y: px(-200) }]]);
  const ls = [{ id: 'ln', type: 'line', joints: ['l1', 'l2'] }];             // horizontal at screen y = 300, x 200..800
  assert.ok(sn(lm, ls, { x: 650, y: 300 - SNAP.LINE_PX + 1 })?.type === 'shape', `${ppu}: line snaps at LINE_PX - 1`);
  assert.ok(sn(lm, ls, { x: 650, y: 300 - SNAP.LINE_PX - 1 }) === null, `${ppu}: line does not snap at LINE_PX + 1`);
  const om = new Map([[ORIGIN_JOINT_ID, { x: 0, y: 0 }]]);                   // origin at (500, 500), the X axis is y = 500
  assert.ok(sn(om, [], { x: 800, y: 500 - SNAP.AXIS_PX + 1 })?.type === 'axis-x', `${ppu}: axis snaps at AXIS_PX - 1`);
  assert.ok(sn(om, [], { x: 800, y: 500 - SNAP.AXIS_PX - 1 }) === null, `${ppu}: axis does not snap at AXIS_PX + 1`);
}

// ---- F2: an attached line that already carries a horizontal constraint takes no vertical inference
{
  const joints = new Map([['f', { x: 0, y: 0 }], ['e', { x: 10, y: 0 }]]);
  const shapes = [{ id: 'l', type: 'line', joints: ['f', 'e'] }];
  const opts = (constraints) => ({ draggedType: 'joint', draggedId: 'e', worldPerPx: 1, constraints });
  assert.equal(findInference({ x: 10, y: 0 }, { x: 0.2, y: 357 }, shapes, joints, null, opts([]))?.type, 'vertical', 'control: free line, end thrown above the other end infers vertical');
  assert.notEqual(findInference({ x: 10, y: 0 }, { x: 0.2, y: 357 }, shapes, joints, null, opts([{ type: 'horizontal', joints: ['f', 'e'] }]))?.type, 'vertical', 'an H-constrained line takes no vertical inference');
}
console.log('snap-threshold-zoom tests passed');
