// tests/dimension-point-line-node.test.js - TASK 576 (node port of tests/dimension-point-line-live.test.js, TASK 520), SketchStudio through
// tests/helpers/node-app.js: the Dimension tool's
//  A. point-to-line dimension (click a point, then the line): is driving, holds the PERPENDICULAR distance when the line is swung by a drag,
//     a typed value drives it, and ONE Undo click removes it.
//  B. line-to-line dimension in BOTH click orders is driving (not a reference) and positive.
// Everything is read from what the canvas drew (line elements in screen px, the dimension labels), as the browser test read it. Same
// offsets from the canvas centre (cv = the canvas rect's centre, the kit's measured 1600 x 900 rect).
import assert from 'node:assert';
import { open } from './helpers/node-app.js';
import { lines, labels, findLabel, labelEl, typeValue, px } from './helpers/node-dom-read.js';

const app = await open({ host: 'sketchstudio' });
let failed = null;
try {
  const r = app.svg.getBoundingClientRect();
  const cv = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  const click = (x, y) => app.click(x, y);
  const clickBtn = (id) => { app.document.getElementById(id).click(); app.frames(); };
  const perpPx = (p, a, b) => Math.abs(((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / Math.hypot(b.x - a.x, b.y - a.y));
  const drawLine = (x1, y1, x2, y2) => { clickBtn('tool-line'); click(x1, y1); click(x2, y2); app.esc(); };

  // ---------------------------------------------------------------- A. point to line
  drawLine(cv.x - 200, cv.y + 80, cv.x + 200, cv.y + 80);
  drawLine(cv.x - 150, cv.y - 120, cv.x + 60, cv.y - 80);
  let LN = lines(app);
  assert.strictEqual(LN.length, 2, 'two lines drawn: ' + JSON.stringify(LN));
  LN.sort((u, v) => u[0].y - v[0].y);                               // [upper line M, lower line L]
  const P = LN[0][0].x > LN[0][1].x ? LN[0][0] : LN[0][1];          // the right end of the upper line is the point to dimension

  const create = async () => {
    clickBtn('tool-dim');
    click(P.x, P.y);                                       // the point
    click(cv.x - 60, cv.y + 80);                           // the line (its middle)
    click(cv.x + 100, cv.y - 20);                          // drop the label
    await typeValue(app, '3');
  };
  const linesBefore = JSON.stringify(lines(app));
  await create();
  // ONE Undo click removes the whole dimension (value included) and leaves the lines where they were
  clickBtn('btn-undo');
  assert.strictEqual(labels(app).length, 0, 'one undo removes the dimension');
  assert.strictEqual(JSON.stringify(lines(app)), linesBefore, 'and the geometry is where it was');
  await create();
  const afterCreate = labels(app);
  assert(afterCreate.some((t) => /3\.0/.test(t) && !/\(/.test(t)), 'a driving (no parentheses) 3.0 dimension label is shown: ' + JSON.stringify(afterCreate));
  const measure = () => { const l = lines(app).sort((u, v) => u[0].y - v[0].y); const up = l[0], lo = l[1]; const pt = up[0].x > up[1].x ? up[0] : up[1]; return { pt, a: lo[0], b: lo[1], d: perpPx(pt, lo[0], lo[1]), lo }; };
  assert.strictEqual(lines(app).length, 2, 'no extra shape was added by the dimension');
  const d3 = measure().d;
  // the typed value drives: 3 -> 4.5 scales the perpendicular distance by 1.5
  { const lab = findLabel(app, () => true); assert(lab, 'the dimension label is on screen'); app.dblclick(lab.x, lab.y, { target: () => labelEl(app, lab.idx) }); } // a double click on the label opens the editor
  await typeValue(app, '4.5');
  const d45 = measure().d;
  assert(Math.abs(d45 / d3 - 1.5) < 0.02, `typed value drives the perpendicular distance: 3 -> 4.5 scaled it by ${(d45 / d3).toFixed(3)} (px ${d3.toFixed(1)} -> ${d45.toFixed(1)})`);

  // swing the long line: a drag of its right end; the perpendicular distance must hold
  clickBtn('tool-select');
  const m0 = measure();
  const end = m0.b.x > m0.a.x ? m0.b : m0.a;                      // the right end of the long line
  app.drag(end, { x: end.x, y: end.y - 70 }, 8);
  const m1 = measure();
  assert(Math.abs(m1.lo[0].y - m0.lo[0].y) + Math.abs(m1.lo[1].y - m0.lo[1].y) + Math.abs(m1.pt.y - m0.pt.y) > 20, 'the drag moved the geometry');
  assert(Math.abs(m1.d - d45) / d45 < 0.02, `after swinging the line the perpendicular distance holds: ${d45.toFixed(1)} px -> ${m1.d.toFixed(1)} px`);
  console.log('A. point-to-line: ok');

  // ---------------------------------------------------------------- B. line to line, both click orders
  app.state.clearDocument(); app.frames();
  drawLine(cv.x - 200, cv.y - 100, cv.x + 100, cv.y - 100);
  drawLine(cv.x - 200, cv.y + 100, cv.x + 100, cv.y + 100);
  for (const [first, second, name] of [[-100, 100, 'upper line then lower line'], [100, -100, 'lower line then upper line']]) {
    clickBtn('tool-dim');
    click(cv.x - 50, cv.y + first); click(cv.x - 50, cv.y + second);
    click(cv.x + 180, cv.y);                          // drop the label
    await app.waitFor(() => { const i = app.document.getElementById('dimInput'); return !!i && !i.classList.contains('hidden'); }, 'the value input after dropping the line-line label');
    await app.waitFor(() => app.document.activeElement && app.document.activeElement.id === 'dimInput', 'the value input to take focus (the app focuses it after the drop)');
    app.enter();   // accept the measured value
    const ls = labels(app);
    assert(ls.length >= 1, name + ': a dimension label exists: ' + JSON.stringify(ls));
    const t = ls[ls.length - 1];
    assert(!/\(/.test(t) && !/-/.test(t) && /\d/.test(t), name + ': the label is a positive, driving (no parentheses) value: ' + t);
    clickBtn('btn-undo');
    assert.strictEqual(labels(app).length, 0, name + ': one undo removes it');
  }
  console.log('B. line-to-line: ok in both click orders');
} catch (e) { failed = e; } finally { await app.close(); }
if (failed) { console.error(failed.stack || failed.message || failed); process.exitCode = 1; }
