// tests/bezier-pick-762-close-live.test.js — TASK 762, the BEZIER tool closes on its first anchor, Shaper desktop 1280 x 800, real mouse
// (tests/helpers/bezier-pick-live.js bezierToolFacts): a corner, a corner, a dragged smooth anchor, then the pointer 6 / 5 px off the FIRST anchor:
//  the snap marker is on the first anchor (state.snapTarget, the Line tool's snap; screenshot .evidence/762/shaper-closing-snap-marker.png); the click
//  there: the anchor IS the first one (TASK 1045, Fusion measured 2026-11-27: one shared point, no coincident), the path ends, the page's findLoops returns ONE loop of the three
//  beziers; Enter afterwards changes nothing;
//  Prepare: a click inside picks the region and the type menu (TASK S3: the operations toolbar) offers Inside, Outside and Pocket.
import assert from 'node:assert';
import { sleep } from './helpers/cdp-browser.js';
import { openBezierPickPage, bezierToolFacts, ST } from './helpers/bezier-pick-live.js';

const t = await openBezierPickPage({ tag: 'close' });
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const out = {};
try {
  await t.open();
  const f = await bezierToolFacts(t, { endWith: 'enter', shot: 'shaper-closing-snap-marker.png' });
  out.snapShown = f.snapShown; out.afterClose = f.afterClose; out.final = f.final;
  const first = await t.evalJs(`${ST}.shapes[0].joints[0]`);
  assert.strictEqual(f.snapShown, 'joint@' + first, 'the snap marker is on the first anchor');
  assert.deepStrictEqual(f.afterClose, { shapes: ['bezier', 'bezier', 'bezier'], jointsAtFirst: 1, constraints: [], loops: [3], drawing: false, tool: 'bezier' }, 'the click closed the outline and ended the path: ' + JSON.stringify(f.afterClose));
  assert.deepStrictEqual(f.final, { shapes: 3, loops: [3], constraints: [], drawing: false }, 'Enter afterwards changes nothing');
  // Prepare: the region
  await t.evalJs(`document.querySelector('.sk-header-tab[data-tab="prepare"]').click()`);
  await t.waitFor(`!!document.getElementById('prepare-canvas').getScreenCTM() && document.querySelectorAll('#prepare-world-group path[data-shape-id]').length === 3`, 'Prepare draws the three bezier edges');
  await sleep(300);
  const inner = await t.evalJs(`Promise.all([import('/packages/core/loop-finder.js'), import('/packages/core/loop-geometry.js')]).then(([L, G]) => { const st = ${ST}, by = new Map(st.shapes.map((s) => [s.id, s]));
    const p = G.loopPolygon(L.findLoops(st)[0], st, by); const cx = p.reduce((a, q) => a + q.x, 0) / p.length, cy = p.reduce((a, q) => a + q.y, 0) / p.length;
    const svg = document.getElementById('prepare-canvas'), pt = svg.createSVGPoint(); pt.x = cx; pt.y = cy; const s = pt.matrixTransform(svg.getScreenCTM()); return G.pointInPolygon(p, { x: cx, y: cy }) ? { x: s.x, y: s.y } : null; })`);
  assert.ok(inner, 'an inner point of the region');
  await t.click(inner);
  await t.waitFor(`window.__prepareView.selectedTargets().length === 1`, 'a click inside picks the region'); // TASK S3: a click shows no card; the operations toolbar offers the types
  out.menu = await t.evalJs(`Object.fromEntries([...document.querySelectorAll('#prepare-ribbon [id^="op-type-"]')].map((o) => [o.id.slice(8), !o.disabled && !o.hidden]))`);
  assert.deepStrictEqual([out.menu.interior, out.menu.exterior, out.menu.pocket], [true, true, true], 'Inside, Outside and Pocket are offered: ' + JSON.stringify(out.menu));
  console.log(`bezier-pick-762-close-live: ALL CHECKS PASSED ${JSON.stringify(out)}`);
} finally { await t.close(); }
