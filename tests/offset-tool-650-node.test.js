// tests/offset-tool-650-node.test.js - TASK 650: the OFFSET tool in the real app (tests/helpers/node-app.js: the page's own modules, its ribbon,
// input-manager, renderer, history and autosave; SketchStudio's own tool switch). The ribbon: Offset in the Modify group after Mirror (also in
// Shaper and Pen Plotter, the shared ribbon). The flow on an L of two lines drawn with the Line tool:
//   pick a line -> the chain (both lines) lights up, the distance box opens with the remembered 5, the preview follows the cursor side and flips;
//   Esc -> nothing made, no undo step; pick again, type 5, Enter -> two new lines 5 from their sources, joined, ONE offset dimension drawn as a
//   label; ONE Undo removes all of it, Redo brings it back; a double click on the label + 8 + Enter moves the offset chain to 8;
//   on touch: tap a line, tap a side, the green check applies.
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { labelEl, labelBoxCenter } from './helpers/node-dom-read.js';

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };

// ---- the ribbon in the hosts that mount it here: Offset in Modify, right after Mirror
for (const host of ['sketchstudio', 'shaper', 'penplotter']) {
  const profile = await createProfile();
  await createNamedDesign(profile, host, 'Offset 650 ' + host);
  const app = await open({ host, profile });
  try {
    const b = app.document.getElementById('tool-offset');
    const g = b && b.closest('.sk-ribbon-group');
    ok(b && g.querySelector('.sk-ribbon-group-label').textContent === 'Modify' && b.textContent.trim() === 'Offset', `${host}: an Offset button in the Modify group`);
    const tools = [...g.querySelectorAll('.sk-ribbon-btn')].map((x) => x.id);
    ok(tools.indexOf('tool-offset') === tools.indexOf('tool-mirror') + 3, `${host}: Offset after Mirror and the two pattern tools, task 658 (${tools})`);
    ok(b.querySelector('svg.sk-ribbon-ic'), `${host}: an inline icon in the ribbon's icon style`);
  } finally { await app.close(); }
}

