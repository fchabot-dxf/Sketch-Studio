// tests/bezier-snap-872-live.test.js — TASK 872, the Bezier pen's ANCHORS snap and attach like the Line tool's points (owner turn 3393; audit 869 cause J).
// Shaper's Design tab (tests/helpers/bezier-pick-live.js), desktop 1280 x 800 (real mouse) and phone 390 x 844 (real touch). A Bezier whose first anchor is
// in free space and whose SECOND anchor is pressed 4 px off the scene's line, at mid-span (10, 0): the snap marker shows on the line on hover (desktop), the
// anchor lies ON the line (distance 0) with ONE point-on-line, and a Select drag of the line carries the anchor with it (distance still 0, anchor moved).
import assert from 'node:assert';
import { sleep } from './helpers/cdp-browser.js';
import { openBezierPickPage, ST, SHAPE } from './helpers/bezier-pick-live.js';

const out = {};
for (const phone of [false, true]) {
  const name = phone ? 'phone' : 'desktop';
  const t = await openBezierPickPage({ tag: '872-' + name, phone, evidence: '.evidence/872' });
  if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
  try {
    await t.open();
    await t.fresh('line');
    const { evalJs, press, drag, mouse, keys, ribbon, toScreen } = t;
    await ribbon('tool-bezier');
    const A = await toScreen(10, 14), B = await toScreen(10, 0);
    const near = { x: B.x + 4, y: B.y }; // 4 px off the line: a hand never hits the pixel
    await press(A);
    if (!phone) { await mouse('mouseMoved', near); await sleep(300); }
    const hover = await evalJs(`(() => { const s = ${ST}.snapTarget; return s ? s.type + '@' + (s.shape ? s.shape.id : s.targetId) : null; })()`);
    if (!phone) assert.strictEqual(hover, 'shape@' + SHAPE.line, 'the snap marker shows on the line while the pen hovers it');
    await press(near);
    await keys.enter();
    const facts = () => evalJs(`(() => { const st = ${ST}; const bz = st.shapes.filter((s) => s.type === 'bezier' && s.groupId !== 'bezier_b762').pop(); const j = st.joints.get(bz.joints[1]);
      const L = st.shapes.find((s) => s.id === '${SHAPE.line}'), p = st.joints.get(L.joints[0]), q = st.joints.get(L.joints[1]);
      const len = Math.hypot(q.x - p.x, q.y - p.y); const dist = Math.abs((q.x - p.x) * (p.y - j.y) - (p.x - j.x) * (q.y - p.y)) / len;
      return { dist: +dist.toFixed(6), x: +j.x.toFixed(3), y: +j.y.toFixed(3), line: [p.x, p.y, q.x, q.y].map((v) => +v.toFixed(3)),
        cons: st.constraints.filter((c) => (c.joints || [c.joint]).includes(bz.joints[1])).map((c) => c.type) }; })()`);
    const before = await facts();
    assert.strictEqual(before.dist, 0, name + ': the second anchor lies on the line (distance 0): ' + JSON.stringify(before));
    assert.deepStrictEqual(before.cons, ['pointOnLine'], name + ': one point-on-line holds it there: ' + JSON.stringify(before));
    // Select: drag the line's body (30, 0), away from the anchor and the middle, 60 px down
    await ribbon('tool-select'); await keys.esc();
    const g = await toScreen(30, 0);
    await drag(g, { x: g.x, y: g.y + 60 });
    const after = await facts();
    assert.ok(Math.abs(after.line[1] - before.line[1]) > 1, name + ': the line moved: ' + JSON.stringify([before.line, after.line]));
    assert.strictEqual(after.dist, 0, name + ': the anchor follows the dragged line (distance 0): ' + JSON.stringify(after));
    assert.ok(Math.abs(after.y - before.y) > 1, name + ': the anchor moved with it: ' + JSON.stringify([before, after]));
    out[name] = { hover, before, after };
  } finally { await t.close(); }
}
console.log(`bezier-snap-872-live: ALL CHECKS PASSED ${JSON.stringify(out)}`);
