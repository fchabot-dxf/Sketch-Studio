// tests/bezier-pick-762-shaper-live.test.js — TASK 762, Shaper's Design tab in depth, desktop 1280 x 800, real mouse (tests/helpers/bezier-pick-live.js:
// the scene of a line, an arc and a chain of two beziers; every result read from the page's state). The SELECT rows of the facts table for a BEZIER
// body, at its t = 0.5 point (far from its chord and its ends):
//  hover lights it (the hover owner: the curve itself, it is in no user group); a click selects it; a body drag moves its two end joints AND its two
//  control points by the same vector; a double click selects its chain (the two beziers). (Boxes, the menu, the line and the arc: -box-live.)
//  Screenshot: .evidence/762/shaper-hover-bezier-body.png (the hovered curve, zoomed).
import assert from 'node:assert';
import { openBezierPickPage, SHAPE } from './helpers/bezier-pick-live.js';

const t = await openBezierPickPage({ tag: 'shaper' });
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const out = {};
try {
  await t.open();
  const { probes } = t;
  const B = SHAPE.bezier, B2 = 's_bezier_b762b';
  out.hover = await probes.hover('bezier');
  assert.deepStrictEqual(out.hover, { hovered: B, hoverOwner: B }, 'the pointer on the body hovers the bezier');
  await t.shot('shaper-hover-bezier-body.png', await t.worldClip(95, -28, 165, 28, 25));
  out.click = await probes.click('bezier');
  assert.deepStrictEqual(out.click, [B], 'a click on the body selects it');
  out.drag = await probes.drag('bezier');
  const v = out.drag.ends[0];
  assert.ok(Math.hypot(...v) > 3, 'the body drag moved the curve: ' + JSON.stringify(out.drag));
  assert.ok([out.drag.ends[1], out.drag.c1, out.drag.c2].every((w) => Math.hypot(w[0] - v[0], w[1] - v[1]) < 0.011), 'both ends and both control points moved by the same vector: ' + JSON.stringify(out.drag));
  out.dblclick = await probes.dblclick('bezier');
  assert.deepStrictEqual(out.dblclick, [B, B2].sort(), 'a double click selects the chain');
  console.log(`bezier-pick-762-shaper-live: ALL CHECKS PASSED ${JSON.stringify(out)}`);
} finally { await t.close(); }
