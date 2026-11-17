// tests/bezier-pick-762-shaper-box-live.test.js — TASK 762, Shaper's Design tab, desktop 1280 x 800, real mouse (tests/helpers/bezier-pick-live.js, the scene
// of a line, an arc and a chain of two beziers). The rest of the SELECT rows of the facts table: a window box around the bezier's ends selects it, a
// crossing box over its body alone selects nothing (as for a line or an arc: a box takes curves by their points); the right-click menu opens on its body
// with it selected; the line and the arc are still picked at their body points.
import assert from 'node:assert';
import { openBezierPickPage, SHAPE, BODY } from './helpers/bezier-pick-live.js';

const t = await openBezierPickPage({ tag: 'shaper-box' });
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const out = {};
try {
  await t.open();
  const { probes } = t;
  const B = SHAPE.bezier;
  out.boxWindow = await probes.boxWindow('bezier');
  assert.deepStrictEqual(out.boxWindow, [B], 'a window box around its ends selects it');
  out.boxCrossing = await probes.boxCrossing('bezier');
  assert.deepStrictEqual(out.boxCrossing, [], 'a crossing box over the body alone selects nothing (a box takes curves by their points, as lines and arcs)');
  out.menu = await probes.menu('bezier');
  assert.ok(out.menu.menu && out.menu.items > 0 && JSON.stringify(out.menu.selected) === JSON.stringify([B]), 'the right-click menu opens on the body, the bezier selected: ' + JSON.stringify(out.menu));
  out.line = await probes.click('line');
  out.arc = await probes.click('arc');
  assert.deepStrictEqual([out.line, out.arc], [[SHAPE.line], [SHAPE.arc]], 'the line and the arc are picked at ' + JSON.stringify([BODY.line, BODY.arc]) + ' as before');
  console.log(`bezier-pick-762-shaper-box-live: ALL CHECKS PASSED ${JSON.stringify(out)}`);
} finally { await t.close(); }
