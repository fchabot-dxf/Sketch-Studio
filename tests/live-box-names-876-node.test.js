// tests/live-box-names-876-node.test.js -- TASK 876: the drawing tools' value boxes (the length of a line, the sides of a rectangle ...) read dimension and parameter NAMES and
// formulas the way a dimension's edit box does, keep the formula in the dimension they create, and a click on an existing dimension names it into the box being typed in.
//  A. typed by hand: "d1 / 2" in a line's length box draws a line half of d1; the new line's dimension READS d1 (its expression), and changing d1 afterwards changes the new line
//  B. an unknown name is refused like the edit box refuses it (the hint under the box, aria-invalid, Enter places nothing); the box asks for the full text keyboard
//  C. click-to-insert: only once the user has TYPED in the focused box; before that a click on the dimension's text is the drawing's own click (a point is placed)
//  D. the two-field box (a rectangle's W x H): the name goes into the field being typed in; a circle's typed diameter formula becomes its radius formula
import assert from 'node:assert';
import { open } from './helpers/node-app.js';
import { labelPoint, labelEl, boxOpen } from './helpers/node-dom-read.js';
import { parseBoxValue } from '#ui/numeric-input-manager.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const near = (a, b, m, tol = 1e-6) => { assert.ok(typeof a === 'number' && Math.abs(a - b) < tol, `${m}: ${a} vs ${b}`); checks++; };

