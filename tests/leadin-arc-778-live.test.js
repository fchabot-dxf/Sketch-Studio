// tests/leadin-arc-778-live.test.js — TASK 778, desktop 1280 x 800, mouse, INCHES:
//  - Tangential ARC lead-in on 1 in squares (0.25 in radius Outside & Inside) + 2 x 1.5 in Spiral + Loop pocket with start mark
//  - Calculated defaults tag, typing removes tag, Reset to calculated restores null + tag
//  - Draggable junction handle (mouse drag moves leadInAt, does NOT pan view, before/after screenshots, refused corner shows .is-refused & does not commit, ONE undo restores)
//  - Export 2D (arc labels + start mark row), Export 3D (board + pocket-start mark), Generate -> .evidence/778/owner-origin-test-778.svg
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { openPocketPage } from './helpers/pocket-live.js';
import { pathPoints } from './helpers/leadin-live.js';
import { sleep } from './helpers/cdp-browser.js';

const IN = 25.4;
const EVIDENCE_DIR = path.resolve('.evidence/778');
const t = await openPocketPage({
  tag: '778-desktop',
  evidenceDir: EVIDENCE_DIR,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }

try {
  const { send, evalJs, waitFor, clickEl, clickWorld, pickType, typeField, openMode, shot, shotWorld, download, fileElements, export2d, setUnit, pickClearing, setLoop } = t;
  await setUnit('in');
  await openMode('design');
  await waitFor('!!(window.__designController && window.__designController.state)', 'design ready');
  await evalJs(`import('/apps/shaper/src/cut-plan.js').then((m) => m.CUT_PLAN.clear())`);
  // Owner Origin test drawing:
  //   A: 1 in square (0..1 in)         -> On line, 0.25 in arc lead-in OUTSIDE
  //   B: 1 in square (1.75..2.75 in)   -> On line, 0.25 in arc lead-in INSIDE
  //   C: 2 x 1.5 in rect (3.5..5.5 in) -> Pocket, Spiral + Loop ON (with start mark)
  await evalJs(`(() => {
    const st = window.__designController.state;
    for (const k of [...st.joints.keys()]) st.joints.delete(k);
    st.shapes.length = 0; st.constraints.length = 0;
    const poly = (name, pts) => { pts.forEach(([x, y], i) => st.joints.set(name + 'j' + i, { x, y })); pts.forEach((_, i) => st.shapes.push({ id: name + 's' + i, type: 'line', joints: [name + 'j' + i, name + 'j' + ((i + 1) % pts.length)] })); };
    poly('A', [[0, 0], [${IN}, 0], [${IN}, ${IN}], [0, ${IN}]]);
    poly('B', [[${1.75 * IN}, 0], [${2.75 * IN}, 0], [${2.75 * IN}, ${IN}], [${1.75 * IN}, ${IN}]]);
    poly('C', [[${3.5 * IN}, 0], [${5.5 * IN}, 0], [${5.5 * IN}, ${1.5 * IN}], [${3.5 * IN}, ${1.5 * IN}]]);
    st.saveState('draw');
  })()`);
  await openMode('prepare');

  const pick = async (x, y, w = 180) => {
    await evalJs(`window.__prepareView.setView({ x: ${x}, y: ${y}, w: ${w} })`);
    await sleep(150);
    await clickWorld(x, y);
    await waitFor(`!document.querySelector('#prepare-panel .cut-card').hidden`, `card at ${x},${y}`);
  };
  const preset = async (row, v) => { await clickEl(`#prepare-panel .cut-row[data-row="${row}"] .cut-preset[data-value="${v}"]`); await sleep(200); };
  const screenOf = (x, y) => evalJs(`(() => { const svg = document.getElementById('prepare-canvas'); const p = svg.createSVGPoint(); p.x = ${x}; p.y = ${y}; const s = p.matrixTransform(svg.getScreenCTM()); return { x: Math.round(s.x), y: Math.round(s.y) }; })()`);
  const mouse = (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });

  // A: 1 in square, On line, 0.25 in arc lead-in OUTSIDE
  await pick(IN / 2, IN / 2);
  await pickType('online');
  await typeField('.cut-depth', '0.125');
  await preset('leadIn', 'true');
  // Calculated tag visible before typing; Reset hidden
  let calcState = await evalJs(`({ rVal: document.querySelector('.cut-lead-radius').value, rTag: !document.querySelector('.cut-row[data-row="leadInRadius"] .cut-calc-tag').hidden, rReset: !document.querySelector('.cut-calc-reset[data-reset="leadInRadius"]').hidden })`);
  assert.deepStrictEqual(calcState, { rVal: '0.125', rTag: true, rReset: false }, 'A: calculated Radius = 0.125 in with tag');
  await typeField('.cut-lead-radius', '0.25');
  calcState = await evalJs(`({ rVal: document.querySelector('.cut-lead-radius').value, rTag: !document.querySelector('.cut-row[data-row="leadInRadius"] .cut-calc-tag').hidden, rReset: !document.querySelector('.cut-calc-reset[data-reset="leadInRadius"]').hidden })`);
  assert.deepStrictEqual(calcState, { rVal: '0.25', rTag: false, rReset: true }, 'A: typed 0.25 removes tag, shows Reset to calculated');
  // Test Reset to calculated and re-type 0.25
  await clickEl('.cut-calc-reset[data-reset="leadInRadius"]');
  await sleep(150);
  assert.strictEqual(await evalJs(`document.querySelector('.cut-lead-radius').value`), '0.125', 'A: Reset to calculated returns to 0.125 in');
  await typeField('.cut-lead-radius', '0.25');
  await shot('desktop-card-arc.png', '#prepare-panel .cut-card', 2);
  await shotWorld('desktop-prepare-outside-arc.png', [-10, -10, IN + 10, IN + 10], 2);

  // B: 1 in square, On line, 0.25 in arc lead-in INSIDE
  await pick(2.25 * IN, IN / 2);
  await pickType('online');
  await typeField('.cut-depth', '0.125');
  await preset('leadIn', 'true');
  await preset('leadInSide', 'inside');
  await typeField('.cut-lead-radius', '0.25');
  assert.strictEqual(await evalJs(`document.querySelectorAll('#prepare-toolpath-group .sk-lead-leg').length`), 1, 'B: arc drawn in Prepare');
  await shotWorld('desktop-prepare-inside-arc.png', [1.75 * IN - 10, -10, 2.75 * IN + 10, IN + 10], 2);

  // C: 2 x 1.5 in Spiral + Loop ON pocket (no Lead-in row, 1 start mark)
  await pick(4.5 * IN, 0.75 * IN, 220);
  await pickType('pocket');
  await typeField('.cut-depth', '0.125');
  await typeField('.cut-bit', '0.125');
  await pickClearing('linked');
  await setLoop(true);
  assert.strictEqual(await evalJs(`getComputedStyle(document.querySelector('.cut-row[data-row="leadIn"]')).display`), 'none', 'C: pocket has NO Lead-in row');
  assert.strictEqual(await evalJs(`document.querySelectorAll('#prepare-toolpath-group .sk-pocket-start').length`), 1, 'C: 1 pocket start mark in Prepare');
  await shotWorld('desktop-prepare-pocket-startmark.png', [3.5 * IN - 6, -6, 5.5 * IN + 6, 1.5 * IN + 6], 2);

  // Generate the Owner Origin Test SVG BY THE APP!
  const ownerFile = path.join(EVIDENCE_DIR, 'owner-origin-test-778.svg');
  const svg = await download();
  fs.writeFileSync(ownerFile, svg);
  console.log('owner test file ' + ownerFile);
  const els = fileElements(svg);
  const online = els.filter((e) => e[2] === 'online'), guides = els.filter((e) => e[2] === 'guide');
  assert.strictEqual(online.length, 3, 'Owner SVG: 3 on-line paths (A outside arc, B inside arc, C closed Spiral Loop)');
  assert.strictEqual(guides.length, 1, 'Owner SVG: 1 guide start mark for pocket C');
  assert.ok(online.filter((e) => !/Z$/.test(e[1]) && e[1].includes(' A 6.35 6.35 ')).length === 2, 'Owner SVG: A and B are open paths with 0.25 in (6.35 mm) arc');
  assert.ok(online.filter((e) => /Z$/.test(e[1])).length === 1, 'Owner SVG: C is a closed Spiral Loop');

  // Export 2D & Export 3D checks + screenshots
  const e2 = await export2d('desktop-778');
  assert.ok(e2.rows.some((r) => /lead-in arc/.test(r)) && e2.rows.some((r) => /start mark/.test(r)), 'Export 2D lists lead-in arc and start mark: ' + JSON.stringify(e2.rows));
  await shot('desktop-export-2d.png', ['#review-stage', '#review-side']);
  await clickEl('#review-view-3d');
  await waitFor(`/triangles/.test(document.getElementById('review-info').textContent)`, '3D built');
  await sleep(600);
  const marks3d = await evalJs(`Promise.all([import('/packages/core/relief-model.js'), import('/apps/shaper/src/cut-plan.js')]).then(([R, C]) => R.buildRelief({ state: window.__designController.state, items: C.planReliefItems(window.__designController.state), stock: { thickness: 19.05 } }).marks)`);
  assert.ok(Array.isArray(marks3d) && marks3d.some((m) => m.kind === 'pocket-start'), 'Export 3D builds pocket-start mark: ' + JSON.stringify(marks3d));
  await clickEl('#review-top');
  await sleep(500);
  await shot('desktop-export-3d.png', '#review-stage');

  // Draggable handle on Shape A (Outside 0.25 in arc): drag along top edge + refused corner + undo
  await openMode('prepare');
  await pick(IN / 2, IN / 2, 90);
  await evalJs(`window.__prepareView.setView({ x: ${IN / 2}, y: ${IN / 2}, w: 90 })`);
  await sleep(200);
  await shotWorld('desktop-drag-before.png', [-10, -10, IN + 10, IN + 10], 2);
  const view0 = await evalJs(`({ ...window.__prepareView.view })`);
  const recA = () => evalJs(`import('/apps/shaper/src/cut-plan.js').then((C) => { const k = [...window.__prepareView.selection.keys()][0]; const r = C.CUT_PLAN.get(k); return { leadInAt: r.leadInAt ?? null, leadInSide: r.leadInSide }; })`);
  assert.strictEqual((await recA()).leadInAt, null, 'before drag: leadInAt is null (calculated)');

  // Drag from junction (IN/2, 0) to right edge middle (IN, IN/2)
  const pStart = await screenOf(IN / 2, 0);
  const pEnd = await screenOf(IN, IN / 2);
  await mouse('mouseMoved', pStart.x, pStart.y);
  await mouse('mousePressed', pStart.x, pStart.y, 1);
  await sleep(50);
  await mouse('mouseMoved', Math.round((pStart.x + pEnd.x) / 2), Math.round((pStart.y + pEnd.y) / 2), 1);
  await sleep(50);
  await mouse('mouseMoved', pEnd.x, pEnd.y, 1);
  await sleep(80);
  await mouse('mouseReleased', pEnd.x, pEnd.y, 0);
  await sleep(200);

  const view1 = await evalJs(`({ ...window.__prepareView.view })`);
  assert.deepStrictEqual(view1, view0, 'desktop drag of handle NEVER pans the view');
  const afterDrag = await recA();
  assert.ok(afterDrag.leadInAt != null && Math.abs(afterDrag.leadInAt - 0.375) < 0.08, `desktop drag moved leadInAt to right edge (~0.375): ${afterDrag.leadInAt}`);
  assert.strictEqual(await evalJs(`document.querySelector('.cut-pos-state').textContent`), 'moved', 'Position row reads moved');
  await shotWorld('desktop-drag-after.png', [-10, -10, IN + 10, IN + 10], 2);

  // Switch A to Inside, drag into refused corner (close to top-left corner x=2, y=0): refused style shown, release does NOT commit!
  await preset('leadInSide', 'inside');
  await typeField('.cut-lead-sweep', '90');
  const beforeRefused = (await recA()).leadInAt;
  const curJ = await evalJs(`(() => { const h = document.querySelector('#prepare-canvas .sk-lead-handle'); const r = h.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  const pBad = await screenOf(2, 0);
  await mouse('mouseMoved', curJ.x, curJ.y);
  await mouse('mousePressed', curJ.x, curJ.y, 1);
  await sleep(50);
  await mouse('mouseMoved', pBad.x, pBad.y, 1);
  await sleep(100);
  const refusedShown = await evalJs(`!!document.querySelector('#prepare-canvas .sk-lead-leg.is-refused')`);
  assert.strictEqual(refusedShown, true, 'dragging onto ROOM-failing corner shows refused style (.sk-lead-leg.is-refused)');
  await mouse('mouseReleased', pBad.x, pBad.y, 0);
  await sleep(200);
  assert.strictEqual((await recA()).leadInAt, beforeRefused, 'releasing on refused spot does NOT commit (keeps last good leadInAt)');

  // Undo sweep + side + drag via real Ctrl+Z -> verify ONE undo restores drag!
  const ctrlZ = async () => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 });
    await sleep(150);
  };
  await ctrlZ(); // undo sweep
  await ctrlZ(); // undo side
  await ctrlZ(); // undo drag
  assert.strictEqual((await recA()).leadInAt, null, 'ONE undo restores leadInAt back to null (calculated)');
  assert.strictEqual(await evalJs(`document.querySelector('.cut-pos-state').textContent`), 'calculated', 'Position row back to calculated after undo');
  console.log('leadin-arc-778-live: ok');
} finally {
  await t.close();
}
