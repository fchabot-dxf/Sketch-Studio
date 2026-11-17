// tests/bezier-pick-762-phone-live.test.js — TASK 762 on the PHONE: Shaper's Design tab at 390 x 844, real TOUCH (tests/helpers/bezier-pick-live.js; each
// kind is probed with the view centred on it at 8 px / mm, so the body point is beyond a finger's 60 px point reach from the curve's end points):
//  a tap on the bezier's BODY selects it; a one-finger drag of the body moves its two end joints AND its control points by the same vector; a double tap
//  selects its chain; touch and hold on the body opens the menu with it selected. (The Bezier tool closing by taps: bezier-pick-762-phone-close-live.)
import assert from 'node:assert';
import { openBezierPickPage, SHAPE } from './helpers/bezier-pick-live.js';

const t = await openBezierPickPage({ tag: 'phone', phone: true });
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const out = {};
try {
  await t.open();
  const { probes } = t;
  const B = SHAPE.bezier;
  out.tap = await probes.click('bezier');
  assert.deepStrictEqual(out.tap, [B], 'a tap on the body selects it');
  out.drag = await probes.drag('bezier');
  const v = out.drag.ends[0];
  assert.ok(Math.hypot(...v) > 2, 'the touch drag moved the curve: ' + JSON.stringify(out.drag));
  assert.ok([out.drag.ends[1], out.drag.c1, out.drag.c2].every((w) => Math.hypot(w[0] - v[0], w[1] - v[1]) < 0.011), 'both ends and both control points moved by the same vector: ' + JSON.stringify(out.drag));
  out.doubleTap = await probes.dblclick('bezier');
  assert.deepStrictEqual(out.doubleTap, [B, 's_bezier_b762b'], 'a double tap selects the chain');
  out.hold = await probes.menu('bezier');
  assert.ok(out.hold.menu && out.hold.items > 0 && JSON.stringify(out.hold.selected) === JSON.stringify([B]), 'touch and hold on the body opens the menu, the bezier selected: ' + JSON.stringify(out.hold));
  console.log(`bezier-pick-762-phone-live: ALL CHECKS PASSED ${JSON.stringify(out)}`);
} finally { await t.close(); }
