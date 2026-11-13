// tests/dimension-redundant-driven-node.test.js - TASK 576 (node port of tests/dimension-redundant-driven-live.test.js, TASK 516), SketchStudio
// through tests/helpers/node-app.js: a dimension on a quantity the sketch already determines is placed DRIVEN (bracketed, measured value)
// and cannot be typed; a non-redundant one still opens the value box. Read from what the canvas drew (line elements in screen px, the
// dimension labels, #dimInput, the context menu and the toast), as the browser test read it. The right click is the right button press +
// the `contextmenu` event on the label (kit rightClick); the screenshots the browser test wrote as evidence are not taken.
import assert from 'node:assert';
import { open } from './helpers/node-app.js';
import { lines, labels, findLabel, labelEl, typeValue, boxOpen } from './helpers/node-dom-read.js';

const app = await open({ host: 'sketchstudio' });
let failed = null;
try {
  const r = app.svg.getBoundingClientRect();
  const cv = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  const click = (x, y) => app.click(x, y);
  const clickBtn = (id) => { app.document.getElementById(id).click(); app.frames(); };
  const clickItem = (sel) => { const e = app.document.querySelector(sel); assert(e, sel + ' not found'); e.click(); app.frames(); };
  const menu = () => { const m = app.document.querySelector('.sk-context-menu'); if (!m) return null; return [...m.querySelectorAll('.sk-context-item')].map((i) => ({ id: i.dataset.id, checked: i.getAttribute('aria-checked') })); };
  const toasts = () => [...app.document.querySelectorAll('#notification-container pre')].map((e) => e.textContent.trim());
  const corners = () => { const xs = lines(app).flat(); return { x0: Math.min(...xs.map((p) => p.x)), x1: Math.max(...xs.map((p) => p.x)), y0: Math.min(...xs.map((p) => p.y)), y1: Math.max(...xs.map((p) => p.y)) }; };
  const dblClickLabel = (lab) => app.dblclick(lab.x, lab.y, { target: () => labelEl(app, lab.idx) });
  const rightClickLabel = (lab) => app.rightClick(lab.x, lab.y, { target: () => labelEl(app, lab.idx) });

  // a rectangle, one corner locked, width and height dimensioned: fully constrained. Each of these two dimensions is NOT redundant, so
  // typeValue (which waits for the value box to open) is the check that a non-redundant dimension still opens the box and its typed value drives.
  clickBtn('tool-rect');
  app.drag({ x: cv.x - 120, y: cv.y - 100 }, { x: cv.x + 120, y: cv.y + 100 }, 8);
  clickBtn('tool-select');
  let R = corners();
  app.rightClick(R.x0, R.y0); // the rectangle's corner: its context menu (Lock)
  clickItem('.sk-context-menu .sk-context-item[data-id="geo-lock"]');
  const dimPts = async (a, b, drop, val) => { clickBtn('tool-dim'); click(a.x, a.y); click(b.x, b.y); app.move(drop.x, drop.y); click(drop.x, drop.y); if (val) await typeValue(app, val); };
  await dimPts({ x: R.x0, y: R.y0 }, { x: R.x1, y: R.y0 }, { x: (R.x0 + R.x1) / 2, y: R.y0 - 60 }, '3');
  R = corners();
  await dimPts({ x: R.x1, y: R.y0 }, { x: R.x1, y: R.y1 }, { x: R.x1 + 60, y: (R.y0 + R.y1) / 2 }, '3');
  R = corners();
  // ---------------------------------------------------------------- 1. the diagonal of the fully constrained square is placed DRIVEN
  const bracketed = () => findLabel(app, (t) => t.startsWith('('));
  const plainWith = (re) => findLabel(app, (t) => !t.startsWith('(') && re.test(t));
  clickBtn('tool-dim');
  click(R.x0, R.y0); click(R.x1, R.y1);
  app.move((R.x0 + R.x1) / 2 + 40, (R.y0 + R.y1) / 2 - 40);
  click((R.x0 + R.x1) / 2 + 40, (R.y0 + R.y1) / 2 - 40);
  assert.strictEqual(boxOpen(app), false, 'no value box opens for a dimension the square already determines');
  let L = labels(app);
  assert.strictEqual(L.length, 3, 'three dimension labels: ' + JSON.stringify(L));
  assert(L.some((t) => /^\(4\.2\)$/.test(t)), 'the diagonal is bracketed at its measured value 4.2: ' + JSON.stringify(L));

  // ---------------------------------------------------------------- 2. a driven dimension cannot be typed: double click in the Dimension tool and in the Select tool
  let c = bracketed(); assert(c, 'the bracketed diagonal label is on screen');
  dblClickLabel(c);
  assert.strictEqual(boxOpen(app), false, 'double click on the driven diagonal (Dimension tool): no value box');
  clickBtn('tool-select');
  c = bracketed(); assert(c, 'the bracketed diagonal label is on screen');
  dblClickLabel(c);
  assert.strictEqual(boxOpen(app), false, 'double click on the driven diagonal (Select tool): no value box');
  assert.deepStrictEqual(labels(app), L, 'nothing changed');

  // ---------------------------------------------------------------- 3. right-click Driving on it is refused while the square determines it
  c = bracketed(); assert(c, 'the bracketed diagonal label is on screen');
  rightClickLabel(c);
  const m = menu();
  assert(m && m.some((i) => i.id === 'dim-driving'), 'the dimension menu has Driving: ' + JSON.stringify(m));
  clickItem('.sk-context-menu .sk-context-item[data-id="dim-driving"]');
  assert.deepStrictEqual(labels(app), L, 'still bracketed (driven) after the refused Driving');
  assert(toasts().some((t) => /already determines it/i.test(t)), 'the refusal message is shown: ' + JSON.stringify(toasts()));

  // ---------------------------------------------------------------- 3b. delete one side dimension: now Driving works and the value can be typed
  const side = plainWith(/3[.]0/); assert(side, 'a side dimension label is on screen');
  app.click(side.x, side.y, { target: () => labelEl(app, side.idx) }); app.key('Delete');
  L = labels(app);
  assert.strictEqual(L.length, 2, 'one side dimension deleted: ' + JSON.stringify(L));
  c = bracketed(); assert(c, 'the bracketed diagonal label is on screen');
  rightClickLabel(c);
  clickItem('.sk-context-menu .sk-context-item[data-id="dim-driving"]');
  L = labels(app);
  assert(L.every((t) => !/^\(/.test(t)), 'the diagonal is driving now (no brackets): ' + JSON.stringify(L));
  const lab = plainWith(/4[.][0-9]/); assert(lab, 'the driving diagonal label is on screen');
  dblClickLabel(lab);
  assert.strictEqual(boxOpen(app), true, 'double click on the now-driving diagonal opens the value box');
  app.esc();
  console.log('516 node: ok');
} catch (e) { failed = e; } finally { await app.close(); }
if (failed) { console.error(failed.stack || failed.message || failed); process.exitCode = 1; }
