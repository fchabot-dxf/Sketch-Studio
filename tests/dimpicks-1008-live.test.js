// tests/dimpicks-1008-live.test.js — TASK 1008 live Chromium guarding test (Desktop 1280x800 mouse + Phone 390x844 touch), the Shaper's Design tab
// (it exposes window.__designController.state; the Design tab is the same shared one in every host).
//   circle rim picks (D-8): a point then a circle rim = the distance to the centre; a circle click = a Diameter dimension (task 1008 item 1)
//   dimension label drag in the Dimension tool (D-10): the label moves, no second dimension is born, the tool stays
// The node twin (every pair, arcs, lines, origin; Tab, reference names, reference-only circles): tests/dimpicks-1008-node.test.js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';

const EVIDENCE = process.env.EVIDENCE_DIR || '';   // set by the task's evidence run: screenshots go there
const CANVAS = 'design-canvas';

function makeDoc(joints, shapes, constraints = []) {
  return {
    version: 3, hosts: {},
    geometry: {
      joints: [
        ['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }],
        ...Object.entries(joints).map(([id, [x, y, fixed]]) => [id, { x, y, fixed: !!fixed, sketchId: 'sketch-1' }]),
      ],
      shapes: shapes.map((s) => ({ sketchId: 'sketch-1', isConstruction: false, ...s })),
      constraints, parameters: [],
      sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }],
      activeSketchId: 'sketch-1', groups: [], profiles: [],
    },
  };
}

async function openSeeded(cdp, doc) {
  const { port, evalJs, waitForApp, navigate } = cdp;
  const url = `http://127.0.0.1:${port}/apps/shaper/index.html`;
  await resetBufferLive(cdp);
  await navigate(url, 12000);
  await waitForApp(CANVAS);
  await evalJs(`import('/packages/ui/project-store.js').then(async (m) => { const s = m.getProjectStore(); const d = await s.newDesign('DimPicks 1008', { app: 'shaper' }); await s.save(${JSON.stringify(doc)}, { app: 'shaper', id: d.id }); })`);
  await navigate(url, 12000);
  await waitForApp(CANVAS);
  await cdp.waitFor(`!!window.__designController && window.__designController.state.shapes.length > 0`, 'the seeded design');
  await sleep(400);
}
const st = (cdp, expr) => cdp.evalJs(`JSON.stringify((() => { const st = window.__designController.state; return ${expr}; })())`).then(JSON.parse);
async function setView(cdp, cx, cy, vw) {
  await cdp.evalJs(`(() => {
    const svg = document.getElementById('${CANVAS}');
    const r = svg.getBoundingClientRect();
    const vh = ${vw} / (r.width / r.height);
    svg.setAttribute('viewBox', (${cx} - ${vw}/2) + ' ' + (${cy} - vh/2) + ' ' + ${vw} + ' ' + vh);
    const s = window.__designController.state; s.view.x = ${cx}; s.view.y = ${cy}; s.view.w = ${vw}; s.view.h = vh;
  })()`);
  await sleep(150);
}
const w2s = (cdp, wx, wy) => cdp.evalJs(`(() => {
  const svg = document.getElementById('${CANVAS}');
  const pt = svg.createSVGPoint(); pt.x = ${wx}; pt.y = ${wy};
  const p = pt.matrixTransform(svg.getScreenCTM());
  return { x: p.x, y: p.y };
})()`);
const shot = async (cdp, name) => {
  if (!EVIDENCE) return;
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(EVIDENCE, { recursive: true });
  fs.writeFileSync(`${EVIDENCE}/${name}.png`, Buffer.from(r.data, 'base64'));
};

const mouse = {
  click: async (cdp, x, y) => {
    const rx = Math.round(x), ry = Math.round(y);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rx, y: ry, button: 'none', clickCount: 0 });
    await sleep(30);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rx, y: ry, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(30);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rx, y: ry, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(200);
  },
  drag: async (cdp, a, b) => {
    const ax = Math.round(a.x), ay = Math.round(a.y);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ax, y: ay, button: 'none', clickCount: 0 });
    await sleep(30);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: ax, y: ay, button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 6; i++) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(a.x + (b.x - a.x) * i / 6), y: Math.round(a.y + (b.y - a.y) * i / 6), button: 'left', buttons: 1 });
      await sleep(25);
    }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(b.x), y: Math.round(b.y), button: 'left', buttons: 0, clickCount: 1 });
    await sleep(250);
  },
};
const touch = {
  click: async (cdp, x, y) => {
    const rx = Math.round(x), ry = Math.round(y);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rx, y: ry, id: 1, radiusX: 2, radiusY: 2, force: 1 }] });
    await sleep(45);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(250);
  },
  drag: async (cdp, a, b) => {
    const tp = (p) => [{ x: Math.round(p.x), y: Math.round(p.y), id: 1, radiusX: 2, radiusY: 2, force: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(a) });
    await sleep(40);
    for (let i = 1; i <= 6; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp({ x: a.x + (b.x - a.x) * i / 6, y: a.y + (b.y - a.y) * i / 6 }) });
      await sleep(25);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(300);
  },
};

// one circle (rim click at 20,-25 + 15 = 35,-25), a free point p1, a line with a dimension
const docPicks = () => makeDoc({ p1: [-40, 20], cc: [20, -25] }, [{ id: 'C1', type: 'circle', joints: ['cc'], radius: 15 }]);
const docLabel = () => makeDoc({ a: [0, 0, true], b: [60, 0] }, [{ id: 'L1', type: 'line', joints: ['a', 'b'] }],
  [{ type: 'distance', joints: ['a', 'b'], value: 60, dimMode: 'horizontal', offset: -20, name: 'd1' }]);

