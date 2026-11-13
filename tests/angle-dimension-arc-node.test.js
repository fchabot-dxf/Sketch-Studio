// tests/angle-dimension-arc-node.test.js — TASK 580 (node port of tests/angle-dimension-arc-live.test.js, TASK 543 / 553), SketchStudio through
// tests/helpers/node-app.js. The owner's document (two lines 10 degrees apart, ANGLE value 10 whose label sat in the 170 degree sector), stored as the
// current design and loaded by the app's own restore path (createNamedDesign with the document, then open()).
//  A. the drawn arc spans 10 degrees (read back from the SVG path the shared renderer drew, in world units), between the two line directions, label 10.0
//  B. a drag of the label across the vertex into the other sectors never changes what the arc measures (10) and moves no geometry
//  C. creation: the drop sector decides the value (task 543); D. typed past 180 (190, 270: the reflex arc, label inside), 0 refused (task 553)
// What is read where: the arc and the lines from the drawn elements, as the browser test did; the label's centre (the browser read its rect) from the
// world position the renderer stored on the constraint (glyphPos), which is where it draws the label. Not here: the screenshots (evidence, no assert).
// The browser test's wheel zoom-out is a WheelEvent on the canvas; its "Clear All + reload for the default view" is a fresh page on a fresh profile.
import assert from 'node:assert';
import fs from 'node:fs';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { boxOpen, labelEl, labelBoxCenter, px } from './helpers/node-dom-read.js';

const OWNER = JSON.parse(fs.readFileSync(new URL('./fixtures/angle-dimension/owner-trapezoid-angle.json', import.meta.url), 'utf8'));
const RADIUS = OWNER.geometry.constraints.find((c) => c.type === 'angle').offset;   // the arc is the SVG arc path with this radius
const INT = { x: 587.4900947223791, y: 7584.647136653884 };                        // the lines' intersection (computed from the document)

