// tests/leadin-arc-778-phone-live.test.js — TASK 778, phone 390 x 844, real touch, mm:
//  - Calculated defaults + 44 px buttons / Reset / handle hit area
//  - Real finger drag of .sk-lead-handle: moves leadInAt, NEVER pans view, refused corner shows .is-refused & does not commit, undo restores
//  - Before/after drag screenshots + pocket start mark screenshot to .evidence/778/
import assert from 'node:assert';
import path from 'node:path';
import { openPocketPage } from './helpers/pocket-live.js';
import { sleep } from './helpers/cdp-browser.js';

const EVIDENCE_DIR = path.resolve('.evidence/778');
const t = await openPocketPage({
  tag: '778-phone',
  phone: true,
  evidenceDir: EVIDENCE_DIR,
});
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }

try {
  const { send, evalJs, waitFor, clickEl, clickWorld, pickType, typeField, openMode, shot, shotWorld, setUnit, pickClearing, setLoop } = t;
  await setUnit('mm');
  await openMode('design');
  await waitFor('!!(window.__designController && window.__designController.state)', 'design ready');
  await evalJs(`import('/tests/helpers/plan-v2.js').then((m) => m.V2_PLAN.clear())`);
  await evalJs(`(() => {
    const st = window.__designController.state;
    for (const k of [...st.joints.keys()]) st.joints.delete(k);
    st.shapes.length = 0; st.constraints.length = 0;
    const poly = (name, pts) => { pts.forEach(([x, y], i) => st.joints.set(name + 'j' + i, { x, y })); pts.forEach((_, i) => st.shapes.push({ id: name + 's' + i, type: 'line', joints: [name + 'j' + i, name + 'j' + ((i + 1) % pts.length)] })); };
    poly('A', [[0, 0], [60, 0], [60, 40], [0, 40]]);
    poly('P', [[0, 60], [60, 60], [60, 100], [0, 100]]);
    st.saveState('draw');
  })()`);
  await openMode('prepare');
  if (!await evalJs(`document.querySelector('#prepare-ops .ops-body').hidden`)) await clickEl('#prepare-ops .ops-head');

  const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 4, radiusY: 4, force: 1 })) });
  const screenOf = (x, y) => evalJs(`(() => { const svg = document.getElementById('prepare-canvas'); const p = svg.createSVGPoint(); p.x = ${x}; p.y = ${y}; const s = p.matrixTransform(svg.getScreenCTM()); return { x: Math.round(s.x), y: Math.round(s.y) }; })()`);

  // Frame A in the upper free strip left of the card, select it
  await evalJs(`window.__prepareView.setView({ x: 55, y: 30, w: 140 })`);
  await sleep(200);
  await clickWorld(30, 20);
  await waitFor(`!document.querySelector('#prepare-panel .cut-card').hidden`, 'card open');
  await pickType('online');
  await typeField('.cut-depth', '3');
  await clickEl('#prepare-panel .cut-row[data-row="leadIn"] .cut-preset[data-value="true"]');
  await sleep(250);
  await typeField('.cut-lead-radius', '10');
  await typeField('.cut-lead-sweep', '90');

  // Verify 44 px touch targets on Reset button & handle hit circle
  const hitBox = await evalJs(`(() => { const h = document.querySelector('#prepare-canvas .sk-lead-hit').getBoundingClientRect(); const r = document.querySelector('.cut-calc-reset[data-reset="leadInRadius"]').getBoundingClientRect(); return { hitW: Math.round(h.width), hitH: Math.round(h.height), resetH: Math.round(r.height) }; })()`);
  console.log('phone hit boxes: ' + JSON.stringify(hitBox));
  assert.ok(hitBox.hitW >= 43 && hitBox.hitH >= 43, `phone handle hit area >= 44 px: ${JSON.stringify(hitBox)}`);
  assert.ok(hitBox.resetH >= 44, `phone Reset button >= 44 px tall: ${JSON.stringify(hitBox)}`);

  // Position A comfortably in the visible left/upper strip so the handle and target edge are clear of the card
  await evalJs(`(() => { const v = window.__prepareView, svg = document.getElementById('prepare-canvas'), c = svg.getBoundingClientRect(), card = document.querySelector('#prepare-panel').getBoundingClientRect();
    const L = 48, R = card.left - 8, k = Math.min((R - L) / 76, (c.height * 0.4) / 56), w = c.width / k;
    v.setView({ x: -8 - (L - c.left) / k + w / 2, y: 20 + (c.height / 2 - c.height * 0.3) / k, w }); })()`);
  await sleep(250);
  await shotWorld('phone-drag-before.png', [-10, -10, 70, 50], 2);

  const view0 = await evalJs(`({ ...window.__prepareView.view })`);
  const recA = () => evalJs(`import('/tests/helpers/plan-v2.js').then((C) => { const k = [...window.__prepareView.selection.keys()][0]; return C.V2_PLAN.get(k).leadInAt ?? null; })`);
  assert.strictEqual(await recA(), null, 'phone before drag: leadInAt null');

  // Real finger touch drag from (30, 0) to (50, 0)
  const p0 = await screenOf(30, 0), p1 = await screenOf(50, 0);
  await T('touchStart', [p0]);
  await sleep(50);
  await T('touchMove', [{ x: Math.round((p0.x + p1.x) / 2), y: p0.y }]);
  await sleep(50);
  await T('touchMove', [p1]);
  await sleep(80);
  await T('touchEnd', []);
  await sleep(250);

  const view1 = await evalJs(`({ ...window.__prepareView.view })`);
  assert.deepStrictEqual(view1, view0, 'phone finger drag of handle NEVER pans the view');
  const movedAt = await recA();
  assert.ok(movedAt != null && Math.abs(movedAt - 50 / 200) < 0.06, `phone finger drag moved leadInAt to ~0.25: ${movedAt}`);
  assert.strictEqual(await evalJs(`document.querySelector('.cut-pos-state').textContent`), 'moved', 'phone Position row reads moved');
  await shotWorld('phone-drag-after.png', [-10, -10, 70, 50], 2);

  // Switch to Inside and drag into tight corner (x=2, y=0): refused style during drag, not committed on release
  await clickEl('#prepare-panel .cut-row[data-row="leadInSide"] .cut-preset[data-value="inside"]');
  await sleep(200);
  const beforeRefused = await recA();
  const hPos = await evalJs(`(() => { const r = document.querySelector('#prepare-canvas .sk-lead-handle').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  const pBad = await screenOf(2, 0);
  await T('touchStart', [hPos]);
  await sleep(50);
  await T('touchMove', [pBad]);
  await sleep(100);
  assert.strictEqual(await evalJs(`!!document.querySelector('#prepare-canvas .sk-lead-leg.is-refused')`), true, 'phone drag over refused corner shows .is-refused');
  await T('touchEnd', []);
  await sleep(200);
  assert.strictEqual(await recA(), beforeRefused, 'phone release on refused corner keeps last good leadInAt');

  // Undo side then undo drag via real Ctrl+Z -> back to null
  const ctrlZ = async () => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 });
    await sleep(150);
  };
  await ctrlZ();
  await ctrlZ();
  assert.strictEqual(await recA(), null, 'phone undo restores leadInAt to null');

  // Pocket P: Spiral + Loop -> no Lead-in row, 1 start mark target
  await evalJs(`window.__prepareView.setView({ x: 55, y: 90, w: 140 })`);
  await sleep(200);
  await clickWorld(6, 95);
  await waitFor(`!document.querySelector('#prepare-panel .cut-card').hidden`, 'pocket card');
  await pickType('pocket');
  await typeField('.cut-depth', '6');
  await typeField('.cut-bit', '6');
  await pickClearing('linked');
  await setLoop(true);
  assert.strictEqual(await evalJs(`getComputedStyle(document.querySelector('.cut-row[data-row="leadIn"]')).display`), 'none', 'phone pocket: no Lead-in row');
  assert.strictEqual(await evalJs(`document.querySelectorAll('#prepare-toolpath-group .sk-pocket-start').length`), 1, 'phone pocket: 1 start mark target');
  await shotWorld('phone-pocket-start.png', [-6, 54, 66, 106], 2);
  console.log('leadin-arc-778-phone-live: ok');
} finally {
  await t.close();
}