async function suite(label, cdp, T, shotPrefix) {
  const pressTool = (tool) => pressRibbonTool(cdp.evalJs, (p) => T.click(cdp, p.x, p.y), `tool-${tool}`);
  const dims = () => st(cdp, `st.constraints.filter(c => c.type === 'distance').map(c => ({ n: c.name, j: c.joints || null, s: c.shape || null, dia: !!c.isDiameter, ref: !!(c.isDriven || c.driven), v: c.value, off: c.offset, slide: c.labelSlide, mode: c.dimMode || null }))`);

  // D-8: a point, then a circle rim -> the distance from the point to the circle's centre
  await openSeeded(cdp, docPicks());
  await setView(cdp, 10, -10, 200);
  await pressTool('dim');
  const pP = await w2s(cdp, -40, 20), pRim = await w2s(cdp, 35, -25);
  await T.click(cdp, pP.x, pP.y);
  await T.click(cdp, pRim.x, pRim.y);
  let ds = await dims();
  assert.equal(ds.length, 1, `${label} D-8: one dimension from point + rim: ${JSON.stringify(ds)}`);
  assert.deepEqual(ds[0].j && ds[0].j.slice().sort(), ['cc', 'p1'], `${label} D-8: it is the distance point - centre: ${JSON.stringify(ds)}`);
  assert.equal(ds[0].s, null, `${label} D-8: not a circle size`);
  await shot(cdp, `${shotPrefix}-rim-pick-point-to-centre`);
  console.log(`PASS ${label} D-8 point + circle rim = distance to the centre`, JSON.stringify(ds[0]));

  // item 1: a click on the circle = a DIAMETER dimension (label reads Ø), the tool stays active
  await openSeeded(cdp, docPicks());
  await setView(cdp, 10, -10, 200);
  await pressTool('dim');
  const pPlace = await w2s(cdp, 60, -45);
  await T.click(cdp, pRim.x, pRim.y);
  await T.click(cdp, pPlace.x, pPlace.y);
  await sleep(250);
  await cdp.evalJs(`(() => { const i = document.getElementById('dimInput'); return i && !i.classList.contains('hidden'); })()`).then(async (open) => { if (open) { await sendRealKey(cdp.send, 'Enter'); await sleep(250); } });
  ds = await dims();
  assert.equal(ds.length, 1, `${label} item 1: one dimension: ${JSON.stringify(ds)}`);
  assert.equal(ds[0].dia, true, `${label} item 1: a diameter`);
  const labels = await cdp.evalJs(`[...document.querySelectorAll('#${CANVAS} .dim-label text')].map(t => t.textContent.trim())`);
  assert.ok(labels.length === 1 && labels[0].startsWith('Ø'), `${label} item 1: the label reads Ø: ${JSON.stringify(labels)}`);
  assert.equal(await st(cdp, 'st.currentTool'), 'dim', `${label} item 1: the Dimension tool stays active`);
  await shot(cdp, `${shotPrefix}-circle-diameter`);
  console.log(`PASS ${label} item 1 circle = Diameter`, JSON.stringify(labels));

  // D-10: drag an existing dimension's label while the Dimension tool is active
  await openSeeded(cdp, docLabel());
  await setView(cdp, 30, 0, 140);
  await pressTool('dim');
  const g = await st(cdp, 'st.constraints.find(c => c.name === "d1").glyphPos');
  const pl = await w2s(cdp, g.x, g.y);
  const labelPos = await cdp.evalJs(`(() => { const e = document.querySelector('#${CANVAS} .dim-label'); const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
  const before = (await dims())[0];
  const h0 = await st(cdp, 'st.history.length');
  await T.drag(cdp, labelPos, { x: labelPos.x + 30, y: labelPos.y - 35 });
  ds = await dims();
  assert.equal(ds.length, 1, `${label} D-10: no second dimension: ${JSON.stringify(ds)} (pl ${JSON.stringify(pl)})`);
  assert.ok(ds[0].off !== before.off || ds[0].slide !== before.slide, `${label} D-10: the label moved: ${JSON.stringify(before)} -> ${JSON.stringify(ds[0])}`);
  assert.equal(await st(cdp, 'st.currentTool'), 'dim', `${label} D-10: the tool stays`);
  assert.equal(await st(cdp, 'st.history.length') - h0, 1, `${label} D-10: one undo step`);
  assert.equal(await st(cdp, '!!st.placingConstraint'), false, `${label} D-10: nothing left placing`);
  await shot(cdp, `${shotPrefix}-label-dragged-in-dim-tool`);
  console.log(`PASS ${label} D-10 label drag in the Dimension tool`, JSON.stringify(before), '->', JSON.stringify(ds[0]));
}

const ARGS = ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'];
{
  const cdp = await launchBrowser({ tag: '1008-desktop', width: 1280, height: 800, args: ARGS });
  if (!cdp) { console.log('SKIP: no headless Chrome/Edge installed'); process.exit(0); }
  try {
    await installFakeDriveSession(cdp);
    await suite('desktop 1280x800', cdp, mouse, 'desktop');
  } finally { await cdp.close(); }
}
{
  const cdp = await launchBrowser({ tag: '1008-phone', width: 390, height: 844, args: ARGS });
  if (cdp) {
    try {
      await installFakeDriveSession(cdp);
      await suite('phone 390x844', cdp, touch, 'phone');
    } finally { await cdp.close(); }
  }
}
console.log('ALL dimpicks-1008-live tests PASSED');
process.exit(0);
