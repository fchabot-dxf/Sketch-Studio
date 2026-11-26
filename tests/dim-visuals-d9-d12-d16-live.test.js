// tests/dim-visuals-d9-d12-d16-live.test.js -- D-9, D-12, D-16 (TASK 1010, BUG-130..132) in a real headless browser, desktop 1280x800
// and phone 390x844 (touch): the angle arrowheads point along the arc, the radius leader stops at the "R" text, and a narrow
// label ("5") is hit from beside it. Screenshots (zoomed) go to .evidence/1010/.
import assert from 'node:assert';
import { launchBrowser } from './helpers/cdp-browser.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { docOf } from './helpers/display-1010.js';
import { NO_NET, openSeeded, setView, w2s, mouseMove, touchTap, shot } from './helpers/display-1010-live.js';

const doc = docOf(
  { a: [0, 0, true], b: [60, 0, true], c: [30, 51.9615], cc: [-45, 20, true], n1: [80, 0, true], n2: [85, 0, true] },
  [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['a', 'c'] }, { id: 'C1', type: 'circle', joints: ['cc'], radius: 18 }, { id: 'LN', type: 'line', joints: ['n1', 'n2'] }],
  [
    { type: 'angle', shapes: ['L1', 'L2'], value: 60, sector: { ray1: 1, ray2: 1, turn: 1 }, offset: 32, name: 'd1' },
    { type: 'distance', shape: 'C1', value: 18, isRadius: true, offset: 34, labelAngle: 0.35, name: 'd2' },
    { type: 'distance', joints: ['n1', 'n2'], value: 5, dimMode: 'horizontal', offset: -18, name: 'd3' },
  ],
);

// the arrows of dimension `idx`: how far each points along the arc tangent / the radial (the angle's vertex is the origin)
const ARROWS = (idx) => `(() => {
  const svg = document.getElementById('svgCanvas');
  return [...svg.querySelectorAll('polygon[data-constraint-idx="${idx}"]')].map((p) => {
    const [tip, b1, b2] = p.getAttribute('points').trim().split(/\\s+/).map((q) => q.split(',').map(Number));
    const d = [tip[0] - (b1[0] + b2[0]) / 2, tip[1] - (b1[1] + b2[1]) / 2], l = Math.hypot(d[0], d[1]), r = Math.hypot(tip[0], tip[1]);
    return { radial: (d[0] * tip[0] + d[1] * tip[1]) / (l * r), tangent: (d[0] * -tip[1] + d[1] * tip[0]) / (l * r) };
  });
})()`;
// the radius leader's end point vs the label text's screen box
const LEADER = (idx) => `(() => {
  const svg = document.getElementById('svgCanvas');
  const line = svg.querySelector('line[data-constraint-idx="${idx}"]'), t = svg.querySelector('.dim-label[data-constraint-idx="${idx}"] text');
  const m = svg.getScreenCTM(), end = new DOMPoint(+line.getAttribute('x2'), +line.getAttribute('y2')).matrixTransform(m);
  const b = t.getBoundingClientRect();
  return { inside: end.x > b.left + 1 && end.x < b.right - 1 && end.y > b.top + 1 && end.y < b.bottom - 1, end: [end.x, end.y], box: [b.left, b.top, b.right, b.bottom] };
})()`;
const LABEL_BOX = (canvas, idx) => `(() => { const b = document.querySelector('#${canvas} .dim-label[data-constraint-idx="${idx}"] text').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`;

async function run(tag, width, height, touch) {
  const cdp = await launchBrowser({ tag, width, height, args: NO_NET });
  if (!cdp) { console.log(`skipped ${tag}: no headless browser`); return; }
  try {
    await installFakeDriveSession(cdp);
    await openSeeded(cdp, doc);
    await setView(cdp, 'svgCanvas', 20, 20, touch ? 180 : 190);
    // D-9
    const arrows = await cdp.evalJs(ARROWS(0));
    console.log(tag, 'D-9 arrows', JSON.stringify(arrows));
    assert.strictEqual(arrows.length, 2);
    assert.ok(arrows.every((a) => Math.abs(a.radial) < 1e-3 && Math.abs(a.tangent) > 0.999), `angle arrows point along the arc: ${JSON.stringify(arrows)}`);
    const p = await w2s(cdp, 'svgCanvas', 22, 18);
    await shot(cdp, `${tag}-d9-angle-arrows.png`, { x: p.x - 70, y: p.y - 70, width: 140, height: 140 });
    // D-12
    const lead = await cdp.evalJs(LEADER(1));
    console.log(tag, 'D-12 leader', JSON.stringify(lead));
    assert.ok(!lead.inside, `the radius leader ends outside the "R 18" text: ${JSON.stringify(lead)}`);
    const [bl, bt, br, bb] = lead.box;
    await shot(cdp, `${tag}-d12-radius-leader.png`, { x: (bl + br) / 2 - 55, y: (bt + bb) / 2 - 35, width: 110, height: 70 }, 5);
    // D-16 (Shaper: its page exposes the design state): the "5" is 6 px wide; a pointer / finger 9 px beside it still picks it
    await openSeeded(cdp, doc, { host: 'shaper', canvas: 'design-canvas', url: '/apps/shaper/index.html' });
    await setView(cdp, 'design-canvas', 82.5, -18, 60);
    const sel = (js) => cdp.evalJs(`(() => { const st = window.__designController.state; return ${js}; })()`);
    const box = await cdp.evalJs(LABEL_BOX('design-canvas', 2));
    const at = { x: box.x + box.w / 2, y: box.y + box.h + 3 }; // 3 px under the label's 15 px high drawn box (the minimum hit area is 24 px)
    if (touch) await touchTap(cdp, at.x, at.y); else await mouseMove(cdp, at.x, at.y);
    const hit = touch ? await sel('st.selectedConstraints.size') : await sel('st.hoveredConstraint ? st.hoveredConstraint.name : null');
    console.log(tag, 'D-16 label box', JSON.stringify(box), touch ? 'selected' : 'hovered', JSON.stringify(hit));
    assert.ok(touch ? hit === 1 : hit === 'd3', `a pointer 3 px under the drawn "5" box reaches it: ${JSON.stringify(hit)}`);
    await shot(cdp, `${tag}-d16-narrow-label.png`, { x: box.x - 50, y: box.y - 40, width: 110, height: 80 });
    console.log(`PASS ${tag}`);
  } finally { await cdp.close(); }
}

await run('1010-desktop', 1280, 800, false);
await run('1010-phone', 390, 844, true);
process.exit(0);