const app = await open({ host: 'sketchstudio' });
let failed = null;
try {
  const st = app.state, doc = app.document;
  const r = app.svg.getBoundingClientRect();
  const cv = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  const click = (p) => app.click(p.x, p.y);
  const lenOf = (s) => { const a = st.joints.get(s.joints[0]), b = st.joints.get(s.joints[1]); return Math.hypot(b.x - a.x, b.y - a.y); };
  const lineShapes = () => st.shapes.filter((s) => s.type === 'line');
  const live = () => [...doc.querySelectorAll('#dualInput input, #dimInput')].filter((i) => !i.classList.contains('hidden') && !(i.closest('#dualInput') || i).classList.contains('hidden'));
  const hint = () => { const h = doc.getElementById('dimHint'); return h && !h.classList.contains('hidden') ? h.textContent : null; };
  const boxReady = async () => { await app.waitFor(() => boxOpen(app) && doc.activeElement && doc.activeElement.id === 'dimInput', 'the dimension box'); doc.getElementById('dimInput').select(); };

  // a line A-B of length 300 mm, dimensioned: d1
  const A = { x: cv.x - 400, y: cv.y + 150 }, B = { x: cv.x - 100, y: cv.y + 150 };
  app.tool('line'); click(A); click(B); app.esc();
  const len0 = lenOf(lineShapes()[0]);
  app.tool('select'); app.tool('dim'); click(A); click(B);
  const m = { x: (A.x + B.x) / 2, y: A.y - 40 }; app.move(m.x, m.y); click(m);
  await boxReady(); app.enter();
  app.tool('select');
  const d1 = st.constraints.find((c) => c.name === 'd1');
  assert.ok(d1, 'the first line has its dimension d1');
  near(d1.value, len0, 'd1 is the line length');
  const d1pt = () => { const idx = st.constraints.findIndex((c) => c.name === 'd1'); return { idx, ...labelPoint(app, idx) }; };

  // ---- A. typed by hand: d1 / 2
  const C = { x: cv.x + 100, y: cv.y - 150 }, D = { x: cv.x + 300, y: cv.y - 150 };
  const n0 = lineShapes().length;
  app.tool('line'); click(C); app.move(D.x, D.y);
  app.type('d1 / 2');
  eq(live()[0].inputMode, 'text', 'B. the live box asks for the full text keyboard (letters)');
  eq(hint(), null, 'A. a readable formula shows no refusal');
  app.enter();
  let made = lineShapes().slice(n0);
  eq(made.length, 1, 'A. Enter places the line');
  near(lenOf(made[0]), len0 / 2, 'A. the line is half of d1');
  const dim2 = st.constraints.find((c) => c.type === 'distance' && c !== d1 && c.joints && c.joints.includes(made[0].joints[1]));
  assert.ok(dim2, 'A. the new line has its length dimension');
  eq(dim2.expression, 'd1 / 2', 'A. the new dimension is driven by the expression');
  app.esc(); app.esc();
  // d1 changes -> the new line follows
  {
    const lab = d1pt(); assert.ok(lab, 'd1 label is on the canvas');
    app.tool('select'); await app.pause(550);
    app.dblclick(lab.x, lab.y, { target: () => labelEl(app, lab.idx) }); await boxReady();
    app.type('200'); app.enter();
    near(st.constraints.find((c) => c.name === 'd1').value, 200, 'A. d1 is now 200');
    near(lenOf(made[0]), 100, 'A. the line typed as d1 / 2 follows d1 (100)');
  }

  // ---- B. an unknown name is refused like the edit box refuses it
  {
    const n1 = lineShapes().length;
    app.tool('line'); click({ x: cv.x + 100, y: cv.y + 100 }); app.move(cv.x + 300, cv.y + 100);
    app.type('nosuch / 2');
    assert.ok(hint() && /nosuch/.test(hint()), 'B. the hint says why: ' + hint());
    eq(live()[0].getAttribute('aria-invalid'), 'true', 'B. the box is marked invalid');
    app.enter();
    eq(lineShapes().length, n1, 'B. Enter places nothing while the name is unknown');
    app.esc(); app.esc();
  }

  // ---- C. click-to-insert
  {
    const lab = () => d1pt();
    const n1 = lineShapes().length;
    // C1: nothing typed: a click on d1's text is the drawing's click (the line is placed)
    app.tool('line'); click({ x: cv.x + 100, y: cv.y }); app.move(cv.x + 200, cv.y + 10);
    const t = lab(); assert.ok(t, 'the d1 label is there');
    app.click(t.x, t.y, { target: () => labelEl(app, t.idx) });
    assert.ok(lineShapes().length > n1 || (st.active && st.active.start && lineShapes().length === n1), 'C1: the click was a drawing click');
    app.esc(); app.esc();
    // C2: typed in the box (then deleted): a click on d1's text inserts "d1", no point is placed
    const n2 = lineShapes().length;
    app.tool('line'); click({ x: cv.x + 100, y: cv.y }); app.move(cv.x + 200, cv.y + 10);
    app.type('1');
    live()[0].value = ''; live()[0].dispatchEvent(new app.window.Event('input', { bubbles: true }));
    const t2 = lab();
    app.click(t2.x, t2.y, { target: () => labelEl(app, t2.idx) });
    eq(live()[0].value, 'd1', 'C2: the box reads the clicked dimension name');
    eq(lineShapes().length, n2, 'C2: the drawing got no new point');
    eq(doc.activeElement === live()[0], true, 'C2: the box stays focused');
    app.type('/2');
    eq(live()[0].value, 'd1/2', 'C2: typing goes on at the caret');
    app.enter();
    const made2 = lineShapes().slice(n2);
    eq(made2.length, 1, 'C2: Enter places the line');
    near(lenOf(made2[0]), 100, 'C2: the line is half of d1 (200 / 2)');
    app.esc(); app.esc();
  }

  // ---- D. the two-field box: the name goes into the field being typed in
  {
    const n1 = lineShapes().length;
    app.tool('rect');
    click({ x: cv.x - 300, y: cv.y - 250 }); app.move(cv.x - 200, cv.y - 200);
    app.type('5');                       // the width field
    app.key('Tab');
    const inputs = [...doc.querySelectorAll('#dualInput input')];
    inputs[1].focus(); app.type('7');     // the height field
    const t = d1pt();
    app.click(t.x, t.y, { target: () => labelEl(app, t.idx) });
    eq(inputs.map((i) => i.value), ['5', '7d1'], 'D. the name is inserted in the field being typed in, the other is untouched');
    inputs[1].value = '5'; inputs[1].dispatchEvent(new app.window.Event('input', { bubbles: true }));
    app.esc(); app.esc();
    // a circle's diameter typed as a formula: its diameter dimension reads the formula as typed (task 1008)
    app.tool('circle'); click({ x: cv.x - 300, y: cv.y - 250 }); app.move(cv.x - 200, cv.y - 200);
    app.type('d1 / 2'); app.enter();
    const cir = st.shapes.filter((s) => s.type === 'circle').pop();
    near(cir.radius, 50, 'D. a circle typed with the diameter d1 / 2 (100) has radius 50');
    const rad = st.constraints.find((c) => c.isRadius && c.shape === cir.id);
    eq(rad && rad.expression, 'd1 / 2', 'D. its diameter dimension reads the diameter formula as typed');
    app.esc(); app.esc();
  }

  // ---- the reading itself: plain numbers keep their value, a formula without a name is just its value
  near(parseBoxValue('10/2', 'length'), 5, 'a plain fraction keeps its value');
  near(parseBoxValue('d1 / 2', 'length'), 100, 'a name reads in the page state');
  assert.ok(Number.isNaN(parseBoxValue('nosuch', 'length')), 'an unknown name reads as NaN (the box refuses it)');
} catch (e) { failed = e; }
try { await app.close(); } catch (_) { /* the kit's page */ }
if (failed) { console.error(failed); process.exit(1); }
console.log(`live-box-names-876-node: ${checks} checks passed`);
