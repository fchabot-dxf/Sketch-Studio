// tests/bezier-pick-762-shaper-snap-live.test.js — TASK 762, Shaper's Design tab, desktop 1280 x 800, real mouse (tests/helpers/bezier-pick-live.js).
//  The Line tool ending ON a bezier's body: its end snaps to the curve while hovering it and lands on the curve (within 0.01 mm), no constraint holds it
//  there (a bezier holds no point: its control points are shape data), the point-on-curve notice says so;
//  Close path picked by the BODY of an open bezier chain closes it (the page's findLoops: one loop with both beziers).
import assert from 'node:assert';
import { openBezierPickPage, ST } from './helpers/bezier-pick-live.js';

// the distance (mm) from p to the scene's first bezier (100, 0) (100, -25) (130, -25) (130, 0): 20000 samples
const offCurve = ([x, y]) => { let d = Infinity; for (let i = 0; i <= 20000; i++) { const t = i / 20000, u = 1 - t; const px = u * u * u * 100 + 3 * u * u * t * 100 + 3 * u * t * t * 130 + t * t * t * 130, py = -25 * 3 * t * u; d = Math.min(d, Math.hypot(px - x, py - y)); } return +d.toFixed(4); };
const t = await openBezierPickPage({ tag: 'shaper-snap' });
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const out = {};
try {
  await t.open();
  const { probes } = t;
  // the Line tool ending on the body
  await t.fresh('bezier'); await t.clearNotes();
  out.lineSnap = await probes.lineSnap('bezier', 'body');
  out.lineSnapNotes = await t.notes();
  assert.strictEqual(out.lineSnap.snapWhileHovering, 'shape@s_bezier_b762a', 'the line\'s end snaps to the bezier body while hovering it');
  out.endOffCurve = offCurve(out.lineSnap.end);
  assert.ok(out.endOffCurve < 0.01 && Math.hypot(out.lineSnap.end[0] - 115, out.lineSnap.end[1] + 18.75) < 1, 'the end lands on the curve, where it was pressed: ' + out.lineSnap.end + ' (' + out.endOffCurve + ' mm off the curve)');
  assert.ok(!out.lineSnap.newConstraints.some((c) => c.startsWith('pointOnLine')), 'no point-on-line on the bezier: ' + out.lineSnap.newConstraints);
  assert.ok(out.lineSnapNotes.includes('Point on curve: a point cannot be held on a Bezier curve (it stays where it was placed, not held)'), 'the notice says why: ' + JSON.stringify(out.lineSnapNotes));
  // Close path by the body: the chain's second bezier turned to end at (130, 20) so the closing line crosses neither curve
  await t.fresh('bezier');
  await t.evalJs(`(() => { const st = ${ST}; st.joints.set('jb2', { x: 130, y: 20, fixed: false }); const b = st.shapes.find((s) => s.id === 's_bezier_b762b'); b.c1 = [140, 5]; b.c2 = [140, 15]; st.saveState('762 close'); })()`);
  await t.ribbon('tool-closePath'); await t.press(await t.toScreen(115, -18.75));
  out.closePath = await t.evalJs(`import('/packages/core/loop-finder.js').then((L) => L.findLoops(${ST}).map((l) => l.edges))`);
  assert.ok(out.closePath.some((e) => e.includes('s_bezier_b762a') && e.includes('s_bezier_b762b')), 'Close path picked by the body closed the chain: ' + JSON.stringify(out.closePath));
  console.log(`bezier-pick-762-shaper-snap-live: ALL CHECKS PASSED ${JSON.stringify(out)}`);
} finally { await t.close(); }