const profile = await createProfile();
await createNamedDesign(profile, 'sketchstudio', 'Offset 650 flow');
const app = await open({ host: 'sketchstudio', profile });
try {
  const st = app.state, doc = app.document;
  const r = app.svg.getBoundingClientRect();
  const C = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  const at = (dx, dy) => ({ x: C.x + dx, y: C.y + dy });
  const click = (p, o) => app.click(p.x, p.y, o);
  const box = () => doc.getElementById('offset-distance-input');
  const preview = () => [...app.svg.querySelectorAll('#offset-tool-overlay .offset-preview')];
  const lit = () => app.svg.querySelectorAll('#offset-tool-overlay .offset-chain').length;
  const offsets = () => st.constraints.filter((c) => c.type === 'offset');
  // zoom out until 100 px is more than 15 mm, so the L's sides are long against a 5 mm offset
  for (let i = 0; i < 20 && Math.abs(app.toScreen(15, 0).x - app.toScreen(0, 0).x) > 100; i++) app.wheel(C.x, C.y, 300);
  ok(Math.abs(app.toScreen(15, 0).x - app.toScreen(0, 0).x) <= 100, 'zoomed out: 15 mm within 100 px');
  // the L: from the top down to the corner, then right
  const P1 = at(-200, -150), P2 = at(-200, 120), P3 = at(150, 120);
  app.tool('line'); click(P1); click(P2); click(P3); app.esc();
  app.tool('select');
  ok(st.shapes.filter((s) => s.type === 'line').length === 2, 'the L is drawn: two lines');
  const src = st.shapes.slice();
  const vertical = src.find((s) => { const a = st.joints.get(s.joints[0]), b = st.joints.get(s.joints[1]); return Math.abs(a.x - b.x) < 1e-6; });
  const srcX = st.joints.get(vertical.joints[0]).x;
  const h0 = st.history.length, n0 = st.shapes.length, c0 = st.constraints.length;

  // ---- pick, the preview follows the cursor side, Esc cancels
  app.tool('offset');
  const onVertical = at(-200, -20), inside = at(-120, -20), outside = at(-280, -20);
  click(onVertical);
  ok(box() && parseFloat(box().value) === 5, `the distance box opens with the remembered 5 (${box() && box().value})`);
  ok(doc.activeElement === box(), 'the box has the focus');
  ok(lit() === 2, `the connected chain (both lines) lights up (${lit()})`);
  app.move(inside.x, inside.y);
  const pxOf = () => { const l = preview().find((e) => Math.abs(+e.getAttribute('x1') - +e.getAttribute('x2')) < 1e-6); return l ? +l.getAttribute('x1') : null; };
  const xin = pxOf();
  ok(preview().length === 2 && Math.abs(Math.abs(xin - srcX) - 5) < 1e-6, `the preview: two lines, the vertical one 5 from its source (${xin} vs ${srcX})`);
  app.move(outside.x, outside.y);
  const xout = pxOf();
  ok(Math.abs(Math.abs(xout - srcX) - 5) < 1e-6 && Math.sign(xout - srcX) === -Math.sign(xin - srcX), `moving to the other side flips it (${xout})`);
  app.move(inside.x, inside.y);
  app.esc();
  ok(!box() && !app.svg.querySelector('#offset-tool-overlay'), 'Esc: the box and the preview are gone');
  ok(st.shapes.length === n0 && st.constraints.length === c0 && st.history.length === h0, 'Esc: nothing made, no undo step');

  // ---- pick, type 5, Enter: ONE undo step
  click(onVertical); app.move(inside.x, inside.y);
  box().select(); app.type('5'); app.enter();
  ok(!box(), 'Enter: the box closes');
  ok(st.shapes.length === n0 + 2 && offsets().length === 1, `Enter: two new lines and one offset constraint (${st.shapes.length - n0}, ${offsets().length})`);
  ok(st.history.length === h0 + 1, `ONE undo step (${st.history.length - h0})`);
  const off = offsets()[0];
  const offIds = off.shapes.filter((_, i) => i % 2 === 1);
  const offLines = offIds.map((id) => st.shapes.find((s) => s.id === id));
  ok(offLines[0].joints.some((j) => offLines[1].joints.includes(j)), 'the two new lines share their corner joint (joined)');
  const offVertical = offLines.find((s) => { const a = st.joints.get(s.joints[0]), b = st.joints.get(s.joints[1]); return Math.abs(a.x - b.x) < 1e-6; });
  const xNow = () => st.joints.get(offVertical.joints[0]).x;
  ok(Math.abs(Math.abs(xNow() - srcX) - 5) < 1e-6 && Math.sign(xNow() - srcX) === Math.sign(xin - srcX), `the offset lies 5 from its source on the cursor side (${xNow()})`);
  const idx = st.constraints.indexOf(off);
  const lab = labelEl(app, idx);
  ok(lab && /5/.test(lab.textContent), `the offset dimension is drawn as a label (${lab && lab.textContent.trim()})`);
  ok(off.name && /^d\d+$/.test(off.name) && !off.isDriven, `it is a driving named dimension (${off.name})`);

  // ---- ONE Undo removes all of it; Redo brings it back
  app.undo();
  ok(st.shapes.length === n0 && offsets().length === 0 && st.constraints.length === c0, 'one Undo removes the two lines and the dimension');
  app.redo();
  ok(st.shapes.length === n0 + 2 && offsets().length === 1, 'Redo brings them back');

  // ---- the dimension edit: double click the label, 8, Enter -> the chain moves to 8
  app.tool('select');
  const o2 = offsets()[0], i2 = st.constraints.indexOf(o2);
  const center = labelBoxCenter(app, labelEl(app, i2));
  await app.pause(550);
  app.dblclick(center.x, center.y, { target: () => labelEl(app, i2) });
  const dimInput = doc.getElementById('dimInput');
  ok(dimInput && !dimInput.classList.contains('hidden'), 'a double click on the offset label opens the dimension box');
  dimInput.select(); app.type('8'); app.enter();
  const ov = st.shapes.find((s) => s.id === o2.shapes[o2.shapes.indexOf(vertical.id) + 1]);
  const x8 = st.joints.get(ov.joints[0]).x;
  ok(o2.value === 8 && Math.abs(Math.abs(x8 - srcX) - 8) < 1e-4, `editing the dimension to 8 moves the offset chain (${x8} vs ${srcX})`);
  ok(Math.abs(st.joints.get(vertical.joints[0]).x - srcX) < 1e-6, 'the source stays');

  // ---- touch: tap a line, tap the side, the green check
  app.tool('offset');
  const n1 = st.shapes.length, h1 = st.history.length;
  const horiz = at(0, 120), below = at(0, 200);
  click(horiz, { pointerType: 'touch' });
  ok(box(), 'touch: a tap on a line opens the box');
  click(below, { pointerType: 'touch' });
  const check = doc.querySelector('.sk-done');
  ok(check && !check.hidden && check.getAttribute('aria-label') === 'Apply the offset', `touch: the green check shows (${check && check.getAttribute('aria-label')})`);
  check.click(); app.frames();
  ok(!box() && st.shapes.length > n1 && st.history.length === h1 + 1, 'touch: the check applies the offset (one undo step)');
  const last = offsets()[offsets().length - 1];
  const yOf = (id) => { const s = st.shapes.find((x) => x.id === id); return s && st.joints.get(s.joints[0]).y; };
  const srcH = src.find((s) => s !== vertical);
  const dy = yOf(last.shapes[last.shapes.indexOf(srcH.id) + 1]) - st.joints.get(srcH.joints[0]).y;
  ok(Math.abs(Math.abs(dy) - 5) < 1e-6, `touch: the offset is 5 from the line, on the tapped side (dy ${dy})`);
  const ySrc = st.joints.get(srcH.joints[0]).y, side = Math.sign(app.toScreen(0, ySrc + dy).y - app.toScreen(0, ySrc).y);
  ok(side === Math.sign(below.y - horiz.y), `touch: the offset is on the tapped side (screen direction ${side})`);
} finally { await app.close(); }

console.log(`offset-tool-650-node: ${checks} checks passed`);