const profile = await createProfile();
await createNamedDesign(profile, 'sketchstudio', 'owner-543', OWNER);
let app = await open({ host: 'sketchstudio', profile });
try {
  const ARC_RE = /^M ([-\d.e]+) ([-\d.e]+) A ([-\d.e]+) [-\d.e]+ 0 ([01]) 1 ([-\d.e]+) ([-\d.e]+)$/;
  const arcs = () => [...app.svg.querySelectorAll('path')].map((p) => ARC_RE.exec(p.getAttribute('d') || '')).filter(Boolean);
  // the angle dimension's arc as drawn: its two end points in WORLD units (the path is in world coordinates)
  const arc = () => { const m = arcs().find((x) => Math.abs(+x[3] - RADIUS) < 1); return m && { sx: +m[1], sy: +m[2], large: +m[4], ex: +m[5], ey: +m[6] }; };
  const spanOf = (a) => { const d = (x) => Math.atan2(x.y - INT.y, x.x - INT.x) * 180 / Math.PI; return ((d({ x: a.ex, y: a.ey }) - d({ x: a.sx, y: a.sy })) % 360 + 360) % 360; };
  const centerOfLabel = () => labelBoxCenter(app);
  const labelTarget = (idx) => () => labelEl(app, idx);
  const lineRows = () => JSON.stringify([...app.svg.querySelectorAll('line.shape-elem')].map((e) => [e.getAttribute('x1'), e.getAttribute('y1'), e.getAttribute('x2'), e.getAttribute('y2')]));
  const labels = () => [...app.svg.querySelectorAll('.dim-label')].map((e) => e.textContent.replace(/\s+/g, ''));
  const boxReady = async () => { await app.waitFor(() => boxOpen(app) && app.document.activeElement && app.document.activeElement.id === 'dimInput', 'the dimension box to open and take the focus'); };
  const clickBtn = (id) => { app.document.getElementById(id).click(); app.frames(); };

  assert(app.svg.querySelector('.dim-label'), 'the owner dimension is drawn');
  // the dimension sits 19757 units from the vertex, past the top of the first fit: a wheel zoom-out brings the whole dimension into view
  { const r = app.svg.getBoundingClientRect(); app.wheel(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2), 700); }

  // ---- A. the arc spans the value
  const a0 = arc();
  assert(a0, 'the angle dimension arc is in the page');
  const span0 = spanOf(a0);
  assert(Math.abs(span0 - 10) < 0.5, `A: the drawn arc spans ${span0.toFixed(2)} degrees; the label reads 10`);
  const label0 = app.svg.querySelector('.dim-label').textContent.replace(/\s+/g, '');
  assert(/10\.0/.test(label0), 'A: the label reads 10.0: ' + label0);
  console.log('A. arc span', span0.toFixed(2), 'label', label0);

  // ---- B. a label drag into other sectors never changes what the arc measures
  app.tool('select');
  const cv = (() => { const r = app.svg.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })();
  const vertex = px(app, INT.x, INT.y);
  const stable = lineRows();
  for (const target of [{ x: cv.l + cv.w * 0.3, y: cv.t + cv.h * 0.25 }, { x: cv.l + cv.w * 0.75, y: cv.t + cv.h * 0.7 }, { x: vertex.x - 120, y: vertex.y + 40 }]) {
    const lab = centerOfLabel();
    await app.pause(550); // the app pairs two clicks on one label within 500 ms: a person's pause since the last click
    app.drag(lab, target, 10, { target: labelTarget(lab.idx) });
    const a = arc();
    assert(a, 'B: the arc is still drawn after the label drag');
    const sp = spanOf(a);
    assert(Math.abs(sp - 10) < 0.5, `B: after dragging the label to (${Math.round(target.x)},${Math.round(target.y)}) the arc spans ${sp.toFixed(2)}, not 10`);
  }
  assert.strictEqual(lineRows(), stable, 'B: the lines did not move');
  console.log('B. label dragged into other sectors: arc stays 10, geometry unchanged');

  // ---- C. CREATION: the sector the label is dropped in decides what a NEW dimension measures (Fusion: 10.00 in the 10 degree sector, 170.00 in the 170 one)
  await app.storedDoc(); await app.close();
  app = await open({ host: 'sketchstudio', profile: await (async () => { const p = await createProfile(); await createNamedDesign(p, 'sketchstudio'); return p; })() }); // an empty design at the default view
  const r = app.svg.getBoundingClientRect();
  const C = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  const corner = { x: C.x - 250, y: C.y + 100 };
  const click = (p) => app.click(p.x, p.y);
  const drawLine = (a, b) => { app.tool('line'); click(a); click(b); app.esc(); };
  drawLine(corner, { x: corner.x + 400, y: corner.y });                       // line A: along +x
  drawLine(corner, { x: corner.x + 346, y: corner.y - 200 });                 // line B: 30 degrees above it, sharing the corner
  const create = async (drop, text) => {
    app.tool('dim');
    click({ x: corner.x + 200, y: corner.y });                                // line A
    click({ x: corner.x + 173, y: corner.y - 100 });                          // line B
    click(drop);                                                              // drop the label in the chosen sector
    await boxReady();
    const shown = parseFloat(app.document.getElementById('dimInput').value);
    if (text) { app.document.getElementById('dimInput').select(); app.type(text); }
    app.enter();
    return shown;
  };
  const editTo = async (text) => {
    const lab = centerOfLabel();
    await app.pause(550); // the app pairs two clicks on one label within 500 ms: a person's pause since the last click
    app.dblclick(lab.x, lab.y, { target: labelTarget(lab.idx) });
    await boxReady();
    app.document.getElementById('dimInput').select(); app.type(text); app.enter();
  };
  const narrow = await create({ x: corner.x + 300, y: corner.y - 40 });       // inside the 30 degree sector
  const t1 = labels().pop();
  clickBtn('btn-undo');
  assert.strictEqual(labels().length, 0, 'C: one undo removes the narrow dimension');
  const wide = await create({ x: corner.x + 120, y: corner.y + 120 });        // inside the 150 degree sector below line A
  const t2 = labels().pop();
  console.log('C. label in the narrow sector reads', narrow, '(' + t1 + '), in the wide sector', wide, '(' + t2 + ')');
  assert(Math.abs(narrow - 30) < 2, 'C: the narrow sector measures about 30: ' + narrow);
  assert(Math.abs(narrow + wide - 180) < 0.2, `C: the two sectors are supplements (30 + 150): ${narrow} + ${wide}`);
  assert(t1.includes(narrow.toFixed(1)) && t2.includes(wide.toFixed(1)), 'C: the labels read what the value box showed: ' + t1 + ' / ' + t2);
  // the wide dimension drives: typing 120 re-solves the lines so that sector is 120 (the lines were 150 apart in that sector)
  await editTo('120');
  const t3 = labels().pop();
  assert(t3.includes('120.0'), 'C: the wide dimension was edited to 120: ' + t3);
  console.log('C. wide-sector dimension typed to 120 holds:', t3);

  // ---- D. TASK 553: past 180 like Fusion. A new dimension in the 30 sector typed 190, then 270 in the value box: the sector keeps opening
  // the same way round, the arc is drawn over the reflex sector (large-arc flag 1) and the label sits inside it; 0 is refused.
  // The arc's span is read from the SVG path alone: its centre from the two ends, the radius and the large-arc flag (sweep flag 1).
  const anyArc = () => { const m = arcs()[0]; return m && { sx: +m[1], sy: +m[2], r: +m[3], large: +m[4], ex: +m[5], ey: +m[6] }; };
  const reflexOf = (a, glyph) => {
    const mx = (a.sx + a.ex) / 2, my = (a.sy + a.ey) / 2, hx = a.ex - a.sx, hy = a.ey - a.sy, h = Math.hypot(hx, hy) / 2;
    const d = Math.sqrt(Math.max(0, a.r * a.r - h * h)), side = a.large ? -1 : 1;
    const cx = mx + side * (-hy / (2 * h)) * d, cy = my + side * (hx / (2 * h)) * d, n = (x) => ((x % 360) + 360) % 360;
    const a0 = Math.atan2(a.sy - cy, a.sx - cx) * 180 / Math.PI, span = n(Math.atan2(a.ey - cy, a.ex - cx) * 180 / Math.PI - a0);
    return { span, labelInside: n(Math.atan2(glyph.y - cy, glyph.x - cx) * 180 / Math.PI - a0) <= span };
  };
  clickBtn('btn-undo'); clickBtn('btn-undo');           // the edit, then the wide dimension
  assert.strictEqual(labels().length, 0, 'D: back to the two lines');
  await create({ x: corner.x + 300, y: corner.y - 40 }, '190');                                        // the 30 sector, typed 190 at once
  for (const [text, want] of [['190', 190], ['270', 270]]) {
    if (text !== '190') await editTo(text);
    const a = anyArc(), g = centerOfLabel().world, rr = reflexOf(a, g), t = labels().pop();
    console.log(`D. typed ${text}: label ${t}, arc span ${rr.span.toFixed(2)}, large-arc ${a.large}, label inside ${rr.labelInside}`);
    assert(t.includes(`${want}.0`), `D: the label reads ${want}: ${t}`);
    assert(Math.abs(rr.span - want) < 0.5 && a.large === 1 && rr.labelInside, `D: the arc spans ${rr.span.toFixed(2)} (large ${a.large}, label inside ${rr.labelInside}), not ${want}`);
  }
  const before0 = lineRows();
  await editTo('0');
  if (boxOpen(app)) app.esc();
  assert(labels().pop().includes('270.0'), 'D: 0 is refused, the value stays 270');
  assert.strictEqual(lineRows(), before0, 'D: 0 moved nothing');
  console.log('D. typed 0: refused, still 270, nothing moved');
  console.log('angle-dimension-arc-node: ok');
} finally { await app.close(); }
